// Analytics — pipeline funnel, outreach rates, daily send/reply chart, leads
// by country. Ported 1:1 from v1's Analytics tab (renderAnalyticsTab / hbar /
// dailyChart in dashboard.ts). Zero behavior change: same GET /api/analytics
// payload ({ funnel, others, daily, rates, by_country }), same rows and math.
// Nothing on this tab is "hot" — no amber anywhere, per the design system.
import { $, esc, req, skeletons, emptyHtml } from './core.js';
import { onLeadChange } from './drawer.js';

export const id = 'analytics';
export const title = 'Analytics';
export const icon = '◫';
export const hotkey = 'a';

// Ordinal blue ramp for the ordered funnel steps, light -> dark (info-blue family).
const RAMP = ['#8fb9e2', '#6fa8da', '#5b9dd9', '#4b83b6', '#3a6890'];

export function render(root) {
  root.innerHTML = `<div class="an-grid" id="an-grid">
    <div class="card">${skeletons(6)}</div>
    <div class="card">${skeletons(5)}</div>
    <div class="card">${skeletons(4)}</div>
    <div class="card">${skeletons(6)}</div>
  </div>`;
  load();
}

// Drawer edits can change a lead's status/country — refresh if we're mounted.
onLeadChange(() => { if ($('an-grid')) load(); });

function load() {
  req('GET', '/api/analytics').then((a) => {
    const grid = $('an-grid');
    if (!grid) return; // tab changed while in flight
    grid.innerHTML = funnelCard(a) + ratesCard(a) + dailyCard(a) + countryCard(a) + roiCard(a) + heatmapCard(a) + variantsCard(a);
  }).catch(() => {});
}

function hbar(label, value, max, color) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return `<div class="bar-row"><div class="lbl">${esc(label)}</div>
    <div class="track"><div class="bar" style="width:${pct}%;background:${color}" title="${esc(label)}: ${value}"></div>
    <span class="val num">${value}</span></div></div>`;
}

function funnelCard(a) {
  const funnel = a.funnel || [];
  const maxF = Math.max(...funnel.map((f) => f.n), 1);
  const bars = funnel.map((f, i) => hbar(f.status, f.n, maxF, RAMP[i] || RAMP[4])).join('');
  const others = a.others || {};
  const otherTotal = Object.keys(others).reduce((s, k) => s + others[k], 0);
  const exited = Object.keys(others)
    .map((k) => `${esc(k)} <span class="num">${others[k]}</span>`)
    .join(' · ');
  return `<div class="card">
    <div class="cardtop"><b>Pipeline funnel</b></div>
    ${bars}
    <div class="hint" style="margin-top:8px">exited: ${exited} (<span class="num">${otherTotal}</span> total)</div>
  </div>`;
}

function ratesCard(a) {
  const r = a.rates || {};
  const bounceRate = r.bounce_rate || 0;
  return `<div class="card">
    <div class="cardtop"><b>Outreach performance (all time)</b></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px">
      <div class="kpi"><div class="v num">${r.sent || 0}</div><div class="l">emails sent</div></div>
      <div class="kpi"><div class="v num">${r.replies || 0}</div><div class="l">real replies</div></div>
      <div class="kpi"><div class="v num">${r.reply_rate || 0}%</div><div class="l"><i style="background:var(--ok)"></i>reply rate</div></div>
      <div class="kpi"><div class="v num">${bounceRate}%</div><div class="l"><i style="background:${bounceRate > 3 ? 'var(--warn)' : 'var(--ok)'}"></i>bounce rate</div></div>
      <div class="kpi"><div class="v num">${r.interested || 0}</div><div class="l"><i style="background:var(--ok)"></i>interested</div></div>
      ${r.win_rate !== null && r.win_rate !== undefined
        ? `<div class="kpi"><div class="v num">${r.win_rate}%</div><div class="l"><i style="background:var(--ok)"></i>win rate (${r.won}W/${r.lost}L)</div></div>`
        : ''}
    </div>
    <div class="hint" style="margin-top:8px">Bounce rate above 3% auto-pauses sending.</div>
  </div>`;
}

function dailyCard(a) {
  return `<div class="card">
    <div class="cardtop"><b>Last 30 days — sent vs replies</b></div>
    <div class="legend"><span><i style="background:var(--info)"></i>sent</span><span><i style="background:var(--ok)"></i>replies</span></div>
    ${dailyChart(a.daily || [])}
  </div>`;
}

function dailyChart(daily) {
  if (!daily.length) return emptyHtml('No email activity yet.');
  // Fill the last 30 days so gaps render as zero.
  const byDay = {};
  daily.forEach((d) => { byDay[d.d] = d; });
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const row = byDay[dt] || { sent: 0, replies: 0 };
    days.push({ d: dt, sent: row.sent || 0, replies: row.replies || 0 });
  }
  const W = 640, H = 150, PAD = 6;
  const max = Math.max(...days.map((x) => Math.max(x.sent, x.replies)), 1);
  const bw = (W - PAD * 2) / days.length;
  let svg = `<svg viewBox="0 0 ${W} ${H + 22}" style="width:100%;height:auto" role="img" aria-label="sent vs replies per day, last 30 days">`;
  // Recessive gridlines at 0%, 50%, 100%.
  [0, 0.5, 1].forEach((g) => {
    const y = H - g * (H - 10);
    svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="var(--line2)" stroke-width="1"/>`;
    svg += `<text x="2" y="${y - 3}" fill="var(--t3)" font-size="9">${Math.round(g * max)}</text>`;
  });
  days.forEach((x, i) => {
    const cx = PAD + i * bw;
    const hS = Math.round((x.sent / max) * (H - 10));
    const hR = Math.round((x.replies / max) * (H - 10));
    const w = Math.max(3, bw * 0.36);
    svg += `<rect x="${cx}" y="${H - hS}" width="${w}" height="${hS}" rx="1.5" fill="var(--info)"><title>${esc(x.d)} — sent ${x.sent}</title></rect>`;
    svg += `<rect x="${cx + w + 1.5}" y="${H - hR}" width="${w}" height="${hR}" rx="1.5" fill="var(--ok)"><title>${esc(x.d)} — replies ${x.replies}</title></rect>`;
    if (i % 7 === 0) svg += `<text x="${cx}" y="${H + 14}" fill="var(--t3)" font-size="9">${esc(x.d.slice(5))}</text>`;
  });
  svg += '</svg>';
  return svg;
}

function countryCard(a) {
  const byCountry = a.by_country || [];
  const maxC = Math.max(...byCountry.map((x) => x.total), 1);
  const bars = byCountry
    .map((x) => hbar(x.country + (x.interested ? ` (★${x.interested})` : ''), x.total, maxC, 'var(--ok)'))
    .join('');
  return `<div class="card">
    <div class="cardtop"><b>Leads by country</b></div>
    ${bars || emptyHtml('No leads yet.')}
    ${byCountry.length ? '<div class="hint" style="margin-top:6px">★ = interested leads in that country</div>' : ''}
  </div>`;
}

// ---------- P6: source ROI ----------
function roiCard(a) {
  const rows = a.roi || [];
  if (!rows.length) return '';
  const pct = (n, d) => (d ? Math.round((n / d) * 100) + '%' : '—');
  return `<div class="card" style="grid-column:1/-1">
    <div class="cardtop"><b>Source ROI</b><span class="hint">which category × city cohorts convert — spend scrape budget there</span></div>
    <div class="tablewrap"><table class="data"><thead><tr>
      <th>Category</th><th>City</th><th>Leads</th><th>Verified</th><th>Replied</th><th>Interested</th><th>Won</th><th>Lead→reply</th><th>Reply→interested</th>
    </tr></thead><tbody>${rows.map((r) => `
      <tr><td class="pri">${esc(r.category)}</td><td>${esc(r.city)}</td>
      <td class="num">${r.leads}</td><td class="num">${r.verified}</td><td class="num">${r.replied}</td>
      <td class="num"${r.interested ? ' style="color:var(--hot)"' : ''}>${r.interested}</td>
      <td class="num"${r.won ? ' style="color:var(--ok)"' : ''}>${r.won}</td>
      <td class="num">${pct(r.replied, r.leads)}</td><td class="num">${pct(r.interested, r.replied)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ---------- P6: reply-time heatmap ----------
function heatmapCard(a) {
  const cells = a.heatmap || [];
  if (!cells.length) return '';
  const byKey = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.n]));
  const max = Math.max(...cells.map((c) => c.n));
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let h = '<div style="display:grid;grid-template-columns:34px repeat(24,minmax(8px,1fr));gap:2px;overflow-x:auto">';
  h += '<span></span>' + Array.from({ length: 24 }, (_, i) => `<span class="mono" style="font-size:9px;color:var(--t3);text-align:center">${i % 6 === 0 ? i : ''}</span>`).join('');
  for (let d = 0; d < 7; d++) {
    h += `<span class="mono" style="font-size:10px;color:var(--t3)">${DAYS[d]}</span>`;
    for (let hr = 0; hr < 24; hr++) {
      const n = byKey.get(`${d}-${hr}`) || 0;
      const alpha = n ? 0.15 + 0.85 * (n / max) : 0;
      h += `<span title="${DAYS[d]} ${hr}:00 lead-local — ${n} repl${n === 1 ? 'y' : 'ies'}" style="height:14px;border-radius:2px;background:${n ? `rgba(91,157,217,${alpha.toFixed(2)})` : 'var(--bg2)'}"></span>`;
    }
  }
  h += '</div>';
  return `<div class="card" style="grid-column:1/-1"><div class="cardtop"><b>When they reply</b><span class="hint">weekday × hour, lead-local (ICT)</span></div>${h}</div>`;
}

// ---------- P6: A/B variant performance ----------
function variantsCard(a) {
  const rows = a.variants || [];
  if (!rows.length) return '';
  return `<div class="card">
    <div class="cardtop"><b>A/B variants</b><span class="hint">manage variants under System → Templates</span></div>
    <div class="tablewrap"><table class="data"><thead><tr><th>Step</th><th>Variant</th><th>Sent</th><th>Replied</th><th>Reply %</th></tr></thead><tbody>${
      rows.map((v) => `<tr><td class="num">${v.sequence_step}</td><td class="pri mono">${esc(v.variant_label)}</td>
        <td class="num">${v.sent}</td><td class="num">${v.replied}</td>
        <td class="num">${v.sent ? Math.round((v.replied / v.sent) * 100) : 0}%</td></tr>`).join('')
    }</tbody></table></div></div>`;
}
