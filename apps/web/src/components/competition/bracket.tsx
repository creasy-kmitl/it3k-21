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
};

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
    for (const match of list) {
      for (const side of match.sides) {
        if (!side.sourceMatchId || !byId.has(side.sourceMatchId)) continue;
        linked.add(match.id);
        linked.add(side.sourceMatchId);
        if (side.sourceResult === "winner") fedAsWinner.add(side.sourceMatchId);
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
}: {
  brackets: DivisionBracket[];
  matchRoute: MatchRoute;
}) {
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
          <div className="overflow-x-auto rounded-2xl border bg-muted/30 p-4">
            <div className="flex w-max flex-col gap-6">
              {bracket.roots.map((root) => (
                <Tree key={root.match.id} node={root} matchRoute={matchRoute} />
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
function Tree({ node, matchRoute }: { node: BracketNode; matchRoute: MatchRoute }) {
  const count = node.feeders.length;
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
                <Tree node={feeder} matchRoute={matchRoute} />
              </div>
            ))}
          </div>
          <div className="h-px w-6 shrink-0 bg-border" aria-hidden />
        </>
      )}
      <BracketCard match={node.match} matchRoute={matchRoute} />
    </div>
  );
}

function when(match: BracketMatch) {
  if (match.status === "live" || match.status === "finished" || match.status === "cancelled") {
    return MATCH_STATUS_LABELS[match.status];
  }
  if (match.startAt === null) return "ยังไม่กำหนดเวลา";
  return `${formatBangkok(match.startAt, "day")} ${formatBangkok(match.startAt, "time")}`;
}

function BracketCard({ match, matchRoute }: { match: BracketMatch; matchRoute: MatchRoute }) {
  const live = match.status === "live";
  const title = [match.matchNo !== null ? `M${match.matchNo}` : null, match.stageName]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={matchRoute}
      params={{ matchId: match.id }}
      className={cn(
        "flex w-60 shrink-0 flex-col gap-1 rounded-xl border bg-card p-2.5 text-sm shadow-xs transition-colors hover:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        live && "border-destructive/60",
      )}
    >
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{title}</span>
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
          ) : (
            <span className="size-4 shrink-0 rounded-full border border-dashed" aria-hidden />
          )}
          <span className={cn("min-w-0 flex-1 truncate", side.placeholder && "italic")}>
            {side.name}
          </span>
          {side.score !== null && <span className="tabular-nums">{side.score}</span>}
        </span>
      ))}
    </Link>
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
