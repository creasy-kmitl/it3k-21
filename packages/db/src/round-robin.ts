// Round-robin schedules: every team in a group meets every other team, once
// or twice (legs), and the matches fill the courts slot by slot. Pure, so the
// API previews exactly what it would save and the web app can test it.

export type RoundRobinGroup = { name: string; teamIds: string[] };

export type RoundRobinCourt = { venueId: string | null; court: string | null };

export type RoundRobinPlanInput = {
  groups: RoundRobinGroup[];
  firstStartAt: number;
  slotMinutes: number;
  courts: RoundRobinCourt[];
  legs: number;
  /** The first match number to hand out; later ones count up from it. */
  firstMatchNo?: number;
};

/** One pairing of a group's round, before it has a time or a court. */
export type RoundRobinPairing = { roundNo: number; homeTeamId: string; awayTeamId: string };

export type PlannedMatch = RoundRobinPairing & {
  groupIndex: number;
  groupName: string;
  matchNo: number;
  /** Which time slot, from 0; slot n starts n × slotMinutes after the first. */
  slot: number;
  startAt: number;
  venueId: string | null;
  court: string | null;
};

export type RoundRobinPlan = {
  matches: PlannedMatch[];
  /** How many time slots the schedule takes. */
  slots: number;
  /** When the last slot ends. */
  endsAt: number;
};

const MINUTE_MS = 60_000;

/**
 * The circle method: the first team stays put while the rest turn one place a
 * round. An odd count gets a bye (no match) each round. The second leg repeats
 * the first with home and away swapped.
 */
export function roundRobinPairings(teamIds: readonly string[], legs = 1): RoundRobinPairing[] {
  if (new Set(teamIds).size !== teamIds.length) throw new Error("A team is listed twice");
  if (teamIds.length < 2) return [];
  const circle: (string | null)[] = [...teamIds];
  if (circle.length % 2 === 1) circle.push(null);
  const size = circle.length;
  const rounds = size - 1;
  const firstLeg: RoundRobinPairing[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < size / 2; i++) {
      const a = circle[i];
      const b = circle[size - 1 - i];
      if (a == null || b == null) continue;
      // The fixed team alternates home and away; the others swap by position,
      // so nobody is at home every round.
      const swap = i === 0 ? round % 2 === 1 : i % 2 === 1;
      firstLeg.push({
        roundNo: round + 1,
        homeTeamId: swap ? b : a,
        awayTeamId: swap ? a : b,
      });
    }
    // Keep the first team, turn the rest one place clockwise.
    const last = circle.pop() as string | null;
    circle.splice(1, 0, last);
  }

  const pairings = [...firstLeg];
  for (let leg = 1; leg < legs; leg++) {
    for (const pairing of firstLeg) {
      pairings.push({
        roundNo: pairing.roundNo + rounds * leg,
        homeTeamId: leg % 2 === 1 ? pairing.awayTeamId : pairing.homeTeamId,
        awayTeamId: leg % 2 === 1 ? pairing.homeTeamId : pairing.awayTeamId,
      });
    }
  }
  return pairings;
}

/**
 * Every group's pairings, given times and courts. Each slot fills the courts
 * in order with the earliest matches whose teams are free: no team plays twice
 * in a slot, and each team plays its rounds in order. Groups share the courts,
 * round by round.
 */
export function planRoundRobin(input: RoundRobinPlanInput): RoundRobinPlan {
  const seen = new Set<string>();
  for (const group of input.groups) {
    for (const teamId of group.teamIds) {
      if (seen.has(teamId)) throw new Error("A team is in two groups");
      seen.add(teamId);
    }
  }
  if (input.courts.length === 0) throw new Error("No courts");

  // Round 1 of every group, then round 2 of every group, and so on.
  const pending = input.groups
    .flatMap((group, groupIndex) =>
      roundRobinPairings(group.teamIds, input.legs).map((pairing, order) => ({
        ...pairing,
        groupIndex,
        groupName: group.name,
        order,
      })),
    )
    .sort((a, b) => a.roundNo - b.roundNo || a.groupIndex - b.groupIndex || a.order - b.order);

  const slotMs = input.slotMinutes * MINUTE_MS;
  const firstMatchNo = input.firstMatchNo ?? 1;
  const matches: PlannedMatch[] = [];
  let slot = 0;

  while (pending.length > 0) {
    const busy = new Set<string>();
    // A team whose earlier match is still waiting cannot play a later one yet.
    const waiting = new Set<string>();
    let court = 0;
    for (let i = 0; i < pending.length && court < input.courts.length;) {
      const match = pending[i] as (typeof pending)[number];
      const teams = [match.homeTeamId, match.awayTeamId];
      if (teams.some((team) => busy.has(team) || waiting.has(team))) {
        for (const team of teams) waiting.add(team);
        i++;
        continue;
      }
      const place = input.courts[court] as RoundRobinCourt;
      matches.push({
        roundNo: match.roundNo,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        groupIndex: match.groupIndex,
        groupName: match.groupName,
        matchNo: firstMatchNo + matches.length,
        slot,
        startAt: input.firstStartAt + slot * slotMs,
        venueId: place.venueId,
        court: place.court,
      });
      for (const team of teams) busy.add(team);
      pending.splice(i, 1);
      court++;
    }
    slot++;
  }

  return { matches, slots: slot, endsAt: input.firstStartAt + slot * slotMs };
}
