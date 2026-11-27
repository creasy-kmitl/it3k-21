import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "./auth";

/**
 * A token a Discord bot (apps/discord/*) sends to `/api/bot/*` as
 * `Authorization: Bearer <token>`. Admins issue them on the staff dashboard.
 * Only the SHA-256 of the token is kept: the plain token is shown once, when
 * it is issued. `prefix` is its first characters, so the list can tell tokens
 * apart without being able to use them. Revoked tokens stay as a record.
 */
export const botToken = sqliteTable(
  "bot_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [index("bot_token_created_at_idx").on(table.createdAt)],
);
