import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";

import {
  RegistrationFieldsEditor,
  facebookLink,
  facebookUsername,
  parseDraft,
  toDraft,
} from "./registration-fields";

afterEach(cleanup);

const esports = {
  requiresShirtNumber: false,
  requiresBadmintonRank: false,
  requiresGameProfile: true,
};

describe("facebookUsername", () => {
  test.each([
    ["jane.doe", "jane.doe"],
    ["@jane.doe", "jane.doe"],
    ["  jane.doe  ", "jane.doe"],
    ["https://www.facebook.com/jane.doe", "jane.doe"],
    ["https://www.facebook.com/jane.doe/?mibextid=ZbWKwL", "jane.doe"],
    ["http://m.facebook.com/jane.doe#about", "jane.doe"],
    ["facebook.com/jane.doe", "jane.doe"],
    ["web.facebook.com/jane.doe/", "jane.doe"],
    ["https://fb.com/jane.doe", "jane.doe"],
    [
      "https://www.facebook.com/profile.php?id=100012345678&mibextid=x",
      "profile.php?id=100012345678",
    ],
    ["profile.php?id=100012345678", "profile.php?id=100012345678"],
    ["https://facebook.com/", ""],
  ])("%p → %p", (input, expected) => {
    expect(facebookUsername(input)).toBe(expected);
  });

  test("a look-alike host is not treated as a link", () => {
    expect(facebookUsername("https://notfacebook.com/x")).toBe("https://notfacebook.com/x");
  });
});

describe("the stored link", () => {
  test("is built from the username, and read back as one", () => {
    expect(facebookLink("jane.doe")).toBe("https://facebook.com/jane.doe");
    expect(facebookLink("")).toBe("");
    expect(toDraft({ facebookUrl: "https://www.facebook.com/jane.doe/" }).facebookUrl).toBe(
      "jane.doe",
    );
  });

  test("parseDraft sends a full link and rejects what cannot be a username", () => {
    const draft = { ...toDraft(), ign: "Faker", ignReading: "เฟเกอร์" };
    const ok = parseDraft(esports, { ...draft, facebookUrl: "jane.doe" });
    expect(ok).toMatchObject({
      ok: true,
      fields: { facebookUrl: "https://facebook.com/jane.doe" },
    });

    expect(parseDraft(esports, { ...draft, facebookUrl: "jane doe" })).toEqual({
      ok: false,
      issues: { facebookUrl: "ชื่อผู้ใช้ Facebook ใช้ได้แค่ตัวอักษรอังกฤษ ตัวเลข และจุด" },
    });
    expect(parseDraft(esports, { ...draft, facebookUrl: "" })).toMatchObject({
      ok: false,
      issues: { facebookUrl: "กรอกชื่อผู้ใช้ Facebook" },
    });
  });
});

describe("the Facebook field", () => {
  function Editor() {
    const [draft, setDraft] = useState(toDraft());
    return (
      <RegistrationFieldsEditor division={esports} draft={draft} issues={{}} onChange={setDraft} />
    );
  }

  test("a pasted link keeps only the username", () => {
    const view = render(<Editor />);
    const input = view.getByLabelText("Facebook") as HTMLInputElement;
    fireEvent.paste(input, {
      clipboardData: { getData: () => "https://www.facebook.com/jane.doe/?mibextid=x" },
    });
    expect(input.value).toBe("jane.doe");
  });

  test("a typed link stays as typed until the field is left", () => {
    const view = render(<Editor />);
    const input = view.getByLabelText("Facebook") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "facebook.com" } });
    expect(input.value).toBe("facebook.com");
    fireEvent.change(input, { target: { value: "facebook.com/john.smith/" } });
    fireEvent.blur(input);
    expect(input.value).toBe("john.smith");
  });
});
