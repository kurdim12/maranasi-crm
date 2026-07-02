// Command Center shell: boot, login, tabs, keyboard, ⌘K palette, chat.
import { $, esc, req, toast, state, closeModal, closeDrawer, isDrawerOpen, debounce, inputModal } from './core.js';
import { openLead } from './drawer.js';
import * as today from './tab-today.js';
import * as inbox from './tab-inbox.js';
import * as leads from './tab-leads.js';
import * as pipeline from './tab-pipeline.js';
import * as analytics from './tab-analytics.js';
import * as system from './tab-system.js';

const TABS = [today, inbox, leads, pipeline, analytics, system];
let activeTab = null;

// ---------- login / session ----------
function showLogin(msg) {
  state.apiKey = null;
  state.user = null;
  $('login').classList.add('on');
  $('app').classList.remove('on');
  $('login-err').textContent = msg || '';
  $('login-pass').value = '';
  $('login-key').value = '';
  $('login-user').focus();
}
state.onLogout = showLogin;

function boot() {
  $('login').classList.remove('on');
  $('app').classList.add('on');
  const isSession = state.user && state.user !== 'api-key';
  $('b-user').textContent = state.user === 'api-key' ? 'API key' : state.user;
  $('btn-passwd').style.display = isSession ? '' : 'none';
  loadStats();
  goTab(localStorage.getItem('mo.tab') || 'today');
}

function tryLogin() {
  const u = $('login-user').value.trim();
  const p = $('login-pass').value;
  if (!u || !p) return;
  $('login-btn').disabled = true;
  fetch('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  }).then((r) => r.json().then((d) => ({ ok: r.ok, d })))
    .then((res) => {
      $('login-btn').disabled = false;
      if (!res.ok) { $('login-err').textContent = res.d.error || 'Sign-in failed.'; return; }
      state.user = res.d.username;
      boot();
    })
    .catch(() => { $('login-btn').disabled = false; $('login-err').textContent = 'Network error.'; });
}

function tryKeyLogin() {
  const key = $('login-key').value.trim();
  if (!key) return;
  $('login-key-btn').disabled = true;
  fetch('/api/stats', { headers: { 'X-API-Key': key } }).then((r) => {
    $('login-key-btn').disabled = false;
    if (!r.ok) { $('login-err').textContent = 'Invalid key.'; return; }
    state.apiKey = key;
    state.user = 'api-key';
    boot();
  }).catch(() => { $('login-key-btn').disabled = false; $('login-err').textContent = 'Network error.'; });
}

// ---------- header stats / mode badge ----------
export function loadStats() {
  return req('GET', '/api/stats').then((s) => {
    state.stats = s;
    const badge = $('b-mode');
    if (s.sending_paused) {
      badge.className = 'mode-badge paused';
      badge.textContent = 'PAUSED';
    } else if (s.dry_run) {
      badge.className = 'mode-badge test';
      badge.textContent = 'TEST';
    } else {
      badge.className = 'mode-badge live';
      badge.textContent = 'LIVE';
    }
    $('btn-pause').style.display = s.sending_paused ? 'none' : '';
    $('btn-resume').style.display = s.sending_paused ? '' : 'none';
    document.dispatchEvent(new CustomEvent('mo:stats', { detail: s }));
    return s;
  }).catch(() => null);
}

// ---------- tab router ----------
function goTab(id) {
  const mod = TABS.find((t) => t.id === id) || TABS[0];
  activeTab = mod;
  state.tab = mod.id;
  localStorage.setItem('mo.tab', mod.id);
  document.querySelectorAll('nav.tabs button, #bottombar button[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === mod.id);
  });
  const view = $('view');
  view.innerHTML = '';
  mod.render(view);
  loadStats();
}
export { goTab };

// ---------- keyboard ----------
const GO = { t: 'today', i: 'inbox', l: 'leads', p: 'pipeline', a: 'analytics', s: 'system' };
let goArmed = false;
let goTimer = null;

function inEditable(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (e.key === 'Escape') {
    if ($('palette-wrap').classList.contains('open')) { closePalette(); return; }
    if ($('modal-wrap').classList.contains('open')) { closeModal(); return; }
    if (isDrawerOpen()) { closeDrawer(); return; }
    if ($('chat').classList.contains('open') && window.innerWidth <= 900) { $('chat').classList.remove('open'); return; }
    if (inEditable(e)) e.target.blur();
    return;
  }
  if (inEditable(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!$('app').classList.contains('on')) return;

  const k = e.key.toLowerCase();
  if (goArmed) {
    goArmed = false;
    clearTimeout(goTimer);
    if (GO[k]) { e.preventDefault(); goTab(GO[k]); }
    return;
  }
  if (k === 'g') {
    goArmed = true;
    goTimer = setTimeout(() => { goArmed = false; }, 900);
    return;
  }
  if (k === '/') {
    const search = document.querySelector('#view input[type="text"]');
    if (search) { e.preventDefault(); search.focus(); }
    return;
  }
  // delegate j/k/enter/e/r/t to the active tab
  if (activeTab && activeTab.keys && activeTab.keys(k, e)) e.preventDefault();
});

// ---------- ⌘K palette ----------
let palSel = 0;
let palItems = [];

const PAL_ACTIONS = [
  { label: 'Go to Today', hint: 'g t', run: () => goTab('today') },
  { label: 'Go to Inbox', hint: 'g i', run: () => goTab('inbox') },
  { label: 'Go to Leads', hint: 'g l', run: () => goTab('leads') },
  { label: 'Go to Pipeline', hint: 'g p', run: () => goTab('pipeline') },
  { label: 'Go to Analytics', hint: 'g a', run: () => goTab('analytics') },
  { label: 'Go to System', hint: 'g s', run: () => goTab('system') },
  { label: 'Run scrape now', hint: '', run: () => req('POST', '/api/scrape/run', {}).then(() => toast('Scrape started — check System → Scrape runs.', 'ok')) },
  { label: 'Pause sending', hint: '', run: () => req('POST', '/api/sending/pause').then(() => { toast('Sending paused'); loadStats(); }) },
  { label: 'Resume sending', hint: '', run: () => req('POST', '/api/sending/resume').then(() => { toast('Sending resumed', 'ok'); loadStats(); }) },
  { label: 'Refresh data', hint: '', run: () => goTab(state.tab) },
];

function openPalette() {
  $('palette-wrap').classList.add('open');
  const input = $('pal-input');
  input.value = '';
  input.focus();
  renderPalette('');
}
function closePalette() {
  $('palette-wrap').classList.remove('open');
}

const searchLeads = debounce((q) => {
  req('GET', `/api/leads?q=${encodeURIComponent(q)}&limit=6`).then((data) => {
    const cur = $('pal-input').value.trim();
    if (cur !== q) return; // stale response
    renderPalette(q, data.leads || []);
  }).catch(() => {});
}, 160);

function renderPalette(q, foundLeads) {
  palItems = [];
  const ql = q.toLowerCase();
  let h = '';

  if (q && foundLeads === undefined) searchLeads(q);
  const leadRows = foundLeads || [];
  if (leadRows.length) {
    h += '<div class="pal-group">Leads</div>';
    for (const l of leadRows) {
      const i = palItems.length;
      palItems.push({ run: () => openLead(l.id) });
      h += `<div class="pal-item${i === palSel ? ' sel' : ''}" data-i="${i}">
        <span class="ico">◇</span><span>${esc(l.company_name)}</span>
        <span class="sub">${esc(l.email || l.domain || l.city || '')}</span>
        <span class="right sub">${esc(l.status)}</span></div>`;
    }
  }

  const acts = PAL_ACTIONS.filter((a) => !ql || a.label.toLowerCase().includes(ql));
  if (acts.length) {
    h += '<div class="pal-group">Actions</div>';
    for (const a of acts) {
      const i = palItems.length;
      palItems.push({ run: a.run });
      h += `<div class="pal-item${i === palSel ? ' sel' : ''}" data-i="${i}">
        <span class="ico">→</span><span>${esc(a.label)}</span>
        ${a.hint ? `<span class="right"><span class="kbd">${esc(a.hint)}</span></span>` : ''}</div>`;
    }
  }

  if (q) {
    const i = palItems.length;
    palItems.push({ run: () => { openChat(); $('chat-text').value = q; sendChat(); } });
    h += `<div class="pal-group">Agent</div>
      <div class="pal-item${i === palSel ? ' sel' : ''}" data-i="${i}">
      <span class="ico">✦</span><span>Ask agent: “${esc(q)}”</span></div>`;
  }

  if (!palItems.length) h = '<div class="pal-group">No matches</div>';
  if (palSel >= palItems.length) palSel = Math.max(0, palItems.length - 1);
  $('pal-list').innerHTML = h;
  $('pal-list').querySelectorAll('.pal-item').forEach((el) => {
    el.onclick = () => { closePalette(); palItems[+el.dataset.i].run(); };
  });
}

$('pal-input').addEventListener('input', () => { palSel = 0; renderPalette($('pal-input').value.trim()); });
$('pal-input').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); rerenderPal(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); rerenderPal(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const item = palItems[palSel];
    if (item) { closePalette(); item.run(); }
  }
});
function rerenderPal() {
  $('pal-list').querySelectorAll('.pal-item').forEach((el) => {
    el.classList.toggle('sel', +el.dataset.i === palSel);
  });
  const sel = $('pal-list').querySelector('.pal-item.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
$('palette-wrap').addEventListener('click', (e) => { if (e.target === $('palette-wrap')) closePalette(); });

// ---------- chat ----------
let chatHistory = [];
function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  $('chat-log').appendChild(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}
function openChat() { $('chat').classList.add('open'); $('chat-text').focus(); }
function sendChat(preset) {
  const ta = $('chat-text');
  const text = (preset || ta.value).trim();
  if (!text) return;
  ta.value = '';
  addMsg('user', text);
  const busy = addMsg('agent busy', 'thinking…');
  $('chat-send').disabled = true;
  req('POST', '/api/agent', { message: text, history: chatHistory }).then((r) => {
    chatHistory = r.history || chatHistory;
    busy.className = 'msg agent';
    busy.textContent = r.reply || '(no reply)';
    $('chat-send').disabled = false;
    loadStats();
    document.dispatchEvent(new CustomEvent('mo:agent-done'));
  }).catch(() => {
    busy.className = 'msg agent';
    busy.textContent = '(request failed)';
    $('chat-send').disabled = false;
  });
}
$('chat-send').addEventListener('click', () => sendChat());
$('chat-text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});
$('chat-clear').addEventListener('click', () => {
  chatHistory = [];
  $('chat-log').innerHTML = '';
  toast('Conversation cleared');
});
document.querySelectorAll('#chat-chips button').forEach((b) => {
  b.addEventListener('click', () => sendChat(b.dataset.q));
});
$('chat-fab').addEventListener('click', openChat);
$('chat-toggle').addEventListener('click', () => $('chat').classList.toggle('open'));
$('chat-close').addEventListener('click', () => $('chat').classList.remove('open'));

// ---------- header actions ----------
$('btn-refresh').addEventListener('click', () => goTab(state.tab));
$('btn-scrape').addEventListener('click', () => {
  $('btn-scrape').disabled = true;
  req('POST', '/api/scrape/run', {})
    .then(() => { toast('Scrape started — check System → Scrape runs in a few minutes.', 'ok'); $('btn-scrape').disabled = false; })
    .catch(() => { $('btn-scrape').disabled = false; });
});
$('btn-pause').addEventListener('click', () =>
  req('POST', '/api/sending/pause').then(() => { toast('Sending paused'); loadStats(); }));
$('btn-resume').addEventListener('click', () =>
  req('POST', '/api/sending/resume').then(() => { toast('Sending resumed', 'ok'); loadStats(); }));
$('btn-logout').addEventListener('click', () =>
  fetch('/auth/logout', { method: 'POST' }).then(() => showLogin('Signed out.')));
$('btn-passwd').addEventListener('click', async () => {
  const ans = await inputModal({
    title: 'Change password',
    fields: [
      { key: 'cur', label: 'current', type: 'password', required: true },
      { key: 'nw', label: 'new (min 8)', type: 'password', required: true },
    ],
    confirmLabel: 'Change password',
  });
  if (!ans) return;
  fetch('/auth/password', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ current_password: ans.cur, new_password: ans.nw }),
  }).then((r) => r.json()).then((d) => toast(d.ok ? 'Password changed' : d.error || 'Failed', d.ok ? 'ok' : 'err'));
});

// ---------- tab bars ----------
function buildTabBars() {
  $('tabbar').innerHTML = TABS.map((t) =>
    `<button data-tab="${t.id}">${esc(t.title)}<span class="kbd">g ${t.hotkey}</span></button>`).join('');
  $('tabbar').querySelectorAll('button').forEach((b) => {
    b.onclick = () => goTab(b.dataset.tab);
  });
  const mobileTabs = TABS.filter((t) => ['today', 'inbox', 'leads', 'pipeline'].includes(t.id));
  $('bottombar').innerHTML = mobileTabs.map((t) =>
    `<button data-tab="${t.id}"><span class="ico">${t.icon}</span>${esc(t.title)}</button>`).join('') +
    '<button id="bb-more"><span class="ico">⋯</span>More</button>';
  $('bottombar').querySelectorAll('button[data-tab]').forEach((b) => {
    b.onclick = () => goTab(b.dataset.tab);
  });
  $('bb-more').onclick = () => goTab(moreCycle());
}
let moreLast = 'analytics';
function moreCycle() {
  moreLast = moreLast === 'analytics' ? 'system' : 'analytics';
  return moreLast;
}

// ---------- login wiring ----------
$('login-btn').addEventListener('click', tryLogin);
$('login-user').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('login-pass').focus(); });
$('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
$('login-key-btn').addEventListener('click', tryKeyLogin);
$('login-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryKeyLogin(); });
$('login-alt').addEventListener('click', (e) => {
  e.preventDefault();
  $('login-form').style.display = 'none';
  $('login-keyform').style.display = '';
  $('login-err').textContent = '';
  $('login-key').focus();
});
$('login-back').addEventListener('click', (e) => {
  e.preventDefault();
  $('login-keyform').style.display = 'none';
  $('login-form').style.display = '';
  $('login-err').textContent = '';
  $('login-user').focus();
});

// ---------- global chrome ----------
$('scrim').addEventListener('click', closeDrawer);
$('modal-wrap').addEventListener('click', (e) => { if (e.target === $('modal-wrap')) closeModal(); });

// ---------- boot ----------
buildTabBars();
fetch('/auth/me').then((r) => (r.ok ? r.json() : null)).then((me) => {
  if (me && me.ok) { state.user = me.username; boot(); } else showLogin('');
}).catch(() => showLogin(''));
