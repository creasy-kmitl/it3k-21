import { expect, test } from "bun:test";
import { Hono } from "hono";
import { userProfile } from "@it3k/db/schema/profile";
import { createTestContext, defined } from "../../../server/src/testing";
import { createProfileRoutes } from "../../../server/src/routes/profile";
import { createProfileApi } from "./profile";
import { EMPTY_PROFILE, profileSchema, suggestedInstitution } from "@it3k/db/profile";
import { DraftSaver } from "./draft-saver";
import { ApiError } from "./leadership";

test("debounces changes and saves the newest draft", async () => {
  const calls: string[] = [];
  const saver = new DraftSaver(
    0,
    async (_revision, values) => {
      calls.push(values.firstName);
      return { revision: 1 };
    },
    () => undefined,
    10,
  );
  saver.change({ ...EMPTY_PROFILE, firstName: "A" });
  saver.change({ ...EMPTY_PROFILE, firstName: "B" });
  expect(calls).toEqual([]);
  await Bun.sleep(30);
  expect(calls).toEqual(["B"]);
  saver.stop();
});
test("serializes in-flight saves and carries revisions forward", async () => {
  const revisions: number[] = [];
  let resolve: (() => void) | undefined;
  const wait = new Promise<void>((done) => {
    resolve = done;
  });
  const saver = new DraftSaver(
    5,
    async (revision) => {
      revisions.push(revision);
      if (revision === 5) await wait;
      return { revision: revision + 1 };
    },
    () => undefined,
    10000,
  );
  saver.change({ ...EMPTY_PROFILE, firstName: "A" });
  const saving = saver.flush();
  saver.change({ ...EMPTY_PROFILE, firstName: "B" });
  expect(revisions).toEqual([5]);
  resolve?.();
  await saving;
  expect(revisions).toEqual([5, 6]);
  expect(saver.revision).toBe(7);
  saver.stop();
});
test("failed saves retain the latest values for retry; conflicts never overwrite", async () => {
  let failing = true;
  const saver = new DraftSaver(
    0,
    async () => {
      if (failing) throw new Error("offline");
      return { revision: 1 };
    },
    () => undefined,
  );
  saver.change(EMPTY_PROFILE);
  await expect(saver.flush()).rejects.toThrow("offline");
  failing = false;
  await saver.flush();
  expect(saver.revision).toBe(1);
  saver.stop();
  let calls = 0;
  const conflict = new DraftSaver(
    0,
    async () => {
      calls++;
      throw new ApiError(409, "stale");
    },
    () => undefined,
  );
  conflict.change(EMPTY_PROFILE);
  await expect(conflict.flush()).rejects.toThrow("stale");
  conflict.change(EMPTY_PROFILE);
  await expect(conflict.flush()).rejects.toThrow();
  expect(calls).toBe(1);
  conflict.stop();
});
test("a definite validation rejection can be corrected without retrying invalid values", async () => {
  const calls: string[] = [];
  const saver = new DraftSaver(
    0,
    async (revision, values) => {
      calls.push(values.firstName);
      if (values.firstName === "Invalid") throw new ApiError(400, "Invalid field");
      return { revision: revision + 1 };
    },
    () => {},
    60000,
  );
  try {
    saver.change({ ...EMPTY_PROFILE, firstName: "Invalid" });
    await expect(saver.flush()).rejects.toThrow("Invalid field");
    saver.change({ ...EMPTY_PROFILE, firstName: "Fixed" });
    await saver.flush();
    expect(calls).toEqual(["Invalid", "Fixed"]);
    expect(saver.revision).toBe(1);
  } finally {
    saver.stop();
  }
});
test("institution inference never guesses a KMUTNB campus or overrides personal email", () => {
  expect(suggestedInstitution("user@kmitl.ac.th")).toBe("kmitl");
  expect(suggestedInstitution("USER@mail.KMUTT.ac.th")).toBe("kmutt");
  expect(suggestedInstitution("s123@email.kmutnb.ac.th")).toBe("");
  expect(suggestedInstitution("a@gmail.com")).toBe("");
  expect(suggestedInstitution("a@evilkmitl.ac.th")).toBe("");
});
test("submission requires identity and photo but optional medical fields may be blank", () => {
  expect(profileSchema.safeParse(EMPTY_PROFILE).success).toBe(false);
  const values = {
    ...EMPTY_PROFILE,
    prefix: "นาย",
    firstName: "สมชาย",
    lastName: "ใจดี",
    nickname: "ชาย",
    phone: "+66812345678",
    photoFileId: crypto.randomUUID(),
    institution: "kmitl",
  };
  expect(profileSchema.safeParse(values).success).toBe(true);
  expect(profileSchema.safeParse({ ...values, phone: "abc" }).success).toBe(false);
});

test("a lost HTTP response is acknowledged before newer edits are saved", async () => {
  const t = createTestContext();
  await t.seedUser("guest", { role: "guest" });
  const app = new Hono().route("/api/profile", createProfileRoutes(t.deps));
  let loseResponse = true;
  const requests: { revision: number; values: { firstName: string } }[] = [];
  const api = createProfileApi(
    "http://localhost",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      request.headers.set("x-test-user", "guest");
      requests.push(await request.clone().json());
      const response = await app.request(request);
      if (loseResponse) {
        loseResponse = false;
        await response.text();
        throw new TypeError("Network response lost");
      }
      return response;
    },
  );
  const saver = new DraftSaver(
    0,
    (revision, values) => api.saveDraft(revision, values, "guest"),
    () => {},
    60000,
  );
  try {
    saver.change({ ...EMPTY_PROFILE, firstName: "A" });
    await expect(saver.flush()).rejects.toThrow("Network response lost");
    saver.change({ ...EMPTY_PROFILE, firstName: "B" });
    await saver.flush();
    expect(requests.map(({ revision, values }) => [revision, values.firstName])).toEqual([
      [0, "A"],
      [0, "A"],
      [1, "B"],
    ]);
    expect(saver.revision).toBe(2);
    expect(defined((await t.db.select().from(userProfile))[0])).toMatchObject({
      revision: 2,
      draft: { firstName: "B" },
    });
  } finally {
    saver.stop();
  }
});
