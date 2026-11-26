// How the public pages word a match: its title, round, period and day.
import type { MatchPhase, ScoringConfig } from "@it3k/db/competition-rules";
import { INSTITUTIONS } from "@it3k/db/profile";

import type { ScoreDisplaySide } from "@/components/competition/score-display";
import { dateKey, formatBangkok } from "@/lib/bangkok-time";
import type { PublicMatch, PublicSide } from "@/lib/public-competition";

/** "รอบแบ่งกลุ่ม · สาย A · นัดที่ 3". */
export function roundLabel(
  match: Pick<PublicMatch, "stageName" | "group" | "roundNo" | "matchNo">,
) {
  return [
    match.stageName,
    match.group?.name,
    match.roundNo === null ? null : `รอบที่ ${match.roundNo}`,
    match.matchNo === null ? null : `แมตช์ ${match.matchNo}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "สจล. พบ มจธ.", or the sides in order for races. */
export function sidesLabel(sides: Pick<PublicSide, "name">[]) {
  const names = sides.map((side) => side.name || "รอผล");
  return names.length === 2 ? `${names[0]} พบ ${names[1]}` : names.join(", ");
}

/** "สนามฟุตบอล · คอร์ต 2". */
export function placeLabel(match: Pick<PublicMatch, "venue" | "court">) {
  return [match.venue?.name, match.court].filter(Boolean).join(" · ");
}

export function timeLabel(startAt: number | null) {
  return startAt === null ? "ยังไม่กำหนดเวลา" : formatBangkok(startAt, "time");
}

/** What ScoreDisplay draws for each side. */
export function scoreSides(sides: PublicSide[]): ScoreDisplaySide[] {
  return sides.map((side) => ({
    id: side.id,
    name: side.name || "รอผล",
    score: side.score,
    detail: side.detail,
    resultValue: side.resultValue,
    rank: side.rank,
    outcome: side.outcome,
  }));
}

/** What the scoring calls one period: ครึ่ง, ควอเตอร์, เกม, เอนด์. */
function periodWord(scoring: ScoringConfig) {
  switch (scoring.engine) {
    case "points":
      return scoring.periods.label;
    case "sets":
      return scoring.setLabel;
    case "series":
      return scoring.gameLabel;
    case "ends":
      return "เอนด์";
    case "race":
      return "เกม";
  }
}

const PHASE_LABELS: Record<Exclude<MatchPhase, "regular">, (scoring: ScoringConfig) => string> = {
  overtime: (scoring) =>
    scoring.engine === "points" && scoring.overtime ? scoring.overtime.label : "ต่อเวลา",
  shootout: (scoring) =>
    scoring.engine === "points" && scoring.shootout ? scoring.shootout.label : "ดวลจุดโทษ",
};

/** "ครึ่งที่ 2", "ต่อเวลา", or null before a live state exists. */
export function periodLabel(match: Pick<PublicMatch, "live" | "scoring">) {
  if (!match.live) return null;
  if (match.live.phase !== "regular") return PHASE_LABELS[match.live.phase](match.scoring);
  return `${periodWord(match.scoring)}ที่ ${match.live.period}`;
}

export type DayGroup<T> = { key: string; label: string; items: T[] };

/** Items by Bangkok day, in the order given; items with no time go last. */
export function groupByDay<T extends { startAt: number | null }>(items: T[]): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  for (const item of items) {
    const key = item.startAt === null ? "none" : dateKey(item.startAt);
    const group = groups.get(key) ?? {
      key,
      label: item.startAt === null ? "ยังไม่กำหนดวัน" : formatBangkok(item.startAt, "longDay"),
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  const none = groups.get("none");
  groups.delete("none");
  return none ? [...groups.values(), none] : [...groups.values()];
}

export function institutionOf(id: string) {
  return INSTITUTIONS.find((institution) => institution.id === id);
}
