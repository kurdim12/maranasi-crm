// System — merges five v1 tabs (Templates / Suppression / Scrape runs /
// Activity / Settings) behind a sub-nav. Ported 1:1 from dashboard.ts's
// renderTemplatesTab / renderSuppressionTab / renderRunsTab /
// renderActivityTab / renderSettingsTab + SETTING_HINTS. Zero behavior
// change: same endpoints, same payload shapes. The last-viewed section is
// remembered in localStorage under 'mo.system'.
import {
  $, esc, req, toast, chip, classChip, empty, emptyHtml, skeletons, confirmModal,
} from './core.js';
import { openLead, onLeadChange } from './drawer.js';
import { loadStats } from './app.js';

export const id = 'system';
export const title = 'System';
export const icon = '⚙';
export const hotkey = 's';

const SECTIONS = [
  { id: 'templates', label: 'Templates' },
  { id: 'suppression', label: 'Suppression' },
  { id: 'runs', label: 'Scrape runs' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

// verbatim from v1 dashboard.ts
const SETTING_HINTS = {
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
  ANTHROPIC_API_KEY: 'Optional fallback provider — OpenRouter wins when both are set.',
};

let section = 'templates';

// ---------- activity list state (for j/k/enter row nav) ----------
const ACT_LIMIT_START = 100;
const ACT_STEP = 100;
let activityLimit = ACT_LIMIT_START;
let activityRows = [];
let activitySel = -1;

export function render(root) {
  const saved = localStorage.getItem('mo.system');
  section = SECTIONS.some((s) => s.id === saved) ? saved : 'templates';
  root.innerHTML = '<div class="subnav" id="sys-nav"></div><div id="sys-body"></div>';
  wireNav();
  loadSection();
}

function wireNav() {
  const nav = $('sys-nav');
  nav.innerHTML = SECTIONS.map((s) =>
    `<button data-s="${s.id}" class="${s.id === section ? 'on' : ''}">${esc(s.label)}</button>`).join('');
  nav.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.s === section) return;
      section = b.dataset.s;
      localStorage.setItem('mo.system', section);
      nav.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.s === section));
      loadSection();
    };
  });
}

function loadSection() {
  if (!$('sys-body')) return;
  if (section === 'templates') renderTemplates();
  else if (section === 'suppression') renderSuppression();
  else if (section === 'runs') renderRuns();
  else if (section === 'activity') renderActivity();
  else if (section === 'settings') renderSettings();
}

// Drawer edits (e.g. status changes via lead actions) can affect activity /
// settings rows — refresh whichever section is currently mounted.
onLeadChange(() => { loadSection(); });

export function keys(k, e) {
  if (section !== 'activity') return false;
  if (!activityRows.length) return false;
  if (k === 'j') { activitySel = Math.min(activityRows.length - 1, activitySel + 1); applyActivitySel(); return true; }
  if (k === 'k') { activitySel = Math.max(0, activitySel - 1); applyActivitySel(); return true; }
  if (k === 'enter') {
    const row = activityRows[activitySel];
    if (row && row.lead_id) openLead(row.lead_id);
    return true;
  }
  return false;
}

// ================= Templates =================
function renderTemplates() {
  const body = $('sys-body');
  body.innerHTML = skeletons(4);
  Promise.all([req('GET', '/api/templates'), req('GET', '/api/config/channel-templates')]).then(([data, ch]) => {
    if (!$('sys-body')) return;
    let h = '<div class="placeholders" style="margin-bottom:12px">Available placeholders: ' +
      '<code>{{company_name}}</code> <code>{{contact_name}}</code> <code>{{city}}</code> <code>{{category}}</code> <code>{{sender_name}}</code>' +
      ' — keep emails plain text, under 130 words, max one link.</div>';
    (data.templates || []).forEach((t) => {
      h += `<div class="tpl" data-id="${esc(t.id)}">
        <div class="top">${chip(`step ${t.sequence_step}`, 'var(--violet)')}<b>${esc(t.name)}</b>
        <label style="color:var(--t2);display:flex;gap:5px;align-items:center">
          <input type="checkbox" class="t-active"${t.active ? ' checked' : ''}> active</label></div>
        <input type="text" class="t-subject" value="${esc(t.subject_template)}" placeholder="Subject">
        <textarea class="t-body">${esc(t.body_template)}</textarea>
        <div class="foot"><button class="primary t-save">Save template</button>
        ${(t.body_template || '').indexOf('PLACEHOLDER') !== -1 ? chip('placeholder copy — replace before go-live', 'var(--warn)') : ''}
        </div></div>`;
    });
    h += `<div class="tpl"><div class="top">${chip('channels', 'var(--info)')}<b>Chat intro messages (WhatsApp · Zalo · Line)</b></div>
      <div class="placeholders" style="margin-bottom:8px">Prefilled when you open a channel from a lead — manual send only, same {{placeholders}}.</div>
      ${['whatsapp', 'zalo', 'line'].map((c) => `
        <div style="margin-bottom:8px"><label style="color:var(--t3);font-size:12px">${c}</label>
        <textarea class="ch-tpl" data-ch="${c}" rows="2" aria-label="${c} intro template">${esc(ch.templates[c] || '')}</textarea></div>`).join('')}
      <div class="foot"><button class="primary" id="ch-save">Save chat intros</button></div></div>`;
    $('sys-body').innerHTML = h || emptyHtml('No templates.');
    $('sys-body').querySelectorAll('.tpl[data-id]').forEach((el) => {
      const save = el.querySelector('.t-save');
      if (save) save.onclick = () => {
        req('PUT', `/api/templates/${el.getAttribute('data-id')}`, {
          subject_template: el.querySelector('.t-subject').value,
          body_template: el.querySelector('.t-body').value,
          active: el.querySelector('.t-active').checked ? 1 : 0,
        }).then(() => { toast('Template saved', 'ok'); renderTemplates(); });
      };
    });
    $('ch-save').onclick = () => {
      const templates = {};
      $('sys-body').querySelectorAll('.ch-tpl').forEach((t) => { templates[t.dataset.ch] = t.value; });
      req('PUT', '/api/config/channel-templates', { templates }).then(() => toast('Chat intros saved', 'ok'));
    };
  }).catch(() => {});
}

// ================= Suppression =================
function renderSuppression() {
  const body = $('sys-body');
  body.innerHTML = skeletons(5);
  req('GET', '/api/suppression').then((data) => {
    if (!$('sys-body')) return;
    const rows = data.suppression || [];
    let h = `<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <input type="text" id="sup-email" class="mono" placeholder="email@company.com" style="width:240px">
      <select id="sup-reason" aria-label="Suppression reason">
        <option value="manual">manual</option>
        <option value="not_interested">not_interested</option>
        <option value="opt_out">opt_out</option>
        <option value="bounce">bounce</option>
      </select>
      <button class="primary" id="sup-add">Suppress email</button>
      <span style="color:var(--t3);align-self:center">Suppressed addresses are never emailed. Opt-outs and bounces are permanent.</span></div>`;
    h += '<div class="tablewrap"><table class="data"><thead><tr><th>Email</th><th>Domain</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>';
    rows.forEach((s) => {
      h += `<tr><td class="pri mono">${esc(s.email)}</td><td class="mono">${esc(s.domain || '—')}</td>` +
        `<td>${classChip(s.reason)}</td>` +
        `<td class="num">${esc(s.created_at)}</td>` +
        `<td>${s.reason === 'manual' ? `<button class="danger sup-del" data-email="${esc(s.email)}">remove</button>` : ''}</td></tr>`;
    });
    h += '</tbody></table></div>';
    if (!rows.length) h += emptyHtml('Suppression list is empty.');
    $('sys-body').innerHTML = h;
    $('sup-add').onclick = () => {
      const email = $('sup-email').value.trim();
      if (!email) return;
      const reason = $('sup-reason').value;
      req('POST', '/api/suppression', { email, reason }).then(() => {
        toast(`Suppressed ${email}`, 'ok');
        renderSuppression();
      }).catch(() => {});
    };
    $('sys-body').querySelectorAll('.sup-del').forEach((b) => {
      b.onclick = async () => {
        const email = b.getAttribute('data-email');
        const go = await confirmModal({
          title: 'Remove from suppression?',
          message: `${email} could be emailed again by future sends. Only remove addresses suppressed by mistake.`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!go) return;
        req('DELETE', `/api/suppression/${encodeURIComponent(email)}`).then(() => {
          toast(`Removed ${email}`, 'ok');
          renderSuppression();
        }).catch(() => {});
      };
    });
  }).catch(() => {});
}

// ================= Scrape runs =================
function runScrapeNow() {
  req('POST', '/api/scrape/run', {}).then(() => {
    toast('Scrape started in the background — check back in a few minutes.', 'ok');
  }).catch(() => {});
}

function renderRuns() {
  const body = $('sys-body');
  body.innerHTML = skeletons(6);
  req('GET', '/api/scrape/runs').then((data) => {
    if (!$('sys-body')) return;
    const runs = data.runs || [];
    let h = '<div class="tablewrap"><table class="data"><thead><tr><th>ID</th><th>Trigger</th><th>Status</th>' +
      '<th>Queries</th><th>Places</th><th>New leads</th><th>Dupes skipped</th><th>Started</th><th>Finished</th><th>Error</th></tr></thead><tbody>';
    runs.forEach((r) => {
      const col = r.status === 'done' ? 'var(--ok)' : r.status === 'failed' ? 'var(--warn)' : 'var(--info)';
      h += `<tr><td class="num">${esc(r.id)}</td><td>${esc(r.trigger)}</td>` +
        `<td>${chip(r.status, col)}</td>` +
        `<td class="num">${r.queries_run == null ? '—' : esc(r.queries_run)}</td>` +
        `<td class="num">${r.places_found == null ? '—' : esc(r.places_found)}</td>` +
        `<td class="num">${r.new_leads == null ? '—' : esc(r.new_leads)}</td>` +
        `<td class="num">${r.skipped_dupes == null ? '—' : esc(r.skipped_dupes)}</td>` +
        `<td class="num">${esc(r.started_at)}</td><td class="num">${esc(r.finished_at || '—')}</td>` +
        `<td title="${esc(r.error)}">${esc(r.error || '—')}</td></tr>`;
    });
    h += '</tbody></table></div>';
    $('sys-body').innerHTML = h;
    if (!runs.length) {
      $('sys-body').appendChild(empty('No scrape runs yet — press ▶ Scrape.', '▶ Run scrape', runScrapeNow));
    }
  }).catch(() => {});
}

// ================= Activity =================
function renderActivity() {
  activityLimit = ACT_LIMIT_START;
  activityRows = [];
  activitySel = -1;
  const body = $('sys-body');
  body.innerHTML = skeletons(8);
  loadActivity();
}

function loadActivity() {
  req('GET', `/api/activities?limit=${activityLimit}`).then((data) => {
    const body = $('sys-body');
    if (!body) return;
    const rows = data.activities || [];
    activityRows = rows;
    if (activitySel >= rows.length) activitySel = rows.length - 1;
    let h = '<div class="tablewrap"><table class="data"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Lead</th><th>Detail</th></tr></thead><tbody>';
    rows.forEach((a, i) => {
      const actorColor = a.actor === 'owner' ? 'var(--info)' : a.actor === 'crm_agent' ? 'var(--violet)' : 'var(--t3)';
      const isErr = a.action === 'error';
      h += `<tr class="${a.lead_id ? 'click' : ''}${i === activitySel ? ' sel' : ''}" data-i="${i}">` +
        `<td class="num">${esc(a.created_at)}</td>` +
        `<td>${chip(a.actor, actorColor)}</td>` +
        `<td class="pri"${isErr ? ' style="color:var(--warn)"' : ''}>${esc(a.action)}</td>` +
        `<td>${a.lead_id ? `<span class="mono">#${esc(a.lead_id)}</span> ${esc(a.company_name || '')}` : '—'}</td>` +
        `<td title="${esc(a.detail)}" style="max-width:420px">${esc(a.detail || '—')}</td></tr>`;
    });
    h += '</tbody></table></div>';
    if (!rows.length) h += emptyHtml('No activity yet.');
    h += '<div style="margin-top:10px;text-align:center"><button id="act-more" style="display:none">Load more</button></div>';
    body.innerHTML = h;
    $('act-more').style.display = rows.length === activityLimit ? '' : 'none';
    $('act-more').onclick = () => { activityLimit += ACT_STEP; loadActivity(); };
    wireActivityRows();
    applyActivitySel();
  }).catch(() => {});
}

function wireActivityRows() {
  const body = $('sys-body');
  if (!body) return;
  body.querySelectorAll('tr[data-i]').forEach((tr) => {
    tr.onclick = () => {
      const i = +tr.dataset.i;
      const row = activityRows[i];
      if (row && row.lead_id) { activitySel = i; openLead(row.lead_id); }
    };
  });
}

function applyActivitySel() {
  const body = $('sys-body');
  if (!body) return;
  body.querySelectorAll('tr[data-i]').forEach((tr) => {
    tr.classList.toggle('sel', +tr.dataset.i === activitySel);
  });
  const sel = body.querySelector('tr.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

// ================= Settings =================
function renderSettings() {
  const body = $('sys-body');
  body.innerHTML = skeletons(8);
  Promise.all([
    req('GET', '/api/settings'),
    req('GET', '/api/config/daily-cap'),
    req('GET', '/api/config/icp'),
  ]).then(([data, cap, icp]) => {
    if (!$('sys-body')) return;
    let h = '';

    h += `<div class="tpl"><div class="top"><b>Integration health</b></div>
      <div class="actions">${
        ['places', 'gmail', 'llm', 'verifier'].map((t) => `<button class="itest" data-t="${t}">Test ${t}</button>`).join('')
      }</div><div id="itest-out" style="margin-top:10px;color:var(--t2)"></div></div>`;

    h += `<div class="tpl"><div class="top"><b>Daily send cap</b>${chip(cap.source)}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="number" id="cap-in" value="${esc(cap.cap)}" min="0" max="500" style="width:100px">
      <button class="primary" id="cap-save">Save cap</button>
      <button id="cap-reset">Reset to default (${esc(cap.default)})</button>
      <span class="placeholders">Go-live ramp: 10/day week 1 → 20 → 35 → 50. Never raise it faster than weekly.</span></div></div>`;

    h += `<div class="tpl"><div class="top"><b>Ideal customer profile</b>${chip(icp.source)}</div>
      <div class="placeholders" style="margin-bottom:8px">The AI scores every lead 1–5 against this paragraph (fit score). Sharpen it after your first scored batch.</div>
      <textarea id="icp-in" rows="3">${esc(icp.icp)}</textarea>
      <div class="foot"><button class="primary" id="icp-save">Save ICP</button><button id="icp-reset">Reset to default</button></div></div>`;

    h += `<div class="tpl"><div class="top"><b>Demo data</b>${chip('showcase', 'var(--violet)')}</div>
      <div class="placeholders" style="margin-bottom:10px">Fills every screen with 14 sample leads, mail threads and activity so you can explore the whole CRM. ` +
      `Nothing is ever sent — demo addresses use the reserved .example.com domain and demo mail is marked DRY RUN. Remove it before go-live.</div>
      <div class="foot"><button id="demo-seed">Seed demo data</button><button id="demo-remove" class="danger">Remove demo data</button></div>
      <div id="demo-out" style="margin-top:8px;color:var(--t2)"></div></div>`;

    h += `<div class="tpl"><div class="top"><b>Connect Gmail</b>${chip('guided', 'var(--info)')}</div>
      <div class="placeholders" style="margin-bottom:10px;line-height:1.8">
        1. In <b>console.cloud.google.com</b>: enable the <b>Gmail API</b>, set up the OAuth consent screen, then Credentials → Create OAuth client ID → type <b>Web application</b>.<br>
        2. Add this authorized redirect URI: <code id="gm-redirect"></code> <button id="gm-copy" style="padding:1px 8px">copy</button><br>
        3. Paste the client ID + secret here and press Connect — approve in the browser as the <b>outreach inbox</b>.
      </div>
      <input type="text" id="gm-id" placeholder="OAuth client ID">
      <input type="text" id="gm-secret" placeholder="OAuth client secret" style="margin-top:8px">
      <div class="foot"><button class="primary" id="gm-connect">Connect Gmail</button></div></div>`;

    h += '<div class="tablewrap"><table class="data"><thead><tr><th>Setting</th><th>Source</th><th>Value</th><th style="width:45%">Update</th></tr></thead><tbody>';
    (data.settings || []).forEach((s) => {
      const srcColor = s.source === 'env' ? 'var(--ok)' : s.source === 'dashboard' ? 'var(--info)' : 'var(--t3)';
      const srcLabel = s.source === 'env' ? 'secret' : s.source;
      h += `<tr><td class="pri" title="${esc(SETTING_HINTS[s.key] || '')}">${esc(s.key)}</td>` +
        `<td>${chip(srcLabel, srcColor)}</td>` +
        `<td class="mono">${esc(s.preview || '—')}</td>` +
        `<td><div style="display:flex;gap:6px"><input type="text" class="set-in mono" data-key="${esc(s.key)}" placeholder="${
          s.source === 'unset' ? 'paste value…' : 'paste new value (empty = clear)'
        }" style="flex:1;min-width:120px">` +
        `<button class="set-save" data-key="${esc(s.key)}">Save</button></div>` +
        `<div class="placeholders" style="margin-top:4px">${esc(SETTING_HINTS[s.key] || '')}</div></td></tr>`;
    });
    h += '</tbody></table></div>';
    h += '<div class="placeholders" style="margin:10px 0">Values saved here are stored in the Worker KV and take effect within ~20 seconds — no redeploy. A value set as an encrypted Worker secret (source: <b>secret</b>) always wins over a dashboard value.</div>';
    $('sys-body').innerHTML = h;

    $('cap-save').onclick = () => {
      req('PUT', '/api/config/daily-cap', { cap: $('cap-in').value }).then((r) => {
        toast(`Daily cap set to ${r.cap}`, 'ok');
        loadStats();
        renderSettings();
      }).catch(() => {});
    };
    $('cap-reset').onclick = () => {
      req('PUT', '/api/config/daily-cap', { cap: null }).then((r) => {
        toast(`Daily cap reset to ${r.cap}`, 'ok');
        loadStats();
        renderSettings();
      }).catch(() => {});
    };
    $('icp-save').onclick = () => {
      req('PUT', '/api/config/icp', { icp: $('icp-in').value }).then(() => {
        toast('ICP saved — new briefs score against it', 'ok');
        renderSettings();
      }).catch(() => {});
    };
    $('icp-reset').onclick = () => {
      req('PUT', '/api/config/icp', { icp: '' }).then(() => {
        toast('ICP reset to default', 'ok');
        renderSettings();
      }).catch(() => {});
    };
    $('gm-redirect').textContent = `${location.origin}/auth/gmail/callback`;
    $('gm-copy').onclick = () => {
      navigator.clipboard.writeText(`${location.origin}/auth/gmail/callback`).then(() => toast('Redirect URI copied', 'ok'));
    };
    $('gm-connect').onclick = () => {
      req('POST', '/api/settings/gmail/start', {
        client_id: $('gm-id').value, client_secret: $('gm-secret').value,
      }).then((r) => {
        if (r.url) { toast('Opening Google consent…', 'ok'); window.open(r.url, '_blank'); }
      }).catch(() => {});
    };
    $('sys-body').querySelectorAll('.set-save').forEach((b) => {
      b.onclick = () => {
        const key = b.getAttribute('data-key');
        const input = $('sys-body').querySelector(`.set-in[data-key="${key}"]`);
        req('PUT', `/api/settings/${key}`, { value: input.value }).then(() => {
          toast(`${key} saved`, 'ok');
          renderSettings();
        }).catch(() => {});
      };
    });
    $('sys-body').querySelectorAll('.itest').forEach((b) => {
      b.onclick = () => {
        const t = b.getAttribute('data-t');
        $('itest-out').textContent = `Testing ${t}…`;
        req('POST', `/api/settings/test/${t}`).then((r) => {
          $('itest-out').innerHTML = (r.ok ? '<span style="color:var(--ok)">✓</span> ' : '<span style="color:var(--warn)">✗</span> ') +
            esc(r.detail || r.error || '');
        }).catch(() => { $('itest-out').textContent = 'Test failed to run.'; });
      };
    });
    $('demo-seed').onclick = () => {
      $('demo-seed').disabled = true;
      $('demo-out').textContent = 'Seeding…';
      req('POST', '/api/demo/seed').then((r) => {
        $('demo-seed').disabled = false;
        $('demo-out').textContent = `Seeded ${r.leads} leads, ${r.emails} emails and ${r.activities} activities.`;
        loadStats();
      }).catch((e) => {
        $('demo-seed').disabled = false;
        $('demo-out').textContent = (e && e.message) || 'Seed failed.';
      });
    };
    $('demo-remove').onclick = async () => {
      const go = await confirmModal({
        title: 'Remove demo data?',
        message: 'Deletes every row marked as demo — leads, mail, activity. Real leads are untouched.',
        confirmLabel: 'Remove demo data',
        danger: true,
      });
      if (!go) return;
      $('demo-remove').disabled = true;
      $('demo-out').textContent = 'Removing…';
      req('POST', '/api/demo/remove').then((r) => {
        $('demo-remove').disabled = false;
        $('demo-out').textContent = `Removed ${r.leads} leads, ${r.emails} emails, ${r.activities} activities.`;
        loadStats();
      }).catch((e) => {
        $('demo-remove').disabled = false;
        $('demo-out').textContent = (e && e.message) || 'Remove failed.';
      });
    };
  }).catch(() => {});
}
