// Today — the home screen. Answers "what do I do right now" with zero clicks:
// needs-reply queue, calls due, tasks due/overdue, hot leads, KPI strip.
import { $, esc, req, toast, chip, classChip, statusChip, emptyHtml, skeletons, fmtDate, inputModal } from './core.js';
import { openLead, onLeadChange } from './drawer.js';
import { goTab } from './app.js';
import { focusThread } from './tab-inbox.js';

export const id = 'today';
export const title = 'Today';
export const icon = '☀';
export const hotkey = 't';

let registered = false;

export function render(root) {
  root.innerHTML = `<div id="kpis"></div><div id="today-body">${skeletons(4)}</div>`;
  if (!registered) { onLeadChange(() => { if ($('today-body')) load(); }); registered = true; }
  loadKpis();
  load();
}

function section(titleText, countHtml, bodyHtml) {
  return `<div class="card"><div class="cardtop"><b>${esc(titleText)}</b>${countHtml || ''}</div>${bodyHtml}</div>`;
}

function load() {
  req('GET', '/api/today').then((d) => {
    const el = $('today-body');
    if (!el) return;
    let h = '';

    // --- Needs reply ---
    const nr = d.needs_reply || [];
    h += section(
      'Needs reply',
      nr.length ? `<span class="chip${nr.some((r) => r.classification === 'interested') ? ' hot' : ''}">${nr.length}</span>` : '',
      nr.length
        ? nr.map((r) => `
          <div class="mailrow" data-lead="${r.lead_id}">
            <span class="mdir min">↓</span>
            <div class="mmain">
              <div class="mtop"><b>${esc(r.subject || '(no subject)')}</b>${r.classification ? classChip(r.classification) : ''}</div>
              <div class="msub">${esc(r.company_name)} · ${esc(r.lead_email || '')}</div>
              <div class="msnip">${esc((r.snippet || '').replace(/\s+/g, ' '))}</div>
            </div>
            <span class="mtime">${esc(fmtDate(r.created_at))}</span>
          </div>`).join('')
        : emptyHtml('Inbox zero — no replies waiting on you.'),
    );

    // --- Calls due ---
    const calls = d.calls_due || [];
    h += section(
      'Calls due',
      calls.length ? `<span class="chip hot">${calls.length}</span>` : '',
      calls.length
        ? `<div class="tablewrap"><table class="data"><tbody>${calls.map((l) => `
            <tr class="click" data-lead="${l.id}">
              <td class="pri">${esc(l.company_name)}</td>
              <td class="mono">${esc(l.phone || 'no phone on file')}</td>
              <td>${esc(l.city || '—')} · ${esc(l.country || '')}</td>
              <td>${statusChip(l.status)}</td>
              <td style="text-align:right"><button class="ghost row-open" data-lead="${l.id}">Open →</button></td>
            </tr>`).join('')}</tbody></table></div>`
        : emptyHtml('No calls due — silence hasn’t exhausted any sequence.'),
    );

    // --- Tasks ---
    const now = new Date().toISOString().slice(0, 10);
    const tasks = d.tasks || [];
    const dueTasks = tasks.filter((t) => !t.due_at || t.due_at.slice(0, 10) <= now);
    h += section(
      'Tasks',
      dueTasks.length ? `<span class="chip">${dueTasks.length}</span>` : '',
      tasks.length
        ? `<div class="tablewrap"><table class="data"><tbody>${tasks.map((t) => {
            const overdue = t.due_at && t.due_at.slice(0, 10) < now;
            return `<tr${t.lead_id ? ` class="click" data-lead="${t.lead_id}"` : ''}>
              <td><button class="ghost t-done" data-task="${t.id}" title="Mark done">◯</button></td>
              <td class="pri">${esc(t.title)}</td>
              <td>${t.company_name ? esc(t.company_name) : '—'}</td>
              <td class="mono" style="${overdue ? 'color:var(--hot)' : ''}">${t.due_at ? esc(fmtDate(t.due_at)) + (overdue ? ' · overdue' : '') : 'no due date'}</td>
              <td>${chip(t.source)}</td>
            </tr>`;
          }).join('')}</tbody></table></div>
          <div class="actions" style="margin-top:10px"><button id="t-add">+ New task</button></div>`
        : emptyHtml('No open tasks.') + '<div class="actions" style="margin-top:10px"><button id="t-add">+ New task</button></div>',
    );

    // --- Hot leads (hidden until fit scores exist) ---
    const hot = d.hot_leads || [];
    if (hot.length) {
      h += section(
        'Hot leads',
        `<span class="chip hot">${hot.length}</span>`,
        `<div class="tablewrap"><table class="data"><tbody>${hot.map((l) => `
          <tr class="click" data-lead="${l.id}">
            <td class="pri">${esc(l.company_name)}</td>
            <td>${esc(l.city || '—')} · ${esc(l.country || '')}</td>
            <td>${statusChip(l.status)}</td>
            <td class="mono" style="color:var(--hot)">fit ${l.fit_score}/5</td>
          </tr>`).join('')}</tbody></table></div>`,
      );
    }

    // --- Pipeline strip ---
    if (d.pipeline && d.pipeline.open_deals > 0) {
      h += section('Pipeline', '', `<div class="mono" style="font-size:14px">
        ${d.pipeline.open_deals} open deal${d.pipeline.open_deals === 1 ? '' : 's'}
        ${d.pipeline.open_value ? ` · $${Number(d.pipeline.open_value).toLocaleString()} open value` : ''}
        </div><div class="actions" style="margin-top:8px"><button id="t-pipe" class="ghost">View pipeline →</button></div>`);
    }

    el.innerHTML = h;

    el.querySelectorAll('[data-lead]').forEach((row) => {
      if (row.classList.contains('mailrow')) {
        // A reply belongs in the Inbox thread view, not the lead drawer.
        row.onclick = () => { focusThread(+row.dataset.lead); goTab('inbox'); };
      } else if (row.classList.contains('click')) {
        row.onclick = (e) => {
          if (e.target.closest('button')) return; // buttons handle themselves
          openLead(row.dataset.lead);
        };
      }
    });
    el.querySelectorAll('.row-open').forEach((b) => { b.onclick = () => openLead(b.dataset.lead); });
    el.querySelectorAll('.t-done').forEach((b) => {
      b.onclick = () => {
        b.disabled = true;
        req('POST', `/api/tasks/${b.dataset.task}/done`)
          .then(() => { toast('Task done', 'ok'); load(); })
          .catch(() => { b.disabled = false; });
      };
    });
    const addBtn = $('t-add');
    if (addBtn) addBtn.onclick = quickTask;
    const pipeBtn = $('t-pipe');
    if (pipeBtn) pipeBtn.onclick = () => goTab('pipeline');
  }).catch(() => {
    const el = $('today-body');
    if (el) el.innerHTML = emptyHtml('Could not load Today — check your connection and refresh.');
  });
}

async function quickTask() {
  const ans = await inputModal({
    title: 'New task',
    fields: [
      { key: 'title', label: 'task', placeholder: 'e.g. Follow up with Lotus Grand', required: true },
      { key: 'due_at', label: 'due', type: 'date' },
    ],
    confirmLabel: 'Add task',
  });
  if (!ans) return;
  req('POST', '/api/tasks', { title: ans.title, due_at: ans.due_at || undefined })
    .then(() => { toast('Task added', 'ok'); load(); });
}

export function keys(k) {
  if (k === 't') { quickTask(); return true; }
  return false;
}

function kpi(value, label, color) {
  return `<div class="kpi"><div class="v">${value}</div><div class="l">${
    color ? `<i style="background:${color}"></i>` : ''
  }${esc(label)}</div></div>`;
}

export function loadKpis() {
  req('GET', '/api/stats').then((s) => {
    if (!$('kpis')) return;
    const b = s.by_status || {};
    const tick = s.health && s.health.jobs ? s.health.jobs.tick : null;
    const mins = tick ? Math.round((Date.now() - new Date(tick).getTime()) / 60000) : null;
    const cronVal = mins === null ? '—' : mins < 1 ? 'now' : `${mins}m`;
    const cronCol = mins === null ? 'var(--t3)' : mins <= 20 ? 'var(--ok)' : 'var(--warn)';
    const errs = s.health ? s.health.errors_24h : 0;
    $('kpis').innerHTML =
      kpi(s.total, 'leads') +
      kpi(b.verified || 0, 'verified', 'var(--info)') +
      kpi(b.contacted || 0, 'contacted', 'var(--violet)') +
      kpi(b.interested || 0, 'interested', 'var(--hot)') +
      kpi(s.needs_call, 'needs call', 'var(--hot)') +
      kpi(s.sent_7d, 'sent · 7d') +
      kpi(s.replies_7d, 'replies · 7d') +
      kpi(`${s.sent_today}<small>/${s.daily_cap}</small>`, 'sent today') +
      kpi(cronVal, 'cron tick', cronCol) +
      kpi(errs, 'errors · 24h', errs > 0 ? 'var(--warn)' : 'var(--ok)');
  }).catch(() => {});
}
