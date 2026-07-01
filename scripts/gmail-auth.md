# Gmail OAuth setup (one-time)

Goal: obtain a **refresh token** for the dedicated outreach inbox with scopes
`gmail.send` + `gmail.readonly`, then store it as a Worker secret.

## 1. Create the OAuth client

1. Go to https://console.cloud.google.com/ and create (or pick) a project.
2. **APIs & Services → Library** → enable **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **Internal** if the inbox is on your own Google Workspace
     (recommended — no verification needed). Otherwise External + add the
     outreach inbox as a test user.
   - Scopes: add `https://www.googleapis.com/auth/gmail.send` and
     `https://www.googleapis.com/auth/gmail.readonly`.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:8765/callback`
5. Note the **Client ID** and **Client secret**.

## 2. Run the local helper script

Requires Node 18+. From the repo root:

```bash
node scripts/gmail-auth.mjs <CLIENT_ID> <CLIENT_SECRET>
```

The script prints a consent URL. Open it **in a browser logged in as the
outreach inbox** (not your personal account), approve, and the script catches
the redirect on localhost and prints your **refresh token**.

## 3. Store the secrets

```bash
wrangler secret put GMAIL_CLIENT_ID
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put GMAIL_REFRESH_TOKEN
wrangler secret put SENDER_EMAIL     # the outreach inbox address
wrangler secret put SENDER_NAME      # display name for outgoing mail
wrangler secret put RECAP_EMAIL      # where recaps + interested alerts go
```

Notes:
- The refresh token stays valid as long as the app isn't in "Testing" mode
  with an External consent screen (those expire after 7 days). Internal apps
  and published apps don't expire.
- If the token is ever revoked, re-run step 2.
