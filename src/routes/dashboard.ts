// Single-file dashboard: dark, dense, vanilla JS, fully responsive (desktop
// + phone). Auth: username/password session (API key as fallback). Palette:
// validated dark-surface tokens; status colors never carry meaning alone —
// the status text label is always rendered next to them.
// NOTE: the embedded <script> deliberately avoids backticks and ${} so this
// whole file can live inside one TypeScript template literal.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maranasi Outreach Engine</title>
<style>
  :root {
    --bg:#131312; --surface:#1a1a19; --raised:#232321; --line:#33322f; --line-soft:#2a2927;
    --text:#ffffff; --text2:#c3c2b7; --muted:#8a897d;
    --blue:#3987e5; --aqua:#199e70; --yellow:#c98500; --violet:#9085e9;
    --red:#e66767; --orange:#d95926; --magenta:#d55181;
    --good:#0ca30c; --warn:#fab219; --serious:#ec835a; --critical:#d03b3b;
    --radius:8px;
  }
  * { box-sizing:border-box; }
  html,body { height:100%; }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.5 ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  button { background:var(--raised); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:5px 12px; cursor:pointer; font:inherit; }
  button:hover { border-color:var(--muted); }
  button:disabled { opacity:.5; cursor:default; }
  button.primary { background:var(--blue); border-color:var(--blue); color:#fff; font-weight:600; }
  button.primary:hover { filter:brightness(1.1); }
  button.danger { color:var(--critical); }
  button.good { color:var(--good); }
  input,select,textarea { background:var(--bg); color:var(--text); border:1px solid var(--line); border-radius:6px; padding:5px 9px; font:inherit; }
  input:focus,select:focus,textarea:focus { outline:none; border-color:var(--blue); }
  ::placeholder { color:var(--muted); }

  /* ---- login ---- */
  #login { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:100; padding:16px; }
  #login .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:32px; width:340px; max-width:100%; }
  #login h1 { margin:0 0 4px; font-size:16px; letter-spacing:.08em; }
  #login p { margin:0 0 18px; color:var(--muted); }
  #login input { width:100%; padding:9px 12px; margin-bottom:10px; }
  #login button { width:100%; padding:9px; }
  #login .err { color:var(--critical); margin:8px 0 0; min-height:18px; }
  #login .alt { margin-top:12px; text-align:center; }
  #login .alt a { color:var(--muted); font-size:12px; }

  /* ---- shell ---- */
  #app { display:none; height:100%; flex-direction:column; }
  header { display:flex; align-items:center; gap:8px; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--surface); flex-wrap:wrap; }
  header .brand { font-weight:700; letter-spacing:.1em; font-size:13px; margin-right:6px; }
  header .brand span { color:var(--blue); }
  .badge { font-size:11px; font-weight:600; letter-spacing:.05em; border-radius:20px; padding:2px 10px; border:1px solid var(--line); color:var(--text2); }
  .badge.dry { color:var(--warn); border-color:var(--warn); }
  .badge.live { color:var(--good); border-color:var(--good); }
  .badge.paused { color:var(--critical); border-color:var(--critical); }
  header .spacer { flex:1; }

  /* ---- KPI row ---- */
  #kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(105px,1fr)); gap:8px; padding:12px 16px; }
  .kpi { background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--radius); padding:10px 12px; }
  .kpi .v { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; }
  .kpi .l { color:var(--muted); font-size:11px; letter-spacing:.04em; text-transform:uppercase; margin-top:2px; display:flex; align-items:center; gap:5px; }
  .kpi .dot { width:7px; height:7px; border-radius:50%; display:inline-block; flex:none; }

  /* ---- layout ---- */
  #main { display:flex; flex:1; min-height:0; }
  #content { flex:1; min-width:0; display:flex; flex-direction:column; padding:0 16px 16px; }
  nav.tabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin-bottom:12px; overflow-x:auto; }
  nav.tabs button { background:none; border:none; border-bottom:2px solid transparent; border-radius:0; color:var(--muted); padding:8px 14px; font-weight:600; white-space:nowrap; }
  nav.tabs button.active { color:var(--text); border-bottom-color:var(--blue); }
  #tabbody { flex:1; overflow:auto; min-height:0; }
  .tablewrap { overflow-x:auto; }

  /* ---- tables ---- */
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; padding:6px 10px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:1; white-space:nowrap; }
  td { padding:7px 10px; border-bottom:1px solid var(--line-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px; color:var(--text2); }
  td.pri { color:var(--text); font-weight:500; }
  tbody tr.click:hover td { background:var(--surface); cursor:pointer; }
  .empty { color:var(--muted); padding:40px; text-align:center; }

  .tag { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; border-radius:20px; padding:1px 9px 1px 6px; border:1px solid var(--line); }
  .tag i { width:7px; height:7px; border-radius:50%; display:inline-block; flex:none; }
  .num { font-variant-numeric:tabular-nums; }

  /* ---- filter bar / toolbar ---- */
  #filters { display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; align-items:center; }
  #filters input[type=text] { width:180px; }
  .viewtoggle button.on { border-color:var(--blue); color:var(--blue); }

  /* ---- board ---- */
  #board { display:flex; gap:10px; overflow-x:auto; align-items:flex-start; padding-bottom:10px; }
  .col { background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--radius); min-width:230px; width:230px; flex:none; }
  .col h4 { margin:0; padding:9px 12px; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--text2); border-bottom:1px solid var(--line-soft); display:flex; gap:6px; align-items:center; }
  .col h4 .cnt { color:var(--muted); margin-left:auto; }
  .col .cards { padding:8px; max-height:60vh; overflow:auto; }
  .card-lead { background:var(--bg); border:1px solid var(--line-soft); border-radius:6px; padding:8px 10px; margin-bottom:8px; cursor:pointer; }
  .card-lead:hover { border-color:var(--muted); }
  .card-lead b { display:block; color:var(--text); margin-bottom:2px; }
  .card-lead .m { color:var(--muted); font-size:11px; }

  /* ---- chat ---- */
  #chat { width:360px; flex:none; border-left:1px solid var(--line); background:var(--surface); display:flex; flex-direction:column; min-height:0; }
  #chat .head { padding:10px 14px; border-bottom:1px solid var(--line); display:flex; align-items:center; }
  #chat .head b { flex:1; }
  #chat-log { flex:1; overflow:auto; padding:12px; }
  .msg { margin:0 0 10px; padding:8px 11px; border-radius:10px; white-space:pre-wrap; max-width:92%; }
  .msg.user { background:var(--blue); color:#fff; margin-left:auto; border-bottom-right-radius:3px; }
  .msg.agent { background:var(--raised); border:1px solid var(--line-soft); border-bottom-left-radius:3px; }
  .msg.agent.busy { color:var(--muted); font-style:italic; }
  #chat-chips { display:flex; gap:6px; padding:0 12px 8px; flex-wrap:wrap; }
  #chat-chips button { font-size:11px; padding:3px 9px; border-radius:14px; color:var(--text2); }
  #chat-input { display:flex; gap:8px; padding:10px; border-top:1px solid var(--line); }
  #chat-input textarea { flex:1; height:58px; resize:none; }
  #chat-close { display:none; }
  #chat-fab { display:none; position:fixed; right:16px; bottom:16px; z-index:15; width:52px; height:52px; border-radius:50%; background:var(--blue); border:none; color:#fff; font-size:22px; box-shadow:0 4px 16px rgba(0,0,0,.5); }

  /* ---- drawer ---- */
  #scrim { position:fixed; inset:0; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .15s; z-index:20; }
  #scrim.open { opacity:1; pointer-events:auto; }
  #drawer { position:fixed; right:0; top:0; height:100%; width:560px; max-width:100vw; background:var(--surface); border-left:1px solid var(--line); transform:translateX(102%); transition:transform .18s ease-out; z-index:21; display:flex; flex-direction:column; }
  #drawer.open { transform:none; }
  #drawer .head { padding:14px 18px; border-bottom:1px solid var(--line); }
  #drawer .head h2 { margin:0 0 6px; font-size:16px; }
  #drawer .sub { color:var(--muted); overflow-wrap:anywhere; }
  #drawer .body { flex:1; overflow:auto; padding:14px 18px; }
  .sect { margin-bottom:18px; }
  .sect h3 { margin:0 0 8px; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .frow { display:flex; gap:8px; margin-bottom:7px; align-items:center; }
  .frow label { width:96px; color:var(--muted); flex:none; }
  .frow input, .frow textarea { flex:1; min-width:0; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .tl-item { border:1px solid var(--line-soft); border-radius:var(--radius); background:var(--bg); padding:8px 11px; margin-bottom:8px; }
  .tl-item .meta { color:var(--muted); font-size:11px; margin-bottom:3px; }
  .tl-item pre { white-space:pre-wrap; margin:4px 0 0; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; color:var(--text2); max-height:220px; overflow:auto; }

  /* ---- cards / panels ---- */
  .tpl { background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--radius); padding:14px; margin-bottom:14px; }
  .tpl .top { display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
  .tpl .top b { flex:1; }
  .tpl input[type=text] { width:100%; margin-bottom:8px; }
  .tpl textarea { width:100%; height:170px; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; }
  .tpl .foot { display:flex; align-items:center; gap:10px; margin-top:8px; flex-wrap:wrap; }
  .placeholders { color:var(--muted); font-size:11px; }
  .placeholders code { background:var(--raised); border-radius:4px; padding:1px 5px; }

  /* ---- analytics ---- */
  .charts { display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px; }
  .chart h4 { margin:0 0 12px; font-size:12px; color:var(--text2); }
  .bar-row { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .bar-row .lbl { width:110px; color:var(--text2); flex:none; font-size:12px; text-align:right; }
  .bar-row .track { flex:1; height:20px; display:flex; align-items:center; }
  .bar-row .bar { height:20px; border-radius:0 4px 4px 0; min-width:2px; }
  .bar-row .val { color:var(--text); font-weight:600; margin-left:8px; font-variant-numeric:tabular-nums; }
  .legend { display:flex; gap:14px; margin-bottom:8px; color:var(--text2); font-size:11px; }
  .legend i { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:4px; }

  /* ---- mail tab ---- */
  .mailrow { display:flex; gap:10px; padding:10px 8px; border-bottom:1px solid var(--line-soft); cursor:pointer; align-items:flex-start; }
  .mailrow:hover { background:var(--surface); }
  .mdir { flex:none; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; margin-top:2px; }
  .mdir.mout { background:rgba(57,135,229,.16); color:var(--blue); }
  .mdir.min { background:rgba(25,158,112,.16); color:var(--aqua); }
  .mmain { flex:1; min-width:0; }
  .mtop { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
  .mtop b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%; }
  .msub { color:var(--text2); font-size:12px; margin-top:2px; }
  .msnip { color:var(--muted); font-size:12px; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mtime { flex:none; color:var(--muted); font-size:11px; margin-top:3px; }

  /* ---- modal ---- */
  #modal-wrap { position:fixed; inset:0; background:rgba(0,0,0,.55); display:none; align-items:center; justify-content:center; z-index:40; padding:16px; }
  #modal-wrap.open { display:flex; }
  #modal { background:var(--surface); border:1px solid var(--line); border-radius:12px; width:560px; max-width:100%; max-height:90vh; overflow:auto; padding:20px; }
  #modal h3 { margin:0 0 12px; }
  #modal .frow label { width:110px; }
  #modal textarea { width:100%; }

  #toast-wrap { position:fixed; bottom:16px; left:16px; z-index:50; display:flex; flex-direction:column; gap:8px; max-width:90vw; }
  .toast { background:var(--raised); border:1px solid var(--line); border-left:3px solid var(--blue); border-radius:6px; padding:9px 14px; max-width:420px; animation:tin .15s ease-out; }
  .toast.err { border-left-color:var(--critical); }
  @keyframes tin { from { transform:translateY(8px); opacity:0; } }

  /* ---- phone ---- */
  @media (max-width: 900px) {
    header { padding:8px 10px; }
    #content { padding:0 10px 70px; }
    #kpis { padding:10px; grid-template-columns:repeat(auto-fit,minmax(88px,1fr)); }
    .kpi .v { font-size:16px; }
    #chat { display:none; position:fixed; inset:0; width:100%; z-index:30; }
    #chat.open { display:flex; }
    #chat-close { display:inline-block; }
    #chat-fab { display:block; }
    #drawer { width:100vw; }
    #filters input[type=text] { width:130px; }
    .bar-row .lbl { width:84px; }
    /* All tabs stay visible on a phone: wrap instead of scrolling off-screen. */
    nav.tabs { flex-wrap:wrap; }
    nav.tabs button { padding:7px 10px; font-size:13px; }
    .mtime { display:none; }
  }
</style>
</head>
<body>

<div id="login">
  <div class="card">
    <h1>MARANASI <span style="color:var(--blue)">OUTREACH</span></h1>
    <p>Sign in to continue.</p>
    <div id="login-form">
      <input type="text" id="login-user" placeholder="Username" autocomplete="username" autofocus>
      <input type="password" id="login-pass" placeholder="Password" autocomplete="current-password">
      <button class="primary" id="login-btn">Sign in</button>
      <div class="alt"><a href="#" id="login-alt">Use the admin API key instead</a></div>
    </div>
    <div id="login-keyform" style="display:none">
      <input type="password" id="login-key" placeholder="Admin API key">
      <button class="primary" id="login-key-btn">Unlock</button>
      <div class="alt"><a href="#" id="login-back">Back to username sign-in</a></div>
    </div>
    <div class="err" id="login-err"></div>
  </div>
</div>

<div id="app">
  <header>
    <div class="brand">MARANASI <span>OUTREACH</span></div>
    <span class="badge" id="b-mode">…</span>
    <span class="badge paused" id="b-paused" style="display:none">PAUSED</span>
    <div class="spacer"></div>
    <button id="btn-scrape">▶ Scrape</button>
    <button id="btn-pause" class="danger">⏸ Pause</button>
    <button id="btn-resume" class="good" style="display:none">▶ Resume</button>
    <button id="btn-refresh">↻</button>
    <span class="badge" id="b-user" style="display:none"></span>
    <button id="btn-passwd" style="display:none" title="Change my password">Password</button>
    <button id="btn-logout" style="display:none">Sign out</button>
  </header>

  <div id="kpis"></div>

  <div id="main">
    <div id="content">
      <nav class="tabs">
        <button data-tab="leads" class="active">Leads</button>
        <button data-tab="mail">Mail</button>
        <button data-tab="analytics">Analytics</button>
        <button data-tab="templates">Templates</button>
        <button data-tab="suppression">Suppression</button>
        <button data-tab="runs">Scrape runs</button>
        <button data-tab="activity">Activity</button>
        <button data-tab="settings">Settings</button>
      </nav>
      <div id="tabbody"></div>
    </div>

    <aside id="chat">
      <div class="head"><b>CRM agent</b><button id="chat-clear" title="Clear conversation">Clear</button><button id="chat-close">✕</button></div>
      <div id="chat-log"></div>
      <div id="chat-chips">
        <button data-q="Recap the new contacts this week.">Weekly recap</button>
        <button data-q="Who needs a call right now? List them with phone numbers.">Who needs a call?</button>
        <button data-q="Give me pipeline stats for the last 7 days.">Pipeline stats</button>
      </div>
      <div id="chat-input">
        <textarea id="chat-text" placeholder="Ask the CRM agent… (Enter to send)"></textarea>
        <button class="primary" id="chat-send">Send</button>
      </div>
    </aside>
  </div>
</div>

<button id="chat-fab" title="CRM agent">✦</button>
<div id="scrim"></div>
<div id="drawer"></div>
<div id="modal-wrap"><div id="modal"></div></div>
<div id="toast-wrap"></div>

<script>
(function () {
  'use strict';
  var API_KEY = null;
  var CURRENT_USER = null;
  var chatHistory = [];
  var tab = 'leads';
  var leadsView = 'table';
  var leadsOffset = 0;
  var LIMIT = 100;

  var STATUS_COLORS = {
    new: 'var(--muted)', enriched: 'var(--aqua)', verified: 'var(--blue)',
    contacted: 'var(--violet)', interested: 'var(--good)', not_interested: 'var(--warn)',
    unresponsive_email: 'var(--serious)', opted_out: 'var(--critical)',
    invalid_email: 'var(--critical)', dropped: 'var(--muted)'
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function toast(msg, isErr) {
    var t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    $('toast-wrap').appendChild(t);
    setTimeout(function () { t.remove(); }, 4500);
  }
  function statusTag(status) {
    var c = STATUS_COLORS[status] || 'var(--muted)';
    var style = status === 'dropped' ? 'text-decoration:line-through;' : '';
    return '<span class="tag" style="' + style + '"><i style="background:' + c + '"></i>' + esc(status) + '</span>';
  }
  function req(method, path, body) {
    var headers = { 'content-type': 'application/json' };
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { showLogin('Session expired — sign in again.'); throw new Error('unauthorized'); }
      return r.json().then(function (data) {
        if (!r.ok && data && data.error) { toast(data.error, true); throw new Error(data.error); }
        return data;
      });
    });
  }
  function openModal(html) { $('modal').innerHTML = html; $('modal-wrap').classList.add('open'); }
  function closeModal() { $('modal-wrap').classList.remove('open'); }
  $('modal-wrap').addEventListener('click', function (e) { if (e.target === $('modal-wrap')) closeModal(); });

  // ---------- login / session ----------
  function showLogin(msg) {
    API_KEY = null;
    CURRENT_USER = null;
    $('login').style.display = 'flex';
    $('app').style.display = 'none';
    $('login-err').textContent = msg || '';
    $('login-pass').value = '';
    $('login-key').value = '';
    $('login-user').focus();
  }
  function boot() {
    $('login').style.display = 'none';
    $('app').style.display = 'flex';
    var isSession = CURRENT_USER && CURRENT_USER !== 'api-key';
    $('b-user').style.display = CURRENT_USER ? '' : 'none';
    $('b-user').textContent = CURRENT_USER === 'api-key' ? 'API key' : CURRENT_USER;
    $('btn-passwd').style.display = isSession ? '' : 'none';
    $('btn-logout').style.display = '';
    refreshAll();
  }
  function tryLogin() {
    var u = $('login-user').value.trim();
    var p = $('login-pass').value;
    if (!u || !p) return;
    $('login-btn').disabled = true;
    fetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, d: d }; });
    }).then(function (res) {
      $('login-btn').disabled = false;
      if (!res.ok) { $('login-err').textContent = res.d.error || 'Sign-in failed.'; return; }
      CURRENT_USER = res.d.username;
      boot();
    }).catch(function () {
      $('login-btn').disabled = false;
      $('login-err').textContent = 'Network error.';
    });
  }
  function tryKeyLogin() {
    var key = $('login-key').value.trim();
    if (!key) return;
    $('login-key-btn').disabled = true;
    fetch('/api/stats', { headers: { 'X-API-Key': key } }).then(function (r) {
      $('login-key-btn').disabled = false;
      if (!r.ok) { $('login-err').textContent = 'Invalid key.'; return; }
      API_KEY = key;
      CURRENT_USER = 'api-key';
      boot();
    }).catch(function () {
      $('login-key-btn').disabled = false;
      $('login-err').textContent = 'Network error.';
    });
  }
  $('login-btn').addEventListener('click', tryLogin);
  $('login-user').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('login-pass').focus(); });
  $('login-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });
  $('login-key-btn').addEventListener('click', tryKeyLogin);
  $('login-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryKeyLogin(); });
  $('login-alt').addEventListener('click', function (e) {
    e.preventDefault();
    $('login-form').style.display = 'none';
    $('login-keyform').style.display = '';
    $('login-err').textContent = '';
    $('login-key').focus();
  });
  $('login-back').addEventListener('click', function (e) {
    e.preventDefault();
    $('login-keyform').style.display = 'none';
    $('login-form').style.display = '';
    $('login-err').textContent = '';
    $('login-user').focus();
  });
  $('btn-logout').addEventListener('click', function () {
    fetch('/auth/logout', { method: 'POST' }).then(function () { showLogin('Signed out.'); });
  });
  $('btn-passwd').addEventListener('click', function () {
    var cur = window.prompt('Current password'); if (!cur) return;
    var nw = window.prompt('New password (min 8 characters)'); if (!nw) return;
    fetch('/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current_password: cur, new_password: nw })
    }).then(function (r) { return r.json(); }).then(function (d) {
      toast(d.ok ? 'Password changed' : (d.error || 'Failed'), !d.ok);
    });
  });

  // ---------- KPIs ----------
  function kpi(value, label, color) {
    return '<div class="kpi"><div class="v num">' + value + '</div><div class="l">' +
      (color ? '<i class="dot" style="background:' + color + '"></i>' : '') + label + '</div></div>';
  }
  function loadStats() {
    return req('GET', '/api/stats').then(function (s) {
      var b = s.by_status || {};
      var tick = s.health && s.health.jobs ? s.health.jobs.tick : null;
      var mins = tick ? Math.round((Date.now() - new Date(tick).getTime()) / 60000) : null;
      var cronVal = mins === null ? '—' : (mins < 1 ? 'now' : mins + 'm ago');
      var cronCol = mins === null ? 'var(--muted)' : (mins <= 20 ? 'var(--good)' : 'var(--critical)');
      var errs = s.health ? s.health.errors_24h : 0;
      $('kpis').innerHTML =
        kpi(s.total, 'leads') +
        kpi(b.verified || 0, 'verified', 'var(--blue)') +
        kpi(b.contacted || 0, 'contacted', 'var(--violet)') +
        kpi(b.interested || 0, 'interested', 'var(--good)') +
        kpi(s.needs_call, 'needs call', 'var(--warn)') +
        kpi(s.sent_7d, 'sent · 7d') +
        kpi(s.replies_7d, 'replies · 7d') +
        kpi(s.sent_today + '<span style="color:var(--muted);font-size:13px">/' + s.daily_cap + '</span>', 'sent today') +
        kpi('<span style="font-size:14px">' + cronVal + '</span>', 'cron tick', cronCol) +
        kpi(errs, 'errors · 24h', errs ? 'var(--critical)' : 'var(--good)');
      var mode = $('b-mode');
      mode.textContent = s.dry_run ? 'DRY RUN' : 'LIVE';
      mode.className = 'badge ' + (s.dry_run ? 'dry' : 'live');
      $('b-paused').style.display = s.sending_paused ? '' : 'none';
      $('btn-pause').style.display = s.sending_paused ? 'none' : '';
      $('btn-resume').style.display = s.sending_paused ? '' : 'none';
    });
  }

  // ---------- tabs ----------
  var tabButtons = document.querySelectorAll('nav.tabs button');
  Array.prototype.forEach.call(tabButtons, function (btn) {
    btn.addEventListener('click', function () {
      tab = btn.getAttribute('data-tab');
      Array.prototype.forEach.call(tabButtons, function (b) { b.className = b === btn ? 'active' : ''; });
      renderTab();
    });
  });
  function renderTab() {
    if (tab === 'leads') renderLeadsTab();
    else if (tab === 'mail') renderMailTab();
    else if (tab === 'analytics') renderAnalyticsTab();
    else if (tab === 'templates') renderTemplatesTab();
    else if (tab === 'suppression') renderSuppressionTab();
    else if (tab === 'runs') renderRunsTab();
    else if (tab === 'activity') renderActivityTab();
    else if (tab === 'settings') renderSettingsTab();
  }

  // ---------- leads ----------
  function renderLeadsTab() {
    $('tabbody').innerHTML =
      '<div id="filters">' +
        '<span class="viewtoggle"><button id="v-table" class="on">Table</button><button id="v-board">Board</button></span>' +
        '<select id="f-status"><option value="">status: all</option>' +
          ['new','enriched','verified','contacted','interested','not_interested','unresponsive_email','opted_out','invalid_email','dropped']
            .map(function (s) { return '<option>' + s + '</option>'; }).join('') +
        '</select>' +
        '<select id="f-country"><option value="">country: all</option><option>VN</option><option>TH</option></select>' +
        '<label style="display:flex;align-items:center;gap:5px;color:var(--text2)"><input type="checkbox" id="f-needs-call"> needs call</label>' +
        '<input type="text" id="f-q" placeholder="Search…">' +
        '<span style="flex:1"></span>' +
        '<button id="btn-add">+ Add lead</button>' +
        '<button id="btn-import">Import CSV</button>' +
        '<button id="btn-export">Export</button>' +
      '</div>' +
      '<div id="leads-body"></div>';
    ['f-status', 'f-country', 'f-needs-call'].forEach(function (id) {
      $(id).addEventListener('change', function () { leadsOffset = 0; loadLeads(false); });
    });
    $('f-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { leadsOffset = 0; loadLeads(false); } });
    $('v-table').addEventListener('click', function () { leadsView = 'table'; $('v-table').className = 'on'; $('v-board').className = ''; loadLeads(false); });
    $('v-board').addEventListener('click', function () { leadsView = 'board'; $('v-board').className = 'on'; $('v-table').className = ''; loadLeads(false); });
    $('btn-add').addEventListener('click', openAddLead);
    $('btn-import').addEventListener('click', openImport);
    $('btn-export').addEventListener('click', exportCsv);
    loadLeads(false);
  }
  function leadQuery() {
    var p = [];
    if ($('f-status') && $('f-status').value) p.push('status=' + encodeURIComponent($('f-status').value));
    if ($('f-country') && $('f-country').value) p.push('country=' + encodeURIComponent($('f-country').value));
    if ($('f-needs-call') && $('f-needs-call').checked) p.push('needs_call=1');
    if ($('f-q') && $('f-q').value) p.push('q=' + encodeURIComponent($('f-q').value));
    return p;
  }
  function leadRow(l) {
    var call = l.needs_call
      ? '<span class="tag"><i style="background:var(--warn)"></i>CALL</span>'
      : esc(l.phone_status);
    return '<tr class="click" data-id="' + l.id + '">' +
      '<td class="num">' + l.id + '</td>' +
      '<td class="pri" title="' + esc(l.company_name) + '">' + esc(l.company_name) + '</td>' +
      '<td>' + esc(l.contact_name || '—') + '</td>' +
      '<td>' + esc(l.city || '—') + (l.country ? ' · ' + esc(l.country) : '') + '</td>' +
      '<td>' + statusTag(l.status) + '</td>' +
      '<td class="num">' + l.sequence_step + '/3</td>' +
      '<td title="' + esc(l.email) + '">' + esc(l.email || '—') + '</td>' +
      '<td>' + call + '</td>' +
      '<td class="num">' + esc(l.next_action_at || '—') + '</td>' +
    '</tr>';
  }
  function loadLeads(append) {
    if (leadsView === 'board') return loadBoard();
    var p = leadQuery().concat(['limit=' + LIMIT, 'offset=' + leadsOffset]);
    req('GET', '/api/leads?' + p.join('&')).then(function (data) {
      if (!append) {
        $('leads-body').innerHTML =
          '<div class="tablewrap"><table><thead><tr><th>ID</th><th>Company</th><th>Contact</th><th>Location</th><th>Status</th><th>Step</th><th>Email</th><th>Phone</th><th>Next due</th></tr></thead>' +
          '<tbody id="rows"></tbody></table></div>' +
          '<div style="margin-top:10px;text-align:center"><button id="btn-more" style="display:none">Load more</button></div>';
        $('btn-more').addEventListener('click', function () { leadsOffset += LIMIT; loadLeads(true); });
      }
      var rows = (data.leads || []).map(leadRow).join('');
      if (!append) $('rows').innerHTML = rows ||
        '<tr><td colspan="9" class="empty">No leads yet — press ▶ Scrape, add one, or import a CSV.</td></tr>';
      else $('rows').insertAdjacentHTML('beforeend', rows);
      $('btn-more').style.display = (data.leads || []).length === LIMIT ? '' : 'none';
      Array.prototype.forEach.call(document.querySelectorAll('#rows tr[data-id]'), function (tr) {
        tr.onclick = function () { openDrawer(tr.getAttribute('data-id')); };
      });
    }).catch(function () {});
  }
  var BOARD_COLS = [
    { title: 'New', statuses: ['new', 'enriched'], color: 'var(--muted)' },
    { title: 'Verified', statuses: ['verified'], color: 'var(--blue)' },
    { title: 'Contacted', statuses: ['contacted'], color: 'var(--violet)' },
    { title: 'Interested', statuses: ['interested'], color: 'var(--good)' },
    { title: 'Needs call', statuses: ['unresponsive_email'], color: 'var(--serious)' },
    { title: 'Closed', statuses: ['not_interested', 'opted_out', 'invalid_email', 'dropped'], color: 'var(--muted)' }
  ];
  function loadBoard() {
    var p = leadQuery().concat(['limit=500']);
    req('GET', '/api/leads?' + p.join('&')).then(function (data) {
      var leads = data.leads || [];
      var h = '<div id="board">';
      BOARD_COLS.forEach(function (col) {
        var items = leads.filter(function (l) { return col.statuses.indexOf(l.status) !== -1; });
        h += '<div class="col"><h4><i class="dot" style="width:7px;height:7px;border-radius:50%;background:' + col.color + ';display:inline-block"></i>' +
          col.title + '<span class="cnt num">' + items.length + '</span></h4><div class="cards">';
        if (!items.length) h += '<div class="m" style="color:var(--muted);padding:8px">—</div>';
        items.slice(0, 60).forEach(function (l) {
          h += '<div class="card-lead" data-id="' + l.id + '"><b>' + esc(l.company_name) + '</b>' +
            '<div class="m">' + esc(l.city || '—') + (l.country ? ' · ' + esc(l.country) : '') + ' · step ' + l.sequence_step + '/3' +
            (l.needs_call ? ' · <span style="color:var(--warn)">CALL</span>' : '') + '</div></div>';
        });
        if (items.length > 60) h += '<div class="m" style="color:var(--muted);padding:4px 8px">+' + (items.length - 60) + ' more (use table view)</div>';
        h += '</div></div>';
      });
      h += '</div>';
      $('leads-body').innerHTML = h;
      Array.prototype.forEach.call(document.querySelectorAll('.card-lead[data-id]'), function (el) {
        el.onclick = function () { openDrawer(el.getAttribute('data-id')); };
      });
    }).catch(function () {});
  }

  // ---------- add / import / export ----------
  function openAddLead() {
    openModal(
      '<h3>Add lead</h3>' +
      ['company_name', 'contact_name', 'email', 'phone', 'website', 'city', 'category'].map(function (f) {
        return '<div class="frow"><label>' + f.replace('_', ' ') + '</label><input id="al-' + f + '"></div>';
      }).join('') +
      '<div class="frow"><label>country</label><select id="al-country"><option value="">—</option><option>VN</option><option>TH</option></select></div>' +
      '<div class="actions" style="margin-top:12px"><button class="primary" id="al-save">Add lead</button><button id="al-cancel">Cancel</button></div>'
    );
    $('al-cancel').onclick = closeModal;
    $('al-save').onclick = function () {
      var body = {};
      ['company_name', 'contact_name', 'email', 'phone', 'website', 'city', 'category', 'country'].forEach(function (f) {
        body[f] = $('al-' + f).value;
      });
      req('POST', '/api/leads', body).then(function (r) {
        closeModal();
        toast('Lead #' + r.lead.id + ' added (' + r.lead.status + ')');
        loadStats(); loadLeads(false);
      }).catch(function () {});
    };
  }
  function openImport() {
    openModal(
      '<h3>Import leads from CSV</h3>' +
      '<div class="placeholders" style="margin-bottom:8px">First line must be a header. Recognized columns: ' +
      '<code>company</code> <code>contact</code> <code>email</code> <code>phone</code> <code>website</code> <code>city</code> <code>country</code> <code>category</code>. ' +
      'Duplicates (by email or domain) and suppressed addresses are skipped. Max 200 rows per batch.</div>' +
      '<textarea id="imp-csv" rows="10" placeholder="company,email,city,country&#10;Saigon Star Events,hello@saigonstar.vn,Ho Chi Minh City,VN"></textarea>' +
      '<div class="actions" style="margin-top:12px"><button class="primary" id="imp-go">Import + verify</button><button id="imp-cancel">Cancel</button></div>' +
      '<div id="imp-out" style="margin-top:10px;color:var(--text2)"></div>'
    );
    $('imp-cancel').onclick = closeModal;
    $('imp-go').onclick = function () {
      $('imp-go').disabled = true;
      $('imp-out').textContent = 'Importing…';
      req('POST', '/api/leads/import', { csv: $('imp-csv').value }).then(function (r) {
        $('imp-go').disabled = false;
        $('imp-out').innerHTML = '✓ imported <b>' + r.imported + '</b> · skipped ' + r.skipped + ' (dupes/suppressed) · verified ' + r.verified +
          (r.errors && r.errors.length ? '<br><span style="color:var(--warn)">' + r.errors.map(esc).join('<br>') + '</span>' : '');
        loadStats(); loadLeads(false);
      }).catch(function () { $('imp-go').disabled = false; $('imp-out').textContent = 'Import failed.'; });
    };
  }
  function exportCsv() {
    var headers = {};
    if (API_KEY) headers['X-API-Key'] = API_KEY;
    fetch('/api/leads/export', { headers: headers }).then(function (r) {
      if (!r.ok) { toast('Export failed', true); return null; }
      return r.blob();
    }).then(function (blob) {
      if (!blob) return;
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'maranasi-leads.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  // ---------- drawer ----------
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('open'); }
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); closeModal(); } });

  function openDrawer(id) {
    req('GET', '/api/leads/' + id).then(function (data) {
      var l = data.lead;
      var inSequence = (l.status === 'verified' || l.status === 'contacted');
      var lastSubject = null;
      (data.emails || []).some(function (e) { if (e.subject) { lastSubject = e.subject; return true; } return false; });

      var h = '<div class="head">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<h2 style="flex:1">#' + l.id + ' ' + esc(l.company_name) + '</h2>' +
          '<button onclick="document.getElementById(&quot;scrim&quot;).click()">✕</button>' +
        '</div>' +
        '<div class="sub">' +
          (l.website ? '<a href="' + esc(l.website) + '" target="_blank" rel="noopener" style="color:var(--blue)">' + esc(l.website) + '</a> · ' : '') +
          esc(l.category || '') + ' · ' + esc(l.source) + ' · created ' + esc(l.created_at) +
        '</div>' +
        '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' +
          statusTag(l.status) +
          '<span class="tag">step ' + l.sequence_step + '/3</span>' +
          '<span class="tag">email: ' + esc(l.email_status) + '</span>' +
          '<span class="tag">phone: ' + esc(l.phone_status) + '</span>' +
          (l.confirmed ? '<span class="tag"><i style="background:var(--good)"></i>confirmed</span>' : '') +
          (l.needs_call ? '<span class="tag"><i style="background:var(--warn)"></i>NEEDS CALL</span>' : '') +
          (inSequence && !l.next_action_at ? '<span class="tag"><i style="background:var(--warn)"></i>follow-ups paused</span>' : '') +
        '</div>' +
        (l.drop_reason ? '<div class="sub" style="margin-top:6px">drop reason: ' + esc(l.drop_reason) + '</div>' : '') +
      '</div>';

      h += '<div class="body">';
      h += '<div class="sect"><h3>Contact</h3>' +
        '<div class="frow"><label>email</label><span style="color:var(--text2);overflow-wrap:anywhere">' + esc(l.email || '—') + '</span></div>' +
        '<div class="frow"><label>contact name</label><input id="ed-contact_name" value="' + esc(l.contact_name) + '"></div>' +
        '<div class="frow"><label>phone</label><input id="ed-phone" value="' + esc(l.phone) + '"></div>' +
        '<div class="frow"><label>city</label><input id="ed-city" value="' + esc(l.city) + '"></div>' +
        '<div class="frow"><label>category</label><input id="ed-category" value="' + esc(l.category) + '"></div>' +
        '<div class="frow"><label>notes</label><textarea id="ed-notes" rows="4">' + esc(l.notes) + '</textarea></div>' +
        '<div class="actions"><button class="primary" id="d-save">Save changes</button></div>' +
      '</div>';

      h += '<div class="sect"><h3>Actions</h3><div class="actions">' +
        '<button class="good" id="d-reached">✓ Call: reached</button>' +
        '<button id="d-noanswer">✗ Call: no answer</button>' +
        '<button id="d-verify">Re-verify email</button>' +
        (inSequence && l.sequence_step < 3 ? '<button id="d-preview">Preview next email</button>' : '') +
        (inSequence && l.next_action_at ? '<button id="d-pause" class="danger">Pause follow-ups</button>' : '') +
        (inSequence && !l.next_action_at && l.sequence_step < 3 ? '<button id="d-resume" class="good">Resume follow-ups</button>' : '') +
      '</div><div class="sub" style="margin-top:6px;color:var(--muted)">Logging "no answer" is the human gate that later allows the agent to drop this lead.</div></div>';

      if (l.email) {
        h += '<div class="sect"><h3>Reply / compose (sends for real via Gmail)</h3>' +
          '<div class="frow"><label>subject</label><input id="re-subject" value="' + esc(lastSubject ? (lastSubject.indexOf('Re:') === 0 ? lastSubject : 'Re: ' + lastSubject) : '') + '"></div>' +
          '<textarea id="re-body" rows="6" style="width:100%" placeholder="Write your reply… (ask the CRM agent to draft_reply if you want a starting point)"></textarea>' +
          '<div class="actions" style="margin-top:8px"><button class="primary" id="re-send">Send email</button></div></div>';
      }

      var items = [];
      (data.emails || []).forEach(function (e) {
        items.push({ at: e.created_at, html:
          '<div class="tl-item"><div class="meta">' + esc(e.created_at) + ' · ' +
          (e.direction === 'out' ? '↑ sent' : '↓ received') +
          (e.sequence_step ? ' · step ' + e.sequence_step : (e.direction === 'out' ? ' · manual' : '')) +
          (e.classification ? ' · ' + esc(e.classification) : '') +
          (e.dry_run ? ' · DRY RUN' : '') + '</div>' +
          '<b>' + esc(e.subject || '(no subject)') + '</b>' +
          '<pre>' + esc((e.body || '').slice(0, 1500)) + '</pre></div>' });
      });
      (data.activities || []).forEach(function (a) {
        items.push({ at: a.created_at, html:
          '<div class="tl-item"><div class="meta">' + esc(a.created_at) + ' · ' + esc(a.actor) + ' · <b>' + esc(a.action) + '</b></div>' +
          (a.detail ? '<pre>' + esc(a.detail) + '</pre>' : '') + '</div>' });
      });
      items.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      h += '<div class="sect"><h3>Timeline (' + items.length + ')</h3>' +
           (items.length ? items.map(function (i) { return i.html; }).join('') : '<div class="empty">Nothing yet.</div>') +
           '</div>';
      h += '</div>';

      $('drawer').innerHTML = h;
      $('drawer').classList.add('open');
      $('scrim').classList.add('open');

      $('d-save').onclick = function () {
        var body = { notes: $('ed-notes').value };
        ['contact_name', 'phone', 'city', 'category'].forEach(function (f) { body[f] = $('ed-' + f).value; });
        req('PATCH', '/api/leads/' + id, body).then(function () { toast('Lead saved'); loadLeads(false); loadStats(); openDrawer(id); });
      };
      $('d-reached').onclick = function () {
        req('POST', '/api/leads/' + id + '/call-outcome', { outcome: 'reached' }).then(function () { toast('Logged: call reached'); loadLeads(false); loadStats(); openDrawer(id); });
      };
      $('d-noanswer').onclick = function () {
        req('POST', '/api/leads/' + id + '/call-outcome', { outcome: 'unresponsive' }).then(function () { toast('Logged: no answer'); loadLeads(false); loadStats(); openDrawer(id); });
      };
      $('d-verify').onclick = function () {
        req('POST', '/api/leads/' + id + '/verify').then(function (r) { toast('Verification: ' + r.reason, !r.ok); loadLeads(false); loadStats(); openDrawer(id); });
      };
      if ($('d-preview')) $('d-preview').onclick = function () {
        req('GET', '/api/leads/' + id + '/preview-next').then(function (r) {
          if (!r.ok) { toast(r.reason || 'No preview available', true); return; }
          openModal('<h3>Preview — step ' + r.step + (r.personalized ? ' (AI personalized)' : ' (template fill)') + '</h3>' +
            '<div class="frow"><label>subject</label><span style="color:var(--text)">' + esc(r.subject) + '</span></div>' +
            '<pre style="white-space:pre-wrap;background:var(--bg);border:1px solid var(--line-soft);border-radius:8px;padding:12px;color:var(--text2)">' + esc(r.body) + '</pre>' +
            '<div class="actions"><button id="pv-close">Close</button></div>');
          $('pv-close').onclick = closeModal;
        });
      };
      if ($('d-pause')) $('d-pause').onclick = function () {
        req('POST', '/api/leads/' + id + '/sequence/pause').then(function () { toast('Follow-ups paused'); openDrawer(id); });
      };
      if ($('d-resume')) $('d-resume').onclick = function () {
        req('POST', '/api/leads/' + id + '/sequence/resume').then(function () { toast('Follow-ups resumed'); openDrawer(id); });
      };
      if ($('re-send')) $('re-send').onclick = function () {
        var subject = $('re-subject').value.trim();
        var body = $('re-body').value.trim();
        if (!subject || !body) { toast('Subject and body required', true); return; }
        if (!window.confirm('Send this email to ' + (l.email || '') + ' now? This is a REAL send.')) return;
        $('re-send').disabled = true;
        req('POST', '/api/leads/' + id + '/email', { subject: subject, body: body }).then(function () {
          toast('Email sent to ' + l.email);
          openDrawer(id);
        }).catch(function () { $('re-send').disabled = false; });
      };
    }).catch(function () {});
  }

  // ---------- mail ----------
  var mailOffset = 0;
  function renderMailTab() {
    mailOffset = 0;
    $('tabbody').innerHTML =
      '<div id="filters">' +
        '<select id="m-dir"><option value="">all mail</option><option value="out">sent</option><option value="in">received</option></select>' +
        '<select id="m-kind"><option value="">real + test</option><option value="real">real only</option><option value="test">test (dry run)</option></select>' +
        '<input type="text" id="m-q" placeholder="Search subject, body, company…">' +
        '<span style="flex:1"></span><span id="m-count" style="color:var(--muted);align-self:center"></span>' +
      '</div>' +
      '<div id="mail-body"></div>' +
      '<div style="margin-top:10px;text-align:center"><button id="m-more" style="display:none">Load more</button></div>';
    ['m-dir', 'm-kind'].forEach(function (id) {
      $(id).addEventListener('change', function () { mailOffset = 0; loadMail(false); });
    });
    $('m-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { mailOffset = 0; loadMail(false); } });
    $('m-more').addEventListener('click', function () { mailOffset += 50; loadMail(true); });
    loadMail(false);
  }
  function classTag(cls) {
    var color = cls === 'interested' ? 'var(--good)'
      : cls === 'opt_out' || cls === 'bounce' ? 'var(--critical)'
      : cls === 'not_interested' ? 'var(--serious)'
      : cls === 'ooo' ? 'var(--warn)' : 'var(--muted)';
    return '<span class="tag"><i style="background:' + color + '"></i>' + esc(cls) + '</span>';
  }
  function loadMail(append) {
    var p = ['limit=50', 'offset=' + mailOffset];
    if ($('m-dir').value) p.push('direction=' + $('m-dir').value);
    if ($('m-kind').value) p.push('kind=' + $('m-kind').value);
    if ($('m-q').value) p.push('q=' + encodeURIComponent($('m-q').value));
    req('GET', '/api/emails?' + p.join('&')).then(function (data) {
      var rows = (data.emails || []).map(function (e) {
        var badges = '';
        if (e.direction === 'out') badges += '<span class="tag">' + (e.sequence_step ? 'step ' + e.sequence_step : 'manual') + '</span>';
        if (e.dry_run) badges += '<span class="tag"><i style="background:var(--warn)"></i>DRY RUN</span>';
        if (e.classification) badges += classTag(e.classification);
        return '<div class="mailrow" data-lead="' + e.lead_id + '">' +
          '<span class="mdir ' + (e.direction === 'out' ? 'mout' : 'min') + '">' + (e.direction === 'out' ? '↑' : '↓') + '</span>' +
          '<div class="mmain">' +
            '<div class="mtop"><b>' + esc(e.subject || '(no subject)') + '</b>' + badges + '</div>' +
            '<div class="msub">' + esc(e.company_name) + (e.lead_email ? ' · ' + esc(e.lead_email) : '') + '</div>' +
            '<div class="msnip">' + esc((e.snippet || '').replace(/\\s+/g, ' ')) + '</div>' +
          '</div>' +
          '<span class="mtime num">' + esc((e.created_at || '').slice(0, 16)) + '</span>' +
        '</div>';
      }).join('');
      if (!append) {
        $('mail-body').innerHTML = rows ||
          '<div class="empty">No mail yet. Outreach the sequence engine sends — and replies the watcher pulls in — all land here.</div>';
      } else {
        $('mail-body').insertAdjacentHTML('beforeend', rows);
      }
      $('m-count').textContent = data.total + ' message' + (data.total === 1 ? '' : 's');
      $('m-more').style.display = mailOffset + 50 < data.total ? '' : 'none';
      Array.prototype.forEach.call(document.querySelectorAll('.mailrow[data-lead]'), function (el) {
        el.onclick = function () { openDrawer(el.getAttribute('data-lead')); };
      });
    });
  }

  // ---------- analytics ----------
  function hbar(label, value, max, color) {
    var pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
    return '<div class="bar-row"><div class="lbl">' + esc(label) + '</div>' +
      '<div class="track"><div class="bar" style="width:' + pct + '%;background:' + color + '" title="' + esc(label) + ': ' + value + '"></div>' +
      '<span class="val num">' + value + '</span></div></div>';
  }
  function renderAnalyticsTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/analytics').then(function (a) {
      // ordinal blue ramp for the ordered funnel (validated dark-surface steps)
      var ramp = ['#86b6ef', '#5598e7', '#3987e5', '#256abf', '#184f95'];
      var maxF = Math.max.apply(null, a.funnel.map(function (f) { return f.n; }).concat([1]));
      var h = '<div class="charts">';

      h += '<div class="tpl chart"><h4>Pipeline funnel</h4>';
      a.funnel.forEach(function (f, i) { h += hbar(f.status, f.n, maxF, ramp[i] || ramp[4]); });
      var others = a.others || {};
      var otherTotal = Object.keys(others).reduce(function (s, k) { return s + others[k]; }, 0);
      h += '<div class="placeholders" style="margin-top:8px">exited: ' +
        Object.keys(others).map(function (k) { return k + ' ' + others[k]; }).join(' · ') +
        ' (' + otherTotal + ' total)</div></div>';

      var r = a.rates || {};
      h += '<div class="tpl chart"><h4>Outreach performance (all time)</h4>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px">' +
        '<div class="kpi"><div class="v num">' + (r.sent || 0) + '</div><div class="l">emails sent</div></div>' +
        '<div class="kpi"><div class="v num">' + (r.replies || 0) + '</div><div class="l">real replies</div></div>' +
        '<div class="kpi"><div class="v num">' + (r.reply_rate || 0) + '%</div><div class="l"><i class="dot" style="background:var(--good)"></i>reply rate</div></div>' +
        '<div class="kpi"><div class="v num">' + (r.bounce_rate || 0) + '%</div><div class="l"><i class="dot" style="background:' + ((r.bounce_rate || 0) > 3 ? 'var(--critical)' : 'var(--good)') + '"></i>bounce rate</div></div>' +
        '<div class="kpi"><div class="v num">' + (r.interested || 0) + '</div><div class="l"><i class="dot" style="background:var(--good)"></i>interested</div></div>' +
        '</div><div class="placeholders" style="margin-top:8px">Bounce rate above 3% auto-pauses sending.</div></div>';

      h += '<div class="tpl chart"><h4>Last 30 days — sent vs replies</h4>' +
        '<div class="legend"><span><i style="background:var(--blue)"></i>sent</span><span><i style="background:var(--aqua)"></i>replies</span></div>' +
        dailyChart(a.daily || []) + '</div>';

      var maxC = Math.max.apply(null, (a.by_country || []).map(function (x) { return x.total; }).concat([1]));
      h += '<div class="tpl chart"><h4>Leads by country</h4>';
      (a.by_country || []).forEach(function (x) {
        h += hbar(x.country + (x.interested ? ' (★' + x.interested + ')' : ''), x.total, maxC, 'var(--aqua)');
      });
      if (!(a.by_country || []).length) h += '<div class="empty">No leads yet.</div>';
      h += '<div class="placeholders" style="margin-top:6px">★ = interested leads in that country</div></div>';

      h += '</div>';
      $('tabbody').innerHTML = h;
    }).catch(function () {});
  }
  function dailyChart(daily) {
    if (!daily.length) return '<div class="empty">No email activity yet.</div>';
    // fill the last 30 days so gaps render as zero
    var byDay = {};
    daily.forEach(function (d) { byDay[d.d] = d; });
    var days = [];
    for (var i = 29; i >= 0; i--) {
      var dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      var row = byDay[dt] || { sent: 0, replies: 0 };
      days.push({ d: dt, sent: row.sent || 0, replies: row.replies || 0 });
    }
    var W = 640, H = 150, PAD = 6;
    var max = Math.max.apply(null, days.map(function (x) { return Math.max(x.sent, x.replies); }).concat([1]));
    var bw = (W - PAD * 2) / days.length;
    var svg = '<svg viewBox="0 0 ' + W + ' ' + (H + 22) + '" style="width:100%;height:auto" role="img" aria-label="sent vs replies per day, last 30 days">';
    // recessive gridlines at 0%, 50%, 100%
    [0, 0.5, 1].forEach(function (g) {
      var y = H - g * (H - 10);
      svg += '<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke="#2a2927" stroke-width="1"/>';
      svg += '<text x="2" y="' + (y - 3) + '" fill="#8a897d" font-size="9">' + Math.round(g * max) + '</text>';
    });
    days.forEach(function (x, i) {
      var cx = PAD + i * bw;
      var hS = Math.round((x.sent / max) * (H - 10));
      var hR = Math.round((x.replies / max) * (H - 10));
      var w = Math.max(3, bw * 0.36);
      svg += '<rect x="' + cx + '" y="' + (H - hS) + '" width="' + w + '" height="' + hS + '" rx="1.5" fill="#3987e5"><title>' + x.d + ' — sent ' + x.sent + '</title></rect>';
      svg += '<rect x="' + (cx + w + 1.5) + '" y="' + (H - hR) + '" width="' + w + '" height="' + hR + '" rx="1.5" fill="#199e70"><title>' + x.d + ' — replies ' + x.replies + '</title></rect>';
      if (i % 7 === 0) svg += '<text x="' + cx + '" y="' + (H + 14) + '" fill="#8a897d" font-size="9">' + x.d.slice(5) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  // ---------- templates ----------
  function renderTemplatesTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/templates').then(function (data) {
      var h = '<div class="placeholders" style="margin-bottom:12px">Available placeholders: ' +
        '<code>{{company_name}}</code> <code>{{contact_name}}</code> <code>{{city}}</code> <code>{{category}}</code> <code>{{sender_name}}</code>' +
        ' — keep emails plain text, under 130 words, max one link.</div>';
      (data.templates || []).forEach(function (t) {
        h += '<div class="tpl" data-id="' + t.id + '">' +
          '<div class="top"><span class="tag"><i style="background:var(--violet)"></i>step ' + t.sequence_step + '</span>' +
          '<b>' + esc(t.name) + '</b>' +
          '<label style="color:var(--text2);display:flex;gap:5px;align-items:center">' +
            '<input type="checkbox" class="t-active"' + (t.active ? ' checked' : '') + '> active</label></div>' +
          '<input type="text" class="t-subject" value="' + esc(t.subject_template) + '" placeholder="Subject">' +
          '<textarea class="t-body">' + esc(t.body_template) + '</textarea>' +
          '<div class="foot"><button class="primary t-save">Save template</button>' +
          (t.body_template.indexOf('PLACEHOLDER') !== -1 ? '<span class="tag"><i style="background:var(--warn)"></i>placeholder copy — replace before go-live</span>' : '') +
          '</div></div>';
      });
      $('tabbody').innerHTML = h || '<div class="empty">No templates.</div>';
      Array.prototype.forEach.call(document.querySelectorAll('.tpl[data-id]'), function (el) {
        var save = el.querySelector('.t-save');
        if (save) save.onclick = function () {
          req('PUT', '/api/templates/' + el.getAttribute('data-id'), {
            subject_template: el.querySelector('.t-subject').value,
            body_template: el.querySelector('.t-body').value,
            active: el.querySelector('.t-active').checked ? 1 : 0
          }).then(function () { toast('Template saved'); renderTemplatesTab(); });
        };
      });
    });
  }

  // ---------- suppression ----------
  function renderSuppressionTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/suppression').then(function (data) {
      var h = '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">' +
        '<input type="text" id="sup-email" placeholder="email@company.com" style="width:240px">' +
        '<button class="primary" id="sup-add">Suppress email</button>' +
        '<span style="color:var(--muted);align-self:center">Suppressed addresses are never emailed. Opt-outs and bounces are permanent.</span></div>';
      h += '<div class="tablewrap"><table><thead><tr><th>Email</th><th>Domain</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>';
      (data.suppression || []).forEach(function (s) {
        var col = s.reason === 'opt_out' ? 'var(--critical)' : s.reason === 'bounce' ? 'var(--serious)' : s.reason === 'not_interested' ? 'var(--warn)' : 'var(--muted)';
        h += '<tr><td class="pri">' + esc(s.email) + '</td><td>' + esc(s.domain || '—') + '</td>' +
          '<td><span class="tag"><i style="background:' + col + '"></i>' + esc(s.reason) + '</span></td>' +
          '<td class="num">' + esc(s.created_at) + '</td>' +
          '<td>' + (s.reason === 'manual' ? '<button class="danger sup-del" data-email="' + esc(s.email) + '">remove</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (!(data.suppression || []).length) h += '<div class="empty">Suppression list is empty.</div>';
      $('tabbody').innerHTML = h;
      $('sup-add').onclick = function () {
        var email = $('sup-email').value.trim();
        if (!email) return;
        req('POST', '/api/suppression', { email: email }).then(function () { toast('Suppressed ' + email); renderSuppressionTab(); });
      };
      Array.prototype.forEach.call(document.querySelectorAll('.sup-del'), function (b) {
        b.onclick = function () {
          var email = b.getAttribute('data-email');
          if (!window.confirm('Remove ' + email + ' from the suppression list?')) return;
          req('DELETE', '/api/suppression/' + encodeURIComponent(email)).then(function () { toast('Removed ' + email); renderSuppressionTab(); });
        };
      });
    });
  }

  // ---------- runs ----------
  function renderRunsTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/scrape/runs').then(function (data) {
      var h = '<div class="tablewrap"><table><thead><tr><th>ID</th><th>Trigger</th><th>Status</th><th>Queries</th><th>Places</th><th>New leads</th><th>Dupes skipped</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>';
      (data.runs || []).forEach(function (r) {
        var col = r.status === 'done' ? 'var(--good)' : r.status === 'failed' ? 'var(--critical)' : 'var(--warn)';
        h += '<tr><td class="num">' + r.id + '</td><td>' + esc(r.trigger) + '</td>' +
          '<td><span class="tag"><i style="background:' + col + '"></i>' + esc(r.status) + '</span></td>' +
          '<td class="num">' + (r.queries_run == null ? '—' : r.queries_run) + '</td>' +
          '<td class="num">' + (r.places_found == null ? '—' : r.places_found) + '</td>' +
          '<td class="num">' + (r.new_leads == null ? '—' : r.new_leads) + '</td>' +
          '<td class="num">' + (r.skipped_dupes == null ? '—' : r.skipped_dupes) + '</td>' +
          '<td class="num">' + esc(r.started_at) + '</td><td class="num">' + esc(r.finished_at || '—') + '</td>' +
          '<td title="' + esc(r.error) + '">' + esc(r.error || '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (!(data.runs || []).length) h += '<div class="empty">No scrape runs yet — press ▶ Scrape.</div>';
      $('tabbody').innerHTML = h;
    });
  }

  // ---------- activity ----------
  function renderActivityTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/activities').then(function (data) {
      var h = '<div class="tablewrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Lead</th><th>Detail</th></tr></thead><tbody>';
      (data.activities || []).forEach(function (a) {
        var actorCol = a.actor === 'owner' ? 'var(--blue)' : a.actor === 'crm_agent' ? 'var(--violet)' : 'var(--muted)';
        var isErr = a.action === 'error';
        h += '<tr><td class="num">' + esc(a.created_at) + '</td>' +
          '<td><span class="tag"><i style="background:' + actorCol + '"></i>' + esc(a.actor) + '</span></td>' +
          '<td class="pri"' + (isErr ? ' style="color:var(--critical)"' : '') + '>' + esc(a.action) + '</td>' +
          '<td>' + (a.lead_id ? '#' + a.lead_id + ' ' + esc(a.company_name || '') : '—') + '</td>' +
          '<td title="' + esc(a.detail) + '" style="max-width:420px">' + esc(a.detail || '—') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (!(data.activities || []).length) h += '<div class="empty">No activity yet.</div>';
      $('tabbody').innerHTML = h;
    });
  }

  // ---------- settings ----------
  var SETTING_HINTS = {
    GOOGLE_PLACES_API_KEY: 'console.cloud.google.com → enable "Places API (New)" → Credentials → Create API key. Powers lead sourcing.',
    VERIFIER_API_KEY: 'zerobounce.net API key (optional, recommended before real sending — protects bounce rate).',
    RECAP_EMAIL: 'Where daily recaps, interested-reply alerts and failure alerts are sent.',
    SENDER_EMAIL: 'The outreach inbox address (auto-filled by Gmail connect).',
    SENDER_NAME: 'Display name on outgoing email, e.g. "Rami from Maranasi".',
    GMAIL_CLIENT_ID: 'Managed by the Gmail connect flow above — rarely edited by hand.',
    GMAIL_CLIENT_SECRET: 'Managed by the Gmail connect flow above.',
    GMAIL_REFRESH_TOKEN: 'Created automatically when Gmail is connected.',
    OPENROUTER_API_KEY: 'openrouter.ai/settings/keys — one key drives all AI features.',
    OPENROUTER_MODEL_AGENT: 'Override the CRM-agent model slug (default anthropic/claude-sonnet-4.6).',
    OPENROUTER_MODEL_FAST: 'Override the fast-model slug (default anthropic/claude-haiku-4.5).',
    ANTHROPIC_API_KEY: 'Optional fallback provider — OpenRouter wins when both are set.'
  };
  function renderSettingsTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    Promise.all([req('GET', '/api/settings'), req('GET', '/api/config/daily-cap')]).then(function (res) {
      var data = res[0];
      var cap = res[1];
      var h = '';
      h += '<div class="tpl"><div class="top"><b>Integration health</b></div>' +
        '<div class="actions">' +
          ['places', 'gmail', 'llm', 'verifier'].map(function (t) {
            return '<button class="itest" data-t="' + t + '">Test ' + t + '</button>';
          }).join('') +
        '</div><div id="itest-out" style="margin-top:10px;color:var(--text2)"></div></div>';

      h += '<div class="tpl"><div class="top"><b>Daily send cap</b><span class="tag">' + esc(cap.source) + '</span></div>' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<input type="number" id="cap-in" value="' + cap.cap + '" min="0" max="500" style="width:100px">' +
        '<button class="primary" id="cap-save">Save cap</button>' +
        '<button id="cap-reset">Reset to default (' + cap.default + ')</button>' +
        '<span class="placeholders">Go-live ramp: 10/day week 1 → 20 → 35 → 50. Never raise it faster than weekly.</span></div></div>';

      h += '<div class="tpl"><div class="top"><b>Demo data</b><span class="tag"><i style="background:var(--violet)"></i>showcase</span></div>' +
        '<div class="placeholders" style="margin-bottom:10px">Fills every screen with 14 sample leads, mail threads and activity so you can explore the whole CRM. ' +
        'Nothing is ever sent — demo addresses use the reserved .example.com domain and demo mail is marked DRY RUN. Remove it before go-live.</div>' +
        '<div class="foot"><button id="demo-seed">Seed demo data</button><button id="demo-remove" class="danger">Remove demo data</button></div>' +
        '<div id="demo-out" style="margin-top:8px;color:var(--text2)"></div></div>';

      h += '<div class="tpl"><div class="top"><b>Connect Gmail</b><span class="tag"><i style="background:var(--blue)"></i>guided</span></div>' +
        '<div class="placeholders" style="margin-bottom:10px;line-height:1.8">' +
          '1. In <b>console.cloud.google.com</b>: enable the <b>Gmail API</b>, set up the OAuth consent screen, then Credentials → Create OAuth client ID → type <b>Web application</b>.<br>' +
          '2. Add this authorized redirect URI: <code id="gm-redirect"></code> <button id="gm-copy" style="padding:1px 8px">copy</button><br>' +
          '3. Paste the client ID + secret here and press Connect — approve in the browser as the <b>outreach inbox</b>.' +
        '</div>' +
        '<input type="text" id="gm-id" placeholder="OAuth client ID">' +
        '<input type="text" id="gm-secret" placeholder="OAuth client secret" style="margin-top:8px">' +
        '<div class="foot"><button class="primary" id="gm-connect">Connect Gmail</button></div></div>';

      h += '<div class="tablewrap"><table><thead><tr><th>Setting</th><th>Source</th><th>Value</th><th style="width:45%">Update</th></tr></thead><tbody>';
      (data.settings || []).forEach(function (s) {
        var srcCol = s.source === 'env' ? 'var(--good)' : s.source === 'dashboard' ? 'var(--blue)' : 'var(--muted)';
        var srcLabel = s.source === 'env' ? 'secret' : s.source;
        h += '<tr><td class="pri" title="' + esc(SETTING_HINTS[s.key] || '') + '">' + esc(s.key) + '</td>' +
          '<td><span class="tag"><i style="background:' + srcCol + '"></i>' + srcLabel + '</span></td>' +
          '<td>' + esc(s.preview || '—') + '</td>' +
          '<td><div style="display:flex;gap:6px"><input type="text" class="set-in" data-key="' + s.key + '" placeholder="' +
            (s.source === 'unset' ? 'paste value…' : 'paste new value (empty = clear)') + '" style="flex:1;min-width:120px">' +
          '<button class="set-save" data-key="' + s.key + '">Save</button></div>' +
          '<div class="placeholders" style="margin-top:4px">' + esc(SETTING_HINTS[s.key] || '') + '</div></td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="placeholders" style="margin:10px 0">Values saved here are stored in the Worker KV and take effect within ~20 seconds — no redeploy. A value set as an encrypted Worker secret (source: <b>secret</b>) always wins over a dashboard value.</div>';
      $('tabbody').innerHTML = h;

      $('cap-save').onclick = function () {
        req('PUT', '/api/config/daily-cap', { cap: $('cap-in').value }).then(function (r) {
          toast('Daily cap set to ' + r.cap); loadStats(); renderSettingsTab();
        });
      };
      $('cap-reset').onclick = function () {
        req('PUT', '/api/config/daily-cap', { cap: null }).then(function (r) {
          toast('Daily cap reset to ' + r.cap); loadStats(); renderSettingsTab();
        });
      };
      $('gm-redirect').textContent = location.origin + '/auth/gmail/callback';
      $('gm-copy').onclick = function () {
        navigator.clipboard.writeText(location.origin + '/auth/gmail/callback').then(function () { toast('Redirect URI copied'); });
      };
      $('gm-connect').onclick = function () {
        req('POST', '/api/settings/gmail/start', {
          client_id: $('gm-id').value, client_secret: $('gm-secret').value
        }).then(function (r) {
          if (r.url) { toast('Opening Google consent…'); window.open(r.url, '_blank'); }
        });
      };
      Array.prototype.forEach.call(document.querySelectorAll('.set-save'), function (b) {
        b.onclick = function () {
          var key = b.getAttribute('data-key');
          var input = document.querySelector('.set-in[data-key="' + key + '"]');
          req('PUT', '/api/settings/' + key, { value: input.value }).then(function () {
            toast(key + ' saved'); renderSettingsTab();
          });
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll('.itest'), function (b) {
        b.onclick = function () {
          var t = b.getAttribute('data-t');
          $('itest-out').textContent = 'Testing ' + t + '…';
          req('POST', '/api/settings/test/' + t).then(function (r) {
            $('itest-out').innerHTML = (r.ok ? '<span style="color:var(--good)">✓</span> ' : '<span style="color:var(--critical)">✗</span> ') + esc(r.detail || r.error || '');
          }).catch(function () { $('itest-out').textContent = 'Test failed to run.'; });
        };
      });
      $('demo-seed').onclick = function () {
        $('demo-seed').disabled = true;
        $('demo-out').textContent = 'Seeding…';
        req('POST', '/api/demo/seed').then(function (r) {
          $('demo-seed').disabled = false;
          $('demo-out').textContent = 'Seeded ' + r.leads + ' leads, ' + r.emails + ' emails and ' + r.activities + ' activities.';
          loadStats();
        }).catch(function (e) { $('demo-seed').disabled = false; $('demo-out').textContent = (e && e.message) || 'Seed failed.'; });
      };
      $('demo-remove').onclick = function () {
        if (!confirm('Remove all demo rows (leads, mail, activity marked as demo)? Real leads are untouched.')) return;
        $('demo-remove').disabled = true;
        $('demo-out').textContent = 'Removing…';
        req('POST', '/api/demo/remove').then(function (r) {
          $('demo-remove').disabled = false;
          $('demo-out').textContent = 'Removed ' + r.leads + ' leads, ' + r.emails + ' emails, ' + r.activities + ' activities.';
          loadStats();
        }).catch(function (e) { $('demo-remove').disabled = false; $('demo-out').textContent = (e && e.message) || 'Remove failed.'; });
      };
    });
  }

  // ---------- header actions ----------
  $('btn-refresh').addEventListener('click', refreshAll);
  $('btn-scrape').addEventListener('click', function () {
    $('btn-scrape').disabled = true;
    req('POST', '/api/scrape/run', {}).then(function () {
      toast('Scrape started in the background — check the Scrape runs tab in a few minutes.');
      $('btn-scrape').disabled = false;
    }).catch(function () { $('btn-scrape').disabled = false; });
  });
  $('btn-pause').addEventListener('click', function () {
    req('POST', '/api/sending/pause').then(function () { toast('Sending paused'); loadStats(); });
  });
  $('btn-resume').addEventListener('click', function () {
    req('POST', '/api/sending/resume').then(function () { toast('Sending resumed'); loadStats(); });
  });
  function refreshAll() { loadStats(); renderTab(); }

  // ---------- chat ----------
  function addMsg(cls, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    $('chat-log').appendChild(div);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
    return div;
  }
  function sendChat(preset) {
    var ta = $('chat-text');
    var text = (preset || ta.value).trim();
    if (!text) return;
    ta.value = '';
    addMsg('user', text);
    var busy = addMsg('agent busy', 'thinking…');
    $('chat-send').disabled = true;
    req('POST', '/api/agent', { message: text, history: chatHistory }).then(function (r) {
      chatHistory = r.history || chatHistory;
      busy.className = 'msg agent';
      busy.textContent = r.reply || '(no reply)';
      $('chat-send').disabled = false;
      loadStats();
      if (tab === 'leads') loadLeads(false);
    }).catch(function () {
      busy.className = 'msg agent';
      busy.textContent = '(request failed)';
      $('chat-send').disabled = false;
    });
  }
  $('chat-send').addEventListener('click', function () { sendChat(); });
  $('chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('chat-clear').addEventListener('click', function () {
    chatHistory = [];
    $('chat-log').innerHTML = '';
    toast('Conversation cleared');
  });
  Array.prototype.forEach.call(document.querySelectorAll('#chat-chips button'), function (b) {
    b.addEventListener('click', function () { sendChat(b.getAttribute('data-q')); });
  });
  $('chat-fab').addEventListener('click', function () { $('chat').classList.add('open'); });
  $('chat-close').addEventListener('click', function () { $('chat').classList.remove('open'); });

  // boot: reuse an existing session cookie if there is one
  fetch('/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    if (me && me.ok) { CURRENT_USER = me.username; boot(); } else showLogin('');
  }).catch(function () { showLogin(''); });
})();
</script>
</body>
</html>`;
