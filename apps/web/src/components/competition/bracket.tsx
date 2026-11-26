// Knockout brackets: matches linked by "winner of M3" sides, drawn as trees
// that read left to right towards the final. Staff and public pages feed it
// their own match shapes through the adapters at the bottom.
import {
  MATCH_STATUS_LABELS,
  type MatchStatus,
  type ParticipantOutcome,
  type SideSource,
} from "@it3k/db/competition-rules";
import type { Institution } from "@it3k/db/profile";
import type { SportIcon } from "@it3k/db/sport-rules";
import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { Medal, Plus } from "lucide-react";

import { InstitutionLogo } from "@/components/institution-logo";
import { SportMark } from "@/components/sport-art";
import { formatBangkok } from "@/lib/bangkok-time";
import type { MatchListItem } from "@/lib/competition-matches";
import type { PublicMatch } from "@/lib/public-competition";

export type BracketSide = {
  key: string;
  slot: number;
  name: string;
  institution: Institution | null;
  /** Not a team yet: a label such as "ผู้ชนะ M3". */
  placeholder: boolean;
  score: number | null;
  won: boolean;
  lost: boolean;
  sourceMatchId: string | null;
  sourceResult: SideSource | null;
};

export type BracketMatch = {
  id: string;
  divisionId: string;
  divisionName: string;
  sportId: string;
  sportName: string;
  sportIcon: SportIcon;
  stageName: string;
  matchNo: number | null;
  startAt: number | null;
  status: MatchStatus;
  version: number;
  sides: BracketSide[];
};

/** A match with the matches whose winners play in it, in side order. */
export type BracketNode = { match: BracketMatch; feeders: BracketNode[] };

export type DivisionBracket = {
  divisionId: string;
  divisionName: string;
  sportId: string;
  sportName: string;
  sportIcon: SportIcon;
  /** The final first, then other trees such as the third-place match. */
  roots: BracketNode[];
  /** Matches whose loser already plays on, as in a third-place match. */
  loserSourced: Set<string>;
};

/** What a bracket's add buttons ask for; the page turns it into a new match. */
export type BracketAddRequest =
  | { kind: "next"; match: BracketMatch }
  | { kind: "before"; match: BracketMatch; slot: number }
  | { kind: "third"; match: BracketMatch; feeders: [BracketMatch, BracketMatch] };

type AddProps = { onAdd?: (request: BracketAddRequest) => void };

const notStarted = (match: BracketMatch) =>
  match.status !== "live" && match.status !== "finished" && match.status !== "cancelled";

const size = (node: BracketNode): number =>
  1 + node.feeders.reduce((sum, feeder) => sum + size(feeder), 0);

/**
 * Each division's knockout trees: the matches that feed a side, or are fed
 * by one. Divisions without any link have no bracket. A match is drawn once
 * even if links loop or two matches name the same winner.
 */
export function buildBrackets(matches: readonly BracketMatch[]): DivisionBracket[] {
  const divisions = new Map<string, BracketMatch[]>();
  for (const match of matches) {
    divisions.set(match.divisionId, [...(divisions.get(match.divisionId) ?? []), match]);
  }
  const brackets: DivisionBracket[] = [];
  for (const list of divisions.values()) {
    const byId = new Map(list.map((match) => [match.id, match]));
    const linked = new Set<string>();
    const fedAsWinner = new Set<string>();
    const loserSourced = new Set<string>();
    for (const match of list) {
      for (const side of match.sides) {
        if (!side.sourceMatchId || !byId.has(side.sourceMatchId)) continue;
        linked.add(match.id);
        linked.add(side.sourceMatchId);
        if (side.sourceResult === "winner") fedAsWinner.add(side.sourceMatchId);
        if (side.sourceResult === "loser") loserSourced.add(side.sourceMatchId);
      }
    }
    if (linked.size === 0) continue;

    const drawn = new Set<string>();
    const build = (match: BracketMatch): BracketNode | null => {
      if (drawn.has(match.id)) return null;
      drawn.add(match.id);
      const feeders = match.sides
        .filter((side) => side.sourceResult === "winner" && side.sourceMatchId)
        .toSorted((a, b) => a.slot - b.slot)
        .flatMap((side) => {
          const feeder = byId.get(side.sourceMatchId as string);
          const node = feeder ? build(feeder) : null;
          return node ? [node] : [];
        });
      return { match, feeders };
    };
    const roots = list
      .filter((match) => linked.has(match.id) && !fedAsWinner.has(match.id))
      .flatMap((match) => {
        const node = build(match);
        return node ? [node] : [];
      })
      .toSorted(
        (a, b) =>
          size(b) - size(a) || (a.match.startAt ?? Infinity) - (b.match.startAt ?? Infinity),
      );
    // Matches only reachable through a loop still show, each as its own tree.
    for (const id of linked) {
      const match = byId.get(id);
      const node = match ? build(match) : null;
      if (node) roots.push(node);
    }
    const first = list[0] as BracketMatch;
    brackets.push({
      divisionId: first.divisionId,
      divisionName: first.divisionName,
      sportId: first.sportId,
      sportName: first.sportName,
      sportIcon: first.sportIcon,
      roots,
      loserSourced,
    });
  }
  return brackets.toSorted(
    (a, b) =>
      a.sportName.localeCompare(b.sportName, "th") ||
      a.divisionName.localeCompare(b.divisionName, "th"),
  );
}

export type MatchRoute = "/staff/matches/$matchId" | "/matches/$matchId";

/** Every division's bracket, one after another, each scrolling sideways on its own. */
export function BracketView({
  brackets,
  matchRoute,
  onAdd,
}: {
  brackets: DivisionBracket[];
  matchRoute: MatchRoute;
} & AddProps) {
  return (
    <div className="flex flex-col gap-8">
      {brackets.map((bracket) => (
        <section
          key={bracket.divisionId}
          aria-labelledby={`bracket-${bracket.divisionId}`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`bracket-${bracket.divisionId}`}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <SportMark icon={bracket.sportIcon} seed={bracket.sportId} />
            {bracket.sportName} · {bracket.divisionName}
          </h2>
          {/* inline-size containment keeps a wide bracket scrolling here instead of
              widening the page, whose flex layout grows to fit its content. */}
          <div className="overflow-x-auto rounded-2xl border bg-muted/30 p-4 [contain:inline-size]">
            <div className="flex w-max flex-col gap-6">
              {bracket.roots.map((root) => (
                <Tree
                  key={root.match.id}
                  node={root}
                  matchRoute={matchRoute}
                  root={{ loserSourced: bracket.loserSourced }}
                  onAdd={onAdd}
                />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * A match with its feeders stacked to its left. Each feeder draws a line out
 * to the right, the lines join with a vertical bar, and one stub runs on to
 * the match, so every round lines up with the middle of the two before it.
 */
function Tree({
  node,
  matchRoute,
  root,
  onAdd,
}: {
  node: BracketNode;
  matchRoute: MatchRoute;
  /** Set on a tree's last match, which may go on to a next round. */
  root?: { loserSourced: Set<string> };
} & AddProps) {
  const count = node.feeders.length;
  const [first, second] = node.feeders;
  const canAddNext =
    !!root &&
    node.match.status !== "cancelled" &&
    !node.match.sides.some((s) => s.sourceResult === "loser");
  const thirdPlaceFeeders: [BracketMatch, BracketMatch] | null =
    root &&
    count === 2 &&
    first &&
    second &&
    !root.loserSourced.has(first.match.id) &&
    !root.loserSourced.has(second.match.id)
      ? [first.match, second.match]
      : null;
  return (
    <div className="flex items-center">
      {count > 0 && (
        <>
          <div className="flex flex-col">
            {node.feeders.map((feeder, index) => (
              <div
                key={feeder.match.id}
                className={cn(
                  "relative flex items-center py-2 pr-6",
                  "after:absolute after:top-1/2 after:right-0 after:h-px after:w-6 after:bg-border",
                  count > 1 && "before:absolute before:right-0 before:w-px before:bg-border",
                  count > 1 &&
                    (index === 0
                      ? "before:top-1/2 before:bottom-0"
                      : index === count - 1
                        ? "before:top-0 before:bottom-1/2"
                        : "before:inset-y-0"),
                )}
              >
                <Tree node={feeder} matchRoute={matchRoute} onAdd={onAdd} />
              </div>
            ))}
          </div>
          <div className="h-px w-6 shrink-0 bg-border" aria-hidden />
        </>
      )}
      <BracketCard
        match={node.match}
        matchRoute={matchRoute}
        onAdd={onAdd}
        canAddNext={canAddNext}
        thirdPlaceFeeders={thirdPlaceFeeders}
      />
    </div>
  );
}

/** "M3 · รอบรองชนะเลิศ", or the stage alone for a match without a number. */
export function bracketMatchTitle(match: Pick<BracketMatch, "matchNo" | "stageName">) {
  return [match.matchNo !== null ? `M${match.matchNo}` : null, match.stageName]
    .filter(Boolean)
    .join(" · ");
}

function when(match: BracketMatch) {
  if (match.status === "live" || match.status === "finished" || match.status === "cancelled") {
    return MATCH_STATUS_LABELS[match.status];
  }
  if (match.startAt === null) return "ยังไม่กำหนดเวลา";
  return `${formatBangkok(match.startAt, "day")} ${formatBangkok(match.startAt, "time")}`;
}

/**
 * A match card. The whole card opens the match (a stretched link), and the
 * add buttons sit above the link: a "+" on an open side adds the match
 * whose winner fills it, the "+" on the right edge adds the next round, and
 * a final can add its third-place match.
 */
function BracketCard({
  match,
  matchRoute,
  onAdd,
  canAddNext,
  thirdPlaceFeeders,
}: {
  match: BracketMatch;
  matchRoute: MatchRoute;
  canAddNext: boolean;
  thirdPlaceFeeders: [BracketMatch, BracketMatch] | null;
} & AddProps) {
  const live = match.status === "live";
  const title = bracketMatchTitle(match);
  const open = notStarted(match);
  return (
    <div
      className={cn(
        "relative flex w-60 shrink-0 flex-col gap-1 rounded-xl border bg-card p-2.5 text-sm shadow-xs transition-colors has-[a:hover]:border-ring has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-ring/50",
        live && "border-destructive/60",
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <Link
          to={matchRoute}
          params={{ matchId: match.id }}
          aria-label={`${title}: ${match.sides.map((side) => side.name).join(" พบ ")}`}
          className="truncate after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
        >
          {title}
        </Link>
        <span className={cn("flex shrink-0 items-center gap-1", live && "text-destructive")}>
          {live && (
            <span
              className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
              aria-hidden
            />
          )}
          {when(match)}
        </span>
      </span>
      {match.sides.map((side) => (
        <span
          key={side.key}
          className={cn(
            "flex items-center gap-2",
            side.won && "font-semibold",
            side.lost && "text-muted-foreground",
          )}
        >
          {side.institution ? (
            <InstitutionLogo institution={side.institution} />
          ) : onAdd && open && side.placeholder && !side.sourceMatchId ? (
            <button
              type="button"
              aria-label={`เพิ่มแมตช์ก่อนหน้าให้ฝั่ง ${side.slot} ของ ${title}`}
              title="เพิ่มแมตช์ก่อนหน้า"
              onClick={() => onAdd({ kind: "before", match, slot: side.slot })}
              className="relative z-10 grid size-4 shrink-0 place-items-center rounded-full border border-dashed border-primary/60 text-primary transition-colors hover:border-primary hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Plus className="size-3" aria-hidden />
            </button>
          ) : (
            <span className="size-4 shrink-0 rounded-full border border-dashed" aria-hidden />
          )}
          <span className={cn("min-w-0 flex-1 truncate", side.placeholder && "italic")}>
            {side.name}
          </span>
          {side.score !== null && <span className="tabular-nums">{side.score}</span>}
        </span>
      ))}
      {onAdd && thirdPlaceFeeders && (
        <button
          type="button"
          onClick={() => onAdd({ kind: "third", match, feeders: thirdPlaceFeeders })}
          className="relative z-10 mt-1 flex w-fit items-center gap-1 rounded-md text-xs text-primary hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Medal className="size-3.5" aria-hidden /> เพิ่มนัดชิงอันดับ 3
        </button>
      )}
      {onAdd && canAddNext && (
        <button
          type="button"
          aria-label={`ต่อรอบถัดไปจาก ${title}`}
          title="ต่อรอบถัดไป"
          onClick={() => onAdd({ kind: "next", match })}
          className="absolute top-1/2 -right-3 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors hover:border-primary hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

const WON: ParticipantOutcome[] = ["win", "walkover_win"];
const LOST: ParticipantOutcome[] = ["loss", "forfeit"];

/** A staff list item as a bracket match. */
export function fromStaffMatch(match: MatchListItem): BracketMatch {
  return {
    id: match.id,
    divisionId: match.divisionId,
    divisionName: match.divisionName,
    sportId: match.sportId,
    sportName: match.sportName,
    sportIcon: match.sportIcon,
    stageName: match.stageName,
    matchNo: match.matchNo,
    startAt: match.startAt,
    status: match.status,
    version: match.version,
    sides: match.participants.map((side) => ({
      key: side.id,
      slot: side.slot,
      name: side.name,
      institution: side.institution,
      placeholder: side.teamId === null,
      score: side.score,
      won: side.outcome !== null && WON.includes(side.outcome),
      lost: side.outcome !== null && LOST.includes(side.outcome),
      sourceMatchId: side.sourceMatchId,
      sourceResult: side.sourceResult,
    })),
  };
}

/** A public match as a bracket match. */
export function fromPublicMatch(match: PublicMatch): BracketMatch {
  return {
    id: match.id,
    divisionId: match.division.id,
    divisionName: match.division.name,
    sportId: match.sport.id,
    sportName: match.sport.name,
    sportIcon: match.sport.icon,
    stageName: match.stageName,
    matchNo: match.matchNo,
    startAt: match.startAt,
    status: match.status,
    // Public pages never add matches, so no version is needed.
    version: 0,
    sides: match.sides.map((side) => ({
      key: side.id,
      slot: side.slot,
      name: side.name,
      institution: side.team?.institution ?? null,
      placeholder: side.team === null,
      score: side.score,
      won: side.outcome !== null && WON.includes(side.outcome),
      lost: side.outcome !== null && LOST.includes(side.outcome),
      sourceMatchId: side.sourceMatchId,
      sourceResult: side.sourceResult,
    })),
  };
}
