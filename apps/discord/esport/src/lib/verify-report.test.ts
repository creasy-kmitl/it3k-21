import { describe, expect, test } from "bun:test";

import type { RoleKey } from "./layout";
import { type LinkedMember, type SyncOutcome, verifyReport } from "./verify-report";

const ROLE_IDS: Partial<Record<RoleKey, string>> = {
  staff: "1",
  "game:tft": "2",
  "team:tft:kmutt": "3",
};

const info = (fields: Partial<LinkedMember> = {}): LinkedMember => ({
  linked: true,
  banned: false,
  staff: true,
  nickname: "ต้น",
  institution: "kmutt",
  department: "Tech/Live",
  esports: [
    {
      divisionCode: "esports-tft",
      divisionName: "TFT",
      sportName: "กีฬา Esports",
      institution: "kmutt",
      ign: "TonTFT",
    },
  ],
  ...fields,
});

const outcome = (fields: Partial<SyncOutcome> = {}): SyncOutcome => ({
  info: info(),
  keep: ["staff", "game:tft", "team:tft:kmutt"],
  removed: [],
  roleError: null,
  nickname: { status: "set", value: "[มจธ.] TonTFT" },
  ...fields,
});

const report = (o: SyncOutcome) =>
  verifyReport(o, { userId: "42", avatarUrl: "https://cdn/a.png", roleId: (k) => ROLE_IDS[k] });
const field = (o: SyncOutcome, name: string) =>
  report(o).body.fields?.find((f) => f.name.includes(name))?.value;

describe("verifyReport", () => {
  test("a full success shows who they are, their roles as mentions and their nickname", () => {
    const { tone, body } = report(outcome());
    expect(tone).toBe("success");
    expect(body.title).toBe("ยืนยันตัวตนเรียบร้อย");
    expect(body.description).toContain("<@42>");
    expect(body.thumbnail).toBe("https://cdn/a.png");
    expect(field(outcome(), "ชื่อในเซิร์ฟเวอร์")).toBe("`[มจธ.] TonTFT`");
    expect(field(outcome(), "สถาบัน")).toBe("มจธ.");
    expect(field(outcome(), "ทีมงาน")).toBe("Tech/Live");
    expect(field(outcome(), "รายการแข่ง")).toBe("♟️ **TFT** · ทีม มจธ. · IGN `TonTFT`");
    expect(field(outcome(), "ยศ")).toBe("<@&1> <@&2> <@&3>");
  });

  test("roles taken away are listed", () => {
    expect(field(outcome({ removed: ["9"] }), "ถอดยศ")).toBe("<@&9>");
    expect(field(outcome(), "ถอดยศ")).toBeUndefined();
  });

  test("a nickname or role failure turns it into a warning with the reason", () => {
    const failed = outcome({
      nickname: { status: "failed", value: "[มจธ.] TonTFT", reason: "ยศของคุณอยู่สูงกว่ายศของบอท" },
    });
    expect(report(failed).tone).toBe("warning");
    expect(field(failed, "ชื่อในเซิร์ฟเวอร์")).toContain("ยศของคุณอยู่สูงกว่ายศของบอท");
    const roles = outcome({ keep: [], roleError: "no permission" });
    expect(report(roles).tone).toBe("warning");
    expect(field(roles, "ให้ยศไม่สำเร็จ")).toBe("no permission");
  });

  test("linked with nothing to give is information, not success", () => {
    const none = outcome({
      info: info({ staff: false, esports: [], department: null }),
      keep: [],
      nickname: { status: "none" },
    });
    const { tone, body } = report(none);
    expect(tone).toBe("info");
    expect(body.title).toBe("เชื่อมบัญชีแล้ว แต่ยังไม่มียศ");
    expect(field(none, "ทีมงาน")).toBeUndefined();
    expect(field(none, "รายการแข่ง")).toBeUndefined();
  });
});
