// The overall medal table: each division's places 1 to 4 earn their
// institution MEDAL_POINTS (4/3/2/1). Pure, so the API and the tests agree.
//
// A division that awards no medals, or has fewer than MIN_TEAMS_FOR_MEDALS
// teams (a friendly), counts for nobody.
import { MEDAL_POINTS, MIN_TEAMS_FOR_MEDALS } from "./competition-rules";
import type { Institution } from "./profile";

export type MedalDivision = {
  id: string;
  awardsMedals: boolean;
  teamCount: number;
};

export type MedalPlacement = {
  divisionId: string;
  institution: Institution;
  place: number;
};

export type MedalRow = {
  institution: Institution;
  gold: number;
  silver: number;
  bronze: number;
  // Fourth place earns a point but no medal.
  fourth: number;
  points: number;
  // Institutions level on points, golds, silvers and bronzes share a rank.
  rank: number;
};

/** Whether a division's places earn medals and points. */
export function divisionCountsForMedals(division: MedalDivision) {
  return division.awardsMedals && division.teamCount >= MIN_TEAMS_FOR_MEDALS;
}

const compare = (a: MedalRow, b: MedalRow) =>
  b.points - a.points || b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze;

/**
 * The medal table. `institutions` lists every institution to show, in the
 * order that settles a full tie; any other institution with a place joins it.
 */
export function computeMedals(input: {
  divisions: MedalDivision[];
  placements: MedalPlacement[];
  institutions?: readonly Institution[];
}): MedalRow[] {
  const counted = new Set(input.divisions.filter(divisionCountsForMedals).map((d) => d.id));
  const rows = new Map<Institution, MedalRow>();
  const row = (institution: Institution) => {
    let found = rows.get(institution);
    if (!found) {
      found = { institution, gold: 0, silver: 0, bronze: 0, fourth: 0, points: 0, rank: 0 };
      rows.set(institution, found);
    }
    return found;
  };
  for (const institution of input.institutions ?? []) row(institution);

  for (const placement of input.placements) {
    if (!counted.has(placement.divisionId)) continue;
    const points = MEDAL_POINTS[placement.place - 1];
    if (points === undefined) continue;
    const target = row(placement.institution);
    target.points += points;
    if (placement.place === 1) target.gold += 1;
    else if (placement.place === 2) target.silver += 1;
    else if (placement.place === 3) target.bronze += 1;
    else target.fourth += 1;
  }

  // Array#sort is stable, so a full tie keeps the order `institutions` gave.
  const table = [...rows.values()].sort(compare);
  table.forEach((current, index) => {
    const previous = table[index - 1];
    current.rank = previous && compare(previous, current) === 0 ? previous.rank : index + 1;
  });
  return table;
}
