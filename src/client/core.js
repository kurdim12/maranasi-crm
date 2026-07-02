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
let modalCloseHook = null; // lets promise-based modals resolve on ANY close path (Esc, scrim)

export function openModal(html) {
  $('modal').innerHTML = html;
  $('modal-wrap').classList.add('open');
}
export function closeModal() {
  $('modal-wrap').classList.remove('open');
  if (modalCloseHook) { const fn = modalCloseHook; modalCloseHook = null; fn(); }
}

/**
 * Input modal — the design-system replacement for prompt().
 * fields: [{key, label, placeholder?, value?, type?('text'|'textarea'|'date'), required?}]
 * Resolves with {key: value, ...} on confirm, or null on cancel/Esc.
 */
export function inputModal({ title, fields, confirmLabel = 'Save', hint = '' }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    modalCloseHook = () => settle(null);

    openModal(`<h3>${esc(title)}</h3>
      ${fields.map((f) => `<div class="frow"><label>${esc(f.label)}</label>${
        f.type === 'textarea'
          ? `<textarea data-mkey="${esc(f.key)}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
          : `<input data-mkey="${esc(f.key)}" type="${f.type === 'date' ? 'date' : f.type === 'password' ? 'password' : 'text'}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.value || '')}">`
      }</div>`).join('')}
      ${hint ? `<div class="hint-bar">${esc(hint)}</div>` : ''}
      <div class="actions" style="margin-top:12px;justify-content:flex-end">
        <button id="im-cancel">Cancel</button>
        <button class="primary" id="im-ok">${esc(confirmLabel)}</button>
      </div>`);

    const inputs = [...$('modal').querySelectorAll('[data-mkey]')];
    const submit = () => {
      const out = {};
      for (const el of inputs) {
        const f = fields.find((x) => x.key === el.dataset.mkey);
        const v = el.value.trim();
        if (f && f.required && !v) { el.focus(); el.style.borderColor = 'var(--warn)'; return; }
        out[el.dataset.mkey] = v;
      }
      modalCloseHook = null;
      closeModal();
      settle(out);
    };
    $('im-ok').onclick = submit;
    $('im-cancel').onclick = () => closeModal();
    inputs.forEach((el) => {
      if (el.tagName !== 'TEXTAREA') el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    });
    if (inputs[0]) inputs[0].focus();
  });
}

/**
 * Confirm modal — the design-system replacement for confirm().
 * Resolves true on confirm, false on cancel/Esc.
 */
export function confirmModal({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    modalCloseHook = () => settle(false);

    openModal(`<h3>${esc(title)}</h3>
      <p style="color:var(--t2);margin:0 0 14px">${esc(message)}</p>
      <div class="actions" style="justify-content:flex-end">
        <button id="cm-cancel">Cancel</button>
        <button class="${danger ? 'danger' : 'primary'}" id="cm-ok">${esc(confirmLabel)}</button>
      </div>`);
    const ok = $('cm-ok');
    ok.onclick = () => { modalCloseHook = null; closeModal(); settle(true); };
    $('cm-cancel').onclick = () => closeModal();
    ok.focus();
  });
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
