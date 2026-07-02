// Inbox — the mail log (outreach sent + replies received). Ported 1:1 from
// v1's Mail tab (renderMailTab / loadMail / classTag in dashboard.ts). The
// triage rebuild lands in a later phase — this is zero behavior change.
import { $, esc, req, chip, classChip, empty, skeletons } from './core.js';
import { openLead, onLeadChange } from './drawer.js';

export const id = 'inbox';
export const title = 'Inbox';
export const icon = '▣';
export const hotkey = 'i';

let offset = 0;
let rows = [];
let sel = -1;

export function render(root) {
  offset = 0;
  rows = [];
  sel = -1;
  root.innerHTML = `
    <div class="filters">
      <select id="m-dir">
        <option value="">all mail</option>
        <option value="out">sent</option>
        <option value="in">received</option>
      </select>
      <select id="m-kind">
        <option value="">real + test</option>
        <option value="real">real only</option>
        <option value="test">test (dry run)</option>
      </select>
      <input type="text" id="m-q" placeholder="Search subject, body, company…">
      <span class="grow"></span>
      <span id="m-count" style="color:var(--t3)"></span>
    </div>
    <div class="card"><div id="mail-body">${skeletons(6)}</div></div>
    <div style="margin-top:10px;text-align:center"><button id="m-more" style="display:none">Load more</button></div>
  `;
  ['m-dir', 'm-kind'].forEach((elId) => {
    $(elId).addEventListener('change', () => { offset = 0; loadMail(false); });
  });
  $('m-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { offset = 0; loadMail(false); } });
  $('m-more').addEventListener('click', () => { offset += 50; loadMail(true); });
  loadMail(false);
}

// Refresh the currently displayed page after a drawer edit — only if Inbox
// is the mounted tab (guarded by the presence of our own DOM).
onLeadChange(() => {
  if ($('mail-body')) { offset = 0; loadMail(false); }
});

function mailRowHtml(e) {
  let badges = '';
  if (e.direction === 'out') badges += chip(e.sequence_step ? `step ${e.sequence_step}` : 'manual');
  if (e.dry_run) badges += chip('DRY RUN', 'var(--info)');
  if (e.classification) badges += classChip(e.classification);
  return `<div class="mailrow" data-lead="${esc(e.lead_id)}">
    <span class="mdir ${e.direction === 'out' ? 'mout' : 'min'}">${e.direction === 'out' ? '↑' : '↓'}</span>
    <div class="mmain">
      <div class="mtop"><b>${esc(e.subject || '(no subject)')}</b>${badges}</div>
      <div class="msub">${esc(e.company_name)}${e.lead_email ? ' · ' + esc(e.lead_email) : ''}</div>
      <div class="msnip">${esc((e.snippet || '').replace(/\s+/g, ' '))}</div>
    </div>
    <span class="mtime num">${esc((e.created_at || '').slice(0, 16))}</span>
  </div>`;
}

function loadMail(append) {
  const p = ['limit=50', `offset=${offset}`];
  if ($('m-dir').value) p.push(`direction=${$('m-dir').value}`);
  if ($('m-kind').value) p.push(`kind=${$('m-kind').value}`);
  if ($('m-q').value) p.push(`q=${encodeURIComponent($('m-q').value)}`);
  req('GET', `/api/emails?${p.join('&')}`).then((data) => {
    if (!$('mail-body')) return; // tab changed while in flight
    const emails = data.emails || [];
    rows = append ? rows.concat(emails) : emails;
    if (!append) sel = -1;
    const html = emails.map(mailRowHtml).join('');
    if (!append) {
      $('mail-body').innerHTML = '';
      if (html) $('mail-body').innerHTML = html;
      else {
        $('mail-body').appendChild(
          empty('No mail yet. Outreach the sequence engine sends — and replies the watcher pulls in — all land here.'),
        );
      }
    } else {
      $('mail-body').insertAdjacentHTML('beforeend', html);
    }
    $('m-count').textContent = `${data.total} message${data.total === 1 ? '' : 's'}`;
    $('m-more').style.display = offset + 50 < data.total ? '' : 'none';
    wireRows();
    applySel();
  });
}

function wireRows() {
  const body = $('mail-body');
  if (!body) return;
  body.querySelectorAll('.mailrow[data-lead]').forEach((el) => {
    el.onclick = () => openLead(el.getAttribute('data-lead'));
  });
}

function applySel() {
  const body = $('mail-body');
  if (!body) return;
  const els = body.querySelectorAll('.mailrow');
  els.forEach((el, i) => { el.style.background = i === sel ? 'var(--bg2)' : ''; });
  if (sel >= 0 && els[sel]) els[sel].scrollIntoView({ block: 'nearest' });
}

export function keys(k, e) {
  if (!rows.length) return false;
  if (k === 'j') { sel = Math.min(rows.length - 1, sel + 1); applySel(); return true; }
  if (k === 'k') { sel = Math.max(0, sel - 1); applySel(); return true; }
  if (k === 'enter') {
    if (sel >= 0 && rows[sel]) openLead(rows[sel].lead_id);
    return true;
  }
  return false;
}
