// The dashboard shell: static chrome only — all logic lives in the client
// modules served from /assets (src/client/**). Holds no data; safe to serve
// unauthenticated (the API behind it requires a session or API key).
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Maranasi Outreach</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>

<div id="login">
  <div class="card">
    <h1>MARANASI <span style="color:var(--info)">OUTREACH</span></h1>
    <p>Sign in to continue.</p>
    <div id="login-form">
      <input type="text" id="login-user" placeholder="Username" autocomplete="username" autofocus>
      <input type="password" id="login-pass" placeholder="Password" autocomplete="current-password">
      <button class="primary" id="login-btn">Sign in</button>
      <div class="alt"><a href="#" id="login-alt">Use the admin API key instead</a></div>
    </div>
    <div id="login-keyform" style="display:none">
      <input type="password" id="login-key" placeholder="Admin API key">
      <button class="primary" id="login-key-btn">Unlock</button>
      <div class="alt"><a href="#" id="login-back">Back to username sign-in</a></div>
    </div>
    <div class="err" id="login-err"></div>
  </div>
</div>

<div id="app">
  <header class="top">
    <div class="brand">MARANASI <span>OUTREACH</span></div>
    <span class="mode-badge test" id="b-mode">…</span>
    <div class="spacer"></div>
    <button id="btn-scrape" class="ghost" title="Run lead sourcing now">▶ Scrape</button>
    <button id="btn-pause" class="danger" title="Pause all sending">⏸ Pause</button>
    <button id="btn-resume" class="good" style="display:none" title="Resume sending">▶ Resume</button>
    <button id="btn-refresh" class="ghost" title="Refresh (or press g then tab key)" aria-label="Refresh">↻</button>
    <button id="chat-toggle" class="ghost" title="CRM agent" aria-label="Toggle CRM agent chat">✦</button>
    <span class="chip" id="b-user"></span>
    <button id="btn-passwd" class="ghost" style="display:none" title="Change my password">Password</button>
    <button id="btn-logout" class="ghost">Sign out</button>
  </header>

  <nav class="tabs" id="tabbar" aria-label="Sections"></nav>
  <main id="view"></main>
</div>

<nav id="bottombar" aria-label="Sections"></nav>

<aside id="chat" aria-label="CRM agent">
  <div class="chat-head">
    <b style="flex:1">CRM agent</b>
    <button id="chat-clear" class="ghost">Clear</button>
    <button id="chat-close" class="ghost" aria-label="Close chat">✕</button>
  </div>
  <div id="chat-log"></div>
  <div id="chat-chips">
    <button data-q="Give me the weekly recap.">Weekly recap</button>
    <button data-q="Who needs a call?">Who needs a call?</button>
    <button data-q="Show me pipeline stats.">Pipeline stats</button>
  </div>
  <div id="chat-form">
    <textarea id="chat-text" placeholder="Ask the CRM agent… (Enter to send)" aria-label="Message the CRM agent"></textarea>
    <button class="primary" id="chat-send">Send</button>
  </div>
</aside>
<button id="chat-fab" aria-label="Open CRM agent">✦</button>

<div id="scrim"></div>
<aside id="drawer" aria-label="Lead details"></aside>

<div id="modal-wrap"><div id="modal"></div></div>

<div id="palette-wrap"><div id="palette">
  <input id="pal-input" type="text" placeholder="Search leads, jump, run an action…" autocomplete="off" aria-label="Command palette search">
  <div id="pal-list"></div>
</div></div>

<div id="toasts" role="status" aria-live="polite"></div>

<script type="module" src="/assets/app.js"></script>
</body>
</html>`;
