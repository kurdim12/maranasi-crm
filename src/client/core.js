// Core: api client, dom helpers, components. Every tab module imports from here.

export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---------- shared state ----------
export const state = {
  apiKey: null,          // only set when signed in via API key fallback
  user: null,
  tab: 'today',
  stats: null,
  onLogout: null,
};

// ---------- api ----------
export function req(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (state.apiKey) headers['X-API-Key'] = state.apiKey;
  return fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => {
    if (r.status === 401) {
      if (state.onLogout) state.onLogout('Session expired — sign in again.');
      throw new Error('unauthorized');
    }
    return r.json().then((data) => {
      if (!r.ok) {
        const msg = (data && data.error) || `request failed (${r.status})`;
        toast(msg, 'err');
        throw new Error(msg);
      }
      return data;
    });
  });
}

// ---------- toasts ----------
export function toast(msg, kind) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

// ---------- status chips ----------
export const STATUS_COLORS = {
  new: 'var(--t3)', enriched: 'var(--t2)', verified: 'var(--info)',
  contacted: 'var(--violet)', interested: 'var(--hot)', not_interested: 'var(--t3)',
  unresponsive_email: 'var(--warn)', opted_out: 'var(--warn)',
  invalid_email: 'var(--warn)', dropped: 'var(--t3)',
};

export function chip(label, color, extraClass) {
  return `<span class="chip${extraClass ? ' ' + extraClass : ''}">${
    color ? `<i style="background:${color}"></i>` : ''
  }${esc(label)}</span>`;
}

export function statusChip(status) {
  const hot = status === 'interested';
  return chip(status, STATUS_COLORS[status] || 'var(--t3)', hot ? 'hot' : '');
}

export function classChip(cls) {
  const color = cls === 'interested' ? 'var(--hot)'
    : cls === 'opt_out' || cls === 'bounce' ? 'var(--warn)'
    : cls === 'not_interested' ? 'var(--t3)'
    : cls === 'ooo' ? 'var(--info)' : 'var(--t3)';
  return chip(cls, color, cls === 'interested' ? 'hot' : '');
}

// ---------- empty state: one sentence + one action ----------
export function empty(sentence, actionLabel, onAction) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = `<div>${esc(sentence)}</div>`;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.textContent = actionLabel;
    btn.className = 'act';
    btn.onclick = onAction;
    const wrap = document.createElement('div');
    wrap.className = 'act';
    wrap.appendChild(btn);
    div.appendChild(wrap);
  }
  return div;
}

export function emptyHtml(sentence) {
  return `<div class="empty">${esc(sentence)}</div>`;
}

export function skeletons(n) {
  return Array.from({ length: n || 5 }, () => '<div class="skel"></div>').join('');
}

// ---------- segmented control ----------
export function segmented(options, value, onChange) {
  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const opt of options) {
    const b = document.createElement('button');
    b.textContent = opt.label;
    b.dataset.v = opt.value;
    if (opt.value === value) b.className = 'on';
    b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => (x.className = ''));
      b.className = 'on';
      onChange(opt.value);
    };
    seg.appendChild(b);
  }
  return seg;
}

// ---------- modal ----------
export function openModal(html) {
  $('modal').innerHTML = html;
  $('modal-wrap').classList.add('open');
}
export function closeModal() {
  $('modal-wrap').classList.remove('open');
}

// ---------- drawer host (content is provided by drawer.js) ----------
export function openDrawerHost() {
  $('drawer').classList.add('open');
  $('scrim').classList.add('open');
}
export function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('open');
}
export function isDrawerOpen() {
  return $('drawer').classList.contains('open');
}

// ---------- data table with j/k selection ----------
// cols: [{key, label, cls?, render?(row), sortable?}]
// Returns { el, setRows, moveSel, openSel, getSelRow }
export function dataTable(cols, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  let rows = [];
  let sel = -1;
  let sortKey = opts.sortKey || null;
  let sortDir = opts.sortDir || -1;

  function render() {
    const th = cols.map((c) =>
      `<th${c.sortable ? ` class="sortable" data-k="${c.key}"` : ''}>${esc(c.label)}${
        sortKey === c.key ? `<span class="dir">${sortDir > 0 ? '↑' : '↓'}</span>` : ''
      }</th>`).join('');
    const body = rows.map((r, i) =>
      `<tr class="click${i === sel ? ' sel' : ''}" data-i="${i}">${
        cols.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')
      }</tr>`).join('');
    wrap.innerHTML = `<table class="data"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
    wrap.querySelectorAll('tbody tr').forEach((tr) => {
      tr.onclick = () => { sel = +tr.dataset.i; render(); if (opts.onOpen) opts.onOpen(rows[sel]); };
    });
    wrap.querySelectorAll('th.sortable').forEach((h) => {
      h.onclick = () => {
        const k = h.dataset.k;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
        if (opts.onSort) opts.onSort(sortKey, sortDir);
        else { rows.sort((a, b) => ((a[k] ?? '') < (b[k] ?? '') ? sortDir : -sortDir)); render(); }
      };
    });
  }

  return {
    el: wrap,
    setRows(r, keepSel) { rows = r; if (!keepSel) sel = -1; render(); },
    moveSel(delta) {
      if (!rows.length) return;
      sel = Math.max(0, Math.min(rows.length - 1, sel + delta));
      render();
      const tr = wrap.querySelector('tr.sel');
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    },
    openSel() { if (sel >= 0 && opts.onOpen) opts.onOpen(rows[sel]); },
    getSelRow() { return sel >= 0 ? rows[sel] : null; },
  };
}

// ---------- misc formatters ----------
export function fmtDate(s) {
  return s ? String(s).slice(0, 16) : '—';
}
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
