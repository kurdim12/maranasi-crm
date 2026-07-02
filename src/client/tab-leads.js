// Leads — table/board views, filters, add/import/export. Ported 1:1 from the
// v1 renderLeadsTab/loadLeads/loadBoard/openAddLead/openImport/exportCsv.
import {
  $, esc, req, toast, state, chip, statusChip, STATUS_COLORS,
  empty, skeletons, segmented, dataTable, openModal, closeModal,
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

const cols = [
  { key: 'id', label: 'ID', cls: 'num' },
  { key: 'company_name', label: 'Company', cls: 'pri', render: (r) => `<span title="${esc(r.company_name)}">${esc(r.company_name)}</span>` },
  { key: 'contact_name', label: 'Contact', render: (r) => esc(r.contact_name || '—') },
  { key: 'city', label: 'Location', render: (r) => `${esc(r.city || '—')}${r.country ? ' · ' + esc(r.country) : ''}` },
  { key: 'status', label: 'Status', render: (r) => statusChip(r.status) },
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
    <select id="f-status"><option value="">status: all</option>${
      STATUS_OPTIONS.map((s) => `<option>${s}</option>`).join('')
    }</select>
    <select id="f-country"><option value="">country: all</option><option>VN</option><option>TH</option></select>
    <label style="display:flex;align-items:center;gap:5px;color:var(--t2)"><input type="checkbox" id="f-needs-call"> needs call</label>
    <input type="text" id="f-q" placeholder="Search…">
    <span class="grow"></span>
    <button id="btn-add">+ Add lead</button>
    <button id="btn-import">Import CSV</button>
    <button id="btn-export">Export</button>
  `);
  root.appendChild(filters);

  const body = document.createElement('div');
  body.id = 'leads-body';
  body.innerHTML = skeletons(6);
  root.appendChild(body);

  ['f-status', 'f-country', 'f-needs-call'].forEach((fid) => {
    $(fid).addEventListener('change', () => { offset = 0; loadLeads(false); });
  });
  $('f-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; loadLeads(false); } });
  $('btn-add').addEventListener('click', openAddLead);
  $('btn-import').addEventListener('click', openImport);
  $('btn-export').addEventListener('click', exportCsv);

  loadLeads(false);
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
