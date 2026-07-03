// Contacts repo layer. Invariants owned here:
//  1. Exactly one primary contact per lead (backed by a partial unique index).
//  2. leads.email stays the sequence target, synced FROM the primary contact —
//     an email change resets verification so nothing unverified gets sequenced.
//  3. The primary contact cannot be deleted (promote another one first).
import { logActivity } from './activity';

export interface Contact {
  id: number;
  lead_id: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  line_id: string | null;
  is_primary: number;
  created_at: string;
}

export async function listContacts(db: D1Database, leadId: number): Promise<Contact[]> {
  const rows = await db
    .prepare('SELECT * FROM contacts WHERE lead_id = ? ORDER BY is_primary DESC, id')
    .bind(leadId)
    .all<Contact>();
  return rows.results;
}

export async function addContact(
  db: D1Database,
  leadId: number,
  fields: { name: string; title?: string | null; email?: string | null; phone?: string | null; line_id?: string | null },
): Promise<{ id: number; becamePrimary: boolean }> {
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE lead_id = ?').bind(leadId).first<{ n: number }>();
  const becamePrimary = (existing?.n ?? 0) === 0;
  const row = await db
    .prepare(
      'INSERT INTO contacts (lead_id, name, title, email, phone, line_id, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .bind(
      leadId,
      fields.name.trim(),
      fields.title?.trim() || null,
      fields.email?.trim().toLowerCase() || null,
      fields.phone?.trim() || null,
      fields.line_id?.trim() || null,
      becamePrimary ? 1 : 0,
    )
    .first<{ id: number }>();
  await logActivity(db, 'owner', 'contact_added', leadId, { contact_id: row!.id, name: fields.name, primary: becamePrimary });
  if (becamePrimary) await syncPrimaryToLead(db, leadId, row!.id);
  return { id: row!.id, becamePrimary };
}

/**
 * Make a contact the primary. Returns emailChanged so the caller can re-run
 * verification (verification talks to the network — not this layer's job).
 */
export async function setPrimary(db: D1Database, contactId: number): Promise<{ leadId: number; emailChanged: boolean }> {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first<Contact>();
  if (!contact) throw new Error(`contact ${contactId} not found`);
  // Clear-then-set keeps the partial unique index happy.
  await db.prepare('UPDATE contacts SET is_primary = 0 WHERE lead_id = ? AND is_primary = 1').bind(contact.lead_id).run();
  await db.prepare('UPDATE contacts SET is_primary = 1 WHERE id = ?').bind(contactId).run();
  const emailChanged = await syncPrimaryToLead(db, contact.lead_id, contactId);
  await logActivity(db, 'owner', 'contact_set_primary', contact.lead_id, { contact_id: contactId, email_changed: emailChanged });
  return { leadId: contact.lead_id, emailChanged };
}

export async function updateContact(
  db: D1Database,
  contactId: number,
  fields: Partial<{ name: string; title: string; email: string; phone: string; line_id: string }>,
): Promise<{ leadId: number; emailChanged: boolean }> {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first<Contact>();
  if (!contact) throw new Error(`contact ${contactId} not found`);
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['name', 'title', 'email', 'phone', 'line_id'] as const) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      const v = fields[key];
      binds.push(key === 'email' ? v?.trim().toLowerCase() || null : v?.trim() || null);
    }
  }
  if (sets.length) {
    await db.prepare(`UPDATE contacts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, contactId).run();
  }
  let emailChanged = false;
  if (contact.is_primary) emailChanged = await syncPrimaryToLead(db, contact.lead_id, contactId);
  await logActivity(db, 'owner', 'contact_updated', contact.lead_id, { contact_id: contactId, fields: Object.keys(fields) });
  return { leadId: contact.lead_id, emailChanged };
}

export async function deleteContact(db: D1Database, contactId: number): Promise<{ ok: true } | { error: string }> {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first<Contact>();
  if (!contact) return { error: 'contact not found' };
  if (contact.is_primary) return { error: 'This is the primary contact — make another contact primary first.' };
  await db.prepare('DELETE FROM contacts WHERE id = ?').bind(contactId).run();
  await logActivity(db, 'owner', 'contact_deleted', contact.lead_id, { contact_id: contactId, name: contact.name });
  return { ok: true };
}

/**
 * Mirror the primary contact into the lead's flat fields. leads.email only
 * changes to a non-null contact email; when it changes, email_status resets
 * to 'unverified' so the sequence engine won't touch the lead until the
 * caller re-verifies. Returns whether the email changed.
 */
export async function syncPrimaryToLead(db: D1Database, leadId: number, contactId: number): Promise<boolean> {
  const contact = await db.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first<Contact>();
  const lead = await db.prepare('SELECT id, email FROM leads WHERE id = ?').bind(leadId).first<{ id: number; email: string | null }>();
  if (!contact || !lead) return false;
  const newEmail = contact.email || lead.email; // never null out the sequence target
  const emailChanged = !!newEmail && newEmail !== lead.email;
  await db
    .prepare(
      `UPDATE leads SET contact_name = ?, phone = COALESCE(?, phone), line_id = COALESCE(?, line_id),
         email = ?, email_status = CASE WHEN ? THEN 'unverified' ELSE email_status END,
         updated_at = datetime('now')
       WHERE id = ?`,
    )
    .bind(contact.name, contact.phone, contact.line_id, newEmail, emailChanged ? 1 : 0, leadId)
    .run();
  return emailChanged;
}
