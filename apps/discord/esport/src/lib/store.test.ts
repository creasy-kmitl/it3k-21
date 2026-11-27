import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createBotStore } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("bot store", () => {
  test("the mode falls back until one is set", () => {
    const store = createBotStore(":memory:", "prod");
    expect(store.getMode()).toBe("prod");
    store.setMode("stg");
    expect(store.getMode()).toBe("stg");
    store.setMode("dev");
    expect(store.getMode()).toBe("dev");
  });

  test("init_done can be set and reset", () => {
    const store = createBotStore(":memory:", "dev");
    expect(store.initDone()).toBe(false);
    store.setInitDone(true);
    expect(store.initDone()).toBe(true);
    store.setInitDone(false);
    expect(store.initDone()).toBe(false);
  });

  test("Discord ids are stored, replaced and removed by key", () => {
    const store = createBotStore(":memory:", "dev");
    expect(store.getId("role:staff")).toBeUndefined();
    store.setId("role:staff", "111");
    store.setId("role:staff", "222");
    expect(store.getId("role:staff")).toBe("222");
    store.deleteId("role:staff");
    expect(store.getId("role:staff")).toBeUndefined();
  });

  test("everything survives a restart, creating the folder it needs", () => {
    const dir = mkdtempSync(join(tmpdir(), "esport-bot-"));
    dirs.push(dir);
    const path = join(dir, "nested", "bot.sqlite");

    const first = createBotStore(path, "dev");
    first.setMode("prod");
    first.setInitDone(true);
    first.setId("channel:honeypot", "333");
    first.close();

    const second = createBotStore(path, "dev");
    expect(second.getMode()).toBe("prod");
    expect(second.initDone()).toBe(true);
    expect(second.getId("channel:honeypot")).toBe("333");
    second.close();
  });
});
