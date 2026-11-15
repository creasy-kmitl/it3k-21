import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import type { ProfileValues } from "../profile";

export const userProfile = sqliteTable("user_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  draft: text("draft", { mode: "json" }).$type<ProfileValues>().notNull(),
  values: text("values", { mode: "json" }).$type<ProfileValues>(),
  revision: integer("revision").notNull().default(0),
  dirty: integer("dirty", { mode: "boolean" }).notNull().default(true),
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const uploadedFile = sqliteTable(
  "uploaded_file",
  {
    id: text("id").primaryKey(),
    // Retain metadata after account removal so the cleanup job can delete R2 objects.
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    // Client-known recovery token, separate from the server-issued public ID.
    requestId: text("request_id"),
    key: text("key").notNull().unique(),
    // Persist before sending bytes so cleanup can abort a writer in another Worker.
    uploadId: text("upload_id"),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    state: text("state", { enum: ["pending", "uploading", "ready", "deleting"] }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("uploaded_file_owner_idx").on(t.ownerId),
    index("uploaded_file_cleanup_idx").on(t.state, t.expiresAt),
    uniqueIndex("uploaded_file_request_idx").on(t.ownerId, t.requestId),
  ],
);
