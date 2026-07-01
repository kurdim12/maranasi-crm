#!/usr/bin/env node
// One-time helper: obtain a Gmail refresh token for the outreach inbox.
// Usage: node scripts/gmail-auth.mjs <CLIENT_ID> <CLIENT_SECRET>

import http from 'node:http';
import crypto from 'node:crypto';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/gmail-auth.mjs <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
].join(' ');
const state = crypto.randomBytes(16).toString('hex');

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even if previously authorized
    state,
  }).toString();

console.log('\n1. Open this URL in a browser logged in as the OUTREACH inbox:\n');
console.log(authUrl);
console.log('\n2. Approve access. Waiting for the redirect on localhost...\n');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('state mismatch');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(`error: ${url.searchParams.get('error') ?? 'no code'}`);
    return;
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
      }),
    });
    const data = await tokenRes.json();
    if (!tokenRes.ok || !data.refresh_token) {
      res.writeHead(500).end('Token exchange failed — see terminal.');
      console.error('\nToken exchange failed:', JSON.stringify(data, null, 2));
      if (!data.refresh_token && data.access_token) {
        console.error(
          '\nGot an access token but NO refresh token. Revoke prior access at',
          'https://myaccount.google.com/permissions and run this script again.',
        );
      }
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('Done. Check your terminal — you can close this tab.');
      console.log('\n=== SUCCESS ===');
      console.log('\nRefresh token:\n');
      console.log(data.refresh_token);
      console.log('\nStore it with: wrangler secret put GMAIL_REFRESH_TOKEN\n');
    }
  } catch (err) {
    res.writeHead(500).end('error');
    console.error(err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
