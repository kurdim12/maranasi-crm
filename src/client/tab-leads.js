// Leads — table/board views, filters, add/import/export. Ported 1:1 from the
// v1 renderLeadsTab/loadLeads/loadBoard/openAddLead/openImport/exportCsv.
import {
  $, esc, req, toast, state, chip, statusChip, STATUS_COLORS,
  empty, skeletons, segmented, dataTable, openModal, closeModal, debounce, inputModal, confirmModal,
} from './core.js';
import { openLead, onLeadChange } from './drawer.js';
import { loadStats } from './app.js';

export const id = 'leads';
export const title = 'Leads';
export const icon = '◇';
export const hotkey = 'l';

const LIMIT = 100;
const STATUS_OPTIONS = [
  'new', 'enriched', 'verified', 'contacted', 'interested', 'not_interested',
  'unresponsive_email', 'opted_out', 'invalid_email', 'dropped',
];
const BOARD_COLS = [
  { title: 'New', statuses: ['new', 'enriched'], color: STATUS_COLORS.new },
  { title: 'Verified', statuses: ['verified'], color: STATUS_COLORS.verified },
  { title: 'Contacted', statuses: ['contacted'], color: STATUS_COLORS.contacted },
  { title: 'Interested', statuses: ['interested'], color: STATUS_COLORS.interested },
  { title: 'Needs call', statuses: ['unresponsive_email'], color: STATUS_COLORS.unresponsive_email },
  { title: 'Closed', statuses: ['not_interested', 'opted_out', 'invalid_email', 'dropped'], color: STATUS_COLORS.not_interested },
];

const EMPTY_MSG = 'No leads yet — press ▶ Scrape, add one, or import a CSV.';

// module-level state persists across tab switches, mirroring v1's IIFE vars
let view = 'table';   // 'table' | 'board'
let offset = 0;
let leadsCache = [];
let tableCtl = null;
const selected = new Set(); // bulk-selected lead ids

const cols = [
  {
    key: '_sel', label: '', cls: '',
    render: (r) => `<input type="checkbox" class="blk" data-id="${r.id}"${selected.has(r.id) ? ' checked' : ''} aria-label="Select ${esc(r.company_name)}">`,
  },
  { key: 'id', label: 'ID', cls: 'num' },
  { key: 'company_name', label: 'Company', cls: 'pri', render: (r) => `<span title="${esc(r.company_name)}">${esc(r.company_name)}</span>` },
  { key: 'contact_name', label: 'Contact', render: (r) => esc(r.contact_name || '—') },
  { key: 'city', label: 'Location', render: (r) => `${esc(r.city || '—')}${r.country ? ' · ' + esc(r.country) : ''}` },
  { key: 'status', label: 'Status', render: (r) => statusChip(r.status) },
  {
    key: 'fit_score', label: 'Fit', cls: 'num', sortable: true,
    render: (r) => (r.fit_score
      ? `<span style="${r.fit_score >= 4 ? 'color:var(--hot);font-weight:600' : ''}">${r.fit_score}/5</span>`
      : '—'),
  },
  { key: 'sequence_step', label: 'Step', cls: 'num', render: (r) => `${r.sequence_step}/3` },
  { key: 'email', label: 'Email', cls: 'mono', render: (r) => `<span title="${esc(r.email || '')}">${esc(r.email || '—')}</span>` },
  { key: 'phone_status', label: 'Phone', render: (r) => (r.needs_call ? chip('CALL', 'var(--hot)', 'hot') : esc(r.phone_status || '—')) },
  { key: 'next_action_at', label: 'Next due', cls: 'num', render: (r) => esc(r.next_action_at || '—') },
];

export function render(root) {
  tableCtl = null;

  const filters = document.createElement('div');
  filters.className = 'filters';
  filters.appendChild(segmented(
    [{ label: 'Table', value: 'table' }, { label: 'Board', value: 'board' }],
    view,
    (v) => { view = v; loadLeads(false); },
  ));
  filters.insertAdjacentHTML('beforeend', `
    <select id="f-status" aria-label="Filter by status"><option value="">status: all</option>${
      STATUS_OPTIONS.map((s) => `<option>${s}</option>`).join('')
    }</select>
    <select id="f-country" aria-label="Filter by country"><option value="">country: all</option><option>VN</option><option>TH</option></select>
    <label style="display:flex;align-items:center;gap:5px;color:var(--t2)"><input type="checkbox" id="f-needs-call"> needs call</label>
    <label style="display:flex;align-items:center;gap:5px;color:var(--t2)"><input type="checkbox" id="f-mine"> mine</label>
    <input type="text" id="f-q" placeholder="Search…">
    <span class="grow"></span>
    <button id="btn-add">+ Add lead</button>
    <button id="btn-import">Import CSV</button>
    <button id="btn-export">Export</button>
    <button id="btn-saveview" class="ghost" title="Save the current filters as a view">☆ Save view</button>
    <button id="btn-dupes" class="ghost" title="Find and merge duplicate leads">⧉ Dupes</button>
  `);
  root.appendChild(filters);
  const viewsBar = document.createElement('div');
  viewsBar.id = 'views-bar';
  viewsBar.className = 'filters';
  viewsBar.style.marginTop = '-6px';
  root.appendChild(viewsBar);
  const bulkBar = document.createElement('div');
  bulkBar.id = 'bulk-bar';
  bulkBar.className = 'filters';
  bulkBar.style.display = 'none';
  root.appendChild(bulkBar);

  const body = document.createElement('div');
  body.id = 'leads-body';
  body.innerHTML = skeletons(6);
  root.appendChild(body);

  ['f-status', 'f-country', 'f-needs-call', 'f-mine'].forEach((fid) => {
    $(fid).addEventListener('change', () => { offset = 0; loadLeads(false); });
  });
  // Live search: filters as you type, like every other filter — no Enter needed.
  const liveSearch = debounce(() => { offset = 0; loadLeads(false); }, 200);
  $('f-q').addEventListener('input', liveSearch);
  $('f-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; loadLeads(false); } });
  $('btn-add').addEventListener('click', openAddLead);
  $('btn-import').addEventListener('click', openImport);
  $('btn-export').addEventListener('click', exportCsv);
  $('btn-saveview').addEventListener('click', saveCurrentView);
  $('btn-dupes').addEventListener('click', openDupes);

  selected.clear();
  loadViews();
  loadLeads(false);
}

// Quick entry ('c' anywhere): company, contact, email, country — nothing else.
document.addEventListener('mo:quick-lead', async () => {
  const ans = await inputModal({
    title: 'New lead — quick entry',
    fields: [
      { key: 'company_name', label: 'company', required: true },
      { key: 'contact_name', label: 'contact name' },
      { key: 'email', label: 'email', placeholder: 'optional — verified inline' },
      { key: 'country', label: 'country', value: 'VN', placeholder: 'VN or TH', required: true },
    ],
    confirmLabel: 'Create lead',
    hint: 'Everything else can wait — fill details later in the drawer.',
  });
  if (!ans) return;
  req('POST', '/api/leads', ans).then((r) => {
    toast(`Lead #${r.lead.id} created`, 'ok');
    if ($('leads-body')) loadLeads(false);
    openLead(r.lead.id);
  });
});

// ---------- saved views ----------
async function loadViews() {
  const bar = $('views-bar');
  if (!bar) return;
  const data = await req('GET', '/api/config/views').catch(() => ({ views: [] }));
  const views = data.views || [];
  bar.style.display = views.length ? '' : 'none';
  bar.innerHTML = views.map((v, i) =>
    `<span class="chip" style="cursor:pointer" data-i="${i}">${esc(v.name)}
     <button class="ghost view-del" data-i="${i}" aria-label="Delete view ${esc(v.name)}" style="padding:0 2px;border:none">×</button></span>`).join('');
  bar.querySelectorAll('.chip').forEach((chipEl) => {
    chipEl.onclick = (e) => {
      if (e.target.classList.contains('view-del')) return;
      const v = views[+chipEl.dataset.i];
      const f = v.filters || {};
      if ($('f-status')) $('f-status').value = f.status || '';
      if ($('f-country')) $('f-country').value = f.country || '';
      if ($('f-needs-call')) $('f-needs-call').checked = !!f.needs_call;
      if ($('f-q')) $('f-q').value = f.q || '';
      offset = 0;
      loadLeads(false);
    };
  });
  bar.querySelectorAll('.view-del').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      views.splice(+b.dataset.i, 1);
      await req('PUT', '/api/config/views', { views });
      loadViews();
    };
  });
}

async function saveCurrentView() {
  const ans = await inputModal({
    title: 'Save current filters as a view',
    fields: [{ key: 'name', label: 'name', placeholder: 'e.g. TH hot leads', required: true }],
    confirmLabel: 'Save view',
  });
  if (!ans) return;
  const data = await req('GET', '/api/config/views').catch(() => ({ views: [] }));
  const views = data.views || [];
  views.push({
    name: ans.name,
    filters: {
      status: $('f-status') ? $('f-status').value : '',
      country: $('f-country') ? $('f-country').value : '',
      needs_call: $('f-needs-call') ? $('f-needs-call').checked : false,
      q: $('f-q') ? $('f-q').value : '',
    },
  });
  await req('PUT', '/api/config/views', { views });
  toast('View saved', 'ok');
  loadViews();
}

// ---------- bulk actions ----------
function refreshBulkBar() {
  const bar = $('bulk-bar');
  if (!bar) return;
  if (!selected.size) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  bar.innerHTML = `<span class="mono" style="color:var(--t1)">${selected.size} selected</span>
    <button id="bulk-tag">Tag</button>
    <button id="bulk-pause">Pause</button>
    <button id="bulk-resume" class="good">Resume</button>
    <button id="bulk-verify">Verify</button>
    <span class="grow"></span>
    <button id="bulk-clear" class="ghost">Clear</button>`;
  const run = (action, extra) =>
    req('POST', '/api/leads/bulk', { ids: [...selected], action, ...extra }).then((r) => {
      toast(`${r.done}/${r.of} ${action}${action === 'tag' ? 'ged' : 'd'}`, 'ok');
      selected.clear();
      loadLeads(false);
      refreshBulkBar();
    });
  $('bulk-tag').onclick = async () => {
    const ans = await inputModal({
      title: `Tag ${selected.size} leads`,
      fields: [{ key: 'name', label: 'tag', required: true }],
      confirmLabel: 'Tag all',
    });
    if (!ans) return;
    const made = await req('POST', '/api/tags', { name: ans.name });
    run('tag', { tag_id: made.id });
  };
  $('bulk-pause').onclick = () => run('pause');
  $('bulk-resume').onclick = () => run('resume');
  $('bulk-verify').onclick = () => run('verify');
  $('bulk-clear').onclick = () => { selected.clear(); loadLeads(false); refreshBulkBar(); };
}

// ---------- duplicate merge wizard ----------
async function openDupes() {
  const data = await req('GET', '/api/duplicates').catch(() => null);
  const rows = (data && data.duplicates) || [];
  if (!rows.length) { toast('No duplicate candidates found', 'ok'); return; }
  const groups = new Map();
  rows.forEach((r) => {
    const list = groups.get(r.dupe_key) || [];
    list.push(r);
    groups.set(r.dupe_key, list);
  });
  let h = '<h3>Merge duplicates</h3><div class="hint-bar" style="margin-bottom:10px">Pick the keeper in each group — all mail, activity, deals and tasks move to it; gaps fill from the duplicates.</div>';
  let gi = 0;
  for (const [key, list] of groups) {
    h += `<div class="card" data-group="${gi}"><div class="cardtop"><b class="mono">${esc(key)}</b></div>${
      list.map((l, i) => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0">
        <input type="radio" name="keep-${gi}" value="${l.id}"${i === 0 ? ' checked' : ''}>
        <span class="pri">#${l.id} ${esc(l.company_name)}</span>
        <span class="mono" style="color:var(--t3)">${esc(l.email || '—')} · ${esc(l.status)} · step ${l.sequence_step}</span>
      </label>`).join('')
    }<div class="actions"><button class="danger merge-go" data-group="${gi}">Merge into keeper</button></div></div>`;
    gi++;
  }
  h += '<div class="actions" style="justify-content:flex-end"><button id="dupes-close">Close</button></div>';
  openModal(h);
  $('dupes-close').onclick = closeModal;
  const groupArr = [...groups.values()];
  document.querySelectorAll('.merge-go').forEach((b) => {
    b.onclick = async () => {
      const g = +b.dataset.group;
      const keepId = +document.querySelector(`input[name="keep-${g}"]:checked`).value;
      const losers = groupArr[g].map((l) => l.id).filter((x) => x !== keepId);
      const go = await confirmModal({
        title: `Merge ${losers.length} duplicate${losers.length === 1 ? '' : 's'}?`,
        message: `Everything moves to #${keepId}; the duplicate row${losers.length === 1 ? '' : 's'} are removed after their history transfers.`,
        confirmLabel: 'Merge',
        danger: true,
      });
      if (!go) return;
      for (const mergeId of losers) {
        await req('POST', '/api/leads/merge', { keep_id: keepId, merge_id: mergeId }).catch(() => {});
      }
      toast(`Merged into #${keepId}`, 'ok');
      closeModal();
      loadLeads(false);
    };
  });
}

export function keys(k, e) {
  if (view !== 'table' || !tableCtl) return false;
  if (k === 'j') { tableCtl.moveSel(1); return true; }
  if (k === 'k') { tableCtl.moveSel(-1); return true; }
  if (k === 'enter') { tableCtl.openSel(); return true; }
  return false;
}

function leadQuery() {
  const p = [];
  if ($('f-status') && $('f-status').value) p.push('status=' + encodeURIComponent($('f-status').value));
  if ($('f-country') && $('f-country').value) p.push('country=' + encodeURIComponent($('f-country').value));
  if ($('f-needs-call') && $('f-needs-call').checked) p.push('needs_call=1');
  if ($('f-q') && $('f-q').value) p.push('q=' + encodeURIComponent($('f-q').value));
  if ($('f-mine') && $('f-mine').checked && state.userId) p.push('assigned_to=' + state.userId);
  return p;
}

function loadLeads(append) {
  if (view === 'board') return loadBoard();
  const p = leadQuery().concat([`limit=${LIMIT}`, `offset=${offset}`]);
  req('GET', `/api/leads?${p.join('&')}`).then((data) => {
    const body = $('leads-body');
    if (!body) return;
    const fetched = data.leads || [];
    if (!append) {
      leadsCache = fetched;
      body.innerHTML = '';
      if (!leadsCache.length) {
        tableCtl = null;
        body.appendChild(empty(EMPTY_MSG, '+ Add lead', openAddLead));
        return;
      }
      tableCtl = dataTable(cols, { onOpen: (r) => openLead(r.id) });
      body.appendChild(tableCtl.el);
      // Checkbox clicks select without opening the drawer (capture beats row onclick).
      tableCtl.el.addEventListener('click', (e) => {
        if (e.target.classList && e.target.classList.contains('blk')) e.stopPropagation();
      }, true);
      tableCtl.el.addEventListener('change', (e) => {
        if (!e.target.classList || !e.target.classList.contains('blk')) return;
        const lid = +e.target.dataset.id;
        if (e.target.checked) selected.add(lid); else selected.delete(lid);
        refreshBulkBar();
      });
      const moreWrap = document.createElement('div');
      moreWrap.style.cssText = 'margin-top:10px;text-align:center';
      const moreBtn = document.createElement('button');
      moreBtn.id = 'leads-more';
      moreBtn.textContent = 'Load more';
      moreBtn.style.display = fetched.length === LIMIT ? '' : 'none';
      moreBtn.onclick = () => { offset += LIMIT; loadLeads(true); };
      moreWrap.appendChild(moreBtn);
      body.appendChild(moreWrap);
      tableCtl.setRows(leadsCache, false);
    } else {
      leadsCache = leadsCache.concat(fetched);
      if (tableCtl) tableCtl.setRows(leadsCache, true);
      const moreBtn = $('leads-more');
      if (moreBtn) moreBtn.style.display = fetched.length === LIMIT ? '' : 'none';
    }
  }).catch(() => {});
}

function loadBoard() {
  const p = leadQuery().concat(['limit=500']);
  req('GET', `/api/leads?${p.join('&')}`).then((data) => {
    const body = $('leads-body');
    if (!body) return;
    const leads = data.leads || [];
    if (!leads.length) {
      body.innerHTML = '';
      body.appendChild(empty(EMPTY_MSG, '+ Add lead', openAddLead));
      return;
    }
    let h = '<div id="board">';
    BOARD_COLS.forEach((col) => {
      const items = leads.filter((l) => col.statuses.indexOf(l.status) !== -1);
      h += `<div class="col"><h4><i class="dot" style="width:7px;height:7px;border-radius:50%;background:${col.color};display:inline-block"></i>${
        esc(col.title)
      }<span class="cnt num">${items.length}</span></h4><div class="cards">`;
      if (!items.length) h += '<div class="m" style="color:var(--t3);padding:8px">—</div>';
      items.slice(0, 60).forEach((l) => {
        h += `<div class="card-lead" data-id="${l.id}"><b>${esc(l.company_name)}</b>` +
          `<div class="m">${esc(l.city || '—')}${l.country ? ' · ' + esc(l.country) : ''} · step ${l.sequence_step}/3` +
          `${l.needs_call ? ' · <span style="color:var(--hot)">CALL</span>' : ''}</div></div>`;
      });
      if (items.length > 60) h += `<div class="m" style="color:var(--t3);padding:4px 8px">+${items.length - 60} more (use table view)</div>`;
      h += '</div></div>';
    });
    h += '</div>';
    body.innerHTML = h;
    body.querySelectorAll('.card-lead[data-id]').forEach((el) => {
      el.onclick = () => openLead(el.getAttribute('data-id'));
    });
  }).catch(() => {});
}

// ---------- add / import / export ----------
function openAddLead() {
  openModal(
    '<h3>Add lead</h3>' +
    ['company_name', 'contact_name', 'email', 'phone', 'website', 'city', 'category'].map((f) =>
      `<div class="frow"><label>${f.replace('_', ' ')}</label><input id="al-${f}"></div>`).join('') +
    '<div class="frow"><label>country</label><select id="al-country"><option value="">—</option><option>VN</option><option>TH</option></select></div>' +
    '<div class="actions" style="margin-top:12px"><button class="primary" id="al-save">Add lead</button><button id="al-cancel">Cancel</button></div>',
  );
  $('al-cancel').onclick = closeModal;
  $('al-save').onclick = () => {
    const body = {};
    ['company_name', 'contact_name', 'email', 'phone', 'website', 'city', 'category', 'country'].forEach((f) => {
      body[f] = $(`al-${f}`).value;
    });
    req('POST', '/api/leads', body).then((r) => {
      closeModal();
      toast(`Lead #${r.lead.id} added (${r.lead.status})`, 'ok');
      loadStats();
      loadLeads(false);
      openLead(r.lead.id);
    }).catch(() => {});
  };
}

function openImport() {
  openModal(
    '<h3>Import leads from CSV</h3>' +
    '<div class="hint-bar">First line must be a header. Recognized columns: ' +
    '<code>company</code> <code>contact</code> <code>email</code> <code>phone</code> <code>website</code> <code>city</code> <code>country</code> <code>category</code>. ' +
    'Duplicates (by email or domain) and suppressed addresses are skipped. Max 200 rows per batch.</div>' +
    '<textarea id="imp-csv" rows="10" placeholder="company,email,city,country&#10;Saigon Star Events,hello@saigonstar.vn,Ho Chi Minh City,VN"></textarea>' +
    '<div class="actions" style="margin-top:12px"><button class="primary" id="imp-go">Import + verify</button><button id="imp-cancel">Cancel</button></div>' +
    '<div id="imp-out" style="margin-top:10px;color:var(--t2)"></div>',
  );
  $('imp-cancel').onclick = closeModal;
  $('imp-go').onclick = () => {
    $('imp-go').disabled = true;
    $('imp-out').textContent = 'Importing…';
    req('POST', '/api/leads/import', { csv: $('imp-csv').value }).then((r) => {
      $('imp-go').disabled = false;
      $('imp-out').innerHTML = `✓ imported <b>${r.imported}</b> · skipped ${r.skipped} (dupes/suppressed) · verified ${r.verified}` +
        (r.errors && r.errors.length ? `<br><span style="color:var(--warn)">${r.errors.map(esc).join('<br>')}</span>` : '');
      loadStats();
      loadLeads(false);
    }).catch(() => { $('imp-go').disabled = false; $('imp-out').textContent = 'Import failed.'; });
  };
}

function exportCsv() {
  const headers = {};
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;
  fetch('/api/leads/export', { headers }).then((r) => {
    if (!r.ok) { toast('Export failed', 'err'); return null; }
    return r.blob();
  }).then((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'maranasi-leads.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// ---------- refresh after drawer mutations ----------
onLeadChange(() => {
  if (!$('leads-body')) return;
  loadLeads(false);
});
