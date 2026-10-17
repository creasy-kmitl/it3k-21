import type { Database } from "@it3k/db";
import {
  MAX_FILE_SIZE,
  MAX_PHOTO_SIZE,
  MAX_FILES_PER_USER,
  MAX_PENDING_UPLOADS,
  PHOTO_TYPES,
} from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { activeAccount } from "../profile";
import type { FileStore } from "./storage";
import { limitJsonBody } from "../../middleware/json-body-limit";

export type FileDeps = RouteDeps & {
  getStore: () => FileStore;
  waitUntil?: (promise: Promise<unknown>) => void;
};
const idInput = z.strictObject({ id: z.uuid() });
const requestInput = z.strictObject({ requestId: z.uuid() });
const ownerInput = z.object({ userId: z.string().min(1).optional() });
const uploadInput = z.strictObject({
  userId: z.string().min(1),
  requestId: z.uuid().optional(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) =>
      Array.from(name).every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
    ),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
  contentType: z
    .string()
    .max(100)
    .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
});
const queryInput = z.object({
  userId: z.string().min(1).optional(),
  q: z.string().max(100).optional(),
  images: z.enum(["true"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export function usedBytes(ownerId: string | typeof user.id) {
  return sql<number>`coalesce((select sum(${uploadedFile.size}) from ${uploadedFile} where ${uploadedFile.ownerId} = ${ownerId}), 0)`;
}
function unreferenced(id: string) {
  return sql`not exists (select 1 from ${userProfile} where json_extract(${userProfile.draft}, '$.photoFileId') = ${id} or json_extract(${userProfile.values}, '$.photoFileId') = ${id})`;
}

/** Abort the persisted multipart upload before releasing bytes or quota. */
async function deleteFile(db: Database, store: FileStore, file: typeof uploadedFile.$inferSelect) {
  if (file.uploadId) await store.abortUpload(file.key, file.uploadId);
  await store.delete(file.key);
  await db
    .delete(uploadedFile)
    .where(and(eq(uploadedFile.id, file.id), eq(uploadedFile.state, "deleting")));
}

async function removeOwnedFile(
  c: Context<CurrentUserEnv>,
  deps: FileDeps,
  file: typeof uploadedFile.$inferSelect | undefined,
) {
  if (!file) return c.json({ message: "ไม่พบไฟล์" }, 404);
  const db = c.var.db;
  const actor = c.var.user;
  const { id } = file;
  try {
    await db.batch([
      abortUnless(
        db,
        actor.id,
        and(
          activeAccount(),
          unreferenced(id),
          sql`exists (select 1 from ${uploadedFile} where ${uploadedFile.id} = ${id} and ${uploadedFile.ownerId} = ${actor.id} and ${uploadedFile.state} = ${file.state})`,
        ) ?? sql`0`,
      ),
      db.update(uploadedFile).set({ state: "deleting" }).where(eq(uploadedFile.id, id)),
    ]);
  } catch (error) {
    if (constraintError(error))
      return c.json({ message: "ไฟล์นี้กำลังใช้งานในโปรไฟล์ หรือข้อมูลเปลี่ยนแปลงแล้ว" }, 409);
    throw error;
  }
  // Read the current cancellation ID after fencing new writers.
  const [claimed] = await db
    .select()
    .from(uploadedFile)
    .where(and(eq(uploadedFile.id, id), eq(uploadedFile.state, "deleting")));
  if (claimed) await deleteFile(db, deps.getStore(), claimed);
  return c.json({ success: true }, 200);
}

/** Expired writers are fenced by R2 cancellation, even if their Worker is gone. */
export async function cleanupFiles(db: Database, store: FileStore, ownerId?: string) {
  const candidates = await db
    .select()
    .from(uploadedFile)
    .where(
      and(
        ownerId ? eq(uploadedFile.ownerId, ownerId) : undefined,
        or(
          isNull(uploadedFile.ownerId),
          eq(uploadedFile.state, "deleting"),
          and(
            lt(uploadedFile.expiresAt, new Date()),
            sql`${uploadedFile.state} in ('pending', 'uploading')`,
          ),
        ),
      ),
    )
    .limit(50);
  for (const file of candidates) {
    const [claimed] = await db
      .update(uploadedFile)
      .set({ state: "deleting" })
      .where(and(eq(uploadedFile.id, file.id), eq(uploadedFile.state, file.state)))
      .returning();
    // The atomic claim returns the latest upload ID, including a writer that
    // persisted it after the candidate read. A completed upload survives.
    if (!claimed) continue;
    await deleteFile(db, store, claimed);
  }
}

export function rasterType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return "image/png";
  const ascii = new TextDecoder().decode(bytes.subarray(0, 12));
  if (ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP") return "image/webp";
  return null;
}

/** Checks actual bytes, including chunked requests that lie about their size. */
export function checkedBody(body: ReadableStream<Uint8Array>, size: number, contentType: string) {
  let count = 0;
  let prefix: Uint8Array = new Uint8Array(0);
  let checked = false;
  const image = PHOTO_TYPES.some((type) => type === contentType);
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        count += chunk.byteLength;
        if (count > size) throw new Error("Upload size mismatch");
        if (image && !checked) {
          const combined = prefix.length ? new Uint8Array(prefix.length + chunk.length) : chunk;
          if (prefix.length) {
            combined.set(prefix);
            combined.set(chunk, prefix.length);
          }
          if (combined.length < 12) {
            prefix = combined;
            return;
          }
          if (rasterType(combined) !== contentType) throw new Error("Invalid image bytes");
          checked = true;
          prefix = new Uint8Array(0);
          controller.enqueue(combined);
        } else controller.enqueue(chunk);
      },
      flush() {
        if (count !== size || (image && !checked))
          throw new Error("Upload size mismatch or invalid image");
      },
    }),
  );
}

export const createFileRoutes = (deps: FileDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(async (c, next) => {
      const expected = c.req.query("userId");
      if (expected !== undefined && expected !== c.var.user.id)
        return c.json({ code: "ACCOUNT_CHANGED", message: "บัญชีที่เข้าสู่ระบบเปลี่ยนแปลงแล้ว" }, 403);
      return next();
    })
    .get("/", validate("query", queryInput), async (c) => {
      const { q, images, page } = c.req.valid("query");
      const db = c.var.db;
      const id = c.var.user.id;
      await cleanupFiles(db, deps.getStore(), id);
      const [usage] = await db
        .select({ used: usedBytes(id), limit: user.storageLimit })
        .from(user)
        .where(eq(user.id, id));
      const rows = await db
        .select()
        .from(uploadedFile)
        .where(
          and(
            eq(uploadedFile.ownerId, id),
            eq(uploadedFile.state, "ready"),
            q ? sql`instr(lower(${uploadedFile.name}), lower(${q})) > 0` : undefined,
            images
              ? and(
                  sql`${uploadedFile.contentType} in ('image/jpeg', 'image/png', 'image/webp')`,
                  sql`${uploadedFile.size} <= ${MAX_PHOTO_SIZE}`,
                )
              : undefined,
          ),
        )
        .orderBy(desc(uploadedFile.createdAt), uploadedFile.id)
        .limit(31)
        .offset((page - 1) * 30);
      const uploads = await db
        .select({
          id: uploadedFile.id,
          name: uploadedFile.name,
          size: uploadedFile.size,
          state: uploadedFile.state,
        })
        .from(uploadedFile)
        .where(and(eq(uploadedFile.ownerId, id), sql`${uploadedFile.state} != 'ready'`))
        .orderBy(uploadedFile.createdAt, uploadedFile.id)
        .limit(MAX_PENDING_UPLOADS);
      return c.json(
        {
          items: rows.slice(0, 30).map((file) => ({
            id: file.id,
            name: file.name,
            contentType: file.contentType,
            size: file.size,
            createdAt: file.createdAt,
            url: new URL(`/api/files/public/${file.id}`, c.req.url).href,
          })),
          uploads,
          page,
          hasMore: rows.length > 30,
          used: usage?.used ?? 0,
          limit: usage?.limit ?? 0,
        },
        200,
      );
    })
    .post("/uploads", limitJsonBody, validate("json", uploadInput), async (c) => {
      const { requestId, userId, ...input } = c.req.valid("json");
      // Public IDs and R2 keys are always fresh, including when a client reuses
      // a recovery token. Deleted URLs can never be claimed by another owner.
      const id = crypto.randomUUID();
      const db = c.var.db;
      const actor = c.var.user;
      if (userId !== actor.id)
        return c.json({ code: "ACCOUNT_CHANGED", message: "บัญชีที่เข้าสู่ระบบเปลี่ยนแปลงแล้ว" }, 403);
      await cleanupFiles(db, deps.getStore(), actor.id);
      try {
        await db.batch([
          abortUnless(
            db,
            actor.id,
            and(
              activeAccount(),
              sql`${usedBytes(actor.id)} + ${input.size} <= ${user.storageLimit}`,
              // Metadata and unfinished R2 sessions also consume resources.
              // Check both counts in the same transaction as the reservation.
              sql`(select count(*) from ${uploadedFile} where ${uploadedFile.ownerId} = ${actor.id}) < ${MAX_FILES_PER_USER}`,
              sql`(select count(*) from ${uploadedFile} where ${uploadedFile.ownerId} = ${actor.id} and ${uploadedFile.state} != 'ready') < ${MAX_PENDING_UPLOADS}`,
            ) ?? sql`0`,
          ),
          db.insert(uploadedFile).values({
            ...input,
            contentType: input.contentType.toLowerCase(),
            id,
            requestId,
            ownerId: actor.id,
            key: `users/${actor.id}/${id}`,
            state: "pending",
            expiresAt: new Date(Date.now() + 3600000),
          }),
        ]);
      } catch (error) {
        if (constraintError(error) === "unique")
          return c.json({ message: "รายการอัปโหลดนี้มีอยู่แล้ว" }, 409);
        if (constraintError(error) === "stale")
          return c.json(
            {
              message: `พื้นที่จัดเก็บไม่เพียงพอ คลังไฟล์เต็ม (สูงสุด ${MAX_FILES_PER_USER.toLocaleString("th-TH")} ไฟล์) หรือมีการอัปโหลดค้างครบ ${MAX_PENDING_UPLOADS} รายการแล้ว`,
            },
            409,
          );
        throw error;
      }
      return c.json({ id }, 201);
    })
    .delete(
      "/uploads/:requestId",
      validate("param", requestInput),
      validate("query", ownerInput),
      async (c) => {
        const { requestId } = c.req.valid("param");
        const [file] = await c.var.db
          .select()
          .from(uploadedFile)
          .where(
            and(eq(uploadedFile.requestId, requestId), eq(uploadedFile.ownerId, c.var.user.id)),
          );
        return removeOwnedFile(c, deps, file);
      },
    )
    .put("/:id/content", validate("param", idInput), validate("query", ownerInput), async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [file] = await db
        .select()
        .from(uploadedFile)
        .where(
          and(
            eq(uploadedFile.id, id),
            eq(uploadedFile.ownerId, actor.id),
            eq(uploadedFile.state, "pending"),
          ),
        );
      if (!file || file.expiresAt.getTime() < Date.now())
        return c.json({ message: "ไม่พบรายการอัปโหลดที่พร้อมใช้งาน" }, 404);
      const body = c.req.raw.body;
      if (!body) return c.json({ message: "ไม่มีไฟล์" }, 400);
      try {
        await db.batch([
          abortUnless(
            db,
            actor.id,
            and(
              activeAccount(),
              sql`exists (select 1 from ${uploadedFile} where ${uploadedFile.id} = ${id} and ${uploadedFile.state} = 'pending')`,
            ) ?? sql`0`,
          ),
          db
            .update(uploadedFile)
            .set({ state: "uploading", expiresAt: new Date(Date.now() + 3600000) })
            .where(eq(uploadedFile.id, id)),
        ]);
      } catch (error) {
        if (constraintError(error)) return c.json({ message: "รายการอัปโหลดเปลี่ยนแปลงแล้ว" }, 409);
        throw error;
      }
      const store = deps.getStore();
      const write = (async () => {
        let uploadId: string | null = null;
        try {
          uploadId = await store.createUpload(file.key, file.contentType);
          // No bytes may be sent until the cancellation ID is durable. If
          // cleanup won this race, abort the empty multipart upload below.
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                activeAccount(),
                sql`exists (select 1 from ${uploadedFile} where ${uploadedFile.id} = ${id} and ${uploadedFile.ownerId} = ${actor.id} and ${uploadedFile.state} = 'uploading' and ${uploadedFile.uploadId} is null and ${uploadedFile.expiresAt} > ${Date.now()})`,
              ) ?? sql`0`,
            ),
            db.update(uploadedFile).set({ uploadId }).where(eq(uploadedFile.id, id)),
          ]);
          await store.upload(
            file.key,
            checkedBody(body, file.size, file.contentType),
            file.size,
            uploadId,
          );
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                activeAccount(),
                sql`exists (select 1 from ${uploadedFile} where ${uploadedFile.id} = ${id} and ${uploadedFile.ownerId} = ${actor.id} and ${uploadedFile.state} = 'uploading' and ${uploadedFile.uploadId} = ${uploadId} and ${uploadedFile.expiresAt} > ${Date.now()})`,
              ) ?? sql`0`,
            ),
            db
              .update(uploadedFile)
              .set({ state: "ready", uploadId: null })
              .where(eq(uploadedFile.id, id)),
          ]);
        } catch {
          await db
            .update(uploadedFile)
            .set({ state: "deleting", uploadId })
            .where(eq(uploadedFile.id, id));
          try {
            await deleteFile(db, store, { ...file, uploadId });
          } catch {
            /* Scheduled cleanup retries and quota remains reserved. */
          }
          return c.json({ message: "อัปโหลดไม่สำเร็จ กรุณาตรวจสอบชนิดและขนาดไฟล์แล้วลองใหม่" }, 400);
        }
        return c.json({ id, url: new URL(`/api/files/public/${id}`, c.req.url).href }, 200);
      })();
      // Finish compensation when the browser disconnects during an upload.
      deps.waitUntil?.(write);
      return write;
    })
    .delete("/:id", validate("param", idInput), validate("query", ownerInput), async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [file] = await db
        .select()
        .from(uploadedFile)
        .where(and(eq(uploadedFile.id, id), eq(uploadedFile.ownerId, actor.id)));
      return removeOwnedFile(c, deps, file);
    });

/** Public content only; no authenticated middleware or owner metadata. */
export const createPublicFileRoutes = (deps: Pick<FileDeps, "getDb" | "getStore">) =>
  new Hono().on(["GET", "HEAD"], "/:id", validate("param", idInput), async (c) => {
    const [file] = await deps
      .getDb()
      .select()
      .from(uploadedFile)
      .where(and(eq(uploadedFile.id, c.req.valid("param").id), eq(uploadedFile.state, "ready")));
    if (!file) return c.json({ message: "ไม่พบไฟล์" }, 404);
    const stored = await deps.getStore().download(file.key);
    if (!stored) return c.json({ message: "ไม่พบไฟล์" }, 404);
    const inline = PHOTO_TYPES.some((type) => type === file.contentType);
    const headers = new Headers({
      "Content-Type": file.contentType,
      "Content-Length": String(stored.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
      ETag: `"${stored.etag.replaceAll('"', "")}"`,
    });
    if (!inline) headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
    if (c.req.method === "HEAD") {
      await stored.body.cancel();
      return new Response(null, { headers });
    }
    return new Response(stored.body, { headers });
  });

export type FileRoutes = ReturnType<typeof createFileRoutes>;
