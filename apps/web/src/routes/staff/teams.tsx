import { Alert, AlertDescription } from "@it3k/ui/components/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Info, Settings2, TriangleAlert, Users2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { TeamIssueBadge } from "@/components/competition/team-issues";
import { ErrorState } from "@/components/error-state";
import { InstitutionLabel } from "@/components/institution-logo";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { SportArt } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import type { CompetitionDivision } from "@/lib/competition-divisions";
import type { AutoTeamsPlan } from "@/lib/competition-teams";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/staff/teams")({
  head: () => ({ meta: [{ title: "ทีมแข่ง · IT3Kings" }] }),
  component: TeamsOverview,
});

type SportGroup = {
  sportId: string;
  sportName: string;
  sportIcon: CompetitionDivision["sportIcon"];
  divisions: CompetitionDivision[];
};

function groupBySport(divisions: readonly CompetitionDivision[]) {
  const groups: SportGroup[] = [];
  for (const division of divisions) {
    let group = groups.find((item) => item.sportId === division.sportId);
    if (!group) {
      group = {
        sportId: division.sportId,
        sportName: division.sportName,
        sportIcon: division.sportIcon,
        divisions: [],
      };
      groups.push(group);
    }
    group.divisions.push(division);
  }
  return groups;
}

/** Every division with how many teams it has and how many still lack something. */
export function TeamsOverview() {
  const apis = useApis();
  const divisions = useQuery({
    queryKey: ["competition-divisions"],
    queryFn: () => apis.competitionDivisions.list(),
  });
  const teams = useQuery({
    queryKey: ["competition-teams", "all"],
    queryFn: () => apis.competitionTeams.list(),
  });

  const counts = new Map<string, { teams: number; withIssues: number }>();
  for (const team of teams.data?.items ?? []) {
    const count = counts.get(team.divisionId) ?? { teams: 0, withIssues: 0 };
    count.teams += 1;
    if (team.issues.length > 0) count.withIssues += 1;
    counts.set(team.divisionId, count);
  }
  const failed = divisions.isError ? divisions : teams.isError ? teams : null;

  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<AutoTeamsPlan | null>(null);
  const preview = useMutation({
    mutationFn: () => apis.competitionTeams.autoAll({ dryRun: true }),
    onSuccess: setPlan,
    onError: (error) => toastError(error, "ดูแผนจัดทีมไม่สำเร็จ"),
  });
  const apply = useMutation({
    mutationFn: () => apis.competitionTeams.autoAll({ dryRun: false }),
    onSuccess: (result) => {
      const made = result.divisions
        .filter((division) => !result.failed.includes(division.id))
        .reduce((sum, division) => sum + division.create.length, 0);
      toast.success(`จัดทีมอัตโนมัติแล้ว ${made} ทีม`);
      if (result.failed.length > 0) {
        toast.error(`${result.failed.length} ประเภทมีคนแก้ไปก่อน จึงไม่ได้จัด ลองใหม่อีกครั้ง`);
      }
      setPlan(null);
    },
    onError: (error) => toastError(error, "จัดทีมอัตโนมัติไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["competition-teams"] }),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          icon={Users2}
          title="ทีมแข่ง"
          description="ทีมของแต่ละมหาลัยในแต่ละประเภท เลือกประเภทเพื่อจัดนักกีฬาเข้าทีม"
        />
        {teams.data?.canManage && (
          <LoadingButton
            variant="outline"
            icon={Wand2}
            loading={preview.isPending}
            onClick={() => preview.mutate()}
          >
            จัดทีมอัตโนมัติทุกประเภท
          </LoadingButton>
        )}
      </div>
      {divisions.isPending || teams.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : failed ? (
        <ErrorState error={failed.error} onRetry={failed.refetch} title="โหลดทีมไม่สำเร็จ" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groupBySport(divisions.data?.items ?? []).map((group) => (
            <section
              key={group.sportId}
              aria-labelledby={`sport-${group.sportId}`}
              className="flex flex-col overflow-hidden rounded-3xl border"
            >
              <header className="flex items-center gap-3 border-b p-3">
                <span aria-hidden className="shrink-0">
                  <SportArt
                    icon={group.sportIcon}
                    seed={group.sportId}
                    label=""
                    className="h-10 w-16 rounded-xl"
                  />
                </span>
                <h2 id={`sport-${group.sportId}`} className="font-semibold">
                  {group.sportName}
                </h2>
              </header>
              <ul className="flex flex-col divide-y">
                {group.divisions.map((division) => {
                  const count = counts.get(division.id) ?? { teams: 0, withIssues: 0 };
                  return (
                    <li key={division.id} className="flex items-center gap-1 pr-2">
                      <Link
                        to="/staff/teams/$divisionId"
                        params={{ divisionId: division.id }}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">{division.name}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {count.teams} ทีม
                            <TeamIssueBadge count={count.withIssues} />
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </Link>
                      {divisions.data?.canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`ตั้งค่าการแข่งขัน ${division.name}`}
                          render={
                            <Link
                              to="/staff/competition/$divisionId"
                              params={{ divisionId: division.id }}
                            />
                          }
                          nativeButton={false}
                        >
                          <Settings2 aria-hidden />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {plan && (
        <AutoTeamsDialog
          plan={plan}
          pending={apply.isPending}
          onConfirm={() => apply.mutate()}
          onClose={() => setPlan(null)}
        />
      )}
    </div>
  );
}

/**
 * The plan of "auto for every division", to confirm before anything is made:
 * which institutions get a team in which division, and what is left alone.
 */
function AutoTeamsDialog({
  plan,
  pending,
  onConfirm,
  onClose,
}: {
  plan: AutoTeamsPlan;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const making = plan.divisions.filter((division) => division.create.length > 0);
  const teamCount = making.reduce((sum, division) => sum + division.create.length, 0);
  const arranged = plan.divisions.reduce((sum, division) => sum + division.skipped.length, 0);
  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {teamCount > 0
              ? `จัดทีมอัตโนมัติ ${making.length} ประเภท สร้าง ${teamCount} ทีม`
              : "ไม่มีทีมที่ต้องจัดเพิ่ม"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {teamCount > 0
              ? "แต่ละมหาลัยได้ 1 ทีม ใส่นักกีฬาที่อนุมัติแล้วทุกคน ปรับรายชื่อทีหลังได้ในหน้าประเภท"
              : "ทุกมหาลัยที่มีนักกีฬาอนุมัติแล้วจัดทีมไว้แล้ว"}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Alert>
          <Info aria-hidden />
          <AlertDescription>
            <p>
              <strong>ไม่รวมกีฬาแบดมินตัน</strong> ต้องจัดทีมเองตามมือ 1 / มือ 2 และคู่ที่เลือกไว้
            </p>
            {arranged > 0 && <p>ข้ามมหาลัยที่จัดทีมไว้แล้ว {arranged} รายการ ไม่แตะรายชื่อเดิม</p>}
          </AlertDescription>
        </Alert>

        {making.length > 0 && (
          <ul className="flex flex-col divide-y rounded-2xl border" aria-label="ทีมที่จะสร้าง">
            {making.map((division) => (
              <li key={division.id} className="flex flex-col gap-2 px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden className="size-6 shrink-0 overflow-hidden rounded-md">
                    <SportArt
                      icon={division.sportIcon}
                      seed={division.id}
                      label=""
                      className="size-6"
                    />
                  </span>
                  {division.name}
                </span>
                <ul className="flex flex-wrap gap-1.5">
                  {division.create.map((entry) => (
                    <li
                      key={entry.institution}
                      className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs"
                    >
                      <InstitutionLabel institution={entry.institution} />
                      <span className="text-muted-foreground">{entry.members} คน</span>
                      {entry.overMax && (
                        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <TriangleAlert className="size-3" aria-hidden />
                          เกินจำนวนสูงสุด
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{teamCount > 0 ? "ยกเลิก" : "ปิด"}</AlertDialogCancel>
          {teamCount > 0 && (
            <LoadingButton icon={Wand2} loading={pending} onClick={onConfirm}>
              สร้าง {teamCount} ทีม
            </LoadingButton>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
