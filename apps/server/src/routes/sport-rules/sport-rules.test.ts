import { beforeEach, describe, expect, test } from "bun:test";
import { sport, sportDivision, sportRule } from "@it3k/db/schema/index";
import { RULES_MAX_LENGTH } from "@it3k/db/sport-rules";
import { eq } from "drizzle-orm";

import { createTestContext, defined, readJson } from "../../testing";
import { createSportRuleRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createSportRuleRoutes>;

beforeEach(async () => {
  t = createTestContext();
  app = createSportRuleRoutes(t.deps);
  await t.seedUser("admin", { role: "admin", name: "Admin" });
  await t.seedUser("tech-staff", { department: "Tech/Live", name: "Tech" });
  await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
  await t.seedUser("reg-kmutt", { department: "ทะเบียน", institution: "kmutt" });
  await t.seedUser("athlete", { role: "participant" });
});

async function send(userId: string, method: string, path: string, json?: unknown) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: await readJson(res) };
}

async function sportId(code: string) {
  const [row] = await t.db.select({ id: sport.id }).from(sport).where(eq(sport.code, code));
  return defined(row).id;
}

async function divisionId(code: string) {
  const [row] = await t.db
    .select({ id: sportDivision.id })
    .from(sportDivision)
    .where(eq(sportDivision.code, code));
  return defined(row).id;
}

type RulesBody = { markdown: string; version: number; updatedByName: string | null } | null;

describe("seeded rules", () => {
  test("ball sports carry the IT3K 21 announcement on the sport", async () => {
    const { res, body } = await send("athlete", "GET", `/sports/${await sportId("football")}`);
    expect(res.status).toBe(200);
    const rules = body.rules as RulesBody;
    expect(rules?.markdown.startsWith("# กีฬาฟุตบอล")).toBe(true);
    expect(rules?.version).toBe(1);
    expect(body.canEdit).toBe(false);
  });

  test("folk games and esports carry theirs on each division", async () => {
    const folk = await send("athlete", "GET", `/sports/${await sportId("esports")}`);
    expect(folk.body.rules).toBeNull();
    const divisions = folk.body.divisions as { name: string; hasOwnRules: boolean }[];
    expect(divisions.every((division) => division.hasOwnRules)).toBe(true);

    const rov = await send("athlete", "GET", `/divisions/${await divisionId("esports-rov")}`);
    expect((rov.body.rules as RulesBody)?.markdown).toContain("ROV");
    expect(rov.body.sportRules).toBeNull();
  });

  test("a division without its own rules shows its sport's", async () => {
    const { body } = await send(
      "athlete",
      "GET",
      `/divisions/${await divisionId("badminton-singles-male")}`,
    );
    expect(body.rules).toBeNull();
    expect((body.sportRules as RulesBody)?.markdown.startsWith("# กีฬาแบดมินตัน")).toBe(true);
  });
});

describe("writing", () => {
  test("rule editors add, change and remove a sport's rules", async () => {
    const folk = await sportId("folk");
    const created = await send("tech-staff", "PUT", `/sports/${folk}`, {
      markdown: "# กีฬาพื้นบ้าน\r\n\r\nกติกาทั่วไป\n\n",
      version: 0,
    });
    expect(created.res.status).toBe(200);
    expect(created.body.rules).toMatchObject({
      markdown: "# กีฬาพื้นบ้าน\n\nกติกาทั่วไป",
      version: 1,
      updatedByName: "Tech",
    });

    const changed = await send("reg-staff", "PUT", `/sports/${folk}`, {
      markdown: "# ใหม่",
      version: 1,
    });
    expect(changed.res.status).toBe(200);
    expect(changed.body.rules).toMatchObject({ markdown: "# ใหม่", version: 2 });

    const removed = await send("admin", "PUT", `/sports/${folk}`, { markdown: "  ", version: 2 });
    expect(removed.res.status).toBe(200);
    expect(removed.body.rules).toBeNull();
    expect(await t.db.select().from(sportRule).where(eq(sportRule.sportId, folk))).toEqual([]);
  });

  test("clearing a division's rules sends it back to its sport's", async () => {
    const rov = await divisionId("esports-rov");
    const { res } = await send("tech-staff", "PUT", `/divisions/${rov}`, {
      markdown: "",
      version: 1,
    });
    expect(res.status).toBe(200);
    const { body } = await send("athlete", "GET", `/divisions/${rov}`);
    expect(body.rules).toBeNull();
  });

  test("a save based on an old read is refused", async () => {
    const football = await sportId("football");
    // Someone else saved since this editor read version 1.
    await send("admin", "PUT", `/sports/${football}`, { markdown: "# แก้แล้ว", version: 1 });

    const update = await send("tech-staff", "PUT", `/sports/${football}`, {
      markdown: "# ของฉัน",
      version: 1,
    });
    expect(update.res.status).toBe(409);
    const create = await send("tech-staff", "PUT", `/sports/${football}`, {
      markdown: "# ของฉัน",
      version: 0,
    });
    expect(create.res.status).toBe(409);
    const clear = await send("tech-staff", "PUT", `/sports/${football}`, {
      markdown: "",
      version: 1,
    });
    expect(clear.res.status).toBe(409);

    const { body } = await send("athlete", "GET", `/sports/${football}`);
    expect((body.rules as RulesBody)?.markdown).toBe("# แก้แล้ว");
  });

  test("an editor who loses the right meanwhile saves nothing", async () => {
    const folk = await sportId("folk");
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run(`update user set department_id = null where id = 'tech-staff'`);
    };
    const { res } = await send("tech-staff", "PUT", `/sports/${folk}`, {
      markdown: "# x",
      version: 0,
    });
    expect(res.status).toBe(409);
    expect(await t.db.select().from(sportRule).where(eq(sportRule.sportId, folk))).toEqual([]);
  });

  test("only rule editors may write", async () => {
    const football = await sportId("football");
    for (const id of ["athlete", "reg-kmutt"]) {
      const { res } = await send(id, "PUT", `/sports/${football}`, { markdown: "# x", version: 1 });
      expect(res.status).toBe(403);
    }
    expect((await send("reg-kmutt", "GET", `/sports/${football}`)).body.canEdit).toBe(false);
    expect((await send("reg-staff", "GET", `/sports/${football}`)).body.canEdit).toBe(true);
  });

  test("long Thai rules fit, but not past the limit", async () => {
    const folk = await sportId("folk");
    // Three bytes each: well past the 64 KiB other routes take.
    const fits = await send("admin", "PUT", `/sports/${folk}`, {
      markdown: "ก".repeat(RULES_MAX_LENGTH),
      version: 0,
    });
    expect(fits.res.status).toBe(200);
    const tooLong = await send("admin", "PUT", `/sports/${folk}`, {
      markdown: "ก".repeat(RULES_MAX_LENGTH + 1),
      version: 1,
    });
    expect(tooLong.res.status).toBe(400);
  });

  test("missing sports and divisions are not found", async () => {
    expect((await send("athlete", "GET", "/sports/nope")).res.status).toBe(404);
    expect((await send("athlete", "GET", "/divisions/nope")).res.status).toBe(404);
    const { res } = await send("admin", "PUT", "/divisions/nope", { markdown: "# x", version: 0 });
    expect(res.status).toBe(404);
  });
});
