import { describe, expect, it } from 'vitest';
import { asD1, createTestDb } from './helpers/d1lite';
import { addContact, deleteContact, listContacts, setPrimary, updateContact } from '../src/lib/contacts';

const MIGRATIONS = ['0001_init.sql', '0003_users.sql', '0004_v2_pipeline.sql', '0005_contacts_ownership.sql'];

function newLead(db: ReturnType<typeof createTestDb>): number {
  db.raw
    .prepare("INSERT INTO leads (company_name, email, email_status, status) VALUES ('Contact Test Co', 'first@co.vn', 'verified', 'contacted')")
    .run();
  return Number(db.raw.prepare('SELECT last_insert_rowid() AS id').get()!.id);
}

describe('contacts: primary invariant + email sync (C1)', () => {
  it('first contact becomes primary and syncs to the lead', async () => {
    const db = createTestDb(MIGRATIONS);
    const leadId = newLead(db);
    const a = await addContact(asD1(db as never), leadId, { name: 'Anh', email: 'anh@co.vn', phone: '+84 9' });
    expect(a.becamePrimary).toBe(true);
    const lead = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)!;
    expect(lead.contact_name).toBe('Anh');
    expect(lead.email).toBe('anh@co.vn');
    expect(lead.email_status).toBe('unverified'); // email changed → must re-verify
  });

  it('exactly one primary per lead — setPrimary flips atomically', async () => {
    const db = createTestDb(MIGRATIONS);
    const leadId = newLead(db);
    await addContact(asD1(db as never), leadId, { name: 'Anh', email: 'anh@co.vn' });
    const b = await addContact(asD1(db as never), leadId, { name: 'Binh', email: 'binh@co.vn' });
    expect(b.becamePrimary).toBe(false);
    const { emailChanged } = await setPrimary(asD1(db as never), b.id);
    expect(emailChanged).toBe(true);
    const contacts = await listContacts(asD1(db as never), leadId);
    expect(contacts.filter((c) => c.is_primary).map((c) => c.name)).toEqual(['Binh']);
    const lead = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)!;
    expect(lead.email).toBe('binh@co.vn');
    expect(lead.email_status).toBe('unverified');
  });

  it('a 3-contact lead keeps sequencing only the primary email', async () => {
    const db = createTestDb(MIGRATIONS);
    const leadId = newLead(db);
    await addContact(asD1(db as never), leadId, { name: 'Anh', email: 'anh@co.vn' });
    await addContact(asD1(db as never), leadId, { name: 'Binh', email: 'binh@co.vn' });
    await addContact(asD1(db as never), leadId, { name: 'Chi', email: 'chi@co.vn' });
    // The sequence target IS leads.email — assert it matches the primary only.
    const lead = db.raw.prepare('SELECT email FROM leads WHERE id = ?').get(leadId)!;
    expect(lead.email).toBe('anh@co.vn');
  });

  it('primary contact cannot be deleted; secondary can', async () => {
    const db = createTestDb(MIGRATIONS);
    const leadId = newLead(db);
    const a = await addContact(asD1(db as never), leadId, { name: 'Anh', email: 'anh@co.vn' });
    const b = await addContact(asD1(db as never), leadId, { name: 'Binh' });
    expect(await deleteContact(asD1(db as never), a.id)).toEqual({ error: expect.stringContaining('primary') });
    expect(await deleteContact(asD1(db as never), b.id)).toEqual({ ok: true });
  });

  it('editing the primary email re-syncs and resets verification; secondary edits do not', async () => {
    const db = createTestDb(MIGRATIONS);
    const leadId = newLead(db);
    const a = await addContact(asD1(db as never), leadId, { name: 'Anh', email: 'anh@co.vn' });
    const b = await addContact(asD1(db as never), leadId, { name: 'Binh', email: 'binh@co.vn' });
    db.raw.prepare("UPDATE leads SET email_status = 'verified' WHERE id = ?").run(leadId);

    const secondary = await updateContact(asD1(db as never), b.id, { email: 'new-binh@co.vn' });
    expect(secondary.emailChanged).toBe(false);
    expect(db.raw.prepare('SELECT email_status FROM leads WHERE id = ?').get(leadId)!.email_status).toBe('verified');

    const primary = await updateContact(asD1(db as never), a.id, { email: 'anh-new@co.vn' });
    expect(primary.emailChanged).toBe(true);
    const lead = db.raw.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)!;
    expect(lead.email).toBe('anh-new@co.vn');
    expect(lead.email_status).toBe('unverified');
  });
});
