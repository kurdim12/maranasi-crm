// Lead drawer — shared by Leads, Inbox, Today and the palette.
import {
  $, esc, req, toast, chip, statusChip, openModal, closeModal,
  openDrawerHost, closeDrawer, emptyHtml, inputModal, confirmModal,
} from './core.js';

function fmtTime(s) {
  return s ? String(s).slice(11, 16) : '';
}

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
      <div class="frow"><label>preferred channel</label><select id="ed-preferred_channel" aria-label="Preferred channel">
        ${['', 'whatsapp', 'zalo', 'line', 'email'].map((c) => `<option value="${c}"${(l.preferred_channel || '') === c ? ' selected' : ''}>${c || 'auto (by country)'}</option>`).join('')}
      </select></div>
      <div class="frow"><label>LINE ID</label><input id="ed-line_id" class="mono" value="${esc(l.line_id)}"></div>
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

    // ---- Intelligence (P4): brief, fit score, socials ----
    let brief = null;
    let socials = null;
    try { brief = l.brief ? JSON.parse(l.brief) : null; } catch { brief = null; }
    try { socials = l.socials ? JSON.parse(l.socials) : null; } catch { socials = null; }
    h += `<div class="sect"><h3>Intelligence${
      l.fit_score ? ` <span class="chip${l.fit_score >= 4 ? ' hot' : ''}" style="margin-left:6px">${
        l.fit_score >= 4 ? '<i style="background:var(--hot)"></i>' : ''
      }fit ${l.fit_score}/5</span>` : ''
    }</h3>${
      brief
        ? `${brief.what_they_do ? `<p style="margin:0 0 8px;color:var(--t2)">${esc(brief.what_they_do)}</p>` : ''}
           ${brief.hook_angle ? `<div class="frow"><label>hook</label><span style="color:var(--t1)">${esc(brief.hook_angle)}</span></div>` : ''}
           ${brief.event_types && brief.event_types.length ? `<div class="frow"><label>event types</label><span class="mono" style="color:var(--t2)">${brief.event_types.map(esc).join(' · ')}</span></div>` : ''}
           ${brief.size_signals && brief.size_signals.length ? `<div class="frow"><label>size signals</label><span class="mono" style="color:var(--t2)">${brief.size_signals.map(esc).join(' · ')}</span></div>` : ''}
           ${brief.decision_makers && brief.decision_makers.length ? `<div class="frow"><label>people</label><span style="color:var(--t2)">${brief.decision_makers.map((d) => esc(`${d.name}${d.title ? ` (${d.title})` : ''}`)).join(', ')}</span></div>` : ''}`
        : '<p style="margin:0 0 8px;color:var(--t3)">No brief yet — build one from the website.</p>'
    }${
      socials
        ? `<div class="frow"><label>socials</label><span>${['instagram', 'facebook', 'linkedin']
            .filter((k) => socials[k])
            .map((k) => `<a href="${esc(socials[k])}" target="_blank" rel="noopener" style="margin-right:10px">${k}</a>`)
            .join('')}</span></div>`
        : ''
    }<div class="actions"><button id="d-brief" class="ghost">${brief ? '↻ Rebuild brief' : '✦ Build brief'}</button></div></div>`;

    // ---- Channels (P5): manual deep links only — never automated ----
    const digits = (l.phone || '').replace(/[^\d]/g, '');
    const defChan = l.preferred_channel || (l.country === 'VN' ? 'zalo' : l.country === 'TH' ? 'line' : 'whatsapp');
    h += `<div class="sect"><h3>Channels <span class="hint" style="text-transform:none;letter-spacing:0">manual only — opens the app, you hit send</span></h3>
      <div class="actions">
        <button class="ch-btn${defChan === 'whatsapp' ? ' primary' : ''}" data-ch="whatsapp" ${digits.length >= 7 ? '' : 'disabled title="needs a phone number"'}>WhatsApp</button>
        <button class="ch-btn${defChan === 'zalo' ? ' primary' : ''}" data-ch="zalo" ${digits.length >= 7 ? '' : 'disabled title="needs a phone number"'}>Zalo</button>
        ${l.line_id
          ? `<button class="ch-btn${defChan === 'line' ? ' primary' : ''}" data-ch="line">Line</button>`
          : '<button id="ch-line-add" class="ghost">+ add LINE ID</button>'}
        <button id="ch-log" class="ghost">✓ Log touch</button>
      </div></div>`;

    const deal = (data.deals || []).find((d) => d.stage !== 'won' && d.stage !== 'lost') || (data.deals || [])[0];
    if (deal) {
      const STAGES = ['new', 'call_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost'];
      const terminal = deal.stage === 'won' || deal.stage === 'lost';
      h += `<div class="sect"><h3>Deal ${deal.stage === 'won' ? '· WON' : deal.stage === 'lost' ? '· LOST' : ''}</h3>
        <div class="frow"><label>stage</label>${
          terminal
            ? `<span class="mono">${esc(deal.stage)}${deal.lost_reason ? ` — ${esc(deal.lost_reason)}` : ''}</span>`
            : `<select id="dl-stage" aria-label="Deal stage">${STAGES.map((s) => `<option value="${s}"${s === deal.stage ? ' selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}</select>`
        }</div>
        <div class="frow"><label>value USD</label><input id="dl-value" class="mono" value="${deal.value_usd ?? ''}" ${terminal ? 'disabled' : ''}></div>
        <div class="frow"><label>expected close</label><input id="dl-close" class="mono" placeholder="YYYY-MM-DD" value="${esc(deal.expected_close ? String(deal.expected_close).slice(0, 10) : '')}" ${terminal ? 'disabled' : ''}></div>
        <div class="frow"><label>next step</label><input id="dl-next" value="${esc(deal.next_step)}" ${terminal ? 'disabled' : ''}></div>
        ${terminal ? '' : '<div class="actions"><button id="dl-save">Save deal</button></div>'}
      </div>`;
    }

    const tasks = data.tasks || [];
    h += `<div class="sect"><h3>Tasks (${tasks.length})</h3>${
      tasks.map((t) => `<div class="frow"><button class="ghost dl-task-done" data-task="${t.id}" title="Mark done">◯</button>
        <span style="flex:1">${esc(t.title)}</span>
        <span class="mono" style="color:var(--t3)">${t.due_at ? esc(String(t.due_at).slice(0, 10)) : ''}</span></div>`).join('')
    }<div class="actions"><button id="dl-task-add" class="ghost">+ Task for this lead</button></div></div>`;

    if (l.email) {
      const replySubject = lastSubject ? (lastSubject.startsWith('Re:') ? lastSubject : `Re: ${lastSubject}`) : '';
      h += `<div class="sect"><h3>Reply / compose (sends for real via Gmail)</h3>
        <div class="frow"><label>subject</label><input id="re-subject" value="${esc(replySubject)}"></div>
        <textarea id="re-body" rows="6" placeholder="Write your reply… (ask the CRM agent to draft_reply for a starting point)"></textarea>
        <div class="actions" style="margin-top:8px"><button class="primary" id="re-send">Send email</button></div>
      </div>`;
    }

    const ACT_ICONS = {
      call_outcome: '☎', lead_dropped: '✕', status_change: '→', task_created: '＋', task_completed: '✓',
      deal_created: '◆', deal_stage_changed: '◆', reply_received: '↓', brief_built: '✦',
      suppression_added: '⃠', manual_email_sent: '↑', channel_touch: '#',
    };
    const items = [];
    (data.emails || []).forEach((e) => {
      items.push({
        at: e.created_at,
        html: `<div class="tl-item"><div class="tl-ico" aria-hidden="true">${e.direction === 'out' ? '↑' : '↓'}</div>
          <div class="tl-body"><div class="meta">${esc(fmtTime(e.created_at))} · ${
            e.direction === 'out' ? 'sent' : 'received'
          }${e.sequence_step ? ` · step ${e.sequence_step}` : e.direction === 'out' ? ' · manual' : ''}${
            e.classification ? ` · ${esc(e.classification)}` : ''
          }${e.dry_run ? ' · DRY RUN' : ''}</div><b>${esc(e.subject || '(no subject)')}</b><pre>${
            esc((e.body || '').slice(0, 1500))
          }</pre></div></div>`,
      });
    });
    (data.activities || []).forEach((a) => {
      items.push({
        at: a.created_at,
        html: `<div class="tl-item"><div class="tl-ico" aria-hidden="true">${ACT_ICONS[a.action] || '·'}</div>
          <div class="tl-body"><div class="meta">${esc(fmtTime(a.created_at))} · ${esc(a.actor)} · <b>${
            esc(a.action.replace(/_/g, ' '))
          }</b></div>${a.detail ? `<pre>${esc(a.detail)}</pre>` : ''}</div></div>`,
      });
    });
    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    let timeline = '';
    let lastDay = '';
    for (const it of items) {
      const day = String(it.at || '').slice(0, 10);
      if (day !== lastDay) {
        lastDay = day;
        timeline += `<div class="tl-day">${esc(day)}</div>`;
      }
      timeline += it.html;
    }
    h += `<div class="sect"><h3>Timeline (${items.length})</h3>${
      items.length ? timeline : emptyHtml('Nothing yet — the first send or call lands here.')
    }</div>`;

    $('drawer').innerHTML = h;
    openDrawerHost();

    const reopen = () => openLead(id);
    $('d-close').onclick = closeDrawer;
    $('d-save').onclick = () => {
      const body = { notes: $('ed-notes').value };
      ['contact_name', 'phone', 'city', 'category', 'line_id'].forEach((f) => { body[f] = $(`ed-${f}`).value; });
      body.preferred_channel = $('ed-preferred_channel').value || null;
      req('PATCH', `/api/leads/${id}`, body).then(() => { toast('Lead saved', 'ok'); changed(); reopen(); });
    };
    const logCall = async (outcome, label) => {
      const ans = await inputModal({
        title: label,
        fields: [{ key: 'note', label: 'note', type: 'textarea', placeholder: 'optional — what was said, callback time…' }],
        confirmLabel: 'Log call',
        hint: outcome === 'unresponsive' ? 'Logging "no answer" is the human gate that later allows the agent to drop this lead.' : '',
      });
      if (!ans) return;
      req('POST', `/api/leads/${id}/call-outcome`, { outcome, note: ans.note || undefined })
        .then(() => { toast(`Logged: ${label.toLowerCase()}`, 'ok'); changed(); reopen(); });
    };
    $('d-reached').onclick = () => logCall('reached', 'Call reached');
    $('d-noanswer').onclick = () => logCall('unresponsive', 'Call: no answer');
    $('d-verify').onclick = () =>
      req('POST', `/api/leads/${id}/verify`).then((r) => { toast(`Verification: ${r.reason}`, r.ok ? 'ok' : 'err'); changed(); reopen(); });
    // Channel deep links: fill the per-channel template client-side, open the
    // app, log the touch. Zalo ignores URL prefill → copy text to clipboard.
    document.querySelectorAll('.ch-btn').forEach((b) => {
      b.onclick = async () => {
        const ch = b.dataset.ch;
        const cfg = await req('GET', '/api/config/channel-templates').catch(() => null);
        const tpl = (cfg && cfg.templates && cfg.templates[ch]) || 'Hi {{contact_name}}, Rami from Maranasi Events — quick chat about {{company_name}}?';
        const text = tpl
          .replace(/\{\{\s*company_name\s*\}\}/g, l.company_name || 'your company')
          .replace(/\{\{\s*contact_name\s*\}\}/g, l.contact_name || 'there')
          .replace(/\{\{\s*city\s*\}\}/g, l.city || 'your city');
        let url = null;
        if (ch === 'whatsapp') url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
        else if (ch === 'zalo') {
          url = `https://zalo.me/${digits}`;
          try { await navigator.clipboard.writeText(text); toast('Intro copied — paste it in Zalo', 'ok'); } catch { /* clipboard denied */ }
        } else if (ch === 'line') url = `https://line.me/R/ti/p/~${encodeURIComponent(l.line_id)}`;
        if (!url) return;
        window.open(url, '_blank', 'noopener');
        req('POST', `/api/leads/${id}/touch`, { channel: ch }).then(() => { changed(); });
      };
    });
    if ($('ch-line-add')) $('ch-line-add').onclick = async () => {
      const ans = await inputModal({
        title: 'Add LINE ID',
        fields: [{ key: 'line_id', label: 'LINE ID', placeholder: 'their LINE ID (not display name)', required: true }],
        confirmLabel: 'Save',
      });
      if (!ans) return;
      req('PATCH', `/api/leads/${id}`, { line_id: ans.line_id }).then(() => { toast('LINE ID saved', 'ok'); reopen(); });
    };
    if ($('ch-log')) $('ch-log').onclick = async () => {
      const ans = await inputModal({
        title: 'Log a channel touch',
        fields: [
          { key: 'channel', label: 'channel', value: defChan, placeholder: 'whatsapp · zalo · line · phone', required: true },
          { key: 'note', label: 'note', type: 'textarea', placeholder: 'optional' },
        ],
        confirmLabel: 'Log touch',
      });
      if (!ans) return;
      req('POST', `/api/leads/${id}/touch`, { channel: ans.channel.toLowerCase(), note: ans.note || undefined })
        .then(() => { toast('Touch logged', 'ok'); changed(); reopen(); });
    };
    if ($('d-brief')) $('d-brief').onclick = () => {
      const b = $('d-brief');
      b.disabled = true;
      b.textContent = 'analyzing website…';
      req('POST', `/api/leads/${id}/brief`)
        .then(() => { toast('Brief built', 'ok'); changed(); reopen(); })
        .catch(() => { b.disabled = false; b.textContent = '✦ Build brief'; });
    };
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
    if ($('dl-save') && deal) $('dl-save').onclick = async () => {
      const newStage = $('dl-stage') ? $('dl-stage').value : deal.stage;
      const body = {
        value_usd: $('dl-value').value.trim() ? parseInt($('dl-value').value.replace(/[^\d]/g, ''), 10) : null,
        expected_close: $('dl-close').value.trim() || null,
        next_step: $('dl-next').value.trim() || null,
      };
      if (newStage !== deal.stage) {
        body.stage = newStage;
        if (newStage === 'lost') {
          const ans = await inputModal({
            title: 'Mark deal as lost',
            fields: [{ key: 'reason', label: 'why lost', placeholder: 'e.g. budget cut, went with local vendor', required: true }],
            confirmLabel: 'Mark lost',
          });
          if (!ans) return;
          body.lost_reason = ans.reason;
        }
      }
      req('PATCH', `/api/deals/${deal.id}`, body).then(() => { toast('Deal saved', 'ok'); changed(); reopen(); });
    };
    document.querySelectorAll('.dl-task-done').forEach((b) => {
      b.onclick = () => req('POST', `/api/tasks/${b.dataset.task}/done`).then(() => { toast('Task done', 'ok'); changed(); reopen(); });
    });
    if ($('dl-task-add')) $('dl-task-add').onclick = async () => {
      const ans = await inputModal({
        title: `Task for ${l.company_name}`,
        fields: [
          { key: 'title', label: 'task', placeholder: 'e.g. Send portfolio deck', required: true },
          { key: 'due_at', label: 'due', type: 'date' },
        ],
        confirmLabel: 'Add task',
      });
      if (!ans) return;
      req('POST', '/api/tasks', { title: ans.title, lead_id: id, due_at: ans.due_at || undefined })
        .then(() => { toast('Task added', 'ok'); changed(); reopen(); });
    };
    if ($('re-send')) $('re-send').onclick = async () => {
      const subject = $('re-subject').value.trim();
      const body = $('re-body').value.trim();
      if (!subject || !body) { toast('Subject and body required', 'err'); return; }
      const go = await confirmModal({
        title: 'Send for real?',
        message: `This sends a real email to ${l.email || ''} from your connected inbox right now.`,
        confirmLabel: 'Send email',
      });
      if (!go) return;
      $('re-send').disabled = true;
      req('POST', `/api/leads/${id}/email`, { subject, body })
        .then(() => { toast(`Email sent to ${l.email}`, 'ok'); changed(); reopen(); })
        .catch(() => { const b = $('re-send'); if (b) b.disabled = false; });
    };
  }).catch(() => {});
}
