import type { MatchStatus } from "@it3k/db/match-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@it3k/ui/components/empty";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Minus, Pencil, Plus, Trash2, Trophy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SideDrawer } from "@/components/calendar/side-drawer";
import { PageHeader } from "@/components/page-header";
import { MatchForm } from "@/components/scores/match-form";
import { type Segment, SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import {
  type Match,
  type MatchInput,
  type MatchUpdate,
  STATUS_LABELS,
  isStale,
  universityLabel,
} from "@/lib/matches";

const QUERY_KEY = ["matches"];

type Filter = MatchStatus | "all";

const FILTERS: Segment<Filter>[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "live", label: STATUS_LABELS.live },
  { value: "scheduled", label: STATUS_LABELS.scheduled },
  { value: "finished", label: STATUS_LABELS.finished },
];

export function StatusBadge({ status }: { status: MatchStatus }) {
  return (
    <Badge
      variant={status === "live" ? "destructive" : status === "finished" ? "secondary" : "outline"}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function ScoreSide({
  match,
  side,
  onBump,
  busy,
}: {
  match: Match;
  side: "A" | "B";
  onBump: (delta: 1 | -1) => void;
  busy: boolean;
}) {
  const team = side === "A" ? match.teamA : match.teamB;
  const score = side === "A" ? match.scoreA : match.scoreB;
  const name = universityLabel(team);
  const live = match.status === "live";
  return (
    <div className={cn("flex items-center gap-2", side === "B" && "flex-row-reverse")}>
      <span className="w-12 font-medium">{name}</span>
      {live && (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`ลดคะแนน ${name}`}
          disabled={busy || !score}
          onClick={() => onBump(-1)}
        >
          <Minus />
        </Button>
      )}
      <output
        className="w-10 text-center text-2xl font-semibold tabular-nums"
        aria-label={`คะแนน ${name}`}
      >
        {score ?? "–"}
      </output>
      {live && (
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={`เพิ่มคะแนน ${name}`}
          disabled={busy}
          onClick={() => onBump(1)}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}

/** Staff record matches and correct their scores; any member may edit. */
export function ScoresPage() {
  const { matches } = useApis();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Match | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const list = useQuery({ queryKey: QUERY_KEY, queryFn: () => matches.list() });
  const items = list.data?.items ?? [];
  const shown = filter === "all" ? items : items.filter((item) => item.status === filter);
  const sports = [...new Set(items.map((item) => item.sport))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const close = () => {
    setEditing(null);
    setConfirmDelete(false);
  };
  const failed = (what: string) => (error: Error) => {
    close();
    if (isStale(error)) {
      toast.error("มีคนแก้แมตช์นี้ก่อน โหลดข้อมูลล่าสุดแล้ว ลองอีกครั้ง");
      void refresh();
      return;
    }
    toast.error(`${what}ไม่สำเร็จ: ${error.message}`);
  };

  const create = useMutation({
    mutationFn: (input: MatchInput) => matches.create(input),
    onSuccess: async () => {
      close();
      toast.success("เพิ่มแมตช์แล้ว");
      await refresh();
    },
    onError: failed("เพิ่มแมตช์"),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: MatchUpdate }) => matches.update(id, input),
    onSuccess: async () => {
      close();
      await refresh();
    },
    onError: failed("บันทึกคะแนน"),
  });

  const remove = useMutation({
    mutationFn: (match: Match) => matches.remove(match.id, match.version),
    onSuccess: async () => {
      close();
      toast.success("ลบแมตช์แล้ว");
      await refresh();
    },
    onError: failed("ลบแมตช์"),
  });

  function bump(match: Match, side: "A" | "B", delta: 1 | -1) {
    const key = side === "A" ? "scoreA" : "scoreB";
    const next = Math.max(0, (match[key] ?? 0) + delta);
    update.mutate({ id: match.id, input: { version: match.version, [key]: next } });
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={Trophy}
        title="คะแนนการแข่งขัน"
        description={
          <>
            บันทึกและแก้คะแนนรายแมตช์ ตารางคะแนนรวมคำนวณจากแมตช์ที่จบแล้ว{" "}
            <Link
              to="/scores"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              ดูหน้าสาธารณะ
              <ExternalLink aria-hidden className="size-3.5" />
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          label="สถานะแมตช์"
          segments={FILTERS}
          value={filter}
          onChange={setFilter}
        />
        <Button onClick={() => setEditing("new")}>
          <Plus data-icon="inline-start" />
          เพิ่มแมตช์
        </Button>
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      ) : list.isError ? (
        <p className="text-destructive">โหลดแมตช์ไม่สำเร็จ: {list.error.message}</p>
      ) : shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy />
            </EmptyMedia>
            <EmptyTitle>ยังไม่มีแมตช์</EmptyTitle>
            <EmptyDescription>กด “เพิ่มแมตช์” เพื่อเริ่มบันทึกคะแนน</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((match) => (
            <li
              key={match.id}
              aria-label={`${match.sport} ${universityLabel(match.teamA)} พบ ${universityLabel(match.teamB)}`}
              className="flex flex-col gap-3 rounded-2xl border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{match.sport}</span>
                {match.round && <span className="text-muted-foreground">· {match.round}</span>}
                <StatusBadge status={match.status} />
                {match.startsAt && (
                  <span className="text-xs text-muted-foreground">
                    {formatBangkok(match.startsAt, "dateTime")}
                  </span>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="ml-auto"
                  aria-label="แก้ไขแมตช์"
                  onClick={() => setEditing(match)}
                >
                  <Pencil />
                </Button>
              </div>
              <div className="flex items-center justify-center gap-3">
                <ScoreSide
                  match={match}
                  side="A"
                  busy={update.isPending}
                  onBump={(delta) => bump(match, "A", delta)}
                />
                <span className="text-muted-foreground">:</span>
                <ScoreSide
                  match={match}
                  side="B"
                  busy={update.isPending}
                  onBump={(delta) => bump(match, "B", delta)}
                />
              </div>
              {match.updatedBy && (
                <span className="text-xs text-muted-foreground">
                  แก้ล่าสุดโดย {match.updatedBy.name} · {formatBangkok(match.updatedAt, "dateTime")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <SideDrawer
        open={editing !== null}
        onOpenChange={(open) => !open && close()}
        title={editing === "new" ? "เพิ่มแมตช์" : "แก้ไขแมตช์"}
      >
        {editing !== null && (
          <div className="flex flex-col gap-6">
            <MatchForm
              key={editing === "new" ? "new" : `${editing.id}-${editing.version}`}
              initial={editing === "new" ? undefined : editing}
              sports={sports}
              pending={create.isPending || update.isPending}
              onCancel={close}
              onSubmit={(input) =>
                editing === "new"
                  ? create.mutate(input)
                  : update.mutate({ id: editing.id, input: { ...input, version: editing.version } })
              }
            />
            {editing !== "new" && (
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => (confirmDelete ? remove.mutate(editing) : setConfirmDelete(true))}
              >
                <Trash2 data-icon="inline-start" />
                {confirmDelete ? "กดอีกครั้งเพื่อยืนยันการลบ" : "ลบแมตช์"}
              </Button>
            )}
          </div>
        )}
      </SideDrawer>
    </div>
  );
}
