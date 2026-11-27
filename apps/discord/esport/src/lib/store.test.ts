import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModeStore } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("mode store", () => {
  test("falls back until a mode is set", () => {
    const store = createModeStore(":memory:", "prod");
    expect(store.get()).toBe("prod");
    store.set("stg");
    expect(store.get()).toBe("stg");
    store.set("dev");
    expect(store.get()).toBe("dev");
  });

  test("keeps the mode across restarts, creating the folder it needs", () => {
    const dir = mkdtempSync(join(tmpdir(), "esport-bot-"));
    dirs.push(dir);
    const path = join(dir, "nested", "bot.sqlite");

    const first = createModeStore(path, "dev");
    first.set("prod");
    first.close();

    const second = createModeStore(path, "dev");
    expect(second.get()).toBe("prod");
    second.close();
  });
});
