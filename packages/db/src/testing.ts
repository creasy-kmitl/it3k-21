// Test-only: an in-memory D1 stand-in backed by bun:sqlite, with every
// checked-in migration applied. Routes run against the real Drizzle D1 driver,
// so tests exercise the same SQL, constraints and batch semantics as Workers.
import { Database as Sqlite, type SQLQueryBindings, type Statement } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createDb } from "./index";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

function meta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class SqliteD1Statement implements D1PreparedStatement {
  constructor(
    private readonly sqlite: Sqlite,
    readonly sql: string,
    readonly params: SQLQueryBindings[] = [],
  ) {}

  private statement(): Statement {
    return this.sqlite.prepare(this.sql);
  }

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, this.sql, values.map(toBinding));
  }

  get returnsRows() {
    return this.statement().columnNames.length > 0;
  }

  async first<T>(colName?: string): Promise<T | null> {
    const row = this.statement().get(...this.params) as Record<string, T> | null;
    if (!row) return null;
    return colName === undefined ? (row as T) : (row[colName] ?? null);
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    if (this.returnsRows) return this.all<T>();
    const result = this.statement().run(...this.params);
    return {
      success: true,
      results: [],
      meta: meta(result.changes, Number(result.lastInsertRowid)),
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const results = this.statement().all(...this.params) as T[];
    return { success: true, results, meta: meta() };
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.statement();
    const rows = statement.values(...this.params) as T[];
    return options?.columnNames ? [statement.columnNames, ...rows] : rows;
  }
}

function toBinding(value: unknown): SQLQueryBindings {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as SQLQueryBindings;
}

/** Lets a test act between a route's reads and its batched writes. */
/** Narrows a value a test expects to exist, failing loudly when it does not. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}

export type TestDbHooks = { beforeBatch?: () => void };

class SqliteD1 implements D1Database {
  constructor(
    readonly sqlite: Sqlite,
    private readonly hooks: TestDbHooks = {},
  ) {}

  prepare(query: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.hooks.beforeBatch?.();
    // D1 runs a batch as one implicit transaction: all statements or none.
    const run = this.sqlite.transaction(() =>
      statements.map((statement): D1Result<T> => {
        if (!(statement instanceof SqliteD1Statement)) {
          throw new TypeError("batch() only accepts statements from this database");
        }
        const sql = this.sqlite.prepare(statement.sql);
        if (sql.columnNames.length > 0) {
          return { success: true, results: sql.all(...statement.params) as T[], meta: meta() };
        }
        const result = sql.run(...statement.params);
        return {
          success: true,
          results: [] as T[],
          meta: meta(result.changes, Number(result.lastInsertRowid)),
        };
      }),
    );
    return run();
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.sqlite.run(query);
    return { count: 1, duration: 0 };
  }

  withSession(): D1DatabaseSession {
    return {
      prepare: (query) => this.prepare(query),
      batch: (statements) => this.batch(statements),
      getBookmark: () => null,
    };
  }

  async dump(): Promise<ArrayBuffer> {
    return new Uint8Array(this.sqlite.serialize()).buffer;
  }
}

export function applyMigrations(sqlite: Sqlite) {
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of dirs) {
    const source = readFileSync(join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8");
    for (const statement of source.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.run(statement);
    }
  }
}

export function createTestDb() {
  const sqlite = new Sqlite(":memory:", { strict: true });
  // D1 always enforces foreign keys; plain SQLite needs it switched on.
  sqlite.run("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);
  const hooks: TestDbHooks = {};
  return { db: createDb({ DB: new SqliteD1(sqlite, hooks) }), sqlite, hooks };
}
