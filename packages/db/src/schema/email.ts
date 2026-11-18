import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { EmailAudience } from "../email-rules";
import { INSTITUTION_IDS } from "../profile";
import { user } from "./auth";

export * from "../email-rules";

/**
 * One email a staff member wrote and sent. The content is the Tiptap JSON
 * document the queue consumer renders for each recipient; the counters are
 * filled in as the queue drains.
 */
export const emailCampaign = sqliteTable(
  "email_campaign",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    subject: text("subject").notNull(),
    // Validated against `richTextDocSchema` (@it3k/email) before it is stored.
    content: text("content", { mode: "json" }).$type<unknown>().notNull(),
    audience: text("audience", { mode: "json" }).$type<EmailAudience>().notNull(),
    recipientCount: integer("recipient_count").notNull(),
    sentCount: integer("sent_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    // Kept apart from `sent_by` so the record survives the account.
    senderName: text("sender_name").notNull(),
    impersonatedBy: text("impersonated_by"),
    // Set on campaigns from senders who could only reach their own institution,
    // before seats were KMITL's only. No longer written.
    scopeInstitution: text("scope_institution", { enum: INSTITUTION_IDS }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("email_campaign_created_at_idx").on(table.createdAt),
    index("email_campaign_scope_idx").on(table.scopeInstitution, table.createdAt),
  ],
);
