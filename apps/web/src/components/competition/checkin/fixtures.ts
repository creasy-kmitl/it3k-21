// Test-only: check-in data shaped like the API's answers.
import type { CheckinMatch, MatchCheckins, RosterEntry } from "@/lib/competition-checkins";

export const NOW = "2026-12-05T03:00:00.000Z";

export function checkinMatch(overrides: Partial<CheckinMatch> = {}): CheckinMatch {
  return {
    id: "m-1",
    stageName: "รอบแบ่งกลุ่ม",
    roundNo: 1,
    matchNo: 3,
    // 10:40 in Bangkok.
    startAt: "2026-12-05T03:40:00.000Z",
    venueId: "v-1",
    venueName: "สนามฟุตบอล",
    court: null,
    status: "scheduled",
    outcome: null,
    scoreSeq: 0,
    version: 1,
    divisionId: "d-1",
    divisionName: "ฟุตบอล",
    sportName: "ฟุตบอล",
    sportIcon: "football",
    checkinMode: "kiosk",
    checkinOpensMin: 40,
    checkinClosesMin: 10,
    minPlayers: 2,
    window: {
      state: "open",
      opensAt: "2026-12-05T03:00:00.000Z",
      closesAt: "2026-12-05T03:30:00.000Z",
    },
    sides: [
      {
        participantId: "s-1",
        slot: 1,
        teamId: "t-1",
        label: "สจล.",
        outcome: null,
        checkedIn: 2,
        expected: 3,
        usesLineup: false,
      },
      {
        participantId: "s-2",
        slot: 2,
        teamId: "t-2",
        label: "มจธ.",
        outcome: null,
        checkedIn: 0,
        expected: 2,
        usesLineup: false,
      },
    ],
    ...overrides,
  };
}

export function rosterEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    userId: "p1",
    registrationId: "r-1",
    displayName: "สมชาย",
    shirtNumber: 7,
    image: null,
    role: null,
    listed: true,
    checkin: null,
    ...overrides,
  };
}

export function matchCheckins(
  overrides: Partial<MatchCheckins> = {},
  match: CheckinMatch = checkinMatch(),
): MatchCheckins {
  const [home, away] = match.sides;
  return {
    match: {
      ...match,
      sides: [
        {
          ...(home as CheckinMatch["sides"][number]),
          roster: [
            rosterEntry({ checkin: { method: "scan", at: NOW, by: "Kiosk" } }),
            rosterEntry({
              userId: "p2",
              registrationId: "r-2",
              displayName: "สมหญิง",
              shirtNumber: 9,
            }),
          ],
        },
        {
          ...(away as CheckinMatch["sides"][number]),
          roster: [
            rosterEntry({
              userId: "p3",
              registrationId: "r-3",
              displayName: "มานะ",
              shirtNumber: 10,
            }),
          ],
        },
      ],
    },
    canCheckIn: true,
    canForfeit: false,
    ...overrides,
  };
}
