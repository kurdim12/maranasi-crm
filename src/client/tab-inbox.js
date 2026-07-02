// Inbox v2 — triage console. Queues left, threads center, conversation right.
// Keyboard: j/k move · enter open · r reply · e done · h snooze · esc back.
import { $, esc, req, toast, chip, classChip, emptyHtml, skeletons, fmtDate, inputModal, confirmModal } from './core.js';
import { openLead, onLeadChange } from './drawer.js';

export const id = 'inbox';
export const title = 'Inbox';
export const icon = '▣';
export const hotkey = 'i';

const QUEUES = [
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'done', label: 'Done' },
  { key: 'snoozed', label: 'Snoozed' },
  { key: 'sent', label: 'Sent' },
];

let queue = 'needs_reply';
let kind = '';
let threads = [];
let sel = -1;
let openThread = null; // lead_id currently open in the conversation pane
let registered = false;
let pendingFocus = null; // lead_id another tab asked us to open on next render

/** Other tabs (Today) route here with a specific thread focused. */
export function focusThread(leadId) {
  queue = 'needs_reply';
  pendingFocus = leadId;
}

export function render(root) {
  root.innerHTML = `
    <div class="inbox-wrap">
      <aside class="inbox-rail" id="ib-rail"></aside>
      <section class="inbox-list" id="ib-list">${skeletons(6)}</section>
      <section class="inbox-conv" id="ib-conv">${emptyHtml('Select a thread — j/k to move, enter to open.')}</section>
    </div>`;
  if (!registered) { onLeadChange(() => { if ($('ib-list')) { load(); if (openThread) openConversation(openThread, true); } }); registered = true; }
  renderRail({});
  load();
}

function renderRail(counts) {
  const rail = $('ib-rail');
  if (!rail) return;
  rail.innerHTML = QUEUES.map((q) => {
    const n = counts[q.key];
    return `<button class="rail-item${q.key === queue ? ' on' : ''}" data-q="${q.key}">
      <span>${esc(q.label)}</span>${n ? `<span class="cnt mono">${n}</span>` : ''}</button>`;
  }).join('') +
    `<div class="rail-sep"></div>
     <select id="ib-kind" aria-label="Real or test mail">
       <option value="">real + test</option>
       <option value="real"${kind === 'real' ? ' selected' : ''}>real only</option>
       <option value="test"${kind === 'test' ? ' selected' : ''}>test (dry run)</option>
     </select>
     <div class="hint-bar" style="flex-direction:column;align-items:flex-start;gap:4px;margin-top:12px">
       <span><span class="kbd">r</span> reply</span>
       <span><span class="kbd">e</span> done</span>
       <span><span class="kbd">h</span> snooze</span>
     </div>`;
  rail.querySelectorAll('.rail-item').forEach((b) => {
    b.onclick = () => { queue = b.dataset.q; sel = -1; openThread = null; render(document.getElementById('view')); };
  });
  const kindSel = $('ib-kind');
  if (kindSel) kindSel.onchange = () => { kind = kindSel.value; load(); };
}

function load() {
  const p = [`queue=${queue}`];
  if (kind) p.push(`kind=${kind}`);
  req('GET', `/api/inbox?${p.join('&')}`).then((d) => {
    if (!$('ib-list')) return;
    threads = d.threads || [];
    renderRail(d.counts || {});
    if (pendingFocus !== null) {
      const i = threads.findIndex((t) => t.lead_id === pendingFocus);
      pendingFocus = null;
      if (i >= 0) { sel = i; renderList(); openConversation(threads[i].lead_id); return; }
    }
    renderList();
  }).catch(() => {});
}

function renderList() {
  const list = $('ib-list');
  if (!list) return;
  if (!threads.length) {
    const msgs = {
      needs_reply: 'Inbox zero — nothing needs a reply.',
      waiting: 'Not waiting on anyone.',
      done: 'Nothing archived yet.',
      snoozed: 'Nothing snoozed.',
      sent: 'No sent mail in this filter.',
    };
    list.innerHTML = emptyHtml(msgs[queue] || 'Empty.');
    return;
  }
  list.innerHTML = threads.map((t, i) => `
    <div class="mailrow${i === sel ? ' sel-row' : ''}" data-i="${i}">
      <span class="mdir ${t.direction === 'out' ? 'mout' : 'min'}">${t.direction === 'out' ? '↑' : '↓'}</span>
      <div class="mmain">
        <div class="mtop"><b>${esc(t.subject || '(no subject)')}</b>
          ${t.classification ? classChip(t.classification) : ''}
          ${t.dry_run && t.direction === 'out' ? chip('DRY RUN', 'var(--info)') : ''}
          ${t.snoozed_until ? chip('until ' + fmtDate(t.snoozed_until)) : ''}
        </div>
        <div class="msub">${esc(t.company_name)} · ${esc(t.lead_email || '')}</div>
        <div class="msnip">${esc((t.snippet || '').replace(/\s+/g, ' '))}</div>
      </div>
      <span class="mtime">${esc(fmtDate(t.created_at))}</span>
    </div>`).join('');
  list.querySelectorAll('.mailrow').forEach((row) => {
    row.onclick = () => { sel = +row.dataset.i; renderList(); openConversation(threads[sel].lead_id); };
  });
}

function openConversation(leadId, keepScroll) {
  openThread = leadId;
  const conv = $('ib-conv');
  if (!conv) return;
  if (!keepScroll) conv.innerHTML = skeletons(4);
  req('GET', `/api/leads/${leadId}`).then((data) => {
    if (!$('ib-conv') || openThread !== leadId) return;
    const l = data.lead;
    const emails = (data.emails || []).slice().reverse(); // oldest first
    let h = `<div class="conv-head">
      <div><b>${esc(l.company_name)}</b> <span class="mono" style="color:var(--t3)">${esc(l.email || '')}</span></div>
      <div class="actions">
        <button class="ghost" id="cv-lead">Lead ↗</button>
        ${queue === 'needs_reply' ? '<button id="cv-done" title="e">✓ Done</button><button id="cv-snooze" title="h">Snooze</button>' : ''}
      </div>
    </div>
    <div class="conv-log" id="cv-log">`;
    for (const e of emails) {
      h += `<div class="bubble ${e.direction === 'out' ? 'b-out' : 'b-in'}">
        <div class="b-meta mono">${e.direction === 'out' ? '↑ us' : '↓ them'} · ${esc(fmtDate(e.created_at))}${
          e.sequence_step ? ` · step ${e.sequence_step}` : ''
        }${e.dry_run && e.direction === 'out' ? ' · DRY RUN' : ''}${
          e.classification ? ` · ${esc(e.classification)}` : ''
        }</div>
        <b>${esc(e.subject || '(no subject)')}</b>
        <pre>${esc((e.body || '').slice(0, 3000))}</pre>
      </div>`;
    }
    h += '</div>';

    if (l.email) {
      const lastSubject = (data.emails || []).find((e) => e.subject)?.subject || '';
      const replySubject = lastSubject ? (lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`) : '';
      h += `<div class="conv-compose">
        <div class="frow" style="margin-bottom:6px"><label>subject</label><input id="cv-subject" value="${esc(replySubject)}"></div>
        <textarea id="cv-body" rows="5" placeholder="Write your reply… (r focuses here)"></textarea>
        <div class="actions" style="margin-top:8px">
          <button class="primary" id="cv-send">Send reply</button>
          <span class="seg" id="cv-tone"><button class="on" data-t="warm">warm</button><button data-t="direct">direct</button></span>
          <button id="cv-draft">✦ AI draft</button>
        </div>
      </div>`;
    }
    conv.innerHTML = h;
    const log = $('cv-log');
    if (log) log.scrollTop = log.scrollHeight;

    $('cv-lead').onclick = () => openLead(leadId);
    let tone = 'warm';
    const toneSeg = $('cv-tone');
    if (toneSeg) toneSeg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { toneSeg.querySelectorAll('button').forEach((x) => (x.className = '')); b.className = 'on'; tone = b.dataset.t; };
    });
    const draftBtn = $('cv-draft');
    if (draftBtn) draftBtn.onclick = () => {
      draftBtn.disabled = true;
      draftBtn.textContent = 'drafting…';
      req('POST', `/api/leads/${leadId}/draft`, { tone })
        .then((r) => { $('cv-body').value = r.draft || ''; })
        .catch(() => {})
        .finally(() => { draftBtn.disabled = false; draftBtn.textContent = '✦ AI draft'; });
    };
    const sendBtn = $('cv-send');
    if (sendBtn) sendBtn.onclick = async () => {
      const subject = $('cv-subject').value.trim();
      const bodyText = $('cv-body').value.trim();
      if (!subject || !bodyText) { toast('Subject and body required', 'err'); return; }
      const go = await confirmModal({
        title: 'Send for real?',
        message: `This sends a real email to ${l.email} from your connected inbox right now.`,
        confirmLabel: 'Send email',
      });
      if (!go) return;
      sendBtn.disabled = true;
      req('POST', `/api/leads/${leadId}/email`, { subject, body: bodyText })
        .then(() => { toast(`Sent to ${l.email}`, 'ok'); load(); openConversation(leadId, true); })
        .catch(() => { sendBtn.disabled = false; });
    };
    const doneBtn = $('cv-done');
    if (doneBtn) doneBtn.onclick = () => markDone(leadId);
    const snoozeBtn = $('cv-snooze');
    if (snoozeBtn) snoozeBtn.onclick = () => snooze(leadId);
  }).catch(() => {});
}

function currentEmailId(leadId) {
  const t = threads.find((x) => x.lead_id === leadId);
  return t ? t.id : null;
}

function markDone(leadId) {
  const emailId = currentEmailId(leadId);
  if (!emailId) return;
  req('POST', `/api/emails/${emailId}/triage`, { action: 'done' }).then((r) => {
    toast(r.triage === 'waiting' ? 'Moved to Waiting (we sent last)' : 'Done', 'ok');
    openThread = null;
    sel = -1;
    $('ib-conv').innerHTML = emptyHtml('Handled. Next: j/k + enter.');
    load();
  });
}

async function snooze(leadId) {
  const emailId = currentEmailId(leadId);
  if (!emailId) return;
  const ans = await inputModal({
    title: 'Snooze thread',
    fields: [{ key: 'when', label: 'for', value: '1d', placeholder: '1d · 3d · YYYY-MM-DD', required: true }],
    confirmLabel: 'Snooze',
    hint: 'It returns to Needs reply when time is up.',
  });
  if (!ans) return;
  const pick = ans.when;
  let until;
  const m = pick.match(/^(\d+)d$/i);
  if (m) {
    const dt = new Date(Date.now() + parseInt(m[1], 10) * 86400000);
    until = dt.toISOString().slice(0, 19).replace('T', ' ');
  } else if (!Number.isNaN(Date.parse(pick))) {
    until = `${pick.slice(0, 10)} 06:00:00`;
  } else { toast('Use 1d, 3d, or YYYY-MM-DD', 'err'); return; }
  req('POST', `/api/emails/${emailId}/triage`, { action: 'snooze', until }).then(() => {
    toast(`Snoozed until ${until.slice(0, 10)}`, 'ok');
    openThread = null;
    sel = -1;
    $('ib-conv').innerHTML = emptyHtml('Snoozed. It returns to Needs reply when time is up.');
    load();
  });
}

export function keys(k) {
  if (k === 'j' || k === 'k') {
    if (!threads.length) return true;
    sel = Math.max(0, Math.min(threads.length - 1, sel + (k === 'j' ? 1 : -1)));
    renderList();
    const row = document.querySelector(`.mailrow[data-i="${sel}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if (k === 'enter') {
    if (sel >= 0) openConversation(threads[sel].lead_id);
    return true;
  }
  if (k === 'r') {
    const box = $('cv-body');
    if (box) { box.focus(); return true; }
    if (sel >= 0) {
      openConversation(threads[sel].lead_id);
      setTimeout(() => { const b = $('cv-body'); if (b) b.focus(); }, 700);
      return true;
    }
    return false;
  }
  if (k === 'e' && queue === 'needs_reply') {
    const target = openThread || (sel >= 0 ? threads[sel].lead_id : null);
    if (target) markDone(target);
    return true;
  }
  if (k === 'h' && queue === 'needs_reply') {
    const target = openThread || (sel >= 0 ? threads[sel].lead_id : null);
    if (target) snooze(target);
    return true;
  }
  return false;
}
