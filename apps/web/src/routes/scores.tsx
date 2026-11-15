import { POINTS, type Standing } from "@it3k/db/match-rules";
import { Skeleton } from "@it3k/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@it3k/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Trophy } from "lucide-react";

import { StatusBadge } from "@/components/scores/scores-page";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, universityLabel } from "@/lib/matches";

/** How often the scoreboard checks for new scores while it is open. */
const REFRESH_MS = 15_000;

export const Route = createFileRoute("/scores")({
  // Scores change during the event; render in the browser and poll from there.
  ssr: false,
  component: ScoreboardPage,
});

function StandingsTable({ rows, caption }: { rows: Standing[]; caption: string }) {
  return (
    <Table aria-label={caption}>
      <TableHeader>
        <TableRow>
          <TableHead>สถาบัน</TableHead>
          <TableHead className="text-right">แข่ง</TableHead>
          <TableHead className="text-right">ชนะ</TableHead>
          <TableHead className="text-right">เสมอ</TableHead>
          <TableHead className="text-right">แพ้</TableHead>
          <TableHead className="text-right">แต้ม</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.university}>
            <TableCell className="font-medium">{universityLabel(row.university)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.played}</TableCell>
            <TableCell className="text-right tabular-nums">{row.won}</TableCell>
            <TableCell className="text-right tabular-nums">{row.drawn}</TableCell>
            <TableCell className="text-right tabular-nums">{row.lost}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{row.points}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MatchLine({ match }: { match: PublicMatch }) {
  return (
    <li className="flex flex-col gap-1 rounded-2xl border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {match.round && <span>{match.round}</span>}
        <StatusBadge status={match.status} />
        {match.startsAt && (
          <span className="text-xs">{formatBangkok(match.startsAt, "dateTime")}</span>
        )}
      </div>
      <div className="flex items-center justify-center gap-4 text-base">
        <span className="w-14 text-right font-medium">{universityLabel(match.teamA)}</span>
        <span className="text-2xl font-semibold tabular-nums">
          {match.scoreA ?? "–"} : {match.scoreB ?? "–"}
        </span>
        <span className="w-14 font-medium">{universityLabel(match.teamB)}</span>
      </div>
    </li>
  );
}

export function ScoreboardPage() {
  const { publicScores } = useApis();
  const board = useQuery({
    queryKey: ["public-scores"],
    queryFn: () => publicScores.get(),
    refetchInterval: REFRESH_MS,
  });

  const sports = new Map<string, PublicMatch[]>();
  for (const match of board.data?.matches ?? []) {
    sports.set(match.sport, [...(sports.get(match.sport) ?? []), match]);
  }

  return (
    <div className="container mx-auto flex max-w-3xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-primary">
          <Trophy aria-hidden className="size-7" />
          คะแนนการแข่งขัน IT·3·Kings
        </h1>
        {/* <p className="text-muted-foreground">อัปเดตอัตโนมัติทุก {REFRESH_MS / 1000} วินาที</p> */}
      </header>

      {board.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : board.isError ? (
        <p className="text-destructive">โหลดคะแนนไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">ตารางคะแนนรวม</h2>
            <StandingsTable rows={board.data.standings.overall} caption="ตารางคะแนนรวม" />
            <p className="text-xs text-muted-foreground">
              ชนะ {POINTS.win} แต้ม เสมอ {POINTS.draw} แต้ม นับเฉพาะแมตช์ที่จบแล้ว
            </p>
          </section>

          {[...sports].length === 0 ? (
            <p className="text-muted-foreground">ยังไม่มีแมตช์</p>
          ) : (
            [...sports].map(([sport, matches]) => (
              <section key={sport} className="flex flex-col gap-2">
                <h2 className="text-xl font-semibold">{sport}</h2>
                <ul className="flex flex-col gap-2">
                  {matches.map((match) => (
                    <MatchLine key={match.id} match={match} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
