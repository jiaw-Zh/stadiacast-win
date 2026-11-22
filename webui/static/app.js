'use strict';

// Everything the page shows comes from /api/stream (server-sent events) and /api/logs.
// Actions are POSTs to /api/*, with the header the console server requires.

const PHASES = {
  unknown: ['检测中…', 'wait'],
  stopped: ['已停止', 'off'],
  starting: ['启动中…', 'wait'],
  running: ['运行中', 'on'],
  stopping: ['停止中…', 'wait'],
  failed: ['启动失败', 'bad'],
};

const EVENT_NAMES = {
  ready: 'stadiacast 已启动',
  stopped: 'stadiacast 已停止',
  dns_sink_started: 'DNS 服务已启动',
  controller_new: '发现新手柄',
  controller_hardware: '手柄信息',
  display_state: '连接状态',
  dtls_connected: '加密连接已建立',
  dtls_closed_by_peer: '手柄断开了连接',
  boot_state_reset: '手柄重新开机',
  game_started: '游戏会话已开始',
  game_closed: '游戏会话已关闭',
  game_start_failed: '游戏会话启动失败',
  gamepad_created: '虚拟手柄已创建',
  gamepad_failed: '虚拟手柄出错',
  gamepad_rumble_failed: '震动转发失败',
  rumble_refresh_failed: '震动保持失败',
  port_busy: '端口被占用',
  helper_exited: '辅助进程退出',
  handler_error: '请求处理出错',
  tls_alert: '手柄拒绝了证书',
  rpc_out_failed: '消息发送失败',
  display_rpc_unanswered: '手柄没有应答',
  gmsg_unattributed: '无法识别的手柄请求',
};

const DISPLAY_STATES = {
  idle: '空闲',
  'dtls-connected': '加密连接已建立',
  'get-controller-state-sent': '正在查询手柄状态',
  'controller-state-received': '已收到手柄状态',
  ready: '就绪',
  input: '开始接收输入',
};

const $ = (sel, root = document) => root.querySelector(sel);

let state = null;
let streamDown = false;
let lastLogSeq = null;
let logTimer = null;
const cards = new Map(); // controller IP -> card

// --- helpers ---------------------------------------------------------------------------------

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Stadia-Console': '1' },
    body: JSON.stringify(body ?? {}),
  });
  let doc = null;
  try { doc = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error((doc && doc.error) || `HTTP ${res.status}`);
  return doc;
}

function showBanner(text) {
  const banner = $('#banner');
  banner.textContent = text || '';
  banner.hidden = !text;
}

function fmtAgo(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)} 秒前`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} 分钟前`;
  return `${(seconds / 3600).toFixed(1)} 小时前`;
}

function fmtDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

function linkState(live) {
  if (!live) return ['未连接', 'off'];
  const s = live.display_state;
  if (s === 'input' || s === 'ready') return ['已连接', 'on'];
  if (s === 'idle') return live.last_seen_s < 10 ? ['连接中', 'wait'] : ['未连接（休眠或关机）', 'off'];
  return ['连接中', 'wait'];
}

function labelNames() {
  const names = {};
  for (const c of (state && state.controllers) || []) if (c.label) names[c.label] = c.name || c.ip;
  return names;
}

// --- the receiver ----------------------------------------------------------------------------

function renderReceiver(st) {
  const [text, cls] = PHASES[st.phase] || [st.phase, 'wait'];
  const badge = $('#phase');
  badge.textContent = text;
  badge.className = `badge ${cls}`;

  const info = [];
  if (st.version) info.push(`v${st.version}`);
  if (st.phase === 'running' && st.started_at) {
    const started = new Date(st.started_at);
    info.push(`${fmtTime(st.started_at)} 启动，已运行 ${fmtDuration(Date.now() - started.getTime())}`);
  }
  $('#receiver-info').textContent = info.join(' · ');
  $('#btn-start').disabled = !(st.phase === 'stopped' || st.phase === 'failed');
  $('#btn-stop').disabled = st.phase !== 'running';
  showBanner(streamDown ? '与控制台服务的连接断开了，正在重连…' : st.message);
}

async function act(path, button) {
  button.disabled = true;
  try {
    await post(path);
  } catch (e) {
    showBanner(e.message);
    button.disabled = false;
  }
}

// --- controller cards ------------------------------------------------------------------------

function makeCard(c) {
  const root = $('#card-template').content.firstElementChild.cloneNode(true);
  const refs = {
    name: $('.name', root),
    note: $('.note', root),
    link: $('.link', root),
    ip: $('.ip', root),
    label: $('.label', root),
    player: $('.player', root),
    batteryFill: $('.battery-fill', root),
    batteryText: $('.battery-text', root),
    batteryWhen: $('.battery-when', root),
    seen: $('.seen', root),
    l2: $('.fill.l2', root),
    r2: $('.fill.r2', root),
    ls: $('.dot.ls', root),
    rs: $('.dot.rs', root),
    strength: $('.strength', root),
    duration: $('.duration', root),
    button: $('.btn-rumble', root),
    message: $('.rumble-msg', root),
    buttons: new Map([...root.querySelectorAll('[data-btn]')].map((e) => [e.dataset.btn, e])),
  };
  const card = { ip: c.ip, root, refs, busy: false, connected: false, messageTimer: null };
  refs.button.addEventListener('click', () => rumble(card));
  return card;
}

function setStick(dot, x, y) {
  dot.style.left = `${50 + (x / 32768) * 38}%`;
  dot.style.top = `${50 - (y / 32768) * 38}%`; // the receiver's Y is up-positive
}

function updateCard(card, c) {
  const { refs } = card;
  const live = c.live;
  refs.name.textContent = c.name || '未登记的手柄';
  refs.note.textContent = c.note || '';
  const [text, cls] = linkState(live);
  refs.link.textContent = text;
  refs.link.className = `badge link ${cls}`;
  refs.ip.textContent = c.ip;
  refs.label.textContent = c.label || '—';

  const pad = live && live.gamepad;
  if (pad && pad.error) refs.player.textContent = `出错：${pad.error}`;
  else if (pad && pad.slot != null) refs.player.textContent = `玩家 ${pad.slot + 1}`;
  else refs.player.textContent = '—';

  const b = c.battery; // kept by the console: the controller's last report, or its level at connection
  const battery = b ? b.percent : null;
  refs.batteryFill.style.width = battery == null ? '0%' : `${battery}%`;
  refs.batteryFill.classList.toggle('low', battery != null && battery <= 20);
  refs.batteryText.textContent = battery == null ? '—' : `${battery}%`;
  if (!b) refs.batteryWhen.textContent = live && cls === 'on' ? '读取中…' : '';
  else if (b.source === 'connect') refs.batteryWhen.textContent = '连接时读取，之后没有变化';
  else refs.batteryWhen.textContent = `上次变化：${fmtAgo((Date.now() - b.at_ms) / 1000)}`;
  refs.seen.textContent = live ? fmtAgo(live.last_seen_s) : '—';

  const input = cls === 'on' && live ? live.input : null;
  const held = new Set(input ? input.held : []);
  for (const [name, element] of refs.buttons) element.classList.toggle('on', held.has(name));
  setStick(refs.ls, input ? input.lx : 0, input ? input.ly : 0);
  setStick(refs.rs, input ? input.rx : 0, input ? input.ry : 0);
  refs.l2.style.width = `${((input ? input.l2 : 0) / 255) * 100}%`;
  refs.r2.style.width = `${((input ? input.r2 : 0) / 255) * 100}%`;

  card.connected = cls === 'on' && state && state.phase === 'running';
  refs.button.disabled = !card.connected || card.busy;
  card.root.classList.toggle('offline', cls === 'off');
}

function renderControllers(list) {
  const container = $('#controllers');
  const seen = new Set();
  for (const c of list) {
    seen.add(c.ip);
    let card = cards.get(c.ip);
    if (!card) {
      card = makeCard(c);
      cards.set(c.ip, card);
    }
    container.append(card.root); // keeps the order of the list
    updateCard(card, c);
  }
  for (const [ip, card] of cards) {
    if (!seen.has(ip)) {
      card.root.remove();
      cards.delete(ip);
    }
  }
}

async function rumble(card) {
  const { refs } = card;
  card.busy = true;
  refs.button.disabled = true;
  refs.message.textContent = '发送中…';
  clearTimeout(card.messageTimer);
  try {
    const r = await post('/api/rumble', {
      ip: card.ip,
      strength: Number(refs.strength.value),
      ms: Number(refs.duration.value),
    });
    refs.message.textContent = r.sent ? '已发送' : '没有发出';
  } catch (e) {
    refs.message.textContent = `失败：${e.message}`;
  } finally {
    card.busy = false;
    refs.button.disabled = !card.connected;
    card.messageTimer = setTimeout(() => { refs.message.textContent = ''; }, 5000);
  }
}

// --- events ----------------------------------------------------------------------------------

function detailText(ev) {
  const d = { ...(ev.detail || {}) };
  if (ev.event === 'display_state' && d.display_state) {
    return DISPLAY_STATES[d.display_state] || d.display_state;
  }
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join('  ');
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

async function loadLogs() {
  const res = await fetch('/api/logs');
  if (!res.ok) return;
  const doc = await res.json();
  $('#log-path').textContent = doc.path || '还没有日志';
  const names = labelNames();
  const rows = doc.events.slice().reverse().map((ev) => {
    const tr = document.createElement('tr');
    if (/fail|error|exited|alert|unanswered|unattributed/.test(ev.event)) tr.className = 'bad';
    tr.append(
      cell(fmtTime(ev.ts)),
      cell(ev.controller ? `${names[ev.controller] || ''} ${ev.controller}`.trim() : ''),
      cell(EVENT_NAMES[ev.event] || ev.event),
      cell(detailText(ev)),
    );
    return tr;
  });
  $('#events tbody').replaceChildren(...rows);
}

function scheduleLogs(delay) {
  if (logTimer) return;
  logTimer = setTimeout(() => {
    logTimer = null;
    loadLogs().catch(() => {});
  }, delay); // several changes in a row: one reload
}

// --- settings --------------------------------------------------------------------------------

let maxControllers = 4;

function addRow(c = { name: '', ip: '', note: '' }) {
  const tr = document.createElement('tr');
  for (const [key, placeholder] of [['name', '名称'], ['ip', '192.168.1.x'], ['note', '备注（可选）']]) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.name = key;
    input.value = c[key] || '';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.spellcheck = false;
    td.append(input);
    tr.append(td);
  }
  const td = document.createElement('td');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.textContent = '删除';
  remove.addEventListener('click', () => { tr.remove(); updateAddButton(); });
  td.append(remove);
  tr.append(td);
  $('#ctl-rows').append(tr);
  updateAddButton();
}

function updateAddButton() {
  $('#btn-add').disabled = $('#ctl-rows').children.length >= maxControllers;
}

async function loadConfig() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  maxControllers = cfg.max_controllers || 4;
  $('#settings-form').elements.dns_upstream.value = cfg.dns_upstream;
  $('#ctl-rows').replaceChildren();
  for (const c of cfg.controllers) addRow(c);
}

async function saveConfig(event) {
  event.preventDefault();
  const msg = $('#settings-msg');
  const controllers = [...$('#ctl-rows').children].map((tr) => ({
    name: tr.querySelector('[name=name]').value,
    ip: tr.querySelector('[name=ip]').value,
    note: tr.querySelector('[name=note]').value,
  }));
  msg.textContent = '保存中…';
  try {
    const r = await post('/api/config', {
      dns_upstream: $('#settings-form').elements.dns_upstream.value,
      controllers,
    });
    msg.textContent = r.restart_needed ? '已保存。停止再启动 stadiacast 后生效。' : '已保存。';
    await loadConfig();
  } catch (e) {
    msg.textContent = `没有保存：${e.message}`;
  }
}

// --- start -----------------------------------------------------------------------------------

function connect() {
  const source = new EventSource('/api/stream');
  source.onmessage = (e) => {
    streamDown = false;
    state = JSON.parse(e.data);
    renderReceiver(state);
    renderControllers(state.controllers);
    if (state.log_seq !== lastLogSeq) {
      scheduleLogs(lastLogSeq === null ? 0 : 500); // the first load at once, with the names known
      lastLogSeq = state.log_seq;
    }
  };
  source.onerror = () => {
    streamDown = true;
    showBanner('与控制台服务的连接断开了，正在重连…');
  };
}

document.addEventListener('DOMContentLoaded', () => {
  $('#btn-start').addEventListener('click', (e) => act('/api/start', e.currentTarget));
  $('#btn-stop').addEventListener('click', (e) => act('/api/stop', e.currentTarget));
  $('#btn-add').addEventListener('click', () => addRow());
  $('#settings-form').addEventListener('submit', saveConfig);
  loadConfig().catch(() => {});
  connect();
});
