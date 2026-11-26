// Test-only: matches, sides and setups as the matches API returns them.
import type { CompetitionDivision } from "@/lib/competition-divisions";
import type { MatchDetail, MatchListItem, MatchSetup, MatchSide } from "@/lib/competition-matches";

export const DEC_1_0900 = Date.UTC(2026, 11, 1, 2, 0);
export const DEC_2_1300 = Date.UTC(2026, 11, 2, 6, 0);

export function side(overrides: Partial<MatchSide> = {}): MatchSide {
  return {
    id: "p-1",
    matchId: "m-1",
    slot: 1,
    teamId: "team-kmitl",
    label: null,
    name: "สจล.",
    institution: "kmitl",
    score: null,
    detail: null,
    resultValue: null,
    rank: null,
    outcome: null,
    ...overrides,
  };
}

export function listItem(overrides: Partial<MatchListItem> = {}): MatchListItem {
  return {
    id: "m-1",
    divisionId: "d-football",
    divisionName: "ฟุตบอลชาย",
    sportId: "s-football",
    sportName: "ฟุตบอล",
    sportIcon: "football",
    parentMatchId: null,
    subOrder: null,
    groupId: null,
    groupName: "A",
    stageName: "รอบแบ่งกลุ่ม",
    roundNo: 1,
    matchNo: 1,
    startAt: DEC_1_0900,
    venueId: "v-1",
    venueName: "สนามกลาง",
    court: "1",
    status: "scheduled",
    outcome: null,
    friendly: false,
    scoreSeq: 0,
    coverImageUrl: null,
    notes: null,
    scoringConfig: null,
    version: 1,
    participants: [side(), side({ id: "p-2", slot: 2, teamId: "team-kmutt", name: "มจธ." })],
    ...overrides,
  } as MatchListItem;
}

export function detail(overrides: Partial<MatchDetail> = {}): MatchDetail {
  const { participants, ...base } = listItem();
  return {
    ...base,
    participants,
    division: {
      format: "team",
      lineupStarters: null,
      lineupMaxSubs: null,
      awardsMedals: true,
    },
    subMatches: [],
    referees: [],
    images: [],
    ...overrides,
  } as MatchDetail;
}

export function setup(overrides: Partial<MatchSetup> = {}): MatchSetup {
  return {
    division: {
      id: "d-football",
      name: "ฟุตบอลชาย",
      code: "football",
      format: "team",
      awardsMedals: true,
      lineupStarters: null,
      lineupMaxSubs: null,
      sportId: "s-football",
      sportName: "ฟุตบอล",
      sportIcon: "football",
    },
    teams: [
      { id: "team-kmitl", institution: "kmitl", seq: 1, name: "สจล." },
      { id: "team-kmutt", institution: "kmutt", seq: 1, name: "มจธ." },
      { id: "team-bkk", institution: "kmutnb-bangkok", seq: 1, name: "มจพ. กรุงเทพฯ" },
      { id: "team-prachin", institution: "kmutnb-prachinburi", seq: 1, name: "มจพ. ปราจีนบุรี" },
    ],
    groups: [],
    friendlyByDefault: false,
    nextMatchNo: 1,
    ...overrides,
  } as MatchSetup;
}

/** A division row as the divisions list returns it; only the fields match pages read. */
export function division(overrides: Partial<CompetitionDivision> = {}): CompetitionDivision {
  return {
    id: "d-football",
    name: "ฟุตบอลชาย",
    sportId: "s-football",
    sportName: "ฟุตบอล",
    ...overrides,
  } as CompetitionDivision;
}
