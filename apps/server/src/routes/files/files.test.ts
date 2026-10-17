import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  EMPTY_PROFILE,
  GiB,
  MAX_FILE_SIZE,
  MAX_FILES_PER_USER,
  MAX_PENDING_UPLOADS,
  type ProfileValues,
} from "@it3k/db/profile";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import { user } from "@it3k/db/schema/auth";
import { createTestContext, defined } from "../../testing";
import { createProfileRoutes } from "../profile";
import { createUserRoutes } from "../users";
import { cleanupFiles, createFileRoutes, createPublicFileRoutes, usedBytes } from ".";
import type { FileStore } from "./storage";
import { MAX_JSON_BODY_SIZE } from "../../middleware/json-body-limit";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof setup>;
let objects: Map<string, Uint8Array>;
let uploads: Set<string>;
let store: FileStore;
let failDelete: boolean;
let failAbort: boolean;
function setup() {
  const deps = { ...t.deps, getStore: () => store };
  return new Hono()
    .route("/files/public", createPublicFileRoutes(deps))
    .route("/files", createFileRoutes(deps))
    .route("/profile", createProfileRoutes(t.deps))
    .route("/users", createUserRoutes(t.deps));
}
beforeEach(async () => {
  t = createTestContext();
  objects = new Map();
  uploads = new Set();
  failDelete = false;
  failAbort = false;
  store = {
    async createUpload() {
      const id = crypto.randomUUID();
      uploads.add(id);
      return id;
    },
    async abortUpload(_key, id) {
      if (failAbort) throw new Error("R2 unavailable");
      uploads.delete(id);
    },
    async upload(key, body, _size, id) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (!uploads.delete(id)) throw new Error("Upload aborted");
      objects.set(key, bytes);
    },
    async delete(key) {
      if (failDelete) throw new Error("R2 unavailable");
      objects.delete(key);
    },
    async download(key) {
      const bytes = objects.get(key);
      return bytes
        ? { body: defined(new Response(bytes).body), size: bytes.length, etag: "test" }
        : null;
    },
  };
  app = setup();
  await t.seedUser("guest", { role: "guest" });
  await t.seedUser("other", { role: "guest" });
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("registration", { department: "ทะเบียน" });
  await t.seedUser("art", { department: "Art" });
});
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/L9sAAAAASUVORK5CYII=",
    "base64",
  ),
);
async function reserve(size: number, contentType = "application/octet-stream", owner = "guest") {
  return app.request(
    "/files/uploads",
    t.as(owner, { method: "POST", json: { name: "file", size, contentType } }),
  );
}
async function upload(bytes: Uint8Array = png, contentType = "image/png", owner = "guest") {
  const reservation = await reserve(bytes.length, contentType, owner);
  expect(reservation.status).toBe(201);
  const { id } = (await reservation.json()) as { id: string };
  const res = await app.request(`/files/${id}/content`, {
    ...t.as(owner, { method: "PUT" }),
    body: bytes,
  });
  expect(res.status).toBe(200);
  return id;
}
async function valid(photoFileId: string): Promise<ProfileValues> {
  return {
    ...EMPTY_PROFILE,
    prefix: "นาย",
    firstName: "สมชาย",
    lastName: "ใจดี",
    nickname: "ชาย",
    phone: "0812345678",
    institution: "kmitl",
    photoFileId,
  };
}

describe("file library and quota", () => {
  test("rejects oversized reservation JSON without allocating a file", async () => {
    const res = await app.request("/files/uploads", {
      ...t.as("guest", { method: "POST" }),
      headers: {
        ...Object.fromEntries(new Headers(t.as("guest").headers)),
        "content-type": "application/json",
      },
      body:
        " ".repeat(MAX_JSON_BODY_SIZE) +
        JSON.stringify({ name: "small", size: 1, contentType: "text/plain" }),
    });
    expect(res.status).toBe(413);
    expect(await t.db.select().from(uploadedFile)).toEqual([]);
  });
  test("binary content stays streamed above the JSON limit even with a JSON MIME type", async () => {
    const { id } = (await (await reserve(MAX_JSON_BODY_SIZE + 1, "application/json")).json()) as {
      id: string;
    };
    const headers = new Headers(t.as("guest").headers);
    headers.set("content-type", "application/json");
    expect(
      (
        await app.request(`/files/${id}/content`, {
          method: "PUT",
          headers,
          body: new Uint8Array(MAX_JSON_BODY_SIZE + 1),
        })
      ).status,
    ).toBe(200);
  });
  test("unfinished reservations are visible only to their owner and can be cancelled", async () => {
    const requestId = crypto.randomUUID();
    const reservation = await app.request(
      "/files/uploads",
      t.as("guest", {
        method: "POST",
        json: { requestId, name: "lost.bin", size: 1, contentType: "application/octet-stream" },
      }),
    );
    expect(reservation.status).toBe(201);
    const { id } = (await reservation.json()) as { id: string };
    expect(id).not.toBe(requestId);
    const own = (await (await app.request("/files", t.as("guest"))).json()) as {
      items: unknown[];
      uploads: { id: string; name: string }[];
    };
    expect(own.items).toEqual([]);
    expect(own.uploads).toMatchObject([{ id, name: "lost.bin", state: "pending" }]);
    const other = (await (await app.request("/files", t.as("other"))).json()) as {
      uploads: unknown[];
    };
    expect(other.uploads).toEqual([]);
    expect(
      (await app.request(`/files/uploads/${requestId}`, t.as("other", { method: "DELETE" })))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/files/uploads/${requestId}`, t.as("guest", { method: "DELETE" })))
        .status,
    ).toBe(200);
    expect(await t.db.select().from(uploadedFile)).toEqual([]);
  });
  test("a caller cannot choose an existing public file ID", async () => {
    const { id } = (await (await reserve(1)).json()) as { id: string };
    const res = await app.request(
      "/files/uploads",
      t.as("other", {
        method: "POST",
        json: { id, name: "replace", size: 2, contentType: "text/plain" },
      }),
    );
    expect(res.status).toBe(400);
    expect(defined((await t.db.select().from(uploadedFile))[0])).toMatchObject({
      ownerId: "guest",
      size: 1,
    });
  });
  test("reusing a deleted file ID as a recovery token never reclaims its public URL", async () => {
    const id = await upload(new Uint8Array([1]), "text/plain");
    expect((await app.request(`/files/${id}`, t.as("guest", { method: "DELETE" }))).status).toBe(
      200,
    );
    for (const owner of ["guest", "other"]) {
      const res = await app.request(
        "/files/uploads",
        t.as(owner, {
          method: "POST",
          json: { requestId: id, name: "replacement", size: 1, contentType: "text/plain" },
        }),
      );
      expect(res.status).toBe(201);
      const { id: next } = (await res.json()) as { id: string };
      expect(next).not.toBe(id);
      expect(
        (
          await app.request(`/files/${next}/content`, {
            ...t.as(owner, { method: "PUT" }),
            body: new Uint8Array([2]),
          })
        ).status,
      ).toBe(200);
      expect((await app.request(`/files/public/${id}`)).status).toBe(404);
      expect(await (await app.request(`/files/public/${next}`)).arrayBuffer()).toEqual(
        new Uint8Array([2]).buffer,
      );
    }
  });
  test("recovery tokens are unique per owner while a reservation exists", async () => {
    const requestId = crypto.randomUUID();
    const payload = { requestId, name: "file", size: 1, contentType: "text/plain" };
    expect(
      (await app.request("/files/uploads", t.as("guest", { method: "POST", json: payload })))
        .status,
    ).toBe(201);
    expect(
      (await app.request("/files/uploads", t.as("guest", { method: "POST", json: payload })))
        .status,
    ).toBe(409);
    expect(
      (await app.request("/files/uploads", t.as("other", { method: "POST", json: payload })))
        .status,
    ).toBe(201);
    expect(
      (await app.request(`/files/uploads/${requestId}`, t.as("guest", { method: "DELETE" })))
        .status,
    ).toBe(200);
    expect(defined((await t.db.select().from(uploadedFile))[0]).ownerId).toBe("other");
  });
  test("late compensation cannot delete a newer upload using the same recovery token", async () => {
    const requestId = crypto.randomUUID();
    const payload = { requestId, name: "file", size: 1, contentType: "text/plain" };
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const original = store.upload.bind(store);
    let first = true;
    store.upload = async (...args) => {
      if (first) {
        first = false;
        entered.resolve();
        await resume.promise;
      }
      return original(...args);
    };
    async function reservation() {
      const res = await app.request(
        "/files/uploads",
        t.as("guest", { method: "POST", json: payload }),
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    }
    const old = await reservation();
    const writing = app.request(`/files/${old}/content`, {
      ...t.as("guest", { method: "PUT" }),
      body: new Uint8Array([1]),
    });
    await entered.promise;
    expect(
      (await app.request(`/files/uploads/${requestId}`, t.as("guest", { method: "DELETE" })))
        .status,
    ).toBe(200);
    const next = await reservation();
    expect(next).not.toBe(old);
    expect(
      (
        await app.request(`/files/${next}/content`, {
          ...t.as("guest", { method: "PUT" }),
          body: new Uint8Array([2]),
        })
      ).status,
    ).toBe(200);
    resume.resolve();
    expect((await writing).status).toBe(400);
    expect(await (await app.request(`/files/public/${next}`)).arrayBuffer()).toEqual(
      new Uint8Array([2]).buffer,
    );
    expect(defined((await t.db.select().from(uploadedFile))[0])).toMatchObject({
      id: next,
      state: "ready",
    });
  });
  async function seedFiles(count: number, state: "ready" | "pending" | "uploading" | "deleting") {
    for (let i = 0; i < count; i++) {
      await t.db.insert(uploadedFile).values({
        id: crypto.randomUUID(),
        ownerId: "guest",
        key: `seed/${i}`,
        name: "tiny",
        size: 1,
        contentType: "text/plain",
        state,
        expiresAt: new Date(Date.now() + 3600000),
      });
    }
  }
  test("concurrent tiny-file reservations cannot exceed the file-count limit", async () => {
    await seedFiles(MAX_FILES_PER_USER - 1, "ready");
    const results = await Promise.all([reserve(1), reserve(1)]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await t.db.select().from(uploadedFile)).toHaveLength(MAX_FILES_PER_USER);
    // One account's count does not consume another account's allowance.
    expect((await reserve(1, "text/plain", "other")).status).toBe(201);
  });
  for (const state of ["pending", "uploading"] as const) {
    test(`counts ${state} uploads against the unfinished-upload limit`, async () => {
      await seedFiles(MAX_PENDING_UPLOADS - 1, state);
      const results = await Promise.all([reserve(1), reserve(1)]);
      expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await t.db.select().from(uploadedFile)).toHaveLength(MAX_PENDING_UPLOADS);
    });
  }
  test("a concurrent cancellation cannot bypass the unfinished-upload limit", async () => {
    await seedFiles(MAX_PENDING_UPLOADS, "uploading");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update uploaded_file set state = 'deleting'");
    };
    expect((await reserve(1)).status).toBe(409);
    const rows = await t.db.select().from(uploadedFile);
    expect(rows).toHaveLength(MAX_PENDING_UPLOADS);
    expect(rows.every((row) => row.state === "deleting")).toBe(true);
  });
  test("cancelling or expiring a pending upload releases its count slot", async () => {
    await seedFiles(MAX_PENDING_UPLOADS, "pending");
    const file = defined((await t.db.select().from(uploadedFile))[0]);
    expect((await reserve(1)).status).toBe(409);
    expect(
      (await app.request(`/files/${file.id}`, t.as("guest", { method: "DELETE" }))).status,
    ).toBe(200);
    expect((await reserve(1)).status).toBe(201);
    await t.db.update(uploadedFile).set({ expiresAt: new Date(0) });
    expect((await reserve(1)).status).toBe(201);
    expect(await t.db.select().from(uploadedFile)).toHaveLength(1);
  });
  test("all signed-in roles can upload; anonymous and banned accounts cannot", async () => {
    expect((await app.request("/files", t.as(null))).status).toBe(401);
    for (const role of ["guest", "participant", "athlete", "staff", "admin"]) {
      await t.seedUser(`${role}-role`, { role });
      expect((await reserve(1, "text/plain", `${role}-role`)).status).toBe(201);
    }
    await t.seedUser("banned", { banned: true });
    expect((await reserve(1, "text/plain", "banned")).status).toBe(403);
  });
  test("default quota is 1 GiB; concurrent reservations cannot overbook it", async () => {
    const [row] = await t.db.select().from(user).where(eq(user.id, "guest"));
    expect(row?.storageLimit).toBe(GiB);
    await t.db.update(user).set({ storageLimit: 10 }).where(eq(user.id, "guest"));
    const responses = await Promise.all([reserve(7), reserve(7)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const usage = (await (await app.request("/files", t.as("guest"))).json()) as { used: number };
    expect(usage.used).toBe(7);
  });
  test("rejects oversize and non-JSON reservations", async () => {
    expect((await reserve(MAX_FILE_SIZE + 1)).status).toBe(400);
    expect(
      (
        await app.request("/files/uploads", {
          ...t.as("guest", { method: "POST" }),
          body: "name=file",
        })
      ).status,
    ).toBe(415);
  });
  test("actual body size and image bytes must match the reservation", async () => {
    for (const [size, type, body] of [
      [2, "text/plain", "too long"],
      [100, "text/plain", "short"],
      [13, "image/png", "not an image!"],
    ] as const) {
      const res = await reserve(size, type);
      const { id } = (await res.json()) as { id: string };
      expect(
        (await app.request(`/files/${id}/content`, { ...t.as("guest", { method: "PUT" }), body }))
          .status,
      ).toBe(400);
    }
    expect(await t.db.select().from(uploadedFile)).toHaveLength(0);
    expect(objects.size).toBe(0);
  });
  test("public URLs work anonymously while library metadata remains owned", async () => {
    const id = await upload();
    const res = await app.request(`/files/public/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toStartWith("inline");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect((await app.request(`/files/public/${id}`, { method: "HEAD" })).status).toBe(200);
    const other = (await (await app.request("/files", t.as("other"))).json()) as {
      items: unknown[];
    };
    expect(other.items).toEqual([]);
    expect((await app.request(`/files/${id}`, t.as("other", { method: "DELETE" }))).status).toBe(
      404,
    );
  });
  test("general HTML files download with nosniff and sandbox", async () => {
    const id = await upload(new TextEncoder().encode("<script>alert(1)</script>"), "text/html");
    const res = await app.request(`/files/public/${id}`);
    expect(res.headers.get("content-disposition")).toStartWith("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
  });
  test("unused files delete; failed R2 deletion retains quota until cleanup", async () => {
    const id = await upload();
    failDelete = true;
    expect((await app.request(`/files/${id}`, t.as("guest", { method: "DELETE" }))).status).toBe(
      500,
    );
    const [file] = await t.db.select().from(uploadedFile);
    expect(file?.state).toBe("deleting");
    expect((await app.request(`/files/public/${id}`)).status).toBe(404);
    failDelete = false;
    await cleanupFiles(t.db, store);
    expect(await t.db.select().from(uploadedFile)).toEqual([]);
    expect(objects.size).toBe(0);
  });
  test("cleans expired reservations and removed owners without deleting ready files", async () => {
    const ready = await upload();
    await reserve(4);
    await t.db.update(uploadedFile).set({ expiresAt: new Date(0) });
    await cleanupFiles(t.db, store);
    expect((await t.db.select().from(uploadedFile)).map((f) => f.id)).toEqual([ready]);
    await t.db.delete(user).where(eq(user.id, "guest"));
    await cleanupFiles(t.db, store);
    expect(objects.size).toBe(0);
  });
  test("a reserved file is private and another account cannot fill it", async () => {
    const { id } = (await (await reserve(3)).json()) as { id: string };
    expect((await app.request(`/files/public/${id}`)).status).toBe(404);
    expect(
      (
        await app.request(`/files/${id}/content`, {
          ...t.as("other", { method: "PUT" }),
          body: "abc",
        })
      ).status,
    ).toBe(404);
  });
  for (const reason of ["expiry", "owner removal"] as const) {
    test(`cleanup cancels active uploads after ${reason} before releasing quota`, async () => {
      await t.db.update(user).set({ storageLimit: 1 }).where(eq(user.id, "guest"));
      let start!: () => void;
      const started = new Promise<void>((resolve) => {
        start = resolve;
      });
      let finish!: () => void;
      const finishing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const originalUpload = store.upload;
      store.upload = async (...args) => {
        start();
        await finishing;
        await originalUpload(...args);
      };
      const background: Promise<unknown>[] = [];
      const routes = createFileRoutes({
        ...t.deps,
        getStore: () => store,
        waitUntil: (promise) => {
          background.push(promise);
        },
      });
      const reservation = await routes.request(
        "/uploads",
        t.as("guest", {
          method: "POST",
          json: { name: "file", size: 1, contentType: "text/plain" },
        }),
      );
      const { id } = (await reservation.json()) as { id: string };
      const writing = routes.request(`/${id}/content`, {
        ...t.as("guest", { method: "PUT" }),
        body: "x",
      });
      await started;
      try {
        if (reason === "expiry") await t.db.update(uploadedFile).set({ expiresAt: new Date(0) });
        else await t.db.delete(user).where(eq(user.id, "guest"));
        await cleanupFiles(t.db, store);
        expect(await t.db.select().from(uploadedFile)).toEqual([]);
        expect(uploads.size).toBe(0);
        if (reason === "expiry") {
          expect((await reserve(1)).status).toBe(201);
          await t.db.delete(uploadedFile);
        }
      } finally {
        finish();
      }
      expect((await writing).status).toBe(400);
      await Promise.all(background);
      expect(background).toHaveLength(1);
      expect(objects.size).toBe(0);
      expect(await t.db.select().from(uploadedFile)).toEqual([]);
      if (reason === "expiry") {
        const [usage] = await t.db
          .select({ used: usedBytes("guest") })
          .from(user)
          .where(eq(user.id, "guest"));
        expect(usage?.used).toBe(0);
      }
    });
  }
  for (const stage of [
    "before session persistence",
    "sending bytes",
    "after R2 completion",
  ] as const) {
    test(`cleanup recovers a terminated Worker ${stage}`, async () => {
      const { id } = (await (await reserve(1)).json()) as { id: string };
      const file = defined((await t.db.select().from(uploadedFile))[0]);
      const uploadId =
        stage === "before session persistence"
          ? null
          : await store.createUpload(file.key, file.contentType);
      if (stage === "after R2 completion") {
        await store.upload(file.key, defined(new Response("x").body), 1, defined(uploadId));
      }
      await t.db
        .update(uploadedFile)
        .set({ state: "uploading", uploadId, expiresAt: new Date(0) })
        .where(eq(uploadedFile.id, id));
      await cleanupFiles(t.db, store);
      expect(await t.db.select().from(uploadedFile)).toEqual([]);
      expect(uploads.size).toBe(0);
      expect(objects.size).toBe(0);
    });
  }
  test("failed cancellation retains quota and bytes until cleanup retries", async () => {
    const { id } = (await (await reserve(1)).json()) as { id: string };
    const file = defined((await t.db.select().from(uploadedFile))[0]);
    const uploadId = await store.createUpload(file.key, file.contentType);
    objects.set(file.key, new Uint8Array([1]));
    await t.db
      .update(uploadedFile)
      .set({ state: "uploading", uploadId, expiresAt: new Date(0) })
      .where(eq(uploadedFile.id, id));
    failAbort = true;
    await expect(cleanupFiles(t.db, store)).rejects.toThrow("R2 unavailable");
    expect(defined((await t.db.select().from(uploadedFile))[0]).state).toBe("deleting");
    expect(objects.size).toBe(1);
    expect(uploads.size).toBe(1);
    const [usage] = await t.db
      .select({ used: usedBytes("guest") })
      .from(user)
      .where(eq(user.id, "guest"));
    expect(usage?.used).toBe(1);
    failAbort = false;
    await cleanupFiles(t.db, store);
    expect(await t.db.select().from(uploadedFile)).toEqual([]);
    expect(objects.size).toBe(0);
    expect(uploads.size).toBe(0);
  });
  for (const stage of ["creating session", "sending bytes"] as const) {
    test(`deleting an upload while ${stage} prevents late publication`, async () => {
      const started = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const create = store.createUpload;
      const send = store.upload;
      let sent = false;
      store.createUpload = async (...args) => {
        if (stage === "creating session") {
          started.resolve();
          await resume.promise;
        }
        return create(...args);
      };
      store.upload = async (...args) => {
        sent = true;
        if (stage === "sending bytes") {
          started.resolve();
          await resume.promise;
        }
        await send(...args);
      };
      const { id } = (await (await reserve(1)).json()) as { id: string };
      const writing = app.request(`/files/${id}/content`, {
        ...t.as("guest", { method: "PUT" }),
        body: "x",
      });
      await started.promise;
      try {
        expect(
          (await app.request(`/files/${id}`, t.as("guest", { method: "DELETE" }))).status,
        ).toBe(200);
        expect(await t.db.select().from(uploadedFile)).toEqual([]);
      } finally {
        resume.resolve();
      }
      expect((await writing).status).toBe(400);
      expect(sent).toBe(stage === "sending bytes");
      expect(uploads.size).toBe(0);
      expect(objects.size).toBe(0);
    });
  }
});

describe("registration and drafts", () => {
  test("formatted phone submissions normalize and remain editable as drafts", async () => {
    const photo = await upload();
    const values = { ...(await valid(photo)), phone: "081-234-5678" };
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", {
            method: "POST",
            json: { userId: "guest", revision: 0, values },
          }),
        )
      ).status,
    ).toBe(200);
    const [profile] = await t.db.select().from(userProfile);
    expect(profile?.values?.phone).toBe("0812345678");
    expect(profile?.draft.phone).toBe("0812345678");
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("guest", {
            method: "PUT",
            json: { userId: "guest", revision: 1, values: profile?.draft },
          }),
        )
      ).status,
    ).toBe(200);
  });
  test("overlong phone submissions cannot publish or promote an account", async () => {
    const photo = await upload();
    const values = { ...(await valid(photo)), phone: `081${" ".repeat(1000000)}2345678` };
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", {
            method: "POST",
            json: { userId: "guest", revision: 0, values },
          }),
        )
      ).status,
    ).toBe(413);
    expect(await t.db.select().from(userProfile)).toEqual([]);
    expect(defined((await t.db.select().from(user).where(eq(user.id, "guest")))[0]).role).toBe(
      "guest",
    );
  });
  test("incomplete drafts restore without publishing or changing roles", async () => {
    const values = { ...EMPTY_PROFILE, firstName: "สม", phone: "08" };
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("guest", { method: "PUT", json: { userId: "guest", revision: 0, values } }),
        )
      ).status,
    ).toBe(200);
    const me = (await (await app.request("/profile/me", t.as("guest"))).json()) as {
      draft: unknown;
      profile: unknown;
      revision: number;
      account: { role: string };
    };
    expect(me.draft).toEqual(values);
    expect(me.profile).toBeNull();
    expect(me.revision).toBe(1);
    expect(me.account.role).toBe("guest");
  });
  test("validation failure cannot promote a guest", async () => {
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", {
            method: "POST",
            json: { userId: "guest", revision: 0, values: EMPTY_PROFILE },
          }),
        )
      ).status,
    ).toBe(400);
    const [account] = await t.db.select().from(user).where(eq(user.id, "guest"));
    expect(account?.role).toBe("guest");
  });
  test("submission promotes guests, editing drafts preserves the published profile", async () => {
    const photo = await upload();
    const values = await valid(photo);
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", { method: "POST", json: { userId: "guest", revision: 0, values } }),
        )
      ).status,
    ).toBe(200);
    const [account] = await t.db.select().from(user).where(eq(user.id, "guest"));
    expect(account?.role).toBe("participant");
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("guest", {
            method: "PUT",
            json: { userId: "guest", revision: 1, values: { ...values, firstName: "" } },
          }),
        )
      ).status,
    ).toBe(200);
    const [profile] = await t.db.select().from(userProfile);
    expect(profile?.values?.firstName).toBe("สมชาย");
    expect(profile?.submittedAt).toBeInstanceOf(Date);
    expect(profile?.draft.firstName).toBe("");
    expect((await app.request(`/files/${photo}`, t.as("guest", { method: "DELETE" }))).status).toBe(
      409,
    );
  });
  test("stale autosaves cannot overwrite another tab or a submitted profile", async () => {
    const photo = await upload();
    const values = await valid(photo);
    await app.request(
      "/profile/submit",
      t.as("guest", { method: "POST", json: { userId: "guest", revision: 0, values } }),
    );
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("guest", {
            method: "PUT",
            json: { userId: "guest", revision: 0, values: EMPTY_PROFILE },
          }),
        )
      ).status,
    ).toBe(409);
    expect((await t.db.select().from(userProfile))[0]?.draft).toEqual(values);
  });
  test("all other roles and seats survive registration", async () => {
    for (const role of ["athlete", "staff", "admin", "staff,admin", "participant"]) {
      const id = `registered-${role}`;
      await t.seedUser(id, { role });
      const photo = await upload(png, "image/png", id);
      const res = await app.request(
        "/profile/submit",
        t.as(id, { method: "POST", json: { userId: id, revision: 0, values: await valid(photo) } }),
      );
      expect(res.status).toBe(200);
      expect(defined((await t.db.select().from(user).where(eq(user.id, id)))[0]).role).toBe(role);
    }
  });
  test("foreign photos and account-switch writes are refused", async () => {
    const photo = await upload(png, "image/png", "other");
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", {
            method: "POST",
            json: { userId: "guest", revision: 0, values: await valid(photo) },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("other", {
            method: "PUT",
            json: { userId: "guest", revision: 0, values: EMPTY_PROFILE },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/profile/draft",
          t.as("guest", {
            method: "PUT",
            json: {
              userId: "guest",
              revision: 0,
              values: { ...EMPTY_PROFILE, photoFileId: photo },
            },
          }),
        )
      ).status,
    ).toBe(400);
    expect((await app.request("/profile/me", t.as(null))).status).toBe(401);
  });
  test("a role change during submission rolls back the whole transaction", async () => {
    const photo = await upload();
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set role = 'admin' where id = 'guest'");
    };
    expect(
      (
        await app.request(
          "/profile/submit",
          t.as("guest", {
            method: "POST",
            json: { userId: "guest", revision: 0, values: await valid(photo) },
          }),
        )
      ).status,
    ).toBe(409);
    expect(await t.db.select().from(userProfile)).toEqual([]);
    expect(defined((await t.db.select().from(user).where(eq(user.id, "guest")))[0]).role).toBe(
      "admin",
    );
  });
});

describe("staff quota controls", () => {
  for (const actor of ["tech", "registration"]) {
    test(`revoking ${actor}'s department code during a quota update fails closed`, async () => {
      t.hooks.beforeBatch = () => {
        t.hooks.beforeBatch = undefined;
        t.sqlite.run(
          "update department set code = null where id = (select department_id from user where id = ?)",
          [actor],
        );
      };
      expect(
        (
          await app.request(
            "/users/guest/storage",
            t.as(actor, {
              method: "PUT",
              json: { storageLimit: 0, expectedLimit: GiB },
            }),
          )
        ).status,
      ).toBe(409);
      expect(
        defined((await t.db.select().from(user).where(eq(user.id, "guest")))[0]).storageLimit,
      ).toBe(GiB);
    });
  }
  test("only admins and manager departments may set quota", async () => {
    for (const actor of ["guest", "other", "art"])
      expect(
        (
          await app.request(
            "/users/guest/storage",
            t.as(actor, { method: "PUT", json: { storageLimit: 100, expectedLimit: GiB } }),
          )
        ).status,
      ).toBe(403);
    for (const actor of ["tech", "registration", "admin"]) {
      await t.db.update(user).set({ storageLimit: GiB }).where(eq(user.id, "guest"));
      expect(
        (
          await app.request(
            "/users/guest/storage",
            t.as(actor, { method: "PUT", json: { storageLimit: 100, expectedLimit: GiB } }),
          )
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await app.request(
          "/users/admin/storage",
          t.as("tech", { method: "PUT", json: { storageLimit: 100, expectedLimit: GiB } }),
        )
      ).status,
    ).toBe(403);
  });
  test("lowering below usage keeps files and blocks new uploads", async () => {
    const id = await upload();
    expect(
      (
        await app.request(
          "/users/guest/storage",
          t.as("admin", { method: "PUT", json: { storageLimit: 0, expectedLimit: GiB } }),
        )
      ).status,
    ).toBe(200);
    expect((await app.request(`/files/public/${id}`)).status).toBe(200);
    expect((await reserve(1)).status).toBe(409);
  });
  test("manager revocation during a quota update fails closed", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("update user set department_id = null where id = 'tech'");
    };
    expect(
      (
        await app.request(
          "/users/guest/storage",
          t.as("tech", { method: "PUT", json: { storageLimit: 0, expectedLimit: GiB } }),
        )
      ).status,
    ).toBe(409);
    expect(
      defined((await t.db.select().from(user).where(eq(user.id, "guest")))[0]).storageLimit,
    ).toBe(GiB);
  });
});
