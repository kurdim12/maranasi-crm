// Single-file dashboard: dark, dense, vanilla JS. Prompts once for the admin
// key, keeps it in memory only, and sends it as X-API-Key on every request.
// NOTE: the embedded <script> deliberately avoids backticks and ${} so this
// whole file can live inside one TypeScript template literal.
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Maranasi Outreach Engine</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --fg:#c9d1d9; --dim:#8b949e; --acc:#58a6ff; --ok:#3fb950; --warn:#d29922; --bad:#f85149; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  header { display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid var(--line); background:var(--panel); position:sticky; top:0; z-index:5; flex-wrap:wrap; }
  header h1 { font-size:14px; margin:0 12px 0 0; color:var(--acc); }
  button { background:#21262d; color:var(--fg); border:1px solid var(--line); border-radius:5px; padding:4px 10px; cursor:pointer; font:inherit; }
  button:hover { border-color:var(--acc); }
  button.warn { color:var(--warn); } button.ok { color:var(--ok); }
  #stats { display:flex; gap:14px; padding:8px 14px; border-bottom:1px solid var(--line); color:var(--dim); flex-wrap:wrap; }
  #stats b { color:var(--fg); }
  #main { display:flex; min-height:calc(100vh - 90px); }
  #left { flex:1 1 60%; padding:10px 14px; overflow:auto; }
  #chat { flex:0 0 380px; border-left:1px solid var(--line); display:flex; flex-direction:column; background:var(--panel); }
  #filters { display:flex; gap:8px; margin-bottom:10px; flex-wrap:wrap; }
  select,input[type=text] { background:#0d1117; color:var(--fg); border:1px solid var(--line); border-radius:5px; padding:4px 8px; font:inherit; }
  table { width:100%; border-collapse:collapse; }
  th,td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px; }
  th { color:var(--dim); font-weight:normal; position:sticky; top:0; background:var(--bg); }
  tr:hover td { background:#161b22; cursor:pointer; }
  .tag { padding:1px 6px; border-radius:8px; border:1px solid var(--line); font-size:11px; }
  .s-new{color:var(--dim)} .s-enriched{color:#a5d6ff} .s-verified{color:var(--acc)} .s-contacted{color:#d2a8ff}
  .s-interested{color:var(--ok)} .s-not_interested{color:var(--warn)} .s-opted_out{color:var(--bad)}
  .s-invalid_email{color:var(--bad)} .s-unresponsive_email{color:var(--warn)} .s-dropped{color:var(--dim);text-decoration:line-through}
  #drawer { position:fixed; right:0; top:0; height:100%; width:520px; max-width:95vw; background:var(--panel); border-left:1px solid var(--line); transform:translateX(100%); transition:transform .15s; overflow:auto; z-index:10; padding:14px; }
  #drawer.open { transform:none; }
  #drawer h2 { margin:0 0 4px; font-size:15px; }
  #drawer .row { display:flex; gap:8px; margin:6px 0; align-items:center; }
  #drawer label { width:100px; color:var(--dim); }
  #drawer input, #drawer textarea { flex:1; background:#0d1117; color:var(--fg); border:1px solid var(--line); border-radius:5px; padding:4px 8px; font:inherit; }
  #timeline { margin-top:12px; border-top:1px solid var(--line); padding-top:8px; }
  .tl { padding:6px 8px; margin:6px 0; border:1px solid var(--line); border-radius:6px; background:#0d1117; }
  .tl .meta { color:var(--dim); font-size:11px; }
  .tl pre { white-space:pre-wrap; margin:6px 0 0; color:var(--fg); font:inherit; }
  #chat-log { flex:1; overflow:auto; padding:10px; }
  .msg { margin:8px 0; padding:8px 10px; border-radius:8px; white-space:pre-wrap; }
  .msg.user { background:#1f2937; }
  .msg.agent { background:#0d1117; border:1px solid var(--line); }
  #chat-input { display:flex; gap:8px; padding:10px; border-top:1px solid var(--line); }
  #chat-input textarea { flex:1; height:60px; resize:vertical; background:#0d1117; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:6px; font:inherit; }
  .pill { font-size:11px; border:1px solid var(--line); border-radius:10px; padding:1px 8px; color:var(--dim); }
  #toast { position:fixed; bottom:14px; left:14px; background:#21262d; border:1px solid var(--line); border-radius:6px; padding:8px 12px; display:none; z-index:20; }
</style>
</head>
<body>
<header>
  <h1>MARANASI OUTREACH</h1>
  <button id="btn-scrape">Run scrape</button>
  <button id="btn-pause" class="warn">Pause sending</button>
  <button id="btn-resume" class="ok" style="display:none">Resume sending</button>
  <button id="btn-refresh">Refresh</button>
  <span id="mode" class="pill"></span>
</header>
<div id="stats"></div>
<div id="main">
  <div id="left">
    <div id="filters">
      <select id="f-status">
        <option value="">status: all</option>
        <option>new</option><option>enriched</option><option>verified</option><option>invalid_email</option>
        <option>contacted</option><option>interested</option><option>not_interested</option>
        <option>opted_out</option><option>unresponsive_email</option><option>dropped</option>
      </select>
      <select id="f-country">
        <option value="">country: all</option><option>VN</option><option>TH</option>
      </select>
      <input type="text" id="f-city" placeholder="city">
      <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" id="f-needs-call"> needs call</label>
      <input type="text" id="f-q" placeholder="search company / notes / email">
      <button id="btn-filter">Apply</button>
    </div>
    <table>
      <thead><tr>
        <th>id</th><th>company</th><th>city</th><th>cc</th><th>status</th><th>step</th><th>email</th><th>call</th><th>next action</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <div id="chat">
    <div style="padding:8px 10px;border-bottom:1px solid var(--line);color:var(--dim)">CRM agent</div>
    <div id="chat-log"></div>
    <div id="chat-input">
      <textarea id="chat-text" placeholder="Ask about leads, log notes, drop leads..."></textarea>
      <button id="chat-send">Send</button>
    </div>
  </div>
</div>
<div id="drawer"></div>
<div id="toast"></div>
<script>
(function () {
  var API_KEY = null;
  var chatHistory = [];

  function key() {
    if (!API_KEY) API_KEY = window.prompt('Admin API key');
    return API_KEY || '';
  }
  function req(method, path, body) {
    return fetch(path, {
      method: method,
      headers: { 'X-API-Key': key(), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { API_KEY = null; toast('Bad API key'); throw new Error('unauthorized'); }
      return r.json();
    });
  }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.style.display = 'block';
    setTimeout(function () { t.style.display = 'none'; }, 3500);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }

  // ---- stats + header ----
  function loadStats() {
    req('GET', '/api/stats').then(function (s) {
      var parts = [];
      parts.push('<span>total <b>' + s.total + '</b></span>');
      Object.keys(s.by_status || {}).forEach(function (k) {
        parts.push('<span class="s-' + k + '">' + k + ' <b>' + s.by_status[k] + '</b></span>');
      });
      parts.push('<span>needs_call <b>' + s.needs_call + '</b></span>');
      parts.push('<span>sent 7d <b>' + s.sent_7d + '</b></span>');
      parts.push('<span>replies 7d <b>' + s.replies_7d + '</b></span>');
      parts.push('<span>today <b>' + s.sent_today + '/' + s.daily_cap + '</b></span>');
      document.getElementById('stats').innerHTML = parts.join('');
      document.getElementById('mode').textContent = (s.dry_run ? 'DRY RUN' : 'LIVE') + (s.sending_paused ? ' · PAUSED' : '');
      document.getElementById('btn-pause').style.display = s.sending_paused ? 'none' : '';
      document.getElementById('btn-resume').style.display = s.sending_paused ? '' : 'none';
    }).catch(function () {});
  }

  // ---- leads table ----
  function loadLeads() {
    var p = [];
    var st = document.getElementById('f-status').value; if (st) p.push('status=' + encodeURIComponent(st));
    var cc = document.getElementById('f-country').value; if (cc) p.push('country=' + encodeURIComponent(cc));
    var ci = document.getElementById('f-city').value; if (ci) p.push('city=' + encodeURIComponent(ci));
    if (document.getElementById('f-needs-call').checked) p.push('needs_call=1');
    var q = document.getElementById('f-q').value; if (q) p.push('q=' + encodeURIComponent(q));
    req('GET', '/api/leads' + (p.length ? '?' + p.join('&') : '')).then(function (data) {
      var html = (data.leads || []).map(function (l) {
        return '<tr data-id="' + l.id + '">' +
          '<td>' + l.id + '</td>' +
          '<td title="' + esc(l.company_name) + '">' + esc(l.company_name) + '</td>' +
          '<td>' + esc(l.city) + '</td>' +
          '<td>' + esc(l.country) + '</td>' +
          '<td class="s-' + l.status + '">' + l.status + '</td>' +
          '<td>' + l.sequence_step + '/3</td>' +
          '<td title="' + esc(l.email) + '">' + esc(l.email || '-') + ' <span class="pill">' + l.email_status + '</span></td>' +
          '<td>' + (l.needs_call ? '<span class="tag" style="color:var(--warn)">CALL</span>' : esc(l.phone_status)) + '</td>' +
          '<td>' + esc(l.next_action_at || '-') + '</td>' +
        '</tr>';
      }).join('');
      document.getElementById('rows').innerHTML = html || '<tr><td colspan="9" style="color:var(--dim)">no leads</td></tr>';
      Array.prototype.forEach.call(document.querySelectorAll('#rows tr[data-id]'), function (tr) {
        tr.addEventListener('click', function () { openDrawer(tr.getAttribute('data-id')); });
      });
    }).catch(function () {});
  }

  // ---- drawer ----
  function openDrawer(id) {
    req('GET', '/api/leads/' + id).then(function (data) {
      var l = data.lead;
      var fields = ['contact_name', 'phone', 'city', 'category'];
      var h = '<button style="float:right" onclick="document.getElementById(\\'drawer\\').classList.remove(\\'open\\')">close</button>';
      h += '<h2>#' + l.id + ' ' + esc(l.company_name) + '</h2>';
      h += '<div class="meta" style="color:var(--dim)">' + esc(l.website || '') + ' · ' + esc(l.category || '') + ' · ' + esc(l.country || '') + '</div>';
      h += '<div class="row"><label>status</label><span class="s-' + l.status + '">' + l.status + '</span>' +
           '<span class="pill">step ' + l.sequence_step + '/3</span>' +
           '<span class="pill">email: ' + l.email_status + '</span>' +
           '<span class="pill">phone: ' + l.phone_status + '</span>' +
           (l.needs_call ? '<span class="tag" style="color:var(--warn)">NEEDS CALL</span>' : '') + '</div>';
      h += '<div class="row"><label>email</label><span>' + esc(l.email || '-') + '</span></div>';
      if (l.drop_reason) h += '<div class="row"><label>drop reason</label><span>' + esc(l.drop_reason) + '</span></div>';
      fields.forEach(function (f) {
        h += '<div class="row"><label>' + f + '</label><input id="ed-' + f + '" value="' + esc(l[f]) + '"></div>';
      });
      h += '<div class="row"><label>notes</label><textarea id="ed-notes" rows="4">' + esc(l.notes) + '</textarea></div>';
      h += '<div class="row"><button id="d-save">Save</button>' +
           '<button id="d-reached" class="ok">Call: reached</button>' +
           '<button id="d-noanswer" class="warn">Call: no answer</button>' +
           '<button id="d-verify">Re-verify email</button></div>';
      h += '<div id="timeline"><div style="color:var(--dim)">timeline</div>';
      var items = [];
      (data.emails || []).forEach(function (e) {
        items.push({ at: e.created_at, html: '<div class="tl"><div class="meta">' + e.created_at + ' · email ' + e.direction +
          (e.sequence_step ? ' · step ' + e.sequence_step : '') + (e.classification ? ' · ' + e.classification : '') +
          (e.dry_run ? ' · DRY RUN' : '') + '</div><b>' + esc(e.subject) + '</b><pre>' + esc((e.body || '').slice(0, 1200)) + '</pre></div>' });
      });
      (data.activities || []).forEach(function (a) {
        items.push({ at: a.created_at, html: '<div class="tl"><div class="meta">' + a.created_at + ' · ' + a.actor + ' · ' + a.action +
          '</div><pre>' + esc(a.detail || '') + '</pre></div>' });
      });
      items.sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      h += items.map(function (i) { return i.html; }).join('') + '</div>';

      var drawer = document.getElementById('drawer');
      drawer.innerHTML = h;
      drawer.classList.add('open');

      document.getElementById('d-save').addEventListener('click', function () {
        var body = {};
        fields.forEach(function (f) { body[f] = document.getElementById('ed-' + f).value; });
        body.notes = document.getElementById('ed-notes').value;
        req('PATCH', '/api/leads/' + id, body).then(function () { toast('saved'); loadLeads(); openDrawer(id); });
      });
      document.getElementById('d-reached').addEventListener('click', function () {
        req('POST', '/api/leads/' + id + '/call-outcome', { outcome: 'reached' }).then(function () { toast('call: reached logged'); loadLeads(); openDrawer(id); });
      });
      document.getElementById('d-noanswer').addEventListener('click', function () {
        req('POST', '/api/leads/' + id + '/call-outcome', { outcome: 'unresponsive' }).then(function () { toast('call: unresponsive logged'); loadLeads(); openDrawer(id); });
      });
      document.getElementById('d-verify').addEventListener('click', function () {
        req('POST', '/api/leads/' + id + '/verify').then(function (r) { toast('verify: ' + r.reason); loadLeads(); openDrawer(id); });
      });
    }).catch(function () {});
  }

  // ---- header buttons ----
  document.getElementById('btn-refresh').addEventListener('click', function () { loadStats(); loadLeads(); });
  document.getElementById('btn-filter').addEventListener('click', loadLeads);
  document.getElementById('f-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadLeads(); });
  document.getElementById('btn-scrape').addEventListener('click', function () {
    toast('scrape started...');
    req('POST', '/api/scrape/run', {}).then(function (r) {
      toast('scrape done: ' + r.newLeads + ' new, ' + r.skippedDupes + ' dupes'); loadStats(); loadLeads();
    }).catch(function () { toast('scrape failed'); });
  });
  document.getElementById('btn-pause').addEventListener('click', function () {
    req('POST', '/api/sending/pause').then(loadStats);
  });
  document.getElementById('btn-resume').addEventListener('click', function () {
    req('POST', '/api/sending/resume').then(loadStats);
  });

  // ---- chat ----
  function addMsg(cls, text) {
    var log = document.getElementById('chat-log');
    var div = document.createElement('div');
    div.className = 'msg ' + cls;
    div.textContent = text;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  document.getElementById('chat-send').addEventListener('click', sendChat);
  document.getElementById('chat-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  function sendChat() {
    var ta = document.getElementById('chat-text');
    var text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    addMsg('user', text);
    addMsg('agent', '...');
    req('POST', '/api/agent', { message: text, history: chatHistory }).then(function (r) {
      chatHistory = r.history || chatHistory;
      var log = document.getElementById('chat-log');
      log.lastChild.textContent = r.reply || '(no reply)';
      loadStats(); loadLeads();
    }).catch(function () {
      document.getElementById('chat-log').lastChild.textContent = '(request failed)';
    });
  }

  key();
  loadStats();
  loadLeads();
})();
</script>
</body>
</html>`;
