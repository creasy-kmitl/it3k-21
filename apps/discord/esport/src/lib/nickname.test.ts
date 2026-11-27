import { describe, expect, test } from "bun:test";

import type { MemberInfo } from "./api";
import { NICKNAME_MAX, nicknameFor } from "./nickname";

type Linked = Extract<MemberInfo, { linked: true }>;
type Entry = Linked["esports"][number];

const tft = (fields: Partial<Entry> = {}): Entry => ({
  divisionCode: "esports-tft",
  divisionName: "TFT",
  sportName: "กีฬา Esports",
  institution: "kmutt",
  ign: "TonTFT",
  ...fields,
});

const member = (fields: Partial<Linked> = {}): MemberInfo => ({
  linked: true,
  banned: false,
  staff: false,
  nickname: "ต้น",
  institution: null,
  department: null,
  esports: [],
  ...fields,
});

describe("nicknameFor", () => {
  test("an athlete is their team and in-game name", () => {
    expect(nicknameFor(member({ esports: [tft()] }))).toBe("[มจธ.] TonTFT");
  });

  test("an athlete without an in-game name falls back to their nickname", () => {
    expect(nicknameFor(member({ esports: [tft({ ign: "  " })] }))).toBe("[มจธ.] ต้น");
  });

  test("the team wins over staff; staff alone get the Staff tag", () => {
    expect(nicknameFor(member({ staff: true, esports: [tft()] }))).toBe("[มจธ.] TonTFT");
    expect(nicknameFor(member({ staff: true }))).toBe("[Staff] ต้น");
  });

  test("a game without rooms here does not count as the team", () => {
    const valorant = tft({ divisionCode: "esports-valorant", divisionName: "Valorant" });
    expect(nicknameFor(member({ institution: "kmitl", esports: [valorant] }))).toBe("[สจล.] ต้น");
  });

  test("others get their institution, or just the nickname", () => {
    expect(nicknameFor(member({ institution: "kmutnb-bangkok" }))).toBe("[มจพ. กรุงเทพฯ] ต้น");
    expect(nicknameFor(member())).toBe("ต้น");
  });

  test("nothing to go on leaves the name alone", () => {
    expect(nicknameFor(member({ nickname: null }))).toBeNull();
    expect(nicknameFor(member({ staff: true, nickname: " " }))).toBeNull();
    expect(nicknameFor(member({ banned: true, esports: [tft()] }))).toBeNull();
    expect(nicknameFor({ linked: false, linkUrl: "https://x/me" })).toBeNull();
  });

  test("never longer than Discord allows, and the tag is kept", () => {
    const name = nicknameFor(member({ esports: [tft({ ign: "x".repeat(60) })] }));
    expect(name?.length).toBe(NICKNAME_MAX);
    expect(name?.startsWith("[มจธ.] ")).toBe(true);
  });
});
