import { beforeEach, describe, expect, test } from "bun:test";
import { event } from "@it3k/db/schema/index";

import { createTestContext, readJson } from "../../testing";
import { createVenueRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createVenueRoutes>;

const hall = {
  name: "หอประชุมเจ้าพระยาสุรวงษ์ฯ",
  description: "",
  latitude: 13.7299,
  longitude: 100.7782,
  externalUrl: "https://maps.app.goo.gl/example",
};

beforeEach(async () => {
  t = createTestContext();
  app = createVenueRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt", seat: "vicehead" });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("athlete", { role: "participant" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

describe("venues", () => {
  test("members read venues; participants do not", async () => {
    await send("tech", "POST", "/", hall);
    const read = await send("art", "GET", "/");
    expect(read.res.status).toBe(200);
    expect(read.body).toMatchObject({ items: [{ name: hall.name }], canManage: false });
    expect((await send("athlete", "GET", "/")).res.status).toBe(403);
  });

  test("only catalog managers create, edit and delete", async () => {
    for (const who of ["reg-staff", "reg-kmutt", "art"]) {
      expect((await send(who, "POST", "/", hall)).res.status).toBe(403);
    }
    const created = await send("tech", "POST", "/", hall);
    expect(created.res.status).toBe(201);
    expect(created.body).toMatchObject({ description: null, latitude: 13.7299 });
    const id = created.body.id as string;

    const edited = await send("admin", "PUT", `/${id}`, {
      ...hall,
      latitude: null,
      longitude: null,
      externalUrl: "",
    });
    expect(edited.res.status).toBe(200);
    expect(edited.body).toMatchObject({ latitude: null, externalUrl: null });
    expect((await send("reg-staff", "DELETE", `/${id}`)).res.status).toBe(403);
    expect((await send("tech", "DELETE", `/${id}`)).res.status).toBe(200);
    expect((await send("tech", "DELETE", `/${id}`)).res.status).toBe(404);
  });

  test("names are unique and a position needs both coordinates", async () => {
    await send("tech", "POST", "/", hall);
    expect((await send("tech", "POST", "/", hall)).res.status).toBe(409);
    const half = await send("tech", "POST", "/", { ...hall, name: "สนามกีฬา", longitude: null });
    expect(half.res.status).toBe(400);
    expect(
      (await send("tech", "POST", "/", { ...hall, name: "x", externalUrl: "http://x.test" })).res
        .status,
    ).toBe(400);
  });

  test("a venue with events cannot be deleted", async () => {
    const { body } = await send("tech", "POST", "/", hall);
    await t.db.insert(event).values({
      type: "general",
      name: "ปฐมนิเทศ",
      startAt: new Date(Date.UTC(2026, 11, 1, 2)),
      endAt: new Date(Date.UTC(2026, 11, 1, 4)),
      venueId: body.id as string,
    });
    const res = await send("tech", "DELETE", `/${body.id as string}`);
    expect(res.res.status).toBe(409);
    expect(res.body.message).toBe("สถานที่นี้มีกิจกรรมอยู่ จึงลบไม่ได้");
  });

  test("a write is refused when the actor lost the right since reading it", async () => {
    t.hooks.beforeBatch = () => {
      t.sqlite.run(
        `update user set department_id = (select id from department where name = 'Art') where id = 'tech'`,
      );
    };
    expect((await send("tech", "POST", "/", hall)).res.status).toBe(409);
  });
});
