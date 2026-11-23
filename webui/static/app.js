'use strict';

// Everything the page shows comes from /api/stream (server-sent events) and /api/logs.
// Actions are POSTs to /api/*, with the header the console server requires.
// The texts are in i18n.js: t() for the page's own, tx() for the server's messages.

const PHASE_CLASSES = {
  unknown: 'wait',
  stopped: 'off',
  starting: 'wait',
  running: 'on',
  stopping: 'wait',
  failed: 'bad',
};

const $ = (sel, root = document) => root.querySelector(sel);

let state = null;
let streamDown = false;
let lastLogSeq = null;
let logTimer = null;
let lastLogs = null; // the last /api/logs document, kept to redraw it in another language
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
  if (!res.ok) throw new Error(tx(doc && doc.error) || `HTTP ${res.status}`);
  return doc;
}

function showBanner(text) {
  const banner = $('#banner');
  banner.textContent = text || '';
  banner.hidden = !text;
}

function fmtAgo(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return t('ago.s', { n: Math.round(seconds) });
  if (seconds < 3600) return t('ago.m', { n: Math.round(seconds / 60) });
  return t('ago.h', { n: (seconds / 3600).toFixed(1) });
}

function fmtDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return t('duration.m', { m: minutes });
  return t('duration.hm', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

function fmtTime(iso) {
  if (!iso) return '';
  const m = /T(\d{2}:\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

function linkState(live) {
  if (!live) return [t('link.none'), 'off'];
  const s = live.display_state;
  if (s === 'input' || s === 'ready') return [t('link.on'), 'on'];
  if (s === 'idle') return live.last_seen_s < 10 ? [t('link.wait'), 'wait'] : [t('link.asleep'), 'off'];
  return [t('link.wait'), 'wait'];
}

function labelNames() {
  const names = {};
  for (const c of (state && state.controllers) || []) if (c.label) names[c.label] = c.name || c.ip;
  return names;
}

// --- the receiver ----------------------------------------------------------------------------

function renderBanner() {
  showBanner(streamDown ? t('stream.down') : tx(state && state.message));
}

function renderReceiver(st) {
  const badge = $('#phase');
  badge.textContent = PHASE_CLASSES[st.phase] ? t(`phase.${st.phase}`) : st.phase;
  badge.className = `badge ${PHASE_CLASSES[st.phase] || 'wait'}`;
  badge.removeAttribute('data-i18n'); // the phase decides from now on, not the static text

  const info = [];
  if (st.version) info.push(`v${st.version}`);
  if (st.phase === 'running' && st.started_at) {
    const started = new Date(st.started_at);
    info.push(t('receiver.uptime', { time: fmtTime(st.started_at), duration: fmtDuration(Date.now() - started.getTime()) }));
  }
  $('#receiver-info').textContent = info.join(' · ');
  $('#btn-start').disabled = !(st.phase === 'stopped' || st.phase === 'failed');
  $('#btn-stop').disabled = st.phase !== 'running';
  renderBanner();
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
  refs.name.textContent = c.name || t('card.unregistered');
  refs.note.textContent = c.note || '';
  const [text, cls] = linkState(live);
  refs.link.textContent = text;
  refs.link.className = `badge link ${cls}`;
  refs.ip.textContent = c.ip;
  refs.label.textContent = c.label || '—';

  const pad = live && live.gamepad;
  if (pad && pad.error) refs.player.textContent = t('card.padError', { error: pad.error });
  else if (pad && pad.slot != null) refs.player.textContent = t('card.playerN', { n: pad.slot + 1 });
  else refs.player.textContent = '—';

  const b = c.battery; // kept by the console: the controller's last report, or its level at connection
  const battery = b ? b.percent : null;
  refs.batteryFill.style.width = battery == null ? '0%' : `${battery}%`;
  refs.batteryFill.classList.toggle('low', battery != null && battery <= 20);
  refs.batteryText.textContent = battery == null ? '—' : `${battery}%`;
  if (!b) refs.batteryWhen.textContent = live && cls === 'on' ? t('battery.reading') : '';
  else if (b.source === 'connect') refs.batteryWhen.textContent = t('battery.atConnect');
  else refs.batteryWhen.textContent = t('battery.changed', { ago: fmtAgo((Date.now() - b.at_ms) / 1000) });
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
  refs.message.textContent = t('rumble.sending');
  clearTimeout(card.messageTimer);
  try {
    const r = await post('/api/rumble', {
      ip: card.ip,
      strength: Number(refs.strength.value),
      ms: Number(refs.duration.value),
    });
    refs.message.textContent = r.sent ? t('rumble.sent') : t('rumble.notSent');
  } catch (e) {
    refs.message.textContent = t('rumble.failed', { error: e.message });
  } finally {
    card.busy = false;
    refs.button.disabled = !card.connected;
    card.messageTimer = setTimeout(() => { refs.message.textContent = ''; }, 5000);
  }
}

// --- events ----------------------------------------------------------------------------------

// Events whose name sounds like a failure but that are a normal part of a connection.
function isRoutine(ev) {
  // GetControllerStateRequest re-sent before the controller handed its link to its app: it
  // answers INTERNAL (13), stadiacast ignores that and asks again until it answers OK.
  return ev.event === 'display_controller_state_error' && (ev.detail || {}).code === 13;
}

function detailText(ev) {
  const d = { ...(ev.detail || {}) };
  if (ev.event === 'display_state' && d.display_state) return displayStateName(d.display_state);
  if (isRoutine(ev)) return t('routine.stateDeferred');
  return Object.entries(d).map(([k, v]) => `${k}=${v}`).join('  ');
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderLogs() {
  const doc = lastLogs;
  if (!doc) return;
  $('#log-path').textContent = doc.path || t('events.noLog');
  const names = labelNames();
  const rows = doc.events.slice().reverse().map((ev) => {
    const tr = document.createElement('tr');
    if (/fail|error|exited|alert|unanswered|unattributed/.test(ev.event) && !isRoutine(ev)) tr.className = 'bad';
    tr.append(
      cell(fmtTime(ev.ts)),
      cell(ev.controller ? `${names[ev.controller] || ''} ${ev.controller}`.trim() : ''),
      cell(eventName(ev.event)),
      cell(detailText(ev)),
    );
    return tr;
  });
  $('#events tbody').replaceChildren(...rows);
}

async function loadLogs() {
  const res = await fetch('/api/logs');
  if (!res.ok) return;
  lastLogs = await res.json();
  renderLogs();
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
  for (const [key, placeholderKey] of [['name', 'settings.name'], ['ip', null], ['note', 'settings.notePlaceholder']]) {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.name = key;
    input.value = c[key] || '';
    if (placeholderKey) {
      input.dataset.i18nPlaceholder = placeholderKey;
      input.placeholder = t(placeholderKey);
    } else {
      input.placeholder = '192.168.1.x';
    }
    input.autocomplete = 'off';
    input.spellcheck = false;
    td.append(input);
    tr.append(td);
  }
  const td = document.createElement('td');
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.dataset.i18n = 'settings.remove';
  remove.textContent = t('settings.remove');
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
  msg.textContent = t('settings.saving');
  try {
    const r = await post('/api/config', {
      dns_upstream: $('#settings-form').elements.dns_upstream.value,
      controllers,
    });
    msg.textContent = r.restart_needed ? t('settings.savedRestart') : t('settings.saved');
    await loadConfig();
  } catch (e) {
    msg.textContent = t('settings.notSaved', { error: e.message });
  }
}

// --- language --------------------------------------------------------------------------------

function switchLang(next) {
  setLang(next);
  $('#settings-msg').textContent = '';
  if (state) {
    renderReceiver(state);
    renderControllers(state.controllers);
  } else {
    renderBanner();
  }
  renderLogs();
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
    renderBanner();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  setLang(lang);
  for (const b of document.querySelectorAll('[data-lang]')) {
    b.addEventListener('click', () => switchLang(b.dataset.lang));
  }
  $('#btn-start').addEventListener('click', (e) => act('/api/start', e.currentTarget));
  $('#btn-stop').addEventListener('click', (e) => act('/api/stop', e.currentTarget));
  $('#btn-add').addEventListener('click', () => addRow());
  $('#settings-form').addEventListener('submit', saveConfig);
  loadConfig().catch(() => {});
  connect();
});
