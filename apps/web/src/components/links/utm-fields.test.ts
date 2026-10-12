import { describe, expect, test } from "bun:test";

import { readUtm, withUtm } from "./utm-fields";

describe("UTM on a destination", () => {
  test("reads what is there and blanks the rest", () => {
    expect(readUtm("https://a.example/?utm_source=poster&x=1")).toEqual({
      utm_source: "poster",
      utm_medium: "",
      utm_campaign: "",
    });
    expect(readUtm("not a url")).toEqual({ utm_source: "", utm_medium: "", utm_campaign: "" });
  });

  test("sets and removes one parameter, keeping the others", () => {
    const url = withUtm("https://a.example/form?id=7", "utm_medium", "qr");
    expect(url).toBe("https://a.example/form?id=7&utm_medium=qr");
    expect(withUtm(url, "utm_medium", "")).toBe("https://a.example/form?id=7");
  });

  test("keeps spaces typed between words", () => {
    const url = withUtm("https://a.example/", "utm_campaign", "it3k 21");
    expect(readUtm(url).utm_campaign).toBe("it3k 21");
  });

  test("leaves a destination that is not a URL alone", () => {
    expect(withUtm("forms.example", "utm_source", "x")).toBe("forms.example");
  });
});
