export type Actor = 'system' | 'crm_agent' | 'owner';

export async function logActivity(
  db: D1Database,
  actor: Actor,
  action: string,
  leadId?: number | null,
  detail?: unknown,
): Promise<void> {
  await db
    .prepare('INSERT INTO activities (actor, action, lead_id, detail) VALUES (?, ?, ?, ?)')
    .bind(actor, action, leadId ?? null, detail === undefined ? null : JSON.stringify(detail))
    .run();
}

export async function logError(db: D1Database, where: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? `${err.message}` : String(err);
  console.error(`[error] ${where}: ${message}`);
  try {
    await logActivity(db, 'system', 'error', null, { where, message });
  } catch {
    // never let error logging crash the caller
  }
}
