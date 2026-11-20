import type { Standing } from "@it3k/db/match-rules";
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
import { useState } from "react";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { StatusBadge } from "@/components/scores/scores-page";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import { type PublicMatch, universityLabel } from "@/lib/matches";
import { MatchCard } from "@/components/scores/match-card";

/** How often the scoreboard checks for new scores while it is open. */
const REFRESH_MS = 15_000;
type Tab = "matches" | "standings";

const TABS: Segment<Tab>[] = [
  { value: "matches", label: "แมตช์" },
  { value: "standings", label: "ตารางคะแนนรวม" },
];

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
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ScoreboardPage() {
  const { publicScores } = useApis();
  const board = useQuery({
    queryKey: ["public-scores"],
    queryFn: () => publicScores.get(),
    refetchInterval: REFRESH_MS,
  });
  const [tab, setTab] = useState<Tab>("matches");

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
      <SegmentedControl label="เลือกมุมมอง" segments={TABS} value={tab} onChange={setTab} />
      {board.isPending ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : board.isError ? (
        <p className="text-destructive">โหลดคะแนนไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>
      ) : tab === "standings" ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">ตารางคะแนนรวม</h2>
          <StandingsTable rows={board.data.standings.overall} caption="ตารางคะแนนรวม" />
          <p className="text-xs text-muted-foreground">นับเฉพาะแมตช์ที่จบแล้ว</p>
        </section>
      ) : [...sports].length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีแมตช์</p>
      ) : (
        [...sports].map(([sport, matches]) => (
          <section key={sport} className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">{sport}</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {matches.map((match) => (
                <MatchCard key={match.id} match={match} />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
