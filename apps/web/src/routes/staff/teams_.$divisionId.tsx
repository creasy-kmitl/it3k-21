import { INSTITUTION_IDS, INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { teamIssues, teamSizeLimits } from "@it3k/db/team-rules";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@it3k/ui/components/tabs";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, Settings2, Shuffle, Trash2, Undo2, Users2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { TeamIssueBadge, TeamIssueList } from "@/components/competition/team-issues";
import { TeamMemberPicker } from "@/components/competition/team-member-picker";
import { TeamOfficials } from "@/components/competition/team-officials";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { ConfirmDelete, FormDialog, TextField } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import type { DivisionTeamsPage as PageData, Team } from "@/lib/competition-teams";
import { toastError } from "@/lib/errors";

const searchSchema = z.object({
  institution: z.enum(INSTITUTION_IDS).optional().catch(undefined),
  team: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/staff/teams_/$divisionId")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({ meta: [{ title: "ทีมแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { divisionId } = Route.useParams();
  const { institution, team } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  return (
    <>
      <DivisionTeamsPage
        divisionId={divisionId}
        institution={institution}
        teamId={team}
        onSelect={(next) => navigate({ search: next, replace: true })}
        onDirtyChange={setDirty}
      />
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งรายชื่อที่ยังไม่ได้บันทึก?</AlertDialogTitle>
            <AlertDialogDescription>นักกีฬาที่เลือกไว้แต่ยังไม่ได้บันทึกจะหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>แก้ต่อ</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => blocker.proceed?.()}>
              ทิ้ง
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** A member list being edited, with the team version it started from. */
type Draft = { ids: string[]; version: number };

type Dialog =
  | { kind: "auto" }
  | { kind: "rename"; team: Team }
  | { kind: "delete"; team: Team }
  | { kind: "discard" };

/**
 * One division's teams, an institution at a time: tick athletes into each
 * team, add its officials, and see what it still lacks. Member lists save
 * together from the bar at the bottom.
 */
export function DivisionTeamsPage({
  divisionId,
  institution: chosenInstitution,
  teamId,
  onSelect,
  onDirtyChange,
}: {
  divisionId: string;
  institution?: Institution;
  teamId?: string;
  onSelect: (next: { institution?: Institution; team?: string }) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { competitionTeams: api } = useApis();
  const queryClient = useQueryClient();
  const queryKey = ["competition-teams", "division", divisionId];
  const page = useQuery({ queryKey, queryFn: () => api.division(divisionId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["competition-teams"] });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const data = page.data;
  const institution = chosenInstitution ?? firstInstitution(data);
  const teams = (data?.teams ?? []).filter((team) => team.institution === institution);
  const team = teams.find((item) => item.id === teamId) ?? teams[0];
  const athletes = (data?.athletes ?? []).filter((athlete) => athlete.institution === institution);
  const canManage = data?.canManage ?? false;

  const idsOf = (item: Team) => drafts[item.id]?.ids ?? item.members.map((m) => m.registrationId);
  const isDirty = (item: Team) => {
    const draft = drafts[item.id];
    return (
      draft !== undefined && draft.ids.join() !== item.members.map((m) => m.registrationId).join()
    );
  };
  const dirtyTeams = (data?.teams ?? []).filter(isDirty);
  const dirty = dirtyTeams.length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const added = (item: Team) => {
    const saved = new Set(item.members.map((m) => m.registrationId));
    return idsOf(item).filter((id) => !saved.has(id)).length;
  };

  const save = useMutation({
    mutationFn: async () => {
      // Teams giving athletes up save first, so the ones taking them in find them free.
      const ordered = [...dirtyTeams].sort((a, b) => added(a) - added(b));
      for (const item of ordered) {
        const draft = drafts[item.id] as Draft;
        await api.saveMembers(item.id, { registrationIds: draft.ids, version: draft.version });
        setDrafts(({ [item.id]: _saved, ...rest }) => rest);
      }
    },
    onSuccess: () => toast.success("บันทึกรายชื่อแล้ว"),
    onError: (error) => toastError(error, "บันทึกรายชื่อไม่สำเร็จ"),
    onSettled: refresh,
  });

  const create = useMutation({
    mutationFn: () => api.create({ divisionId, institution, seq: null, name: null }),
    onSuccess: (result) => {
      toast.success(`เพิ่ม ${result.team.label} แล้ว`);
      onSelect({ institution, team: result.team.id });
    },
    onError: (error) => toastError(error, "เพิ่มทีมไม่สำเร็จ"),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (item: Team) => api.remove(item.id),
    onSuccess: (_result, item) => {
      toast.success(`ลบ ${item.label} แล้ว`);
      setDrafts(({ [item.id]: _removed, ...rest }) => rest);
      setDialog(null);
      onSelect({ institution });
    },
    onError: (error) => toastError(error, "ลบทีมไม่สำเร็จ"),
    onSettled: refresh,
  });

  if (page.isPending) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (page.isError) {
    return <ErrorState error={page.error} onRetry={page.refetch} title="โหลดทีมไม่สำเร็จ" />;
  }

  const division = page.data.division;
  const { max } = teamSizeLimits(division);
  const canAddTeam = canManage && teams.length < division.maxTeamsPerInstitution;
  const labelOf = (id: string) => teams.find((item) => item.id === id)?.label ?? null;
  const otherTeamOf = (registrationId: string) => {
    const owner = teams.find(
      (item) => item.id !== team?.id && idsOf(item).includes(registrationId),
    );
    return owner ? labelOf(owner.id) : null;
  };
  // Issues follow the ticks as they change, before saving.
  const liveIssues = team
    ? teamIssues(
        division,
        idsOf(team).map((id) => {
          const athlete = athletes.find((item) => item.registrationId === id);
          return { gender: athlete?.gender ?? null, status: athlete?.status ?? "approved" };
        }),
        team.officials.length,
      )
    : [];

  return (
    <div className={cn("flex flex-1 flex-col gap-4 sm:gap-6", dirty && "pb-24 sm:pb-0")}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link to="/staff/teams" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden /> ทีมทั้งหมด
      </Button>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={Users2}
          title={division.name}
          description={`${division.sportName} · มหาลัยละไม่เกิน ${division.maxTeamsPerInstitution} ทีม`}
        />
        {canManage && (
          <Button
            variant="outline"
            size="sm"
            render={<Link to="/staff/competition/$divisionId" params={{ divisionId }} />}
            nativeButton={false}
          >
            <Settings2 data-icon="inline-start" aria-hidden /> ตั้งค่าการแข่งขัน
          </Button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <SegmentedControl
          label="เลือกมหาลัย"
          className="w-max"
          segments={INSTITUTIONS.map((item) => ({ value: item.id, label: item.short }))}
          value={institution}
          onChange={(next) => onSelect({ institution: next })}
        />
      </div>

      {teams.length === 0 ? (
        <EmptyState
          icon={Users2}
          title="ยังไม่มีทีม"
          description={
            athletes.length > 0
              ? `มีนักกีฬาสมัครแล้ว ${athletes.length} คน`
              : "ยังไม่มีนักกีฬาของมหาลัยนี้สมัครประเภทนี้"
          }
          action={
            canManage && (
              <>
                <LoadingButton
                  icon={Plus}
                  loading={create.isPending}
                  onClick={() => create.mutate()}
                >
                  สร้างทีม
                </LoadingButton>
                {athletes.length > 0 && (
                  <Button variant="outline" onClick={() => setDialog({ kind: "auto" })}>
                    <Shuffle data-icon="inline-start" aria-hidden /> จัดทีมอัตโนมัติ
                  </Button>
                )}
              </>
            )
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={team?.id}
              onValueChange={(value) => onSelect({ institution, team: String(value) })}
              className="-mx-4 max-w-[calc(100%+2rem)] flex-1 overflow-x-auto px-4"
            >
              <TabsList aria-label="ทีม" className="w-max">
                {teams.map((item) => (
                  <TabsTrigger key={item.id} value={item.id} className="gap-2 px-3">
                    {item.label}
                    {isDirty(item) && (
                      <>
                        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                        <span className="sr-only">ยังไม่บันทึก</span>
                      </>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {canManage && (
              <div className="flex gap-2">
                {canAddTeam && (
                  <LoadingButton
                    variant="outline"
                    size="sm"
                    icon={Plus}
                    loading={create.isPending}
                    onClick={() => create.mutate()}
                  >
                    เพิ่มทีม
                  </LoadingButton>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={dirty}
                  onClick={() => setDialog({ kind: "auto" })}
                >
                  <Shuffle data-icon="inline-start" aria-hidden /> จัดอัตโนมัติ
                </Button>
              </div>
            )}
          </div>

          {team && (
            <article
              aria-label={team.label}
              className="flex flex-col gap-6 rounded-3xl border p-4 sm:p-6"
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  {team.label}
                  <TeamIssueBadge count={liveIssues.length} />
                </h2>
                {canManage && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ kind: "rename", team })}
                    >
                      <Pencil data-icon="inline-start" aria-hidden /> เปลี่ยนชื่อ
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDialog({ kind: "delete", team })}
                    >
                      <Trash2 data-icon="inline-start" aria-hidden /> ลบทีม
                    </Button>
                  </div>
                )}
              </header>
              <TeamIssueList issues={liveIssues} />
              <TeamMemberPicker
                athletes={athletes}
                selected={idsOf(team)}
                max={max}
                otherTeamOf={otherTeamOf}
                disabled={!canManage || save.isPending}
                onChange={(ids) =>
                  setDrafts((before) => ({
                    ...before,
                    [team.id]: { ids, version: before[team.id]?.version ?? team.version },
                  }))
                }
              />
              <TeamOfficials
                teamId={team.id}
                officials={team.officials}
                max={division.maxOfficials}
                canManage={canManage}
                onChanged={refresh}
              />
            </article>
          )}
        </>
      )}

      {dirty && (
        <section
          aria-label="บันทึกรายชื่อ"
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-4 sm:rounded-2xl sm:border sm:p-3"
        >
          <div className="flex items-center gap-2">
            <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
              แก้รายชื่อ {dirtyTeams.length} ทีม ยังไม่ได้บันทึก
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-11 sm:h-9"
              onClick={() => setDialog({ kind: "discard" })}
            >
              <Undo2 data-icon="inline-start" aria-hidden /> ยกเลิก
            </Button>
            <LoadingButton
              type="button"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              บันทึก
            </LoadingButton>
          </div>
        </section>
      )}

      {dialog?.kind === "auto" && (
        <AutoDialog
          divisionId={divisionId}
          institution={institution}
          maxTeams={division.maxTeamsPerInstitution}
          approved={athletes.filter((athlete) => athlete.status === "approved").length}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setDrafts({});
            refresh();
          }}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          team={dialog.team}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            refresh();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDelete
          name={dialog.team.label}
          description="รายชื่อนักกีฬาและเจ้าหน้าที่ของทีมนี้จะหายไปด้วย ทีมที่มีแมตช์แล้วลบไม่ได้"
          pending={remove.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => remove.mutate(dialog.team)}
        />
      )}
      <AlertDialog
        open={dialog?.kind === "discard"}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกการแก้ไข?</AlertDialogTitle>
            <AlertDialogDescription>รายชื่อที่แก้ไว้ตั้งแต่บันทึกครั้งล่าสุดจะหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>แก้ไขต่อ</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setDrafts({});
                setDialog(null);
              }}
            >
              ยกเลิกการแก้ไข
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The first institution with athletes or teams in the division, else the host. */
function firstInstitution(data: PageData | undefined): Institution {
  const used = new Set<string>([
    ...(data?.teams ?? []).map((team) => team.institution),
    ...(data?.athletes ?? []).map((athlete) => athlete.institution),
  ]);
  return INSTITUTION_IDS.find((id) => used.has(id)) ?? INSTITUTION_IDS[0];
}

function AutoDialog({
  divisionId,
  institution,
  maxTeams,
  approved,
  onClose,
  onDone,
}: {
  divisionId: string;
  institution: Institution;
  maxTeams: number;
  approved: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { competitionTeams: api } = useApis();
  const [teamCount, setTeamCount] = useState(1);
  const auto = useMutation({
    mutationFn: () => api.auto({ divisionId, institution, teamCount }),
    onSuccess: () => {
      toast.success("จัดทีมแล้ว");
      onDone();
    },
    onError: (error) => toastError(error, "จัดทีมไม่สำเร็จ"),
  });
  return (
    <FormDialog
      title="จัดทีมอัตโนมัติ"
      icon={Shuffle}
      description={`นำนักกีฬาที่อนุมัติแล้ว ${approved} คนเข้าทีม แทนรายชื่อเดิมของทุกทีมในมหาลัยนี้`}
      submitLabel="จัดทีม"
      submitIcon={Shuffle}
      pending={auto.isPending}
      onClose={onClose}
      onSubmit={() => auto.mutate()}
    >
      {maxTeams > 1 ? (
        <SegmentedControl
          label="จำนวนทีม"
          segments={Array.from({ length: maxTeams }, (_, index) => ({
            value: index + 1,
            label: index === 0 ? "รวมเป็น 1 ทีม" : `แบ่ง ${index + 1} ทีม`,
          }))}
          value={teamCount}
          onChange={setTeamCount}
        />
      ) : (
        <p className="text-sm text-muted-foreground">ทุกคนจะอยู่ในทีม 1</p>
      )}
      {teamCount > 1 && (
        <p className="text-sm text-muted-foreground">
          แจกนักกีฬาเข้าทีมทีละคนตามลำดับ ประเภทที่มีมือ 1/มือ 2 จะจัดตามมือก่อน
        </p>
      )}
    </FormDialog>
  );
}

function RenameDialog({
  team,
  onClose,
  onDone,
}: {
  team: Team;
  onClose: () => void;
  onDone: () => void;
}) {
  const { competitionTeams: api } = useApis();
  const [name, setName] = useState(team.name ?? "");
  const rename = useMutation({
    mutationFn: () => api.rename(team.id, { name: name.trim() || null, version: team.version }),
    onSuccess: () => {
      toast.success("เปลี่ยนชื่อทีมแล้ว");
      onDone();
    },
    onError: (error) => toastError(error, "เปลี่ยนชื่อไม่สำเร็จ"),
  });
  return (
    <FormDialog
      title="เปลี่ยนชื่อทีม"
      icon={Pencil}
      pending={rename.isPending}
      onClose={onClose}
      onSubmit={() => rename.mutate()}
    >
      <TextField
        id="team-name"
        label="ชื่อทีม"
        value={name}
        onChange={setName}
        maxLength={60}
        hint="เว้นว่างไว้เพื่อใช้ชื่อย่อมหาลัย"
        autoFocus
      />
    </FormDialog>
  );
}
