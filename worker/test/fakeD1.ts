// A D1-shaped wrapper over node:sqlite so the Worker's SQL runs against a real
// SQLite engine in tests. batch() is one transaction, as it is on D1.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Bound = { sql: string; args: unknown[] };

export const createFakeD1 = (migration: string) => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(migration, 'utf8'));
  const exec = (b: Bound) => {
    const stmt = db.prepare(b.sql);
    return stmt.run(...(b.args as never[]));
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => exec({ sql, args }),
    _bound: { sql, args } as Bound,
  });
  return {
    db,
    d1: {
      prepare: (sql: string) => statement(sql),
      batch: async (stmts: ReturnType<typeof statement>[]) => {
        db.exec('BEGIN');
        try {
          const out = stmts.map((s) => exec(s._bound));
          db.exec('COMMIT');
          return out;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
};
