// The check-in window and the head count a side needs, kept apart from the
// queries so the edges are easy to read and test.
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";

const MINUTE = 60_000;

export type WindowState = "early" | "open" | "closed";

export type CheckinWindow = { opensAt: number; closesAt: number; state: WindowState };

/**
 * When athletes may report in for a match starting at `startAt`: from
 * `opensMin` minutes before the start until `closesMin` minutes before it,
 * both edges included.
 */
export function checkinWindow(
  startAt: number,
  division: { checkinOpensMin: number; checkinClosesMin: number },
  now: number,
): CheckinWindow {
  const opensAt = startAt - division.checkinOpensMin * MINUTE;
  const closesAt = startAt - division.checkinClosesMin * MINUTE;
  const state = now < opensAt ? "early" : now <= closesAt ? "open" : "closed";
  return { opensAt, closesAt, state };
}

/**
 * How many athletes a side must check in to play: the division's own minimum,
 * else its starting lineup, else its smallest team.
 */
export function minPlayers(division: {
  checkinMinPlayers: number | null;
  lineupStarters: number | null;
  teamMinSize: number | null;
}): number {
  return division.checkinMinPlayers ?? division.lineupStarters ?? division.teamMinSize ?? 1;
}

/** A side's name: the team's own name, else its institution (and number). */
export function sideLabel(side: {
  label: string | null;
  teamName: string | null;
  institution: Institution | null;
  seq: number | null;
}): string {
  if (side.teamName) return side.teamName;
  if (side.institution) {
    const short =
      INSTITUTIONS.find((item) => item.id === side.institution)?.short ?? side.institution;
    return side.seq && side.seq > 1 ? `${short} ${side.seq}` : short;
  }
  return side.label ?? "ยังไม่ทราบทีม";
}
