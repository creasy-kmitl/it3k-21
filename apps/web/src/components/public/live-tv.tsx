import { cn } from "@it3k/ui/lib/utils";
import { Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { ScoreDisplay } from "@/components/competition/score-display";
import { formatBangkok } from "@/lib/bangkok-time";
import type { LiveBoard, PublicMatch } from "@/lib/public-competition";

import { periodLabel, placeLabel, roundLabel, scoreSides, timeLabel } from "./match-format";

/** Live matches on one TV screen at a time. */
export const TV_PAGE_SIZE = 4;
export const TV_ROTATE_MS = 10_000;

/** Splits `items` into screens of `size`. */
export function tvPages<T>(items: T[], size = TV_PAGE_SIZE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Moves to the next screen every TV_ROTATE_MS, starting over when the list changes size. */
function useRotation(pageCount: number) {
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (pageCount <= 1) return;
    const timer = setInterval(() => setPage((current) => (current + 1) % pageCount), TV_ROTATE_MS);
    return () => clearInterval(timer);
  }, [pageCount]);
  return pageCount === 0 ? 0 : page % pageCount;
}

function TvMatch({ match }: { match: PublicMatch }) {
  const place = placeLabel(match);
  return (
    <div className="flex min-h-0 flex-col justify-between gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-2xl font-semibold lg:text-3xl">{match.division.name}</span>
          <span className="truncate text-lg text-white/60">{roundLabel(match)}</span>
        </div>
        <span className="flex shrink-0 items-center gap-2 rounded-full bg-red-600 px-3 py-1 text-lg font-semibold">
          <span
            className="size-2.5 animate-pulse rounded-full bg-white motion-reduce:animate-none"
            aria-hidden
          />
          {periodLabel(match) ?? "สด"}
        </span>
      </div>
      <div className="text-2xl lg:text-4xl">
        <ScoreDisplay
          sides={scoreSides(match.sides)}
          scoring={match.scoring}
          status={match.status}
          size="lg"
        />
      </div>
      {place && <span className="truncate text-lg text-white/60">{place}</span>}
    </div>
  );
}

/**
 * The live board for a screen at the venue: large, dark, no site chrome. It
 * rotates through the live matches four at a time and lists what comes next.
 */
export function LiveTv({ board }: { board: LiveBoard }) {
  const now = useNow(1_000);
  const pages = tvPages(board.live);
  const page = useRotation(pages.length);
  const shown = pages[page] ?? [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-6 overflow-hidden bg-neutral-950 p-6 text-white lg:p-10">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold tracking-tight text-red-500 lg:text-4xl">
            IT·3·Kings
          </span>
          <span className="flex items-center gap-2 text-2xl font-semibold lg:text-3xl">
            <Radio className="size-7 text-red-500" aria-hidden />
            กำลังแข่ง
          </span>
        </div>
        <div className="flex items-center gap-6">
          {pages.length > 1 && (
            <span className="text-xl text-white/60 tabular-nums" aria-live="polite">
              {page + 1}/{pages.length}
            </span>
          )}
          <time className="text-3xl font-semibold tabular-nums lg:text-4xl">
            {formatBangkok(now, "time")}
          </time>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6">
        <main
          className={cn(
            "grid min-h-0 flex-1 gap-6",
            shown.length > 1 && "lg:grid-cols-2",
            shown.length > 2 && "grid-rows-2",
          )}
        >
          {shown.length === 0 ? (
            <div className="flex items-center justify-center rounded-3xl border border-white/10 text-3xl text-white/60">
              ยังไม่มีแมตช์ที่กำลังแข่ง
            </div>
          ) : (
            shown.map((match) => <TvMatch key={match.id} match={match} />)
          )}
        </main>

        {(board.upcoming.length > 0 || board.recent.length > 0) && (
          <aside className="hidden w-96 shrink-0 flex-col gap-6 overflow-hidden xl:flex">
            {board.upcoming.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-white/70">แมตช์ถัดไป</h2>
                <ul className="flex flex-col gap-3">
                  {board.upcoming.map((match) => (
                    <li key={match.id} className="flex flex-col rounded-2xl bg-white/5 px-4 py-3">
                      <span className="text-lg font-semibold tabular-nums">
                        {timeLabel(match.startAt)} · {match.division.name}
                      </span>
                      <span className="truncate text-white/70">
                        {match.sides.map((side) => side.name || "รอผล").join(" พบ ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {board.recent.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold text-white/70">ผลล่าสุด</h2>
                <ul className="flex flex-col gap-3">
                  {board.recent.map((match) => (
                    <li key={match.id} className="flex flex-col rounded-2xl bg-white/5 px-4 py-3">
                      <span className="truncate text-white/70">{match.division.name}</span>
                      <span className="truncate text-lg font-semibold tabular-nums">
                        {match.sides
                          .map((side) => `${side.name} ${side.score ?? "–"}`)
                          .join("  ·  ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
