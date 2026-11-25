import { describe, expect, test } from "bun:test";

import { checkinMatch } from "./fixtures";
import { matchWhere, windowLabel } from "./match-checkin-card";
import { describeScan } from "./scan-result";

const PERSON = {
  userId: "p1",
  name: "สมชาย",
  image: null,
  institution: "kmutt" as const,
  shirtNumber: null,
};

describe("describeScan", () => {
  test("an athlete already in is a warning with the time they came", () => {
    const view = describeScan(
      {
        code: "duplicate",
        checkedInAt: "2026-12-05T03:02:00.000Z",
        person: PERSON,
        match: checkinMatch(),
        side: { participantId: "s-2", label: "มจธ.", checkedIn: 1, min: 2 },
      },
      null,
    );
    expect(view).toMatchObject({
      tone: "warning",
      title: "รายงานตัวไปแล้วเมื่อ 10:02",
      name: "สมชาย",
      institution: "มจธ.",
      matchLine: "ฟุตบอล · รอบแบ่งกลุ่ม · M3",
      countLine: "มจธ. รายงานตัวแล้ว 1 / 2 คน",
    });
  });

  test("refusals and network failures are errors with their message", () => {
    expect(
      describeScan({ code: "not-in-lineup", message: "ไม่อยู่ในรายชื่อ", person: PERSON }, null),
    ).toMatchObject({ tone: "error", title: "ไม่อยู่ในรายชื่อ", countLine: null });
    expect(describeScan(null, "เชื่อมต่อไม่ได้")).toMatchObject({
      tone: "error",
      title: "เชื่อมต่อไม่ได้",
      person: null,
    });
  });
});

describe("match labels", () => {
  test("say when check-in opens, closes or has closed", () => {
    const match = checkinMatch();
    expect(windowLabel(match.window)).toBe("เปิดรายงานตัว ถึง 10:30");
    expect(
      windowLabel({ ...(match.window as NonNullable<typeof match.window>), state: "early" }),
    ).toBe("เปิดรายงานตัว 10:00");
    expect(
      windowLabel({ ...(match.window as NonNullable<typeof match.window>), state: "closed" }),
    ).toBe("ปิดรายงานตัวแล้ว");
    expect(windowLabel(null)).toBe("ยังไม่กำหนดเวลา");
    expect(matchWhere({ ...match, court: "คอร์ต 1" })).toBe("10:40 · สนามฟุตบอล · คอร์ต 1");
  });
});
