"""Local web console for stadiacast.

Starts and stops the receiver, shows each controller live (link, battery, player, buttons and
sticks), sends a test rumble, lists the receiver's recent events and edits the few settings the
receiver is started with. It listens on 127.0.0.1 only and needs nothing beyond the standard
library.

    python server.py [--port 8090]

Why a server between the page and the receiver: stadiacast refuses every control request a
browser sends on behalf of a page (any non-GET to /_* that carries an Origin header), and a
receiver that is not running has no HTTP API to start it with.
"""

from __future__ import annotations

import argparse
import collections
import http.client
import ipaddress
import json
import os
import re
import shutil
import struct
import subprocess
import threading
import time
import unicodedata
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PROJECT_DIR = HERE.parent
STATIC_DIR = HERE / "static"
CONFIG_PATH = HERE / "config.json"
CONSOLE_LOG_DIR = PROJECT_DIR / "logs"

# Copied to config.json on the first start: edit the IPs there or on the page's settings.
DEFAULT_CONFIG: dict[str, Any] = {
    "work_dir": "runtime",  # where stadiacast writes captures\<stamp>; relative to the project folder
    "dns_upstream": "192.168.1.1",  # your router, or whatever DNS your network uses
    "controllers": [
        {"name": "A", "ip": "192.168.1.201", "note": ""},
        {"name": "B", "ip": "192.168.1.202", "note": ""},
    ],
}
MAX_CONTROLLERS = 4  # the firewall rules open UDP 40000-40007: two ports per controller
RECEIVER_PORTS = (80, 8008)  # stadiacast's local HTTP endpoints; it goes on without one that is taken
START_TIMEOUT_S = 20.0
STOP_TIMEOUT_S = 15.0
MAX_BODY = 16 * 1024
STREAM_MIN_INTERVAL_S = 0.05  # at most 20 updates a second to a page
STREAM_PING_S = 15.0

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/i18n.js": ("i18n.js", "text/javascript; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; "
    "img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)

# Events of the receiver's log worth showing; the rest (rpc_in, input, rtc_stats...) is noise here.
LOG_EVENTS = frozenset(
    {
        "ready",
        "stopped",
        "dns_sink_started",
        "controller_new",
        "controller_hardware",
        "display_state",
        "dtls_connected",
        "dtls_closed_by_peer",
        "boot_state_reset",
        "game_started",
        "game_closed",
        "gamepad_created",
        "port_busy",
    }
)
LOG_PROBLEM = re.compile(r"fail|error|exited|evict|unanswered|unattributed|alert")
EVENT_NAME = re.compile(rb'"event": "([a-z0-9_]+)"')
DETAIL_KEYS = (
    "display_state",
    "code",
    "ip",
    "serial",
    "product",
    "firmware",
    "kind",
    "slot",
    "helper",
    "alert",
    "reason",
    "error",
    "output",
)
RUN_STAMP = re.compile(r"(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})")
LOG_EVENTS_KEPT = 300
LOG_EVENTS_SENT = 150
LOG_READ_CHUNK = 16 * 1024 * 1024
LINKED_STATES = ("ready", "input")  # display_state values of a controller whose link is up
BATTERY_FETCH_TRIES = 5


def battery_from_status(doc: Any, label: str) -> int | None:
    """The battery level the controller had when it connected, in percent.

    The controller reports its battery (``ControllerToDisplay`` #10, ``battery_percent``) only
    when the level moves by a percent: a few minutes after it connects, and never while the level
    holds, as on a full charge. Its ``GetControllerStateResponse``, answered on every connection,
    carries the level too: field 10, the bits of a float 0..1, which stadiacast keeps as the
    integer ``f10``. On two controllers it read 0.24, 0.21, 0.48 and 0.26 where the first reports
    that followed were 25, 22, 47 and 27 % (docs\\battery.md).
    """
    try:
        raw = doc["controllers"][label]["session"]["display"]["controller_state"]["f10"]
    except (KeyError, TypeError):
        return None
    if not isinstance(raw, int) or isinstance(raw, bool) or not 0 <= raw < 2**32:
        return None
    level = struct.unpack("<f", struct.pack("<I", raw))[0]
    if not 0.0 <= level <= 1.0:  # NaN fails this too
        return None
    return round(level * 100)


def text(zh: str, en: str) -> dict[str, str]:
    """A message for the page in both of its languages; the page shows the one it is in."""
    return {"zh": zh, "en": en}


class ConsoleError(Exception):
    """A request the console refuses: the HTTP status and a message for the page, in both languages."""

    def __init__(self, status: int, zh: str, en: str | None = None) -> None:
        super().__init__(en or zh)
        self.status = status
        self.text = text(zh, en or zh)


# --- settings ------------------------------------------------------------------------------------


def _text(value: Any, what: tuple[str, str], longest: int, *, required: bool) -> str:
    zh, en = what
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ConsoleError(400, f"{zh}必须是文字", f"{en} must be text")
    value = value.strip()
    if required and not value:
        raise ConsoleError(400, f"{zh}不能为空", f"{en} cannot be empty")
    if len(value) > longest:
        raise ConsoleError(400, f"{zh}最多 {longest} 个字符", f"{en} has at most {longest} characters")
    if any(unicodedata.category(ch).startswith("C") for ch in value):
        raise ConsoleError(400, f"{zh}含有不可见字符", f"{en} contains invisible characters")
    return value


def _ipv4(value: Any, what: tuple[str, str], *, private: bool = False) -> str:
    zh, en = what
    try:
        addr = ipaddress.IPv4Address(str(value).strip())
    except ValueError:
        raise ConsoleError(400, f"{zh}：{value} 不是有效的 IPv4 地址", f"{en}: {value} is not a valid IPv4 address") from None
    if private and not addr.is_private:
        raise ConsoleError(400, f"{zh}：{addr} 不是局域网地址", f"{en}: {addr} is not a LAN address")
    return str(addr)


def work_path(cfg: dict[str, Any]) -> Path:
    """The receiver's working directory: ``work_dir``, relative to the project folder."""
    return (PROJECT_DIR / cfg["work_dir"]).resolve()


def validate_config(raw: Any) -> dict[str, Any]:
    """The settings, checked: the work folder, the upstream DNS, and 1 to 4 controllers."""
    if not isinstance(raw, dict):
        raise ConsoleError(400, "配置格式不对", "The settings are malformed")
    folder = raw.get("work_dir")
    if not isinstance(folder, str) or not folder.strip():
        raise ConsoleError(400, "work_dir 必须是一个文件夹路径", "work_dir must be a folder path")
    folder = folder.strip()
    try:
        (PROJECT_DIR / folder).resolve().mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise ConsoleError(400, f"无法创建工作目录 {folder}：{e}", f"Cannot create the work folder {folder}: {e}") from None
    controllers = raw.get("controllers")
    if not isinstance(controllers, list) or not 1 <= len(controllers) <= MAX_CONTROLLERS:
        raise ConsoleError(400, f"手柄数量应为 1 到 {MAX_CONTROLLERS} 只", f"Give 1 to {MAX_CONTROLLERS} controllers")
    checked: list[dict[str, str]] = []
    names: set[str] = set()
    ips: set[str] = set()
    for i, c in enumerate(controllers, 1):
        if not isinstance(c, dict):
            raise ConsoleError(400, f"第 {i} 只手柄的格式不对", f"Controller {i} is malformed")
        name = _text(c.get("name"), (f"第 {i} 只手柄的名称", f"The name of controller {i}"), 20, required=True)
        ip = _ipv4(c.get("ip"), (f"手柄 {name} 的 IP", f"The IP of controller {name}"), private=True)
        note = _text(c.get("note"), (f"手柄 {name} 的备注", f"The note of controller {name}"), 40, required=False)
        if name.casefold() in names:
            raise ConsoleError(400, f"手柄名称重复：{name}", f"Two controllers are named {name}")
        if ip in ips:
            raise ConsoleError(400, f"手柄 IP 重复：{ip}", f"Two controllers have the IP {ip}")
        names.add(name.casefold())
        ips.add(ip)
        checked.append({"name": name, "ip": ip, "note": note})
    return {
        "work_dir": folder,
        "dns_upstream": _ipv4(raw.get("dns_upstream"), ("上游 DNS", "The upstream DNS")),
        "controllers": checked,
    }


def save_config(cfg: dict[str, Any]) -> None:
    tmp = CONFIG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, CONFIG_PATH)


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG)
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return validate_config(json.load(fh))


def receiver_args(cfg: dict[str, Any]) -> list[str]:
    """The flags that worked on a Windows PC behind OpenWrt (docs\\guide.md explains each one).
    scripts\\start-stadiacast.ps1 starts the receiver with the same list: change both together."""
    return [
        "--preset", "live",
        "--no-sntp",  # w32time holds UDP 123; the controller takes the time from HTTP
        "--dns-upstream", cfg["dns_upstream"],
        "--controller-ip", cfg["controllers"][0]["ip"],  # picks the interface that faces the controllers
        "--dns-redirect", "time.google.com,clients3.google.com",
        "--stadiaconfig", "json:{}",
        "--gamepad", "vigem",
    ]  # fmt: skip


def find_receiver() -> str | None:
    found = shutil.which("stadiacast")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "stadiacast.exe"
    return str(fallback) if fallback.exists() else None


# --- the receiver's HTTP API --------------------------------------------------------------------


class ReceiverApi:
    """stadiacast's local endpoints, called from here, where no Origin header is sent."""

    def __init__(self) -> None:
        self.port = RECEIVER_PORTS[0]

    @staticmethod
    def _call(port: int, method: str, path: str, body: Any, timeout: float) -> tuple[int, Any]:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
        try:
            payload = None if body is None else json.dumps(body).encode()
            headers = {"Content-Type": "application/json"} if payload is not None else {}
            conn.request(method, path, body=payload, headers=headers)
            resp = conn.getresponse()
            status, data = resp.status, resp.read()
        finally:
            conn.close()
        try:
            doc = json.loads(data) if data else None
        except ValueError:
            doc = None
        return status, doc

    def probe(self) -> dict[str, Any] | None:
        """``/_status`` of a running receiver, from whichever of its ports answers as stadiacast."""
        for port in (self.port, *(p for p in RECEIVER_PORTS if p != self.port)):
            try:
                status, doc = self._call(port, "GET", "/_status", None, 3.0)
            except (OSError, http.client.HTTPException):
                continue
            if status == 200 and isinstance(doc, dict) and "version" in doc and "controllers" in doc:
                self.port = port
                return doc
        return None

    def request(self, method: str, path: str, body: Any = None, timeout: float = 5.0) -> tuple[int, Any]:
        try:
            return self._call(self.port, method, path, body, timeout)
        except (OSError, http.client.HTTPException) as e:
            raise ConsoleError(502, f"连不上 stadiacast：{e}", f"Cannot reach stadiacast: {e}") from None


# --- the receiver's event log -------------------------------------------------------------------


class LogTail:
    """Follows a run's server.jsonl and keeps the recent events worth showing."""

    def __init__(self) -> None:
        self.path: Path | None = None
        self.offset = 0
        self.partial = b""
        self.events: collections.deque[dict[str, Any]] = collections.deque(maxlen=LOG_EVENTS_KEPT)
        self.seq = 0

    def poll(self, path: Path | None) -> int:
        """Read what was appended since the last poll; the number of events kept from it."""
        if path != self.path:
            self.path, self.offset, self.partial = path, 0, b""
            self.events.clear()
            self.seq += 1
        if path is None:
            return 0
        try:
            size = path.stat().st_size
            if size < self.offset:  # a new file under the same name
                self.offset, self.partial = 0, b""
                self.events.clear()
            if size == self.offset:
                return 0
            with open(path, "rb") as fh:
                fh.seek(self.offset)
                chunk = fh.read(LOG_READ_CHUNK)
        except OSError:
            return 0
        self.offset += len(chunk)
        lines = (self.partial + chunk).split(b"\n")
        self.partial = lines.pop()
        kept = 0
        for line in lines:
            m = EVENT_NAME.search(line, 0, 200)
            if not m:
                continue
            name = m.group(1).decode()
            if name not in LOG_EVENTS and not LOG_PROBLEM.search(name):
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            self.events.append(self._compact(rec))
            kept += 1
        self.seq += kept
        return kept

    @staticmethod
    def _compact(rec: dict[str, Any]) -> dict[str, Any]:
        detail: dict[str, Any] = {}
        for key in DETAIL_KEYS:
            value = rec.get(key)
            if value is None or value == "":
                continue
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            if isinstance(value, str) and len(value) > 200:
                value = value[:200] + "…"
            detail[key] = value
        return {"ts": rec.get("ts"), "event": rec.get("event"), "controller": rec.get("controller"), "detail": detail}


# --- the console's state ------------------------------------------------------------------------


class Console:
    """What the page shows, kept current by two threads: one follows the receiver's /_events
    stream, one its log. ``cond`` wakes the page streams whenever something changed."""

    def __init__(self, api: ReceiverApi) -> None:
        self.api = api
        self.cond = threading.Condition()  # an RLock underneath: methods below nest freely
        self.seq = 0
        self.cfg = load_config()
        self.phase = "unknown"  # unknown | stopped | starting | running | stopping | failed
        self.message: dict[str, str] | None = None  # text(zh, en)
        self.reachable = False
        self.status: dict[str, Any] | None = None  # version and log_dir of the running receiver
        self.live: dict[str, Any] | None = None  # the latest /_input document
        self.proc: subprocess.Popen[bytes] | None = None  # the receiver, when this console started it
        self.err_path: Path | None = None
        self.tail = LogTail()
        # Per controller label while its link is up: {"percent", "source": connect | report, "at"}.
        self.battery: dict[str, dict[str, Any]] = {}
        self.linked: set[str] = set()
        self._battery_gen: dict[str, int] = {}  # a read at connection that is still the current one

    def changed(self) -> None:
        with self.cond:
            self.seq += 1
            self.cond.notify_all()

    # The receiver comes and goes.

    def _set_reachable(self, status: dict[str, Any]) -> None:
        with self.cond:
            self.reachable = True
            self.status = {"version": status.get("version"), "log_dir": status.get("log_dir")}
            if self.phase != "stopping":
                if self.phase in ("starting", "unknown", "stopped", "failed"):
                    self.message = None
                self.phase = "running"
            self.changed()

    def _set_unreachable(self) -> None:
        with self.cond:
            before = (self.phase, self.reachable)
            self.reachable, self.live = False, None
            self.battery.clear()
            self.linked.clear()
            self._battery_gen.clear()
            if self.phase in ("running", "stopping", "unknown"):
                code = self.proc.poll() if self.proc is not None else None
                if self.phase == "running" and code not in (None, 0):
                    self.phase = "failed"
                    tail = self._err_tail()
                    self.message = text(
                        f"stadiacast 意外退出（退出码 {code}）：{tail or '没有错误输出'}",
                        f"stadiacast exited unexpectedly (exit code {code}): {tail or 'no error output'}",
                    )
                else:
                    self.phase = "stopped"
            if (self.phase, self.reachable) != before:
                self.changed()

    def _set_live(self, doc: dict[str, Any]) -> None:
        with self.cond:
            self.live = doc
            self._track_battery(doc)
            self.changed()

    def _track_battery(self, doc: dict[str, Any]) -> None:
        """Keep each linked controller's battery: its own report when there is one, otherwise the
        level it connected with, read once per connection from ``/_status``."""
        now = time.time()
        linked: set[str] = set()
        for label, c in (doc.get("controllers") or {}).items():
            if not isinstance(c, dict) or c.get("display_state") not in LINKED_STATES:
                continue
            linked.add(label)
            pct = c.get("battery_percent")
            if isinstance(pct, int) and not isinstance(pct, bool) and 0 <= pct <= 100:
                known = self.battery.get(label)
                if known is None or known["source"] != "report" or known["percent"] != pct:
                    self.battery[label] = {"percent": pct, "source": "report", "at": now}
            elif label not in self.linked:  # it has just connected
                self.battery.pop(label, None)
                gen = self._battery_gen.get(label, 0) + 1
                self._battery_gen[label] = gen
                threading.Thread(target=self._read_battery_at_connect, args=(label, gen), daemon=True).start()
        for label in list(self.battery):
            if label not in linked:
                del self.battery[label]
        self.linked = linked

    def _read_battery_at_connect(self, label: str, gen: int) -> None:
        for attempt in range(BATTERY_FETCH_TRIES):
            time.sleep(0.5 if attempt == 0 else 1.0)
            with self.cond:
                if self._battery_gen.get(label) != gen or label not in self.linked:
                    return
            try:
                status, doc = self.api.request("GET", "/_status")
            except ConsoleError:
                continue
            pct = battery_from_status(doc, label) if status == 200 else None
            if pct is None:
                continue
            with self.cond:
                if self._battery_gen.get(label) != gen or label not in self.linked:
                    return
                if label not in self.battery:  # a report that came meanwhile wins
                    self.battery[label] = {"percent": pct, "source": "connect", "at": time.time()}
                    self.changed()
            return

    def run_live(self) -> None:
        while True:
            status = self.api.probe()
            if status is None:
                self._set_unreachable()
                time.sleep(1.0)
                continue
            self._set_reachable(status)
            if not self._follow_events(self.api.port):
                time.sleep(2.0)
            time.sleep(0.3)

    def _follow_events(self, port: int) -> bool:
        """Read the receiver's /_events stream until it ends; False when it was refused."""
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            conn.request("GET", "/_events", headers={"Accept": "text/event-stream"})
            resp = conn.getresponse()
            if resp.status != 200:
                return False
            event: bytes | None = None
            data: list[bytes] = []
            while True:
                line = resp.fp.readline(1 << 20)
                if not line:
                    return True
                line = line.rstrip(b"\r\n")
                if line:
                    if line.startswith(b"data:"):
                        data.append(line[5:].strip())
                    elif line.startswith(b"event:"):
                        event = line[6:].strip()
                    continue
                if data and event in (None, b"input"):
                    try:
                        doc = json.loads(b"\n".join(data))
                    except ValueError:
                        doc = None
                    if isinstance(doc, dict):
                        self._set_live(doc)
                event, data = None, []
        except (OSError, http.client.HTTPException):
            return True
        finally:
            conn.close()

    def run_tail(self) -> None:
        while True:
            if self.tail.poll(self._log_path()):
                self.changed()
            time.sleep(1.0)

    def _log_path(self) -> Path | None:
        with self.cond:
            base = work_path(self.cfg)
            log_dir = self.status.get("log_dir") if (self.reachable and self.status) else None
        if log_dir:
            run = Path(log_dir)
            return (run if run.is_absolute() else base / run) / "server.jsonl"
        runs = sorted((base / "captures").glob("*/server.jsonl"))  # stamped names sort by time
        return runs[-1] if runs else None

    def _err_tail(self) -> str | None:
        """The last lines stadiacast wrote to its error output, or None when it wrote nothing."""
        if self.err_path is None:
            return None
        try:
            out = self.err_path.read_bytes()[-4000:].decode("utf-8", "replace").strip()
        except OSError:
            return None
        lines = [ln for ln in out.splitlines() if ln.strip()]
        return " / ".join(lines[-3:]) if lines else None

    # Actions from the page.

    def start(self) -> None:
        with self.cond:
            if self.phase in ("running", "starting", "stopping"):
                raise ConsoleError(409, "stadiacast 已经在运行，或正在启动、停止", "stadiacast is already running, starting or stopping")
            exe = find_receiver()
            if exe is None:
                raise ConsoleError(
                    500,
                    "找不到 stadiacast 命令，先按 docs\\guide.md 第 1 步安装",
                    "The stadiacast command was not found: install it first (README.en.md, step 1)",
                )
            CONSOLE_LOG_DIR.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            out_path = CONSOLE_LOG_DIR / f"console-{stamp}.out"
            self.err_path = CONSOLE_LOG_DIR / f"console-{stamp}.err"
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
            with open(out_path, "wb") as out, open(self.err_path, "wb") as err:
                self.proc = subprocess.Popen(
                    [exe, *receiver_args(self.cfg)],
                    cwd=work_path(self.cfg),
                    stdin=subprocess.DEVNULL,
                    stdout=out,
                    stderr=err,
                    env=env,
                    creationflags=flags,  # its own hidden console: it outlives this server
                )
            self.phase, self.message = "starting", None
            self.changed()
        threading.Thread(target=self._wait_started, args=(self.proc,), daemon=True).start()

    def _wait_started(self, proc: subprocess.Popen[bytes]) -> None:
        deadline = time.monotonic() + START_TIMEOUT_S
        while time.monotonic() < deadline:
            with self.cond:
                if self.phase != "starting" or self.proc is not proc:
                    return  # it came up (the live thread saw it), or something else happened
                code = proc.poll()
                if code is not None:
                    self.phase = "failed"
                    tail = self._err_tail()
                    self.message = text(
                        f"stadiacast 没能启动（退出码 {code}）：{tail or '没有错误输出'}",
                        f"stadiacast did not start (exit code {code}): {tail or 'no error output'}",
                    )
                    self.changed()
                    return
            time.sleep(0.3)
        with self.cond:
            if self.phase == "starting" and self.proc is proc:
                self.phase = "failed"
                tail = self._err_tail()
                self.message = text(
                    f"stadiacast 在 {START_TIMEOUT_S:.0f} 秒内没有启动完成：{tail or '没有错误输出'}",
                    f"stadiacast was not up within {START_TIMEOUT_S:.0f} s: {tail or 'no error output'}",
                )
                self.changed()

    def stop(self) -> None:
        with self.cond:
            if self.phase != "running":
                raise ConsoleError(409, "stadiacast 没有在运行", "stadiacast is not running")
            self.phase, self.message = "stopping", None
            self.changed()
        try:
            self.api.request("POST", "/_shutdown")
        except ConsoleError:
            pass  # it may close the connection as it goes; the live thread tells
        threading.Thread(target=self._wait_stopped, daemon=True).start()

    def _wait_stopped(self) -> None:
        deadline = time.monotonic() + STOP_TIMEOUT_S
        while time.monotonic() < deadline:
            with self.cond:
                if self.phase != "stopping":
                    return
            time.sleep(0.3)
        with self.cond:
            if self.phase == "stopping":
                self.phase = "running" if self.reachable else "stopped"
                self.message = text(
                    f"停止请求发出后 {STOP_TIMEOUT_S:.0f} 秒，stadiacast 还没有退出",
                    f"stadiacast has not exited {STOP_TIMEOUT_S:.0f} s after it was asked to stop",
                )
                self.changed()

    def rumble(self, body: dict[str, Any]) -> dict[str, Any]:
        ip = _ipv4(body.get("ip"), ("手柄 IP", "The controller IP"))
        strength, ms = body.get("strength"), body.get("ms")
        if not isinstance(strength, int) or isinstance(strength, bool) or not 0 <= strength <= 65535:
            raise ConsoleError(400, "强度应为 0 到 65535 的整数", "The strength is a whole number from 0 to 65535")
        if not isinstance(ms, int) or isinstance(ms, bool) or not 1 <= ms <= 10000:
            raise ConsoleError(400, "时长应为 1 到 10000 毫秒的整数", "The length is a whole number of ms from 1 to 10000")
        with self.cond:
            known = {c["ip"] for c in self.cfg["controllers"]}
            known |= {c.get("ip") for c in ((self.live or {}).get("controllers") or {}).values()}
            if self.phase != "running":
                raise ConsoleError(409, "stadiacast 没有在运行", "stadiacast is not running")
        if ip not in known:
            raise ConsoleError(400, f"不认识这只手柄：{ip}", f"Unknown controller: {ip}")
        status, doc = self.api.request(
            "POST", f"/_rumble?controller={urllib.parse.quote(ip)}", {"left": strength, "right": strength, "ms": ms}
        )
        if status != 200 or not isinstance(doc, dict):
            message = doc.get("error") if isinstance(doc, dict) else None  # stadiacast's own, in English
            code = status if 400 <= status < 600 else 502
            if isinstance(message, str) and message:
                raise ConsoleError(code, message, message)
            raise ConsoleError(code, f"stadiacast 返回 {status}", f"stadiacast answered {status}")
        return {"sent": bool(doc.get("sent"))}

    def get_config(self) -> dict[str, Any]:
        with self.cond:
            return {**self.cfg, "max_controllers": MAX_CONTROLLERS}

    def set_config(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.cond:
            merged = {**self.cfg}
            for key in ("dns_upstream", "controllers"):  # work_dir is not the page's to change
                if key in body:
                    merged[key] = body[key]
            cfg = validate_config(merged)
            differs = cfg != self.cfg
            save_config(cfg)
            self.cfg = cfg
            self.changed()
            return {"saved": True, "restart_needed": differs and self.phase == "running"}

    # What the page shows.

    def snapshot(self) -> dict[str, Any]:
        with self.cond:
            live = ((self.live or {}).get("controllers") or {}) if self.reachable else {}
            by_ip = {c.get("ip"): (label, c) for label, c in live.items()}
            def battery(label: str | None) -> dict[str, Any] | None:
                b = self.battery.get(label) if label else None
                return {"percent": b["percent"], "source": b["source"], "at_ms": round(b["at"] * 1000)} if b else None

            cards = []
            for c in self.cfg["controllers"]:
                label, state = by_ip.pop(c["ip"], (None, None))
                cards.append({**c, "label": label, "live": state, "battery": battery(label)})
            for ip, (label, state) in by_ip.items():
                cards.append(
                    {"name": None, "ip": ip, "note": "", "label": label, "live": state, "battery": battery(label)}
                )
            log_dir = (self.status or {}).get("log_dir") if self.reachable else None
            started_at = None
            if log_dir and (m := RUN_STAMP.search(str(log_dir))):
                y, mo, d, h, mi, s = m.groups()
                started_at = f"{y}-{mo}-{d}T{h}:{mi}:{s}"
            return {
                "phase": self.phase,
                "message": self.message,
                "version": (self.status or {}).get("version") if self.reachable else None,
                "log_dir": log_dir,
                "started_at": started_at,
                "pid": self.proc.pid if (self.proc is not None and self.proc.poll() is None) else None,
                "controllers": cards,
                "log_seq": self.tail.seq,
            }

    def logs(self) -> dict[str, Any]:
        with self.cond:
            path = self.tail.path
            events = list(self.tail.events)[-LOG_EVENTS_SENT:]
        return {"path": str(path) if path else None, "events": events}


# --- HTTP ---------------------------------------------------------------------------------------


class Handler(BaseHTTPRequestHandler):
    server_version = "stadia-console/1.0"
    console: Console
    allowed_hosts: frozenset[str] = frozenset()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - the base class's name
        pass  # every request would be a line; errors reach the page instead

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Cache-Control", "no-store")

    def _json(self, status: int, doc: Any) -> None:
        body = json.dumps(doc, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _check_host(self) -> None:
        # A page on another site reaching this server through a name that resolves to
        # 127.0.0.1 (DNS rebinding) still sends that name as Host.
        if self.headers.get("Host", "") not in self.allowed_hosts:
            raise ConsoleError(403, "只接受通过 127.0.0.1 或 localhost 访问", "Only reachable as 127.0.0.1 or localhost")

    def _check_post(self) -> None:
        origin = self.headers.get("Origin")
        if origin is not None and origin not in {f"http://{h}" for h in self.allowed_hosts}:
            raise ConsoleError(403, "不接受来自其他网页的请求", "Requests from other pages are refused")
        # A custom header makes a cross-site request need a CORS preflight, which is never granted.
        if self.headers.get("X-Stadia-Console") != "1":
            raise ConsoleError(403, "缺少 X-Stadia-Console 请求头", "The X-Stadia-Console header is missing")
        if self.headers.get("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            raise ConsoleError(415, "请求体必须是 JSON", "The body must be JSON")

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ConsoleError(400, "Content-Length 不对", "Bad Content-Length") from None
        if not 0 <= length <= MAX_BODY:
            raise ConsoleError(413, "请求体太大", "The body is too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            doc = json.loads(raw or b"{}")
        except ValueError:
            raise ConsoleError(400, "请求体不是有效的 JSON", "The body is not valid JSON") from None
        if not isinstance(doc, dict):
            raise ConsoleError(400, "请求体必须是 JSON 对象", "The body must be a JSON object")
        return doc

    def _static(self, path: str) -> None:
        name, ctype = STATIC_FILES[path]
        body = (STATIC_DIR / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Security-Policy", CSP)
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _stream(self) -> None:
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self._security_headers()
        self.end_headers()
        console = self.console
        sent_seq = -1
        try:
            self.wfile.write(b"retry: 2000\n\n")
            while True:
                with console.cond:
                    console.cond.wait_for(lambda: console.seq != sent_seq, timeout=STREAM_PING_S)
                    seq = console.seq
                if seq == sent_seq:
                    self.wfile.write(b": ping\n\n")
                else:
                    data = json.dumps(console.snapshot(), ensure_ascii=False).encode("utf-8")
                    self.wfile.write(b"data: " + data + b"\n\n")
                    sent_seq = seq
                self.wfile.flush()
                time.sleep(STREAM_MIN_INTERVAL_S)
        except OSError:
            return  # the page went away

    def do_GET(self) -> None:  # noqa: N802 - the base class's name
        try:
            self._check_host()
            path = urllib.parse.urlsplit(self.path).path
            if path in STATIC_FILES:
                return self._static(path)
            if path == "/api/state":
                return self._json(200, self.console.snapshot())
            if path == "/api/stream":
                return self._stream()
            if path == "/api/logs":
                return self._json(200, self.console.logs())
            if path == "/api/config":
                return self._json(200, self.console.get_config())
            raise ConsoleError(404, "没有这个地址", "No such address")
        except ConsoleError as e:
            self._json(e.status, {"error": e.text})
        except OSError:
            pass
        except Exception as e:  # noqa: BLE001 - the page gets the message, the server goes on
            self._json(500, {"error": text(f"{type(e).__name__}: {e}", f"{type(e).__name__}: {e}")})

    def do_POST(self) -> None:  # noqa: N802 - the base class's name
        try:
            self._check_host()
            self._check_post()
            body = self._read_json()
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/start":
                self.console.start()
                return self._json(200, {"ok": True})
            if path == "/api/stop":
                self.console.stop()
                return self._json(200, {"ok": True})
            if path == "/api/rumble":
                return self._json(200, self.console.rumble(body))
            if path == "/api/config":
                return self._json(200, self.console.set_config(body))
            if path == "/api/quit":
                self._json(200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return None
            raise ConsoleError(404, "没有这个地址", "No such address")
        except ConsoleError as e:
            self._json(e.status, {"error": e.text})
        except OSError:
            pass
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": text(f"{type(e).__name__}: {e}", f"{type(e).__name__}: {e}")})


def main() -> None:
    ap = argparse.ArgumentParser(description="Local web console for stadiacast (127.0.0.1 only)")
    ap.add_argument("--port", type=int, default=8090)
    args = ap.parse_args()

    console = Console(ReceiverApi())
    threading.Thread(target=console.run_live, name="live", daemon=True).start()
    threading.Thread(target=console.run_tail, name="tail", daemon=True).start()
    Handler.console = console
    Handler.allowed_hosts = frozenset({f"127.0.0.1:{args.port}", f"localhost:{args.port}"})
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    httpd.daemon_threads = True
    print(f"stadia console: http://127.0.0.1:{args.port}/", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
