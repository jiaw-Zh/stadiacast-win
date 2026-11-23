'use strict';

// The page's two languages. Static text in index.html carries data-i18n (its text),
// data-i18n-title, data-i18n-aria and data-i18n-placeholder; app.js calls t() for the rest.
// Messages from the console server arrive as {zh, en} and are shown with tx().

const I18N = {
  zh: {
    title: 'Stadia 手柄控制台',
    'phase.unknown': '检测中…',
    'phase.stopped': '已停止',
    'phase.starting': '启动中…',
    'phase.running': '运行中',
    'phase.stopping': '停止中…',
    'phase.failed': '启动失败',
    'btn.start': '启动 stadiacast',
    'btn.stop': '停止',
    'receiver.uptime': '{time} 启动，已运行 {duration}',
    hint: '启动后先唤醒第一只手柄，等它的灯常亮再唤醒下一只，玩家编号就按这个顺序排。',
    'controllers.label': '手柄',
    'events.title': '最近事件',
    'events.time': '时间',
    'events.controller': '手柄',
    'events.event': '事件',
    'events.detail': '详情',
    'events.noLog': '还没有日志',
    'settings.title': '设置',
    'settings.dns': '上游 DNS',
    'settings.name': '名称',
    'settings.ip': 'IP',
    'settings.note': '备注',
    'settings.notePlaceholder': '备注（可选）',
    'settings.add': '添加手柄',
    'settings.remove': '删除',
    'settings.save': '保存',
    'settings.saving': '保存中…',
    'settings.saved': '已保存。',
    'settings.savedRestart': '已保存。停止再启动 stadiacast 后生效。',
    'settings.notSaved': '没有保存：{error}',
    'settings.help1': '设置在下次启动 stadiacast 时生效。第一只手柄的 IP 也用来确定朝向手柄的网卡。',
    'settings.help2': '修改手柄 IP 后，还要同步修改路由器的静态地址和 DNS 标签（scripts\\router-dhcp-tag.sh），并重新运行 scripts\\firewall.ps1（它从这份设置里读取手柄 IP）。',
    'card.ip': 'IP',
    'card.label': '编号',
    'card.player': '玩家',
    'card.battery': '电量',
    'card.seen': '最后通信',
    'card.unregistered': '未登记的手柄',
    'card.playerN': '玩家 {n}',
    'card.padError': '出错：{error}',
    'link.none': '未连接',
    'link.on': '已连接',
    'link.wait': '连接中',
    'link.asleep': '未连接（休眠或关机）',
    'battery.reading': '读取中…',
    'battery.atConnect': '连接时读取，之后没有变化',
    'battery.changed': '上次变化：{ago}',
    'btn.up': '上',
    'btn.down': '下',
    'btn.left': '左',
    'btn.right': '右',
    'btn.assistant': '助理',
    'btn.capture': '截图',
    'btn.optionsTitle': '选项键',
    'btn.menuTitle': '菜单键',
    'btn.assistantTitle': 'Google Assistant 键',
    'btn.captureTitle': '截图键',
    'btn.stadiaTitle': 'Stadia 键',
    'rumble.strength': '震动强度',
    'rumble.duration': '震动时长',
    'rumble.s03': '0.3 秒',
    'rumble.s1': '1 秒',
    'rumble.s2': '2 秒',
    'rumble.button': '震动',
    'rumble.sending': '发送中…',
    'rumble.sent': '已发送',
    'rumble.notSent': '没有发出',
    'rumble.failed': '失败：{error}',
    'ago.s': '{n} 秒前',
    'ago.m': '{n} 分钟前',
    'ago.h': '{n} 小时前',
    'duration.m': '{m} 分钟',
    'duration.hm': '{h} 小时 {m} 分钟',
    'stream.down': '与控制台服务的连接断开了，正在重连…',
    'routine.stateDeferred': '连接握手中的正常重试（code 13），stadiacast 会继续询问，随后应出现"就绪"',
  },
  en: {
    title: 'Stadia Controller Console',
    'phase.unknown': 'Checking…',
    'phase.stopped': 'Stopped',
    'phase.starting': 'Starting…',
    'phase.running': 'Running',
    'phase.stopping': 'Stopping…',
    'phase.failed': 'Failed to start',
    'btn.start': 'Start stadiacast',
    'btn.stop': 'Stop',
    'receiver.uptime': 'started {time}, up {duration}',
    hint: 'Once stadiacast runs, wake the first controller, and the next once its light is steady: players are numbered in that order.',
    'controllers.label': 'Controllers',
    'events.title': 'Recent events',
    'events.time': 'Time',
    'events.controller': 'Controller',
    'events.event': 'Event',
    'events.detail': 'Details',
    'events.noLog': 'No log yet',
    'settings.title': 'Settings',
    'settings.dns': 'Upstream DNS',
    'settings.name': 'Name',
    'settings.ip': 'IP',
    'settings.note': 'Note',
    'settings.notePlaceholder': 'Note (optional)',
    'settings.add': 'Add controller',
    'settings.remove': 'Remove',
    'settings.save': 'Save',
    'settings.saving': 'Saving…',
    'settings.saved': 'Saved.',
    'settings.savedRestart': 'Saved. Stop and start stadiacast for it to take effect.',
    'settings.notSaved': 'Not saved: {error}',
    'settings.help1': "The settings take effect the next time stadiacast starts. The first controller's IP also picks the network interface that faces the controllers.",
    'settings.help2': "After changing a controller's IP, change its static lease and DNS tag on the router too (scripts\\router-dhcp-tag.sh), and run scripts\\firewall.ps1 again (it reads the controllers' IPs from these settings).",
    'card.ip': 'IP',
    'card.label': 'Label',
    'card.player': 'Player',
    'card.battery': 'Battery',
    'card.seen': 'Last heard',
    'card.unregistered': 'Unregistered controller',
    'card.playerN': 'Player {n}',
    'card.padError': 'Error: {error}',
    'link.none': 'Not connected',
    'link.on': 'Connected',
    'link.wait': 'Connecting',
    'link.asleep': 'Not connected (asleep or off)',
    'battery.reading': 'Reading…',
    'battery.atConnect': 'read at connection, unchanged since',
    'battery.changed': 'last change: {ago}',
    'btn.up': '↑',
    'btn.down': '↓',
    'btn.left': '←',
    'btn.right': '→',
    'btn.assistant': 'Asst',
    'btn.capture': 'Capt',
    'btn.optionsTitle': 'Options button',
    'btn.menuTitle': 'Menu button',
    'btn.assistantTitle': 'Google Assistant button',
    'btn.captureTitle': 'Capture button',
    'btn.stadiaTitle': 'Stadia button',
    'rumble.strength': 'Strength',
    'rumble.duration': 'Rumble length',
    'rumble.s03': '0.3 s',
    'rumble.s1': '1 s',
    'rumble.s2': '2 s',
    'rumble.button': 'Rumble',
    'rumble.sending': 'Sending…',
    'rumble.sent': 'Sent',
    'rumble.notSent': 'Not sent',
    'rumble.failed': 'Failed: {error}',
    'ago.s': '{n} s ago',
    'ago.m': '{n} min ago',
    'ago.h': '{n} h ago',
    'duration.m': '{m} min',
    'duration.hm': '{h} h {m} min',
    'stream.down': 'Lost the connection to the console server, reconnecting…',
    'routine.stateDeferred': 'A normal retry while the link comes up (code 13): stadiacast asks again, and "Ready" should follow',
  },
};

// stadiacast's own event names, as the event list shows them.
const EVENT_NAMES = {
  zh: {
    ready: 'stadiacast 已启动',
    stopped: 'stadiacast 已停止',
    dns_sink_started: 'DNS 服务已启动',
    controller_new: '发现新手柄',
    controller_hardware: '手柄信息',
    display_state: '连接状态',
    display_controller_state_error: '手柄状态查询被暂缓',
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
  },
  en: {
    ready: 'stadiacast started',
    stopped: 'stadiacast stopped',
    dns_sink_started: 'DNS sink started',
    controller_new: 'New controller',
    controller_hardware: 'Controller info',
    display_state: 'Link state',
    display_controller_state_error: 'Controller state request deferred',
    dtls_connected: 'Encrypted link up',
    dtls_closed_by_peer: 'Controller closed the link',
    boot_state_reset: 'Controller rebooted',
    game_started: 'Game session started',
    game_closed: 'Game session closed',
    game_start_failed: 'Game session failed to start',
    gamepad_created: 'Virtual pad created',
    gamepad_failed: 'Virtual pad error',
    gamepad_rumble_failed: 'Rumble not forwarded',
    rumble_refresh_failed: 'Rumble refresh failed',
    port_busy: 'Port in use',
    helper_exited: 'Helper process exited',
    handler_error: 'Request handling error',
    tls_alert: 'Controller refused the certificate',
    rpc_out_failed: 'Message not sent',
    display_rpc_unanswered: 'Controller did not answer',
    gmsg_unattributed: 'Unattributed controller request',
  },
};

// stadiacast's display_state values.
const DISPLAY_STATES = {
  zh: {
    idle: '空闲',
    'dtls-connected': '加密连接已建立',
    'get-controller-state-sent': '正在查询手柄状态',
    'controller-state-received': '已收到手柄状态',
    ready: '就绪',
    input: '开始接收输入',
  },
  en: {
    idle: 'Idle',
    'dtls-connected': 'Encrypted link up',
    'get-controller-state-sent': 'Asking for the controller state',
    'controller-state-received': 'Controller state received',
    ready: 'Ready',
    input: 'Receiving input',
  },
};

const LANGS = ['zh', 'en'];
const LANG_KEY = 'stadia-console-lang';

// ?lang=en or ?lang=zh in the address wins, then the last choice, then the browser's language.
function initialLang() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(asked)) return asked;
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* storage off */ }
  if (LANGS.includes(saved)) return saved;
  const browser = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return browser.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let lang = initialLang();

function t(key, params = {}) {
  const s = I18N[lang][key] ?? I18N.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

// A message from the console server: {zh, en}, or a plain string (stadiacast's own, in English).
function tx(m) {
  if (m == null) return '';
  if (typeof m === 'string') return m;
  return m[lang] ?? m.en ?? m.zh ?? '';
}

function eventName(name) {
  return EVENT_NAMES[lang][name] ?? name;
}

function displayStateName(s) {
  return DISPLAY_STATES[lang][s] ?? s;
}

function applyI18n(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

function setLang(next) {
  if (!LANGS.includes(next)) return;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* storage off */ }
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  applyI18n(document);
  applyI18n(document.querySelector('#card-template').content);
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === next));
}
