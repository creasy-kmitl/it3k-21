import { TIEBREAK_LABELS, type Tiebreak } from "@it3k/db/competition-rules";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@it3k/ui/components/table";

import type { StandingsDivision } from "@/lib/public-competition";

type Group = StandingsDivision["groups"][number];

/** Whether the division plays in sets, so set and point ratios mean something. */
const showsSets = (division: StandingsDivision) =>
  division.tiebreaks.includes("setRatio") || division.tiebreaks.includes("pointRatio");

function GroupTable({ group, sets }: { group: Group; sets: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">
        {group.stageName} · {group.name}
      </h3>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-center">#</TableHead>
              <TableHead>ทีม</TableHead>
              <TableHead className="text-center" title="แข่ง">
                แข่ง
              </TableHead>
              <TableHead className="text-center" title="ชนะ">
                ชนะ
              </TableHead>
              <TableHead className="text-center" title="เสมอ">
                เสมอ
              </TableHead>
              <TableHead className="text-center" title="แพ้">
                แพ้
              </TableHead>
              {sets ? (
                <TableHead className="text-center" title="เซตได้-เสีย">
                  เซต
                </TableHead>
              ) : (
                <TableHead className="text-center" title="คะแนนได้-เสีย">
                  ได้-เสีย
                </TableHead>
              )}
              <TableHead className="text-center" title="ผลต่าง">
                +/-
              </TableHead>
              <TableHead className="text-center font-semibold">แต้ม</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  ยังไม่มีทีมในสายนี้
                </TableCell>
              </TableRow>
            ) : (
              group.rows.map((row) => (
                <TableRow key={row.teamId}>
                  <TableCell className="text-center tabular-nums">{row.rank}</TableCell>
                  <TableCell className="font-medium">{row.team.name}</TableCell>
                  <TableCell className="text-center tabular-nums">{row.played}</TableCell>
                  <TableCell className="text-center tabular-nums">{row.wins}</TableCell>
                  <TableCell className="text-center tabular-nums">{row.draws}</TableCell>
                  <TableCell className="text-center tabular-nums">{row.losses}</TableCell>
                  <TableCell className="text-center tabular-nums">
                    {sets
                      ? `${row.setsFor}-${row.setsAgainst}`
                      : `${row.scoreFor}-${row.scoreAgainst}`}
                  </TableCell>
                  <TableCell className="text-center tabular-nums">
                    {row.scoreDiff > 0 ? `+${row.scoreDiff}` : row.scoreDiff}
                  </TableCell>
                  <TableCell className="text-center font-semibold tabular-nums">
                    {row.points}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** A division's group tables, with how points are given and ties broken. */
export function DivisionStandings({ division }: { division: StandingsDivision }) {
  const sets = showsSets(division);
  const { win, draw, loss } = division.points;
  const tiebreaks = division.tiebreaks
    .map((tiebreak) => TIEBREAK_LABELS[tiebreak as Tiebreak])
    .filter(Boolean);
  return (
    <section aria-labelledby={`division-${division.id}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`division-${division.id}`} className="text-lg font-semibold">
          {division.name}
        </h2>
        <p className="text-xs text-muted-foreground">
          ชนะ {win} · เสมอ {draw} · แพ้ {loss} แต้ม
          {tiebreaks.length > 0 && ` · แต้มเท่ากันดู${tiebreaks.join(" > ")}`}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {division.groups.map((group) => (
          <GroupTable key={group.id} group={group} sets={sets} />
        ))}
      </div>
    </section>
  );
}
