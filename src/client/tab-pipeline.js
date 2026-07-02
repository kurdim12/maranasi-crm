// Pipeline — deal kanban (drag to move stage) + list view + open tasks.
// Interested leads auto-create deals; won/lost prompt for value/reason.
import { $, esc, req, toast, chip, segmented, emptyHtml, skeletons, fmtDate, inputModal } from './core.js';
import { openLead, onLeadChange } from './drawer.js';
import { goTab } from './app.js';

export const id = 'pipeline';
export const title = 'Pipeline';
export const icon = '▤';
export const hotkey = 'p';

const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'call_scheduled', label: 'Call scheduled' },
  { key: 'proposal_sent', label: 'Proposal sent' },
  { key: 'negotiation', label: 'Negotiation', hot: true },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
];

let view = 'board';
let deals = [];
let registered = false;

export function render(root) {
  root.innerHTML = `
    <div class="filters">
      <span id="pl-seg"></span>
      <span class="grow"></span>
      <span id="pl-totals" class="mono" style="color:var(--t2)"></span>
    </div>
    <div id="pl-body">${skeletons(5)}</div>`;
  $('pl-seg').appendChild(segmented(
    [{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }],
    view,
    (v) => { view = v; draw(); },
  ));
  if (!registered) { onLeadChange(() => { if ($('pl-body')) load(); }); registered = true; }
  load();
}

function load() {
  req('GET', '/api/pipeline').then((d) => {
    if (!$('pl-body')) return;
    deals = d.deals || [];
    const open = deals.filter((x) => x.stage !== 'won' && x.stage !== 'lost');
    const openValue = open.reduce((a, x) => a + (x.value_usd || 0), 0);
    const winPart = d.won + d.lost > 0 ? ` · win rate ${Math.round((d.won / (d.won + d.lost)) * 100)}%` : '';
    $('pl-totals').textContent =
      `${open.length} open${openValue ? ` · $${openValue.toLocaleString()}` : ''}${winPart}`;
    draw();
  }).catch(() => {});
}

function draw() {
  const body = $('pl-body');
  if (!body) return;
  if (!deals.length) {
    body.innerHTML = '';
    const e = document.createElement('div');
    e.className = 'empty';
    e.innerHTML = 'No deals yet — the first interested reply creates one automatically.';
    const act = document.createElement('div');
    act.className = 'act';
    const btn = document.createElement('button');
    btn.textContent = 'View leads';
    btn.onclick = () => goTab('leads');
    act.appendChild(btn);
    e.appendChild(act);
    body.appendChild(e);
    return;
  }
  if (view === 'board') drawBoard(body);
  else drawList(body);
}

function dealCard(d) {
  return `<div class="card-lead deal-card" draggable="true" data-deal="${d.id}" data-stage="${esc(d.stage)}" data-lead="${d.lead_id}">
    <b>${esc(d.company_name)}</b>
    <div class="m">${d.value_usd ? `$${Number(d.value_usd).toLocaleString()}` : 'no value'}${
      d.expected_close ? ` · close ${esc(String(d.expected_close).slice(0, 10))}` : ''
    }</div>
    ${d.next_step ? `<div class="m" style="color:var(--t2)">→ ${esc(d.next_step)}</div>` : ''}
    ${d.lost_reason ? `<div class="m" style="color:var(--warn)">${esc(d.lost_reason)}</div>` : ''}
  </div>`;
}

function drawBoard(body) {
  let h = '<div id="board">';
  for (const s of STAGES) {
    const items = deals.filter((d) => d.stage === s.key);
    const value = items.reduce((a, x) => a + (x.value_usd || 0), 0);
    const dot = s.key === 'won' ? 'var(--ok)' : s.key === 'lost' ? 'var(--warn)' : s.hot ? 'var(--hot)' : 'var(--t3)';
    h += `<div class="col" data-col="${s.key}">
      <h4><i class="dot" style="width:7px;height:7px;border-radius:50%;background:${dot};display:inline-block"></i>
        ${esc(s.label)}<span class="cnt">${items.length}${value ? ` · $${value.toLocaleString()}` : ''}</span></h4>
      <div class="cards" data-col="${s.key}">${items.map(dealCard).join('') || '<div class="m" style="color:var(--t3);padding:6px 8px">—</div>'}</div>
    </div>`;
  }
  h += '</div>';
  body.innerHTML = h;

  body.querySelectorAll('.deal-card').forEach((card) => {
    card.onclick = () => openLead(card.dataset.lead);
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ deal: card.dataset.deal, from: card.dataset.stage }));
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  body.querySelectorAll('.cards').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
      moveDeal(+payload.deal, payload.from, col.dataset.col);
    });
  });
}

function drawList(body) {
  body.innerHTML = `<div class="tablewrap"><table class="data"><thead><tr>
    <th>Company</th><th>Stage</th><th>Value</th><th>Expected close</th><th>Next step</th><th>Updated</th><th></th>
  </tr></thead><tbody>${deals.map((d) => `
    <tr class="click" data-lead="${d.lead_id}">
      <td class="pri">${esc(d.company_name)}</td>
      <td><span id="stg-${d.id}">${stageChip(d.stage)}</span></td>
      <td class="num">${d.value_usd ? `$${Number(d.value_usd).toLocaleString()}` : '—'}</td>
      <td class="num">${d.expected_close ? esc(String(d.expected_close).slice(0, 10)) : '—'}</td>
      <td>${esc(d.next_step || '—')}</td>
      <td class="num">${esc(fmtDate(d.updated_at))}</td>
      <td><select class="stage-sel" data-deal="${d.id}" data-stage="${esc(d.stage)}" onclick="event.stopPropagation()">
        ${STAGES.map((s) => `<option value="${s.key}"${s.key === d.stage ? ' selected' : ''}>${s.label}</option>`).join('')}
      </select></td>
    </tr>`).join('')}</tbody></table></div>`;
  body.querySelectorAll('tr.click').forEach((tr) => { tr.onclick = () => openLead(tr.dataset.lead); });
  body.querySelectorAll('.stage-sel').forEach((sel) => {
    sel.onchange = (e) => { e.stopPropagation(); moveDeal(+sel.dataset.deal, sel.dataset.stage, sel.value); };
  });
}

function stageChip(stage) {
  const s = STAGES.find((x) => x.key === stage);
  const color = stage === 'won' ? 'var(--ok)' : stage === 'lost' ? 'var(--warn)' : stage === 'negotiation' ? 'var(--hot)' : 'var(--t3)';
  return chip(s ? s.label : stage, color, stage === 'negotiation' ? 'hot' : '');
}

export async function moveDeal(dealId, from, to) {
  if (from === to) return;
  const body = { stage: to };
  if (to === 'won') {
    const ans = await inputModal({
      title: '🎉 Mark deal as won',
      fields: [{ key: 'value', label: 'value USD', placeholder: 'optional — leave empty to skip' }],
      confirmLabel: 'Mark won',
    });
    if (!ans) { load(); return; }
    if (ans.value) body.value_usd = parseInt(ans.value.replace(/[^\d]/g, ''), 10) || null;
  }
  if (to === 'lost') {
    const ans = await inputModal({
      title: 'Mark deal as lost',
      fields: [{ key: 'reason', label: 'why lost', placeholder: 'e.g. budget cut, went with local vendor', required: true }],
      confirmLabel: 'Mark lost',
    });
    if (!ans) { toast('Lost needs a reason — deal unchanged', 'err'); load(); return; }
    body.lost_reason = ans.reason;
  }
  req('PATCH', `/api/deals/${dealId}`, body)
    .then(() => { toast(to === 'won' ? '🎉 Won' : `Moved to ${to.replace(/_/g, ' ')}`, to === 'lost' ? undefined : 'ok'); load(); })
    .catch(() => load());
}
