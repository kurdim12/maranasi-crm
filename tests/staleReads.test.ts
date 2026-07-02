import { describe, expect, it } from 'vitest';
import { asD1, createTestDb } from './helpers/d1lite';
import { transitionLead } from '../src/lib/stateMachine';
import { manualSendGuard } from '../src/lib/sendGuards';
import type { Lead } from '../src/env';

function insertLead(db: ReturnType<typeof createTestDb>, over: Partial<Record<string, unknown>> = {}): number {
  const row = {
    company_name: 'Gate Test Co',
    email: 'gate@test-co.vn',
    status: 'unresponsive_email',
    phone_status: 'reached',
    ...over,
  };
  const cols = Object.keys(row).join(', ');
  const marks = Object.keys(row).map(() => '?').join(', ');
  db.raw
    .prepare(`INSERT INTO leads (${cols}) VALUES (${marks})`)
    .run(...(Object.values(row) as never[]));
  return Number(db.raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
}

function leadRow(db: ReturnType<typeof createTestDb>, id: number): Lead {
  return db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(id) as unknown as Lead;
}

describe('drop gate reads live state, never the caller snapshot (A3)', () => {
  it('rejects a drop when a stale snapshot claims unresponsive but the row moved on', async () => {
    const db = createTestDb();
    const id = insertLead(db, { phone_status: 'reached' });
    // Simulate the agent holding an outdated snapshot from an earlier turn.
    const stale = { ...leadRow(db, id), phone_status: 'unresponsive' } as Lead;
    await expect(
      transitionLead(asD1(db as never), stale, 'dropped', { actor: 'crm_agent', dropReason: 'test' }),
    ).rejects.toThrow(/phone_status = unresponsive/);
    expect(leadRow(db, id).status).toBe('unresponsive_email'); // untouched
  });

  it('rejects a drop without a logged call even when phone_status is unresponsive', async () => {
    const db = createTestDb();
    const id = insertLead(db, { phone_status: 'unresponsive' });
    await expect(
      transitionLead(asD1(db as never), leadRow(db, id), 'dropped', { actor: 'crm_agent', dropReason: 'test' }),
    ).rejects.toThrow(/no logged call/);
  });

  it('allows the drop once the live row and a call log both say unresponsive', async () => {
    const db = createTestDb();
    const id = insertLead(db, { phone_status: 'unresponsive' });
    db.raw
      .prepare("INSERT INTO activities (actor, action, lead_id, detail) VALUES ('owner', 'call_outcome', ?, ?)")
      .run(id, JSON.stringify({ outcome: 'unresponsive' }));
    // Even a stale snapshot (wrong phone_status) succeeds now — the gate judges live state.
    const stale = { ...leadRow(db, id), phone_status: 'reached' } as Lead;
    await transitionLead(asD1(db as never), stale, 'dropped', { actor: 'crm_agent', dropReason: 'unreachable' });
    expect(leadRow(db, id).status).toBe('dropped');
    expect(leadRow(db, id).drop_reason).toBe('unreachable');
  });
});

describe('manual send guard messages (A2)', () => {
  const base = { id: 1, email: 'x@real.vn', source: 'places' } as unknown as Lead;
  it('refuses demo leads with the explicit message', () => {
    const demo = { ...base, source: 'demo' } as Lead;
    expect(manualSendGuard(demo, false)?.error).toMatch(/Demo leads can't be emailed/);
    const example = { ...base, email: 'a@b.example.com' } as Lead;
    expect(manualSendGuard(example, false)?.error).toMatch(/Demo leads/);
  });
  it('refuses suppressed addresses with the explicit message', () => {
    expect(manualSendGuard(base, true)?.error).toMatch(/suppression list/);
    expect(manualSendGuard(base, true)?.status).toBe(403);
  });
  it('passes a normal lead', () => {
    expect(manualSendGuard(base, false)).toBeNull();
  });
});
