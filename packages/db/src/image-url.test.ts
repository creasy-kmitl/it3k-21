import { describe, expect, test } from "bun:test";

import { imageUrlSchema } from "./image-url";

describe("imageUrlSchema", () => {
  test("takes blank, https, and the local dev API's own http address", () => {
    for (const value of [
      "",
      "https://cdn.example/a.png",
      "http://localhost:3000/api/files/public/f-1",
      "http://127.0.0.1:3000/api/files/public/f-1",
    ]) {
      expect(imageUrlSchema.safeParse(value).success).toBe(true);
    }
  });

  test("refuses other http links and other schemes", () => {
    for (const value of [
      "http://cdn.example/a.png",
      "http://localhost.evil.example/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
    ]) {
      expect(imageUrlSchema.safeParse(value).success).toBe(false);
    }
  });
});
