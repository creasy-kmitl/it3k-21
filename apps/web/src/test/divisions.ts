// Test-only: the competition settings every division row carries, for fixtures
// built by hand (the seed gives real divisions their rule-based values).
export const COMPETITION_DEFAULTS = {
  maxTeamsPerInstitution: 1,
  teamMinSize: null,
  teamMaxSize: null,
  genderMinimums: null,
  maxOfficials: 3,
  lineupStarters: null,
  lineupMaxSubs: null,
  scoringConfig: null,
  standingsConfig: null,
  checkinMode: "kiosk",
  checkinOpensMin: 40,
  checkinClosesMin: 10,
  checkinMinPlayers: null,
  awardsMedals: true,
  competitionVersion: 1,
} as const;
