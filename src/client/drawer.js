// Lead drawer — shared by Leads, Inbox, Today and the palette.
import {
  $, esc, req, toast, chip, statusChip, openModal, closeModal,
  openDrawerHost, closeDrawer, emptyHtml,
} from './core.js';

// Other views can subscribe to refresh after drawer mutations.
let refreshHooks = [];
export function onLeadChange(fn) { refreshHooks.push(fn); }
function changed() { refreshHooks.forEach((fn) => { try { fn(); } catch { /* view gone */ } }); }

export function openLead(id) {
  req('GET', `/api/leads/${id}`).then((data) => {
    const l = data.lead;
    const inSequence = l.status === 'verified' || l.status === 'contacted';
    const lastSubject = (data.emails || []).find((e) => e.subject)?.subject || null;

    let h = `<div class="drawer-head">
        <h2>#${l.id} ${esc(l.company_name)}</h2>
        <button class="ghost" id="d-close" aria-label="Close">✕</button>
      </div>
      <div class="drawer-meta mono">${
        l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(l.website)}</a> · ` : ''
      }${esc(l.category || '')} · ${esc(l.source)} · created ${esc(l.created_at)}</div>
      <div class="chips-row">
        ${statusChip(l.status)}
        ${chip(`step ${l.sequence_step}/3`)}
        ${chip(`email: ${l.email_status}`)}
        ${chip(`phone: ${l.phone_status}`)}
        ${l.confirmed ? chip('confirmed', 'var(--ok)') : ''}
        ${l.needs_call ? chip('NEEDS CALL', 'var(--hot)', 'hot') : ''}
        ${inSequence && !l.next_action_at ? chip('follow-ups paused', 'var(--warn)') : ''}
      </div>
      ${l.drop_reason ? `<div class="drawer-meta">drop reason: ${esc(l.drop_reason)}</div>` : ''}`;

    h += `<div class="sect"><h3>Contact</h3>
      <div class="frow"><label>email</label><span class="mono" style="color:var(--t2);overflow-wrap:anywhere">${esc(l.email || '—')}</span></div>
      <div class="frow"><label>contact name</label><input id="ed-contact_name" value="${esc(l.contact_name)}"></div>
      <div class="frow"><label>phone</label><input id="ed-phone" class="mono" value="${esc(l.phone)}"></div>
      <div class="frow"><label>city</label><input id="ed-city" value="${esc(l.city)}"></div>
      <div class="frow"><label>category</label><input id="ed-category" value="${esc(l.category)}"></div>
      <div class="frow"><label>notes</label><textarea id="ed-notes" rows="4">${esc(l.notes)}</textarea></div>
      <div class="actions"><button class="primary" id="d-save">Save changes</button></div>
    </div>`;

    h += `<div class="sect"><h3>Actions</h3><div class="actions">
      <button class="good" id="d-reached">✓ Call: reached</button>
      <button id="d-noanswer">✗ Call: no answer</button>
      <button id="d-verify">Re-verify email</button>
      ${inSequence && l.sequence_step < 3 ? '<button id="d-preview">Preview next email</button>' : ''}
      ${inSequence && l.next_action_at ? '<button id="d-pause" class="danger">Pause follow-ups</button>' : ''}
      ${inSequence && !l.next_action_at && l.sequence_step < 3 ? '<button id="d-resume" class="good">Resume follow-ups</button>' : ''}
    </div>
    <div class="hint-bar">Logging "no answer" is the human gate that later allows the agent to drop this lead.</div></div>`;

    if (l.email) {
      const replySubject = lastSubject ? (lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`) : '';
      h += `<div class="sect"><h3>Reply / compose (sends for real via Gmail)</h3>
        <div class="frow"><label>subject</label><input id="re-subject" value="${esc(replySubject)}"></div>
        <textarea id="re-body" rows="6" placeholder="Write your reply… (ask the CRM agent to draft_reply for a starting point)"></textarea>
        <div class="actions" style="margin-top:8px"><button class="primary" id="re-send">Send email</button></div>
      </div>`;
    }

    const items = [];
    (data.emails || []).forEach((e) => {
      items.push({
        at: e.created_at,
        html: `<div class="tl-item"><div class="meta">${esc(e.created_at)} · ${
          e.direction === 'out' ? '↑ sent' : '↓ received'
        }${e.sequence_step ? ` · step ${e.sequence_step}` : e.direction === 'out' ? ' · manual' : ''}${
          e.classification ? ` · ${esc(e.classification)}` : ''
        }${e.dry_run ? ' · DRY RUN' : ''}</div><b>${esc(e.subject || '(no subject)')}</b><pre>${
          esc((e.body || '').slice(0, 1500))
        }</pre></div>`,
      });
    });
    (data.activities || []).forEach((a) => {
      items.push({
        at: a.created_at,
        html: `<div class="tl-item"><div class="meta">${esc(a.created_at)} · ${esc(a.actor)} · <b>${
          esc(a.action)
        }</b></div>${a.detail ? `<pre>${esc(a.detail)}</pre>` : ''}</div>`,
      });
    });
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    h += `<div class="sect"><h3>Timeline (${items.length})</h3>${
      items.length ? items.map((i) => i.html).join('') : emptyHtml('Nothing yet — the first send or call lands here.')
    }</div>`;

    $('drawer').innerHTML = h;
    openDrawerHost();

    const reopen = () => openLead(id);
    $('d-close').onclick = closeDrawer;
    $('d-save').onclick = () => {
      const body = { notes: $('ed-notes').value };
      ['contact_name', 'phone', 'city', 'category'].forEach((f) => { body[f] = $(`ed-${f}`).value; });
      req('PATCH', `/api/leads/${id}`, body).then(() => { toast('Lead saved', 'ok'); changed(); reopen(); });
    };
    $('d-reached').onclick = () =>
      req('POST', `/api/leads/${id}/call-outcome`, { outcome: 'reached' }).then(() => { toast('Logged: call reached', 'ok'); changed(); reopen(); });
    $('d-noanswer').onclick = () =>
      req('POST', `/api/leads/${id}/call-outcome`, { outcome: 'unresponsive' }).then(() => { toast('Logged: no answer', 'ok'); changed(); reopen(); });
    $('d-verify').onclick = () =>
      req('POST', `/api/leads/${id}/verify`).then((r) => { toast(`Verification: ${r.reason}`, r.ok ? 'ok' : 'err'); changed(); reopen(); });
    if ($('d-preview')) $('d-preview').onclick = () =>
      req('GET', `/api/leads/${id}/preview-next`).then((r) => {
        if (!r.ok) { toast(r.reason || 'No preview available', 'err'); return; }
        openModal(`<h3>Preview — step ${r.step}${r.personalized ? ' (AI personalized)' : ' (template fill)'}</h3>
          <div class="frow"><label>subject</label><span>${esc(r.subject)}</span></div>
          <pre style="white-space:pre-wrap;background:var(--bg0);border:1px solid var(--line);border-radius:8px;padding:12px;color:var(--t2);font:12px/1.5 var(--font-mono)">${esc(r.body)}</pre>
          <div class="actions"><button id="pv-close">Close</button></div>`);
        $('pv-close').onclick = closeModal;
      });
    if ($('d-pause')) $('d-pause').onclick = () =>
      req('POST', `/api/leads/${id}/sequence/pause`).then(() => { toast('Follow-ups paused'); changed(); reopen(); });
    if ($('d-resume')) $('d-resume').onclick = () =>
      req('POST', `/api/leads/${id}/sequence/resume`).then(() => { toast('Follow-ups resumed', 'ok'); changed(); reopen(); });
    if ($('re-send')) $('re-send').onclick = () => {
      const subject = $('re-subject').value.trim();
      const body = $('re-body').value.trim();
      if (!subject || !body) { toast('Subject and body required', 'err'); return; }
      if (!window.confirm(`Send this email to ${l.email || ''} now? This is a REAL send.`)) return;
      $('re-send').disabled = true;
      req('POST', `/api/leads/${id}/email`, { subject, body })
        .then(() => { toast(`Email sent to ${l.email}`, 'ok'); changed(); reopen(); })
        .catch(() => { const b = $('re-send'); if (b) b.disabled = false; });
    };
  }).catch(() => {});
}
