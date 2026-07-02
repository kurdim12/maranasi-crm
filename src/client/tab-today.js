// Today — the home tab. Full version lands in P1; P0 ships the shell with
// the KPI strip so the app opens on something useful.
import { $, esc, req, empty } from './core.js';
import { goTab } from './app.js';

export const id = 'today';
export const title = 'Today';
export const icon = '☀';
export const hotkey = 't';

export function render(root) {
  root.innerHTML = '<div id="kpis"></div><div id="today-body"></div>';
  loadKpis();
  $('today-body').appendChild(
    empty('Your action queue arrives in the next phase — Inbox already has your replies.', 'Open Inbox', () => goTab('inbox')),
  );
}

function kpi(value, label, color) {
  return `<div class="kpi"><div class="v">${value}</div><div class="l">${
    color ? `<i style="background:${color}"></i>` : ''
  }${esc(label)}</div></div>`;
}

export function loadKpis() {
  const el = $('kpis');
  if (!el) return;
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
