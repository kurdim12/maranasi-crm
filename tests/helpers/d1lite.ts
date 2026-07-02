// Minimal D1-compatible adapter over node:sqlite (Node 22+) so state-machine
// and hook logic can be tested against a real SQL engine instead of mocks.
// Implements exactly the surface our code uses: prepare().bind().first/all/run.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

class Stmt {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): Stmt {
    return new Stmt(this.db, this.sql, params.map((p) => (p === undefined ? null : p)));
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as never[]));
    return { results: rows as T[], meta: {} };
  }

  async run(): Promise<{ results: never[]; meta: { changes: number; last_row_id: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
}

export interface D1Lite {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  raw: DatabaseSync;
}

/** In-memory DB with the real project migrations applied. */
export function createTestDb(migrations: string[] = ['0001_init.sql', '0003_users.sql', '0004_v2_pipeline.sql']): D1Lite {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) {
    const sql = readFileSync(join(__dirname, '..', '..', 'migrations', m), 'utf8');
    db.exec(sql);
  }
  return {
    prepare: (sql: string) => new Stmt(db, sql),
    exec: (sql: string) => db.exec(sql),
    raw: db,
  };
}

/** Cast helper: our code takes D1Database; the adapter satisfies the used surface. */
export function asD1(db: D1Lite): D1Database {
  return db as unknown as D1Database;
}
