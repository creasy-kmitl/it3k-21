// Department codes grant rights, so triggers lock them (migration
// lock_department_codes). These tests keep later migrations, and the template
// for adding a code, from weakening that lock.
import { Database as Sqlite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { applyMigrations } from "./testing";

const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");
const LOCK_MIGRATION = readdirSync(MIGRATIONS_DIR).find((name) =>
  name.endsWith("_lock_department_codes"),
);
const TEMPLATE = readFileSync(
  join(import.meta.dirname, "..", "templates", "add-department-code.sql"),
  "utf8",
);

/** SQLite stores a trigger's statement without comments or the final semicolon. */
function normalize(statement: string) {
  return statement
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join(" ")
    .replace(/;\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The trigger definitions as lock_department_codes wrote them, by name. */
function canonicalTriggers(): Map<string, string> {
  if (!LOCK_MIGRATION) throw new Error("lock_department_codes migration not found");
  const source = readFileSync(join(MIGRATIONS_DIR, LOCK_MIGRATION, "migration.sql"), "utf8");
  const triggers = new Map<string, string>();
  for (const chunk of source.split("--> statement-breakpoint")) {
    const statement = normalize(chunk);
    const name = /^CREATE TRIGGER `([^`]+)`/.exec(statement)?.[1];
    if (name) triggers.set(name, statement);
  }
  return triggers;
}

function currentTriggers(sqlite: Sqlite): Map<string, string> {
  const rows = sqlite
    .query<{ name: string; sql: string }, []>(
      "select name, sql from sqlite_master where type = 'trigger' and tbl_name = 'department'",
    )
    .all();
  return new Map(rows.map((row) => [row.name, normalize(row.sql)]));
}

function migratedDb() {
  const sqlite = new Sqlite(":memory:", { strict: true });
  sqlite.run("PRAGMA foreign_keys = ON");
  applyMigrations(sqlite);
  // Every seeded department has a code; the template is for one created without.
  sqlite.run("insert into department (id, name) values ('plain', 'Plain')");
  return sqlite;
}

function runTemplate(sqlite: Sqlite, code: string, name: string) {
  const source = TEMPLATE.replaceAll("__CODE__", code).replaceAll("__NAME__", name);
  for (const statement of source.split("--> statement-breakpoint")) {
    if (normalize(statement)) sqlite.run(statement);
  }
}

const codeOf = (sqlite: Sqlite, name: string) =>
  sqlite
    .query<{ code: string | null }, [string]>("select code from department where name = ?")
    .get(name)?.code;

describe("department code lock", () => {
  test("after every migration the lock triggers are exactly as first written", () => {
    const canonical = canonicalTriggers();
    expect([...canonical.keys()].toSorted()).toEqual([
      "department_code_locked",
      "department_code_undeletable",
    ]);
    expect(currentTriggers(migratedDb())).toEqual(canonical);
  });

  test("the add-a-code template sets the code and restores the same lock", () => {
    const sqlite = migratedDb();
    runTemplate(sqlite, "example", "Plain");
    expect(codeOf(sqlite, "Plain")).toBe("example");
    expect(currentTriggers(sqlite)).toEqual(canonicalTriggers());
    expect(() => sqlite.run("update department set code = null where name = 'Plain'")).toThrow(
      /department_code_protected/,
    );
  });

  test("the template fails the migration when the department is missing, lock intact", () => {
    const sqlite = migratedDb();
    expect(() => runTemplate(sqlite, "example", "Renamed in prod")).toThrow(/NOT NULL/);
    expect(currentTriggers(sqlite)).toEqual(canonicalTriggers());
    expect(sqlite.query("select 1 from department where code = 'example'").get()).toBeNull();
  });

  test("the template never moves a code another department already holds", () => {
    const sqlite = migratedDb();
    // tech-live is held by Tech/Live: the UPDATE matches nothing and the guard
    // passes, so rerunning a half-applied migration is harmless.
    runTemplate(sqlite, "tech-live", "Plain");
    expect(codeOf(sqlite, "Tech/Live")).toBe("tech-live");
    expect(codeOf(sqlite, "Plain")).toBeNull();
  });
});
