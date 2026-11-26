// Test-only: public competition answers shaped like the API's.
import type { MatchPage, PublicMatch } from "@/lib/public-competition";

// 25 Dec 2026, 10:00 in Bangkok.
export const MORNING = Date.UTC(2026, 11, 25, 3);
export const HOUR = 60 * 60 * 1000;

export function publicMatch(overrides: Partial<PublicMatch> = {}): PublicMatch {
  return {
    id: "m-1",
    parentMatchId: null,
    subOrder: null,
    sport: { id: "s-football", name: "กีฬาฟุตบอล", icon: "football" },
    division: { id: "d-football", code: "football", name: "ฟุตบอล" },
    stageName: "รอบแบ่งกลุ่ม",
    group: { id: "g-a", name: "สาย A" },
    roundNo: null,
    matchNo: 3,
    startAt: MORNING,
    startedAt: null,
    finishedAt: null,
    venue: { id: "v-field", name: "สนามฟุตบอล" },
    court: null,
    status: "scheduled",
    outcome: null,
    friendly: false,
    coverImageUrl: null,
    scoring: {
      engine: "points",
      buttons: [1],
      periods: { count: 2, label: "ครึ่ง" },
      overtime: null,
      targetScore: null,
      targetWinBy: null,
      allowDraw: true,
      shootout: null,
      clock: null,
    },
    live: null,
    sides: [
      {
        id: "p-1",
        slot: 1,
        name: "สจล.",
        team: { id: "t-1", name: "สจล.", institution: "kmitl" },
        sourceMatchId: null,
        sourceResult: null,
        score: null,
        detail: null,
        resultValue: null,
        rank: null,
        outcome: null,
      },
      {
        id: "p-2",
        slot: 2,
        name: "มจธ.",
        team: { id: "t-2", name: "มจธ.", institution: "kmutt" },
        sourceMatchId: null,
        sourceResult: null,
        score: null,
        detail: null,
        resultValue: null,
        rank: null,
        outcome: null,
      },
    ],
    ...overrides,
  };
}

export function matchPage(overrides: Partial<MatchPage> = {}): MatchPage {
  const base = publicMatch({
    status: "live",
    live: { period: 2, phase: "regular", decided: false, clock: null },
  });
  return {
    ...base,
    sides: base.sides.map((side, index) => ({
      ...side,
      score: index === 0 ? 2 : 1,
      members:
        index === 0
          ? [
              { name: "สมชาย", shirtNumber: 10, role: "starter" as const },
              { name: "สมศักดิ์", shirtNumber: 7, role: "sub" as const },
            ]
          : [{ name: "มานะ", shirtNumber: 9, role: null }],
      officials:
        index === 0
          ? [{ name: "โค้ชเอ", position: "ผู้ฝึกสอน", description: null, photoUrl: null }]
          : [],
    })),
    referees: [{ name: "กรรมการบี", role: "ผู้ตัดสิน" }],
    images: [],
    rules: "## กติกาฟุตบอล",
    timeline: [
      {
        id: "e-1",
        at: MORNING + HOUR / 4,
        period: 1,
        sideId: "p-1",
        text: "ประตู",
        athlete: { name: "สมชาย", shirtNumber: 10 },
      },
    ],
    subMatches: [],
    ...overrides,
  };
}
