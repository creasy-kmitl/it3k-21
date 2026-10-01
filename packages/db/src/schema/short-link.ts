import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { SHORT_LINK_CHANGE_ACTIONS, VISIT_SOURCES } from "../short-link-rules";
import { user } from "./auth";

export * from "../short-link-rules";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

/**
 * A fixed link on the web app's host, `/l/<slug>`, that sends visitors on to
 * `destination`. The slug never changes once created, because it is printed in
 * QR codes; the destination can, which is the point.
 */
export const shortLink = sqliteTable(
  "short_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    destination: text("destination").notNull(),
    // Where visitors go instead while the link is switched off or expired,
    // e.g. the event's page; without one they get the "link unavailable" page.
    fallbackUrl: text("fallback_url"),
    // Normalized with normalizeTag; see short-link-rules.
    tags: text("tags", { mode: "json" })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    // Whoever created it; they edit it, as do admins and Tech/Live.
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    // Bumped by every write, so an edit based on an old read is refused.
    version: integer("version").default(1).notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("short_link_slug_uidx").on(table.slug),
    index("short_link_owner_id_idx").on(table.ownerId),
    index("short_link_updated_at_idx").on(table.updatedAt),
  ],
);

/**
 * Visits per link, per Bangkok day, per source. Only counts: no IP address,
 * user agent, referrer or location is ever stored, so nobody can be traced.
 */
export const shortLinkVisitDay = sqliteTable(
  "short_link_visit_day",
  {
    linkId: text("link_id")
      .notNull()
      .references(() => shortLink.id, { onDelete: "cascade" }),
    // `YYYY-MM-DD` in Bangkok time.
    day: text("day").notNull(),
    source: text("source", { enum: VISIT_SOURCES }).notNull(),
    count: integer("count").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.linkId, table.day, table.source] }),
    check("short_link_visit_day_source_check", sql`${table.source} IN (${inList(VISIT_SOURCES)})`),
  ],
);

// Append-only change log: who changed what, from what, to what. No foreign
// keys, so the history outlives the accounts it names.
export const shortLinkChange = sqliteTable(
  "short_link_change",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    linkId: text("link_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    // The admin behind an impersonated session, if any.
    impersonatedBy: text("impersonated_by"),
    action: text("action", { enum: SHORT_LINK_CHANGE_ACTIONS }).notNull(),
    // `{ field: [before, after] }`
    changes: text("changes", { mode: "json" })
      .$type<Record<string, [unknown, unknown]>>()
      .notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("short_link_change_link_id_idx").on(table.linkId, table.createdAt)],
);
