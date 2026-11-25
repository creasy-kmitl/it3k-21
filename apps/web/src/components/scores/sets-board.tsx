import { type MatchSet, type University, maxSets, setsWon } from "@it3k/db/match-rules";
import { cn } from "@it3k/ui/lib/utils";

import { TeamChip } from "@/components/scores/team-chip";
import { universityLabel } from "@/lib/matches";

/** The board for a match's own page: the card's rows, larger, with the sets won counted from the sets. */
export function SetsBoard({
  a,
  b,
  sets,
  setsToWin,
}: {
  a: University;
  b: University;
  sets: MatchSet[];
  setsToWin: number | null;
}) {
  const wins = setsWon(sets);
  return (
    <div className="mx-auto w-full max-w-xl">
      <SetsCardBody
        a={a}
        b={b}
        sets={sets}
        setsToWin={setsToWin}
        scoreA={wins.a}
        scoreB={wins.b}
        size="lg"
      />
    </div>
  );
}

/**
 * A card's body for a series of sets: the set numbers on top, then a row per
 * university with its points in each set and the sets it has won. One grid
 * holds every row, so the numbers stay over their columns however many sets there are.
 */
export function SetsCardBody({
  a,
  b,
  sets,
  setsToWin,
  scoreA,
  scoreB,
  size = "sm",
}: {
  a: University;
  b: University;
  sets: MatchSet[];
  setsToWin: number | null;
  scoreA: number | null;
  scoreB: number | null;
  size?: "sm" | "lg";
}) {
  const large = size === "lg";
  // A column for every set the series can last, so sets not played yet are left blank.
  const slots = Array.from({ length: maxSets(setsToWin ?? 2) }, (_, index) => sets[index]);
  const columns = large
    ? `3.5rem minmax(0, 1fr) repeat(${slots.length}, 2.5rem) 3.5rem`
    : `2.25rem minmax(0, 1fr) repeat(${slots.length}, 1.25rem) 2rem`;
  const rows = [
    { team: a, side: "a", total: scoreA },
    { team: b, side: "b", total: scoreB },
  ] as const;
  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden
        className={cn(
          "grid items-center gap-x-1.5 text-muted-foreground",
          large ? "text-sm" : "text-xs",
        )}
        style={{ gridTemplateColumns: columns }}
      >
        <span />
        <span />
        {slots.map((_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a set's number is its position
          <span key={index} className="text-center">
            {index + 1}
          </span>
        ))}
        <span />
      </div>
      {rows.map(({ team, side, total }) => (
        <div
          key={side}
          className="grid items-center gap-x-1.5"
          style={{ gridTemplateColumns: columns }}
        >
          <TeamChip team={team} size={size} />
          <span className={cn("truncate pl-1.5 font-medium", large && "pl-3 text-lg font-semibold")}>
            {universityLabel(team)}
          </span>
          {slots.map((set, index) => {
            if (!set) {
              // biome-ignore lint/suspicious/noArrayIndexKey: a set's number is its position
              return (
                <span
                  key={index}
                  aria-hidden
                  className={cn(
                    "text-center text-muted-foreground/60",
                    large ? "text-xl" : "text-sm",
                  )}
                >
                  –
                </span>
              );
            }
            const other = side === "a" ? set.b : set.a;
            return (
              <span
                // A set never moves, so its position in the series is its identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
                aria-label={`เซตที่ ${index + 1} ${universityLabel(team)}`}
                className={cn(
                  "text-center tabular-nums",
                  large ? "text-xl" : "text-sm",
                  !set.done && "text-muted-foreground",
                  set.done && set[side] > other ? "font-bold" : "font-medium",
                )}
              >
                {set[side]}
              </span>
            );
          })}
          <output
            aria-label={`เซตที่ชนะ ${universityLabel(team)}`}
            className={cn(
              "text-right font-bold tabular-nums",
              large ? "text-5xl" : "text-3xl",
            )}
          >
            {total ?? "–"}
          </output>
        </div>
      ))}
    </div>
  );
}
