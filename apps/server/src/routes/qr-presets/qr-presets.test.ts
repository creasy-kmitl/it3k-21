import { beforeEach, describe, expect, test } from "bun:test";

import { createTestContext, readJson } from "../../testing";
import { createQrPresetRoutes } from ".";

let t: ReturnType<typeof createTestContext>;
let app: ReturnType<typeof createQrPresetRoutes>;

const DESIGN = {
  dotStyle: "circle",
  markerBorder: "rounded",
  markerCenter: "circle",
  dotColor: "#1e3a8a",
  markerColor: "#1e3a8a",
  background: "#ffffff",
  logo: null,
  quietZone: 4,
  ecc: "Q",
  exportSize: 1024,
};

type Preset = { id: string; name: string; design: typeof DESIGN; canEdit: boolean };

beforeEach(async () => {
  t = createTestContext();
  app = createQrPresetRoutes(t.deps);
  await t.seedUser("admin", { role: "admin" });
  await t.seedUser("art", { department: "Art" });
  await t.seedUser("art-2", { department: "Art" });
  await t.seedUser("tech", { department: "Tech/Live" });
  await t.seedUser("guest", { role: "guest" });
});

async function send<T = Record<string, unknown>>(
  userId: string,
  method: string,
  path: string,
  json?: unknown,
) {
  const res = await app.request(path, t.as(userId, { method, json }));
  return { res, body: (await readJson(res)) as T };
}

async function save(name = "โปสเตอร์ PR", who = "art") {
  const { res, body } = await send<Preset>(who, "POST", "/", { name, design: DESIGN });
  expect(res.status).toBe(201);
  return body;
}

describe("QR presets", () => {
  test("any member saves one and everyone sees it, sorted by name", async () => {
    await save("ข");
    await save("ก", "tech");
    const { body } = await send<{ items: Preset[]; canCreate: boolean }>("art-2", "GET", "/");
    expect(body.items.map((preset) => preset.name)).toEqual(["ก", "ข"]);
    expect(body.items[1]?.design).toEqual(DESIGN);
    expect(body.items.map((preset) => preset.canEdit)).toEqual([false, false]);
    expect(body.canCreate).toBe(true);
    expect((await send("guest", "GET", "/")).res.status).toBe(403);
  });

  test("refuses designs QR Studio could not draw", async () => {
    for (const design of [
      { ...DESIGN, dotColor: "red" },
      { ...DESIGN, quietZone: 2 },
      { ...DESIGN, exportSize: 300 },
      { ...DESIGN, logo: { dataUrl: "data:image/svg+xml;base64,AAAA", size: 0.2 } },
      { ...DESIGN, logo: { dataUrl: "data:image/png;base64,AAAA", size: 0.5 } },
      { ...DESIGN, extra: true },
    ]) {
      const { res } = await send("art", "POST", "/", { name: "x", design });
      expect(res.status).toBe(400);
    }
  });

  test("the owner, admins and Tech/Live edit and delete; others cannot", async () => {
    const preset = await save();
    expect((await send("art-2", "PATCH", `/${preset.id}`, { name: "mine" })).res.status).toBe(403);
    expect((await send("art-2", "DELETE", `/${preset.id}`)).res.status).toBe(403);
    const renamed = await send<Preset>("tech", "PATCH", `/${preset.id}`, { name: "บัตรนักกีฬา" });
    expect(renamed.body.name).toBe("บัตรนักกีฬา");
    const redesigned = await send<Preset>("art", "PATCH", `/${preset.id}`, {
      design: { ...DESIGN, dotStyle: "joined" },
    });
    expect(redesigned.body.design.dotStyle).toBe("joined");
    expect((await send("admin", "DELETE", `/${preset.id}`)).res.status).toBe(200);
    expect((await send("art", "GET", "/")).body.items).toEqual([]);
  });
});
