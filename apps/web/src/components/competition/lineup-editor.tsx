// A team's lineup for one match: who starts and who sits on the bench, picked
// from the team's members within the division's limits.
import { type LineupRole, LINEUP_ROLE_LABELS } from "@it3k/db/competition-rules";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { LoadingButton } from "@/components/loading-button";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import type { LineupPage } from "@/lib/competition-teams";
import { toastError } from "@/lib/errors";

export type LineupEditorProps = {
  matchId: string;
  participantId: string;
  teamId: string;
  // The division's limits; null means the match needs no lineup.
  starters: number | null;
  maxSubs: number | null;
  canEdit: boolean;
  onSaved?: () => void;
};

type Slot = LineupRole | "out";

export function LineupEditor(props: LineupEditorProps) {
  const { competitionTeams: api } = useApis();
  const queryKey = ["competition-teams", "lineup", props.matchId, props.participantId];
  const lineup = useQuery({
    queryKey,
    queryFn: () => api.lineup(props.matchId, props.participantId),
    enabled: props.starters !== null,
  });

  if (props.starters === null) return null;
  if (lineup.isPending) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <span className="sr-only">กำลังโหลดรายชื่อ</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (lineup.isError) {
    return <ErrorState error={lineup.error} onRetry={lineup.refetch} title="โหลดรายชื่อไม่สำเร็จ" />;
  }
  // Keyed so a reload after saving starts from what was saved.
  return (
    <LineupForm
      key={`${lineup.dataUpdatedAt}`}
      {...props}
      starters={props.starters}
      page={lineup.data}
      queryKey={queryKey}
    />
  );
}

function LineupForm({
  matchId,
  participantId,
  starters: maxStarters,
  maxSubs,
  canEdit,
  onSaved,
  page,
  queryKey,
}: LineupEditorProps & { starters: number; page: LineupPage; queryKey: unknown[] }) {
  const { competitionTeams: api } = useApis();
  const queryClient = useQueryClient();
  const [picks, setPicks] = useState<Record<string, Slot>>(() => {
    const initial: Record<string, Slot> = {};
    for (const id of page.starters) initial[id] = "starter";
    for (const id of page.subs) initial[id] = "sub";
    return initial;
  });
  const subsLimit = maxSubs ?? 0;
  const members = page.team?.members ?? [];
  const chosen = (role: LineupRole) =>
    members.filter((member) => picks[member.registrationId] === role).map((m) => m.registrationId);
  const starters = chosen("starter");
  const subs = chosen("sub");
  const editable = canEdit && page.canEdit && !page.locked;
  const saved = starters.join() === page.starters.join() && subs.join() === page.subs.join();

  const save = useMutation({
    mutationFn: () => api.saveLineup(matchId, participantId, { starters, subs }),
    onSuccess: () => {
      toast.success("บันทึกรายชื่อแล้ว");
      onSaved?.();
    },
    onError: (error) => toastError(error, "บันทึกรายชื่อไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const segments = (current: Slot) => {
    const options: { value: Slot; label: string }[] = [{ value: "out", label: "ไม่ลง" }];
    if (current === "starter" || starters.length < maxStarters) {
      options.push({ value: "starter", label: LINEUP_ROLE_LABELS.starter });
    }
    if (subsLimit > 0 && (current === "sub" || subs.length < subsLimit)) {
      options.push({ value: "sub", label: LINEUP_ROLE_LABELS.sub });
    }
    return options;
  };

  return (
    <section aria-label="รายชื่อลงแข่ง" className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <ClipboardList className="size-4 text-primary" aria-hidden />
          {page.team?.label ?? "รายชื่อลงแข่ง"}
        </h3>
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          ตัวจริง {starters.length} / {maxStarters}
          {subsLimit > 0 && ` · สำรอง ${subs.length} / ${subsLimit}`}
        </p>
      </header>
      {page.locked && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" aria-hidden /> แมตช์นี้จบแล้ว แก้รายชื่อไม่ได้
        </p>
      )}
      {members.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          ทีมนี้ยังไม่มีนักกีฬา
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {members.map((member) => {
            const current = picks[member.registrationId] ?? "out";
            return (
              <li
                key={member.registrationId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <span className={cn("text-sm", current === "out" && "text-muted-foreground")}>
                  {member.shirtNumber !== null && (
                    <span className="mr-1.5 tabular-nums text-muted-foreground">
                      #{member.shirtNumber}
                    </span>
                  )}
                  {member.displayName}
                </span>
                {editable ? (
                  <SegmentedControl
                    label={`ตำแหน่งของ ${member.displayName}`}
                    segments={segments(current)}
                    value={current}
                    onChange={(next) =>
                      setPicks((before) => ({ ...before, [member.registrationId]: next }))
                    }
                  />
                ) : (
                  current !== "out" && (
                    <span className="text-sm text-muted-foreground">
                      {LINEUP_ROLE_LABELS[current]}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && (
        <LoadingButton
          type="button"
          className="h-11 sm:h-9 sm:self-end"
          loading={save.isPending}
          disabled={saved}
          onClick={() => save.mutate()}
        >
          บันทึกรายชื่อ
        </LoadingButton>
      )}
    </section>
  );
}
