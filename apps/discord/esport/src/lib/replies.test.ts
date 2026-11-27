import { describe, expect, test } from "bun:test";

import { notice, reasonOf } from "./replies";

describe("notice", () => {
  test("each tone has its own colour and icon", () => {
    const error = notice("error", { title: "พัง" }).toJSON();
    const success = notice("success", { title: "เรียบร้อย" }).toJSON();
    expect(error.title).toBe("❌ พัง");
    expect(success.title).toBe("✅ เรียบร้อย");
    expect(error.color).not.toBe(success.color);
    expect(notice("warning", { title: "x" }).toJSON().title?.startsWith("⚠️")).toBe(true);
  });

  test("description, fields and footer are optional", () => {
    expect(notice("info", { title: "x" }).toJSON()).not.toHaveProperty("description");
    const full = notice("info", {
      title: "x",
      description: "d",
      fields: [{ name: "API", value: "http://localhost:3000", inline: true }],
      footer: "f",
    }).toJSON();
    expect(full.description).toBe("d");
    expect(full.fields).toEqual([{ name: "API", value: "http://localhost:3000", inline: true }]);
    expect(full.footer?.text).toBe("f");
  });

  test("long text is clipped under Discord's limits", () => {
    const embed = notice("warning", {
      title: "x",
      description: "ก".repeat(5000),
      fields: [{ name: "n", value: "ข".repeat(2000) }],
    }).toJSON();
    expect(embed.description?.length).toBeLessThanOrEqual(4096);
    expect(embed.fields?.[0]?.value.length).toBeLessThanOrEqual(1024);
  });
});

test("reasonOf reads Errors and anything else", () => {
  expect(reasonOf(new Error("ECONNREFUSED"))).toBe("ECONNREFUSED");
  expect(reasonOf("plain")).toBe("plain");
});
