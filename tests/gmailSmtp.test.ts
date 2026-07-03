import { describe, expect, it } from 'vitest';
import { asD1, createTestDb } from './helpers/d1lite';
import { gmailConfigured, gmailThreadReplyHeaders, oauthConfigured, smtpConfigured } from '../src/lib/gmail';
import type { Env } from '../src/env';

const MIGRATIONS = ['0001_init.sql'];

function env(overrides: Partial<Env>): Env {
  return overrides as Env;
}

describe('gmail transports: app-password SMTP alongside OAuth', () => {
  it('configured flags: either transport enables sending, only OAuth enables watching', () => {
    const none = env({});
    const smtpOnly = env({ SENDER_EMAIL: 'hi@maranasi.com', GMAIL_APP_PASSWORD: 'abcdabcdabcdabcd' });
    const oauthOnly = env({ GMAIL_CLIENT_ID: 'a', GMAIL_CLIENT_SECRET: 'b', GMAIL_REFRESH_TOKEN: 'c' });
    expect(gmailConfigured(none)).toBe(false);
    expect(gmailConfigured(smtpOnly)).toBe(true);
    expect(gmailConfigured(oauthOnly)).toBe(true);
    expect(oauthConfigured(smtpOnly)).toBe(false); // watcher must stay off
    expect(smtpConfigured(oauthOnly)).toBe(false);
    // App password without a sender address is NOT enough — SMTP needs both.
    expect(smtpConfigured(env({ GMAIL_APP_PASSWORD: 'abcdabcdabcdabcd' }))).toBe(false);
  });

  it('SMTP mode rebuilds reply headers from our own Message-IDs only', async () => {
    const db = createTestDb(MIGRATIONS);
    db.raw
      .prepare("INSERT INTO leads (company_name, email, email_status, status) VALUES ('T', 't@t.vn', 'verified', 'contacted')")
      .run();
    const ins = db.raw.prepare(
      'INSERT INTO email_log (lead_id, direction, gmail_message_id, gmail_thread_id, dry_run) VALUES (1, ?, ?, ?, ?)',
    );
    ins.run('out', '<mo-1@maranasi.com>', '<mo-1@maranasi.com>', 0);
    ins.run('out', 'a1b2c3hexid', '<mo-1@maranasi.com>', 0); // REST-era opaque id — not a Message-ID
    ins.run('out', '<mo-2@maranasi.com>', '<mo-1@maranasi.com>', 0);
    ins.run('out', '<mo-dry@maranasi.com>', '<mo-1@maranasi.com>', 1); // dry run — excluded
    ins.run('out', '<other@maranasi.com>', '<other-thread>', 0); // different thread

    const smtpEnv = env({ SENDER_EMAIL: 'hi@maranasi.com', GMAIL_APP_PASSWORD: 'abcdabcdabcdabcd' });
    const h = await gmailThreadReplyHeaders(smtpEnv, '<mo-1@maranasi.com>', asD1(db as never));
    expect(h.inReplyTo).toBe('<mo-2@maranasi.com>');
    expect(h.references).toBe('<mo-1@maranasi.com> <mo-2@maranasi.com>');
  });

  it('SMTP mode returns no headers when the db is missing or the thread is unknown', async () => {
    const db = createTestDb(MIGRATIONS);
    const smtpEnv = env({ SENDER_EMAIL: 'hi@maranasi.com', GMAIL_APP_PASSWORD: 'abcdabcdabcdabcd' });
    expect(await gmailThreadReplyHeaders(smtpEnv, '<x@y>')).toEqual({});
    expect(await gmailThreadReplyHeaders(smtpEnv, '<x@y>', asD1(db as never))).toEqual({});
  });
});
