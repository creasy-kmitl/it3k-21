import { describe, expect, test } from "bun:test";

import { homeActions } from "./index";

const labels = (role: string | null, signedIn = true) =>
  homeActions(role, signedIn).map(({ label, to }) => `${label} ${to}`);

describe("homeActions", () => {
  test("someone signed out is asked to sign in", () => {
    expect(labels(null, false)).toEqual(["เข้าสู่ระบบ /login"]);
  });

  test("a guest registers", () => {
    expect(labels("guest")).toEqual(["ลงทะเบียนเข้าร่วม /signup"]);
    expect(labels(null)).toEqual(["ลงทะเบียนเข้าร่วม /signup"]);
  });

  test("a participant finds events or signs up as an athlete", () => {
    expect(labels("participant")).toEqual(["ค้นหากิจกรรม /events", "สมัครนักกีฬา /sports"]);
  });

  test("an athlete goes to their profile", () => {
    expect(labels("athlete")).toEqual(["โปรไฟล์ /me"]);
  });

  test("staff and admins go to the staff system, whatever else they hold", () => {
    for (const role of ["staff", "admin", "staff,athlete", "participant,staff"])
      expect(labels(role)).toEqual(["ระบบทีมงาน /staff/dashboard"]);
  });
});
