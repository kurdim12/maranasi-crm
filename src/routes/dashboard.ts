// Single-file dashboard: dark, dense, vanilla JS. Prompts once for the admin
// key (kept in memory only), sends it as X-API-Key on every request.
// Palette: validated dark-surface tokens; status colors never carry meaning
// alone — the status text label is always rendered next to them.
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
  #login { position:fixed; inset:0; background:var(--bg); display:flex; align-items:center; justify-content:center; z-index:100; }
  #login .card { background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:32px; width:340px; }
  #login h1 { margin:0 0 4px; font-size:16px; letter-spacing:.08em; }
  #login p { margin:0 0 18px; color:var(--muted); }
  #login input { width:100%; padding:9px 12px; margin-bottom:10px; }
  #login button { width:100%; padding:9px; }
  #login .err { color:var(--critical); margin:8px 0 0; min-height:18px; }

  /* ---- shell ---- */
  #app { display:none; height:100%; flex-direction:column; }
  header { display:flex; align-items:center; gap:10px; padding:10px 16px; border-bottom:1px solid var(--line); background:var(--surface); flex-wrap:wrap; }
  header .brand { font-weight:700; letter-spacing:.1em; font-size:13px; margin-right:6px; }
  header .brand span { color:var(--blue); }
  .badge { font-size:11px; font-weight:600; letter-spacing:.05em; border-radius:20px; padding:2px 10px; border:1px solid var(--line); color:var(--text2); }
  .badge.dry { color:var(--warn); border-color:var(--warn); }
  .badge.live { color:var(--good); border-color:var(--good); }
  .badge.paused { color:var(--critical); border-color:var(--critical); }
  header .spacer { flex:1; }

  /* ---- KPI row ---- */
  #kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(110px,1fr)); gap:8px; padding:12px 16px; }
  .kpi { background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--radius); padding:10px 12px; }
  .kpi .v { font-size:20px; font-weight:700; font-variant-numeric:tabular-nums; }
  .kpi .l { color:var(--muted); font-size:11px; letter-spacing:.04em; text-transform:uppercase; margin-top:2px; display:flex; align-items:center; gap:5px; }
  .kpi .dot { width:7px; height:7px; border-radius:50%; display:inline-block; }

  /* ---- layout ---- */
  #main { display:flex; flex:1; min-height:0; }
  #content { flex:1; min-width:0; display:flex; flex-direction:column; padding:0 16px 16px; }
  nav.tabs { display:flex; gap:2px; border-bottom:1px solid var(--line); margin-bottom:12px; }
  nav.tabs button { background:none; border:none; border-bottom:2px solid transparent; border-radius:0; color:var(--muted); padding:8px 14px; font-weight:600; }
  nav.tabs button.active { color:var(--text); border-bottom-color:var(--blue); }
  #tabbody { flex:1; overflow:auto; min-height:0; }

  /* ---- tables ---- */
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; color:var(--muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.05em; padding:6px 10px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:1; }
  td { padding:7px 10px; border-bottom:1px solid var(--line-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px; color:var(--text2); }
  td.pri { color:var(--text); font-weight:500; }
  tbody tr.click:hover td { background:var(--surface); cursor:pointer; }
  .empty { color:var(--muted); padding:40px; text-align:center; }

  .tag { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:600; border-radius:20px; padding:1px 9px 1px 6px; border:1px solid var(--line); }
  .tag i { width:7px; height:7px; border-radius:50%; display:inline-block; flex:none; }
  .num { font-variant-numeric:tabular-nums; }

  /* ---- filter bar ---- */
  #filters { display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; align-items:center; }
  #filters input[type=text] { width:200px; }

  /* ---- chat ---- */
  #chat { width:360px; flex:none; border-left:1px solid var(--line); background:var(--surface); display:flex; flex-direction:column; min-height:0; }
  #chat .head { padding:10px 14px; border-bottom:1px solid var(--line); display:flex; align-items:center; }
  #chat .head b { flex:1; }
  #chat-log { flex:1; overflow:auto; padding:12px; }
  .msg { margin:0 0 10px; padding:8px 11px; border-radius:10px; white-space:pre-wrap; max-width:92%; }
  .msg.user { background:var(--blue); color:#fff; margin-left:auto; border-bottom-right-radius:3px; }
  .msg.agent { background:var(--raised); border:1px solid var(--line-soft); border-bottom-left-radius:3px; }
  .msg.agent.busy { color:var(--muted); font-style:italic; }
  #chat-input { display:flex; gap:8px; padding:10px; border-top:1px solid var(--line); }
  #chat-input textarea { flex:1; height:58px; resize:none; }
  #chat .hint { padding:0 14px 8px; color:var(--muted); font-size:11px; }

  /* ---- drawer ---- */
  #scrim { position:fixed; inset:0; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .15s; z-index:20; }
  #scrim.open { opacity:1; pointer-events:auto; }
  #drawer { position:fixed; right:0; top:0; height:100%; width:560px; max-width:96vw; background:var(--surface); border-left:1px solid var(--line); transform:translateX(102%); transition:transform .18s ease-out; z-index:21; display:flex; flex-direction:column; }
  #drawer.open { transform:none; }
  #drawer .head { padding:14px 18px; border-bottom:1px solid var(--line); }
  #drawer .head h2 { margin:0 0 6px; font-size:16px; }
  #drawer .sub { color:var(--muted); }
  #drawer .body { flex:1; overflow:auto; padding:14px 18px; }
  .sect { margin-bottom:18px; }
  .sect h3 { margin:0 0 8px; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
  .frow { display:flex; gap:8px; margin-bottom:7px; align-items:center; }
  .frow label { width:96px; color:var(--muted); flex:none; }
  .frow input, .frow textarea { flex:1; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; }
  .tl-item { border:1px solid var(--line-soft); border-radius:var(--radius); background:var(--bg); padding:8px 11px; margin-bottom:8px; }
  .tl-item .meta { color:var(--muted); font-size:11px; margin-bottom:3px; }
  .tl-item pre { white-space:pre-wrap; margin:4px 0 0; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; color:var(--text2); max-height:220px; overflow:auto; }

  /* ---- templates tab ---- */
  .tpl { background:var(--surface); border:1px solid var(--line-soft); border-radius:var(--radius); padding:14px; margin-bottom:14px; }
  .tpl .top { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
  .tpl .top b { flex:1; }
  .tpl input[type=text] { width:100%; margin-bottom:8px; }
  .tpl textarea { width:100%; height:170px; font:12px/1.5 ui-monospace,Menlo,Consolas,monospace; }
  .tpl .foot { display:flex; align-items:center; gap:10px; margin-top:8px; }
  .placeholders { color:var(--muted); font-size:11px; }
  .placeholders code { background:var(--raised); border-radius:4px; padding:1px 5px; }

  #toast-wrap { position:fixed; bottom:16px; left:16px; z-index:50; display:flex; flex-direction:column; gap:8px; }
  .toast { background:var(--raised); border:1px solid var(--line); border-left:3px solid var(--blue); border-radius:6px; padding:9px 14px; max-width:420px; animation:tin .15s ease-out; }
  .toast.err { border-left-color:var(--critical); }
  @keyframes tin { from { transform:translateY(8px); opacity:0; } }

  @media (max-width: 1100px) { #chat { display:none; } }
</style>
</head>
<body>

<div id="login">
  <div class="card">
    <h1>MARANASI <span style="color:var(--blue)">OUTREACH</span></h1>
    <p>Enter the admin API key to continue.</p>
    <input type="password" id="login-key" placeholder="Admin API key" autofocus>
    <button class="primary" id="login-btn">Unlock</button>
    <div class="err" id="login-err"></div>
  </div>
</div>

<div id="app">
  <header>
    <div class="brand">MARANASI <span>OUTREACH</span></div>
    <span class="badge" id="b-mode">…</span>
    <span class="badge paused" id="b-paused" style="display:none">PAUSED</span>
    <div class="spacer"></div>
    <button id="btn-scrape">▶ Run scrape</button>
    <button id="btn-pause" class="danger">⏸ Pause sending</button>
    <button id="btn-resume" class="good" style="display:none">▶ Resume sending</button>
    <button id="btn-refresh">↻ Refresh</button>
  </header>

  <div id="kpis"></div>

  <div id="main">
    <div id="content">
      <nav class="tabs">
        <button data-tab="leads" class="active">Leads</button>
        <button data-tab="templates">Templates</button>
        <button data-tab="suppression">Suppression</button>
        <button data-tab="runs">Scrape runs</button>
        <button data-tab="activity">Activity</button>
      </nav>
      <div id="tabbody"></div>
    </div>

    <aside id="chat">
      <div class="head"><b>CRM agent</b><button id="chat-clear" title="Clear conversation">Clear</button></div>
      <div id="chat-log"></div>
      <div class="hint">Try: "recap the new contacts this week" · "add a note to lead 3" · "who needs a call?"</div>
      <div id="chat-input">
        <textarea id="chat-text" placeholder="Ask the CRM agent… (Enter to send)"></textarea>
        <button class="primary" id="chat-send">Send</button>
      </div>
    </aside>
  </div>
</div>

<div id="scrim"></div>
<div id="drawer"></div>
<div id="toast-wrap"></div>

<script>
(function () {
  'use strict';
  var API_KEY = null;
  var chatHistory = [];
  var tab = 'leads';
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
    setTimeout(function () { t.remove(); }, 4200);
  }
  function statusTag(status) {
    var c = STATUS_COLORS[status] || 'var(--muted)';
    var style = status === 'dropped' ? 'text-decoration:line-through;' : '';
    return '<span class="tag" style="' + style + '"><i style="background:' + c + '"></i>' + esc(status) + '</span>';
  }
  function req(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'X-API-Key': API_KEY || '', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401) { showLogin('Session key rejected — enter it again.'); throw new Error('unauthorized'); }
      return r.json().then(function (data) {
        if (!r.ok && data && data.error) { toast(data.error, true); throw new Error(data.error); }
        return data;
      });
    });
  }

  // ---------- login ----------
  function showLogin(msg) {
    API_KEY = null;
    $('login').style.display = 'flex';
    $('app').style.display = 'none';
    $('login-err').textContent = msg || '';
    $('login-key').value = '';
    $('login-key').focus();
  }
  function tryLogin() {
    var key = $('login-key').value.trim();
    if (!key) return;
    $('login-btn').disabled = true;
    fetch('/api/stats', { headers: { 'X-API-Key': key } }).then(function (r) {
      $('login-btn').disabled = false;
      if (!r.ok) { $('login-err').textContent = 'Invalid key.'; return; }
      API_KEY = key;
      $('login').style.display = 'none';
      $('app').style.display = 'flex';
      refreshAll();
    }).catch(function () {
      $('login-btn').disabled = false;
      $('login-err').textContent = 'Network error.';
    });
  }
  $('login-btn').addEventListener('click', tryLogin);
  $('login-key').addEventListener('keydown', function (e) { if (e.key === 'Enter') tryLogin(); });

  // ---------- KPIs / header ----------
  function kpi(value, label, color) {
    return '<div class="kpi"><div class="v num">' + value + '</div><div class="l">' +
      (color ? '<i class="dot" style="background:' + color + '"></i>' : '') + label + '</div></div>';
  }
  function loadStats() {
    return req('GET', '/api/stats').then(function (s) {
      var b = s.by_status || {};
      $('kpis').innerHTML =
        kpi(s.total, 'total leads') +
        kpi(b.verified || 0, 'verified', 'var(--blue)') +
        kpi(b.contacted || 0, 'contacted', 'var(--violet)') +
        kpi(b.interested || 0, 'interested', 'var(--good)') +
        kpi(s.needs_call, 'needs call', 'var(--warn)') +
        kpi(s.sent_7d, 'sent · 7d') +
        kpi(s.replies_7d, 'replies · 7d') +
        kpi(s.sent_today + '<span style="color:var(--muted);font-size:13px">/' + s.daily_cap + '</span>', 'sent today');
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
    else if (tab === 'templates') renderTemplatesTab();
    else if (tab === 'suppression') renderSuppressionTab();
    else if (tab === 'runs') renderRunsTab();
    else if (tab === 'activity') renderActivityTab();
  }

  // ---------- leads ----------
  function renderLeadsTab() {
    $('tabbody').innerHTML =
      '<div id="filters">' +
        '<select id="f-status"><option value="">status: all</option>' +
          ['new','enriched','verified','contacted','interested','not_interested','unresponsive_email','opted_out','invalid_email','dropped']
            .map(function (s) { return '<option>' + s + '</option>'; }).join('') +
        '</select>' +
        '<select id="f-country"><option value="">country: all</option><option>VN</option><option>TH</option></select>' +
        '<input type="text" id="f-city" placeholder="city">' +
        '<label style="display:flex;align-items:center;gap:5px;color:var(--text2)"><input type="checkbox" id="f-needs-call"> needs call</label>' +
        '<input type="text" id="f-q" placeholder="Search company, email, notes…">' +
      '</div>' +
      '<table><thead><tr><th>ID</th><th>Company</th><th>Contact</th><th>Location</th><th>Status</th><th>Step</th><th>Email</th><th>Phone</th><th>Next due</th></tr></thead>' +
      '<tbody id="rows"></tbody></table>' +
      '<div style="margin-top:10px;text-align:center"><button id="btn-more" style="display:none">Load more</button></div>';
    ['f-status', 'f-country', 'f-needs-call'].forEach(function (id) {
      $(id).addEventListener('change', function () { leadsOffset = 0; loadLeads(false); });
    });
    ['f-city', 'f-q'].forEach(function (id) {
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { leadsOffset = 0; loadLeads(false); } });
    });
    $('btn-more').addEventListener('click', function () { leadsOffset += LIMIT; loadLeads(true); });
    loadLeads(false);
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
    var p = ['limit=' + LIMIT, 'offset=' + leadsOffset];
    if ($('f-status') && $('f-status').value) p.push('status=' + encodeURIComponent($('f-status').value));
    if ($('f-country') && $('f-country').value) p.push('country=' + encodeURIComponent($('f-country').value));
    if ($('f-city') && $('f-city').value) p.push('city=' + encodeURIComponent($('f-city').value));
    if ($('f-needs-call') && $('f-needs-call').checked) p.push('needs_call=1');
    if ($('f-q') && $('f-q').value) p.push('q=' + encodeURIComponent($('f-q').value));
    req('GET', '/api/leads?' + p.join('&')).then(function (data) {
      var rows = (data.leads || []).map(leadRow).join('');
      if (!append) $('rows').innerHTML = rows ||
        '<tr><td colspan="9" class="empty">No leads yet — press ▶ Run scrape, or adjust the filters.</td></tr>';
      else $('rows').insertAdjacentHTML('beforeend', rows);
      $('btn-more').style.display = (data.leads || []).length === LIMIT ? '' : 'none';
      Array.prototype.forEach.call(document.querySelectorAll('#rows tr[data-id]'), function (tr) {
        tr.onclick = function () { openDrawer(tr.getAttribute('data-id')); };
      });
    }).catch(function () {});
  }

  // ---------- drawer ----------
  function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('open'); }
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  function openDrawer(id) {
    req('GET', '/api/leads/' + id).then(function (data) {
      var l = data.lead;
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
        '</div>' +
        (l.drop_reason ? '<div class="sub" style="margin-top:6px">drop reason: ' + esc(l.drop_reason) + '</div>' : '') +
      '</div>';

      h += '<div class="body">';
      h += '<div class="sect"><h3>Contact</h3>' +
        '<div class="frow"><label>email</label><span style="color:var(--text2)">' + esc(l.email || '—') + '</span></div>' +
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
      '</div><div class="sub" style="margin-top:6px;color:var(--muted)">Logging "no answer" is the human gate that later allows the agent to drop this lead.</div></div>';

      var items = [];
      (data.emails || []).forEach(function (e) {
        items.push({ at: e.created_at, html:
          '<div class="tl-item"><div class="meta">' + esc(e.created_at) + ' · ' +
          (e.direction === 'out' ? '↑ sent' : '↓ received') +
          (e.sequence_step ? ' · step ' + e.sequence_step : '') +
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
    }).catch(function () {});
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
      Array.prototype.forEach.call(document.querySelectorAll('.tpl'), function (el) {
        el.querySelector('.t-save').onclick = function () {
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
      var h = '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<input type="text" id="sup-email" placeholder="email@company.com" style="width:260px">' +
        '<button class="primary" id="sup-add">Suppress email</button>' +
        '<span style="color:var(--muted);align-self:center">Suppressed addresses are never emailed. Opt-outs and bounces are permanent.</span></div>';
      h += '<table><thead><tr><th>Email</th><th>Domain</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>';
      (data.suppression || []).forEach(function (s) {
        var col = s.reason === 'opt_out' ? 'var(--critical)' : s.reason === 'bounce' ? 'var(--serious)' : s.reason === 'not_interested' ? 'var(--warn)' : 'var(--muted)';
        h += '<tr><td class="pri">' + esc(s.email) + '</td><td>' + esc(s.domain || '—') + '</td>' +
          '<td><span class="tag"><i style="background:' + col + '"></i>' + esc(s.reason) + '</span></td>' +
          '<td class="num">' + esc(s.created_at) + '</td>' +
          '<td>' + (s.reason === 'manual' ? '<button class="danger sup-del" data-email="' + esc(s.email) + '">remove</button>' : '') + '</td></tr>';
      });
      h += '</tbody></table>';
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
      var h = '<table><thead><tr><th>ID</th><th>Trigger</th><th>Status</th><th>Queries</th><th>Places</th><th>New leads</th><th>Dupes skipped</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>';
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
      h += '</tbody></table>';
      if (!(data.runs || []).length) h += '<div class="empty">No scrape runs yet — press ▶ Run scrape.</div>';
      $('tabbody').innerHTML = h;
    });
  }

  // ---------- activity ----------
  function renderActivityTab() {
    $('tabbody').innerHTML = '<div class="empty">Loading…</div>';
    req('GET', '/api/activities').then(function (data) {
      var h = '<table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Lead</th><th>Detail</th></tr></thead><tbody>';
      (data.activities || []).forEach(function (a) {
        var actorCol = a.actor === 'owner' ? 'var(--blue)' : a.actor === 'crm_agent' ? 'var(--violet)' : 'var(--muted)';
        var isErr = a.action === 'error';
        h += '<tr><td class="num">' + esc(a.created_at) + '</td>' +
          '<td><span class="tag"><i style="background:' + actorCol + '"></i>' + esc(a.actor) + '</span></td>' +
          '<td class="pri"' + (isErr ? ' style="color:var(--critical)"' : '') + '>' + esc(a.action) + '</td>' +
          '<td>' + (a.lead_id ? '#' + a.lead_id + ' ' + esc(a.company_name || '') : '—') + '</td>' +
          '<td title="' + esc(a.detail) + '" style="max-width:420px">' + esc(a.detail || '—') + '</td></tr>';
      });
      h += '</tbody></table>';
      if (!(data.activities || []).length) h += '<div class="empty">No activity yet.</div>';
      $('tabbody').innerHTML = h;
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
  function sendChat() {
    var ta = $('chat-text');
    var text = ta.value.trim();
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
  $('chat-send').addEventListener('click', sendChat);
  $('chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $('chat-clear').addEventListener('click', function () {
    chatHistory = [];
    $('chat-log').innerHTML = '';
    toast('Conversation cleared');
  });

  // boot
  showLogin('');
})();
</script>
</body>
</html>`;
