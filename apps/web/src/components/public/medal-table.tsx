import { MEDAL_POINTS } from "@it3k/db/competition-rules";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@it3k/ui/components/table";
import { cn } from "@it3k/ui/lib/utils";

import type { Medals } from "@/lib/public-competition";

import { institutionOf } from "./match-format";

const MEDAL_COLORS = ["bg-amber-400", "bg-slate-300", "bg-orange-400"] as const;

function MedalDot({ place }: { place: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3 rounded-full",
        MEDAL_COLORS[place - 1] ?? "bg-muted-foreground/40",
      )}
    />
  );
}

/** The overall table: points, then golds, silvers and bronzes. */
export function MedalTable({ rows }: { rows: Medals["rows"] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8 text-center">#</TableHead>
            <TableHead>สถาบัน</TableHead>
            <TableHead className="text-center">
              <span className="sr-only">ทอง</span>
              <MedalDot place={1} />
            </TableHead>
            <TableHead className="text-center">
              <span className="sr-only">เงิน</span>
              <MedalDot place={2} />
            </TableHead>
            <TableHead className="text-center">
              <span className="sr-only">ทองแดง</span>
              <MedalDot place={3} />
            </TableHead>
            <TableHead className="text-center">ที่ 4</TableHead>
            <TableHead className="text-center font-semibold">คะแนน</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const institution = institutionOf(row.institution);
            return (
              <TableRow key={row.institution}>
                <TableCell className="text-center tabular-nums">{row.rank}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {institution && (
                      <img src={institution.logo} alt="" className="size-6 object-contain" />
                    )}
                    <span className="font-medium">{institution?.short ?? row.institution}</span>
                  </div>
                </TableCell>
                <TableCell className="text-center tabular-nums">{row.gold}</TableCell>
                <TableCell className="text-center tabular-nums">{row.silver}</TableCell>
                <TableCell className="text-center tabular-nums">{row.bronze}</TableCell>
                <TableCell className="text-center tabular-nums">{row.fourth}</TableCell>
                <TableCell className="text-center font-semibold tabular-nums">
                  {row.points}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Each division's final places; friendlies say they earn nothing. */
export function DivisionResults({ divisions }: { divisions: Medals["divisions"] }) {
  if (divisions.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="division-results">
      <h2 id="division-results" className="text-lg font-semibold">
        ผลรายประเภท
      </h2>
      <p className="text-xs text-muted-foreground">
        อันดับ 1–4 ได้ {MEDAL_POINTS.join("/")} คะแนน ประเภทที่ไม่ครบ 3 ทีมเป็นนัดกระชับมิตร ไม่นับคะแนน
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {divisions.map((division) => (
          <div key={division.id} className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium">{division.name}</h3>
              {!division.counted && (
                <span className="text-xs text-muted-foreground">ไม่นับคะแนน</span>
              )}
            </div>
            <ol className="flex flex-col gap-1 text-sm">
              {division.places.map((place) => (
                <li key={place.team.id} className="flex items-center gap-2">
                  <MedalDot place={place.place} />
                  <span className="w-5 tabular-nums text-muted-foreground">{place.place}</span>
                  <span>{place.team.name}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
