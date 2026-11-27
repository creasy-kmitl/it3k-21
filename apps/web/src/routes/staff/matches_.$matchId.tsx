import {
  MANUAL_MATCH_STATUSES,
  MATCH_OUTCOME_LABELS,
  MATCH_STATUS_LABELS,
  matchImageInput,
  refereeInput,
} from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  ClipboardPen,
  ImagePlus,
  MapPin,
  Pencil,
  ScanLine,
  Star,
  Swords,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { MatchCheckinPanel } from "@/components/competition/checkin/match-checkin-panel";
import { LineupEditor } from "@/components/competition/lineup-editor";
import { matchHeading, matchPlace } from "@/components/competition/match-card";
import { MatchForm } from "@/components/competition/match-form";
import { MatchSelect } from "@/components/competition/match-select";
import { MatchStatusBadge } from "@/components/competition/match-status-badge";
import { ErrorState } from "@/components/error-state";
import {
  ConfirmDelete,
  FormDialog,
  FormLabel,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import { ImageUrlField } from "@/components/image-url-field";
import { LoadingButton } from "@/components/loading-button";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import type { MatchDetail, MatchDetailResponse } from "@/lib/competition-matches";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/staff/matches_/$matchId")({
  head: () => ({ meta: [{ title: "แมตช์ · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { matchId } = Route.useParams();
  const navigate = useNavigate();
  return <MatchPage matchId={matchId} onDeleted={() => void navigate({ to: "/staff/matches" })} />;
}

type ManualStatus = (typeof MANUAL_MATCH_STATUSES)[number];

const matchKey = (id: string) => ["competition-matches", "detail", id];

/** One match: its sides, lineups, status, referees and pictures. */
export function MatchPage({ matchId, onDeleted }: { matchId: string; onDeleted: () => void }) {
  const apis = useApis();
  const api = apis.competitionMatches;
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: matchKey(matchId), queryFn: () => api.get(matchId) });
  const [dialog, setDialog] = useState<"edit" | "delete" | "image" | null>(null);

  const match = detail.data?.match;
  const canManage = detail.data?.canManage ?? false;
  const editing = dialog === "edit" && match;
  const divisions = useQuery({
    queryKey: ["competition-divisions"],
    queryFn: () => apis.competitionDivisions.list(),
    enabled: !!editing,
  });
  const venues = useQuery({
    queryKey: ["venues"],
    queryFn: () => apis.venues.list(),
    enabled: !!editing,
  });

  /** Keeps the page in step with what a write returned. */
  const apply = (next: MatchDetail) => {
    queryClient.setQueryData<MatchDetailResponse>(matchKey(matchId), (current) =>
      current ? { ...current, match: next } : current,
    );
    void queryClient.invalidateQueries({ queryKey: ["competition-matches", "list"] });
  };

  const write = useMutation({
    mutationFn: async (action: () => Promise<{ match: MatchDetail }>) => (await action()).match,
    onSuccess: (next) => {
      apply(next);
      toast.success("บันทึกแล้ว");
    },
    onError: (error) => {
      toastError(error, "บันทึกไม่สำเร็จ");
      void queryClient.invalidateQueries({ queryKey: matchKey(matchId) });
    },
  });

  const remove = useMutation({
    mutationFn: (version: number) => api.remove(matchId, version),
    onSuccess: () => {
      toast.success("ลบแมตช์แล้ว");
      void queryClient.invalidateQueries({ queryKey: ["competition-matches"] });
      onDeleted();
    },
    onError: (error) => toastError(error, "ลบไม่สำเร็จ"),
  });

  if (detail.isPending) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }
  if (detail.isError || !match) {
    return <ErrorState error={detail.error} onRetry={detail.refetch} title="โหลดแมตช์ไม่สำเร็จ" />;
  }

  const place = matchPlace(match);
  const lineups = match.division?.lineupStarters != null;

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        render={<Link to="/staff/matches" />}
        nativeButton={false}
      >
        <ArrowLeft /> แมตช์ทั้งหมด
      </Button>

      <header className="flex flex-col gap-3 rounded-3xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {match.sportName} · {match.divisionName}
              {match.friendly && " · กระชับมิตร"}
            </p>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Swords className="size-5 shrink-0 text-primary" aria-hidden />
              {matchHeading(match)}
            </h1>
          </div>
          <MatchStatusBadge status={match.status} />
        </div>
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden />
            {match.startAt !== null ? formatBangkok(match.startAt, "dateTime") : "ยังไม่กำหนดเวลา"}
          </span>
          {place && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden /> {place}
            </span>
          )}
          {match.outcome && <span>ผล: {MATCH_OUTCOME_LABELS[match.outcome]}</span>}
          {match.notes && <p className="whitespace-pre-wrap text-foreground">{match.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.data.canScore && (
            <Button
              render={<Link to="/score/$matchId" params={{ matchId: match.id }} />}
              nativeButton={false}
            >
              <ClipboardPen /> บันทึกคะแนน
            </Button>
          )}
          {canManage && (
            <>
              <Button variant="outline" onClick={() => setDialog("edit")}>
                <Pencil /> แก้ไข
              </Button>
              <Button variant="outline" onClick={() => setDialog("delete")}>
                <Trash2 className="text-destructive" /> ลบ
              </Button>
            </>
          )}
        </div>
      </header>

      {canManage && match.status !== "finished" && (
        <StatusControl
          key={`${match.status}-${match.version}`}
          status={match.status}
          pending={write.isPending}
          onSave={(status) =>
            write.mutate(() => api.setStatus(match.id, { status, version: match.version }))
          }
        />
      )}

      <Section title="ผู้แข่ง" icon={Users}>
        <ul className="flex flex-col gap-2">
          {match.participants.map((side) => (
            <li key={side.id} className="flex flex-col gap-2 rounded-2xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "min-w-0 truncate font-medium",
                    side.teamId === null && "text-muted-foreground italic",
                  )}
                >
                  {side.name}
                  {side.teamId !== null && side.label && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      ({side.label})
                    </span>
                  )}
                </span>
                <span className="text-lg font-semibold tabular-nums">{side.score ?? "–"}</span>
              </div>
              {side.teamId === null && canManage && (
                <AssignTeam
                  divisionId={match.divisionId}
                  takenTeamIds={match.participants.flatMap((p) => (p.teamId ? [p.teamId] : []))}
                  pending={write.isPending}
                  onAssign={(teamId) =>
                    write.mutate(() =>
                      api.assignTeam(match.id, side.id, { teamId, version: match.version }),
                    )
                  }
                />
              )}
              {lineups && side.teamId !== null && (
                <LineupEditor
                  matchId={match.id}
                  participantId={side.id}
                  teamId={side.teamId}
                  starters={match.division?.lineupStarters ?? null}
                  maxSubs={match.division?.lineupMaxSubs ?? null}
                  canEdit={canManage}
                  onSaved={() =>
                    void queryClient.invalidateQueries({ queryKey: matchKey(matchId) })
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </Section>

      {/* Athletes report in to the whole match, never to one of its sub-matches. */}
      {detail.data.canCheckin && match.subOrder === null && (
        <Section title="รายงานตัว" icon={ScanLine}>
          <MatchCheckinPanel matchId={match.id} />
        </Section>
      )}

      {match.subMatches.length > 0 && (
        <Section title="แมตช์ย่อย" icon={Swords}>
          <ul className="flex flex-col gap-2">
            {match.subMatches.map((sub) => (
              <li key={sub.id}>
                <Link
                  to="/staff/matches/$matchId"
                  params={{ matchId: sub.id }}
                  className="flex items-center justify-between gap-2 rounded-2xl border p-3 hover:bg-muted/50"
                >
                  <span className="min-w-0 truncate">
                    คู่ที่ {sub.subOrder} · {sub.participants.map((p) => p.name).join(" พบ ")}
                  </span>
                  <MatchStatusBadge status={sub.status} />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Referees
        match={match}
        canManage={canManage}
        pending={write.isPending}
        onAdd={(input) => write.mutate(() => api.addReferee(match.id, input))}
        onRemove={(refereeId) => write.mutate(() => api.removeReferee(match.id, refereeId))}
      />

      <Section
        title="รูปภาพ"
        icon={ImagePlus}
        action={
          canManage && (
            <Button size="sm" variant="outline" onClick={() => setDialog("image")}>
              <ImagePlus /> เพิ่มรูป
            </Button>
          )
        }
      >
        {match.images.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีรูป</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {match.images.map((image) => (
              <li key={image.id} className="flex flex-col gap-1.5">
                <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted">
                  <img
                    src={image.url}
                    alt={image.caption ?? ""}
                    className="size-full object-cover"
                  />
                  {image.isCover && (
                    <span className="absolute top-1.5 left-1.5 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium">
                      รูปปก
                    </span>
                  )}
                </div>
                {image.caption && (
                  <p className="truncate text-xs text-muted-foreground">{image.caption}</p>
                )}
                {canManage && (
                  <div className="flex gap-1">
                    {!image.isCover && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={write.isPending}
                        onClick={() =>
                          write.mutate(() =>
                            api.updateImage(match.id, image.id, {
                              url: image.url,
                              caption: image.caption,
                              isCover: true,
                              sortOrder: image.sortOrder,
                            }),
                          )
                        }
                      >
                        <Star /> ตั้งเป็นปก
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="ลบรูป"
                      disabled={write.isPending}
                      onClick={() => write.mutate(() => api.removeImage(match.id, image.id))}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing && (
        <MatchForm
          divisions={divisions.data?.items ?? []}
          venues={venues.data?.items ?? []}
          initial={match}
          onClose={() => setDialog(null)}
          onSaved={(next) => {
            apply(next);
            setDialog(null);
          }}
        />
      )}
      {dialog === "delete" && (
        <ConfirmDelete
          name={matchHeading(match)}
          description="ลบได้เมื่อแมตช์ยังไม่เริ่ม ผู้แข่ง กรรมการ และรูปของแมตช์นี้จะถูกลบด้วย"
          pending={remove.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => remove.mutate(match.version)}
        />
      )}
      {dialog === "image" && (
        <ImageDialog
          first={match.images.length === 0}
          pending={write.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(input) =>
            write.mutate(
              () => api.addImage(match.id, { ...input, sortOrder: match.images.length }),
              {
                onSuccess: () => setDialog(null),
              },
            )
          }
        />
      )}
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Users;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Staff set scheduled, check-in, postponed or cancelled; scoring sets live and finished. */
export function StatusControl({
  status,
  pending,
  onSave,
}: {
  status: MatchDetail["status"];
  pending: boolean;
  onSave: (status: ManualStatus) => void;
}) {
  const current = (MANUAL_MATCH_STATUSES as readonly string[]).includes(status)
    ? (status as ManualStatus)
    : null;
  const [next, setNext] = useState<ManualStatus | null>(current);
  return (
    <div className="flex flex-col gap-2 rounded-2xl border p-3 sm:flex-row sm:items-center">
      <span className="text-sm font-medium sm:w-24">สถานะ</span>
      <MatchSelect<ManualStatus>
        label="เปลี่ยนสถานะเป็น"
        className="sm:max-w-56"
        items={[
          ...(current === null ? [{ value: null, label: MATCH_STATUS_LABELS[status] }] : []),
          ...MANUAL_MATCH_STATUSES.map((value) => ({ value, label: MATCH_STATUS_LABELS[value] })),
        ]}
        value={next}
        onChange={setNext}
      />
      <LoadingButton
        icon={Check}
        loading={pending}
        disabled={next === null || next === current}
        onClick={() => next && onSave(next)}
      >
        เปลี่ยนสถานะ
      </LoadingButton>
    </div>
  );
}

function AssignTeam({
  divisionId,
  takenTeamIds,
  pending,
  onAssign,
}: {
  divisionId: string;
  takenTeamIds: string[];
  pending: boolean;
  onAssign: (teamId: string) => void;
}) {
  const { competitionMatches: api } = useApis();
  const setup = useQuery({
    queryKey: ["competition-matches", "setup", divisionId],
    queryFn: () => api.setup(divisionId),
  });
  const [teamId, setTeamId] = useState<string | null>(null);
  const teams = (setup.data?.teams ?? []).filter((team) => !takenTeamIds.includes(team.id));
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <MatchSelect
        label="ทีมที่เข้ามาแทน"
        items={[
          { value: null, label: "เลือกทีมที่ได้สิทธิ์" },
          ...teams.map((team) => ({ value: team.id, label: team.name })),
        ]}
        value={teamId}
        onChange={setTeamId}
      />
      <LoadingButton
        variant="outline"
        icon={Check}
        loading={pending}
        disabled={teamId === null}
        onClick={() => teamId && onAssign(teamId)}
      >
        ใส่ทีม
      </LoadingButton>
    </div>
  );
}

function Referees({
  match,
  canManage,
  pending,
  onAdd,
  onRemove,
}: {
  match: MatchDetail;
  canManage: boolean;
  pending: boolean;
  onAdd: (input: { name: string; role: string; sortOrder: number }) => void;
  onRemove: (refereeId: string) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("ผู้ตัดสิน");
  const [issue, setIssue] = useState<string | null>(null);
  return (
    <Section title="กรรมการ" icon={UserPlus}>
      {match.referees.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีกรรมการ</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {match.referees.map((referee) => (
            <li key={referee.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 truncate">
                {referee.name}
                <span className="ml-2 text-sm text-muted-foreground">{referee.role}</span>
              </span>
              {canManage && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`ลบ ${referee.name}`}
                  disabled={pending}
                  onClick={() => onRemove(referee.id)}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = refereeInput.safeParse({
              name,
              role,
              sortOrder: match.referees.length,
            });
            if (!parsed.success) {
              setIssue(parsed.error.issues[0]?.message ?? "กรอกข้อมูล");
              return;
            }
            setIssue(null);
            onAdd(parsed.data);
            setName("");
          }}
        >
          <Input
            aria-label="ชื่อกรรมการ"
            placeholder="ชื่อกรรมการ"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={!!issue}
          />
          <Input
            aria-label="หน้าที่"
            placeholder="หน้าที่ เช่น ผู้ตัดสิน"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="sm:max-w-48"
          />
          <LoadingButton type="submit" variant="outline" icon={UserPlus} loading={pending}>
            เพิ่มกรรมการ
          </LoadingButton>
        </form>
      )}
      {issue && <p className="text-sm text-destructive">{issue}</p>}
    </Section>
  );
}

function ImageDialog({
  first,
  pending,
  onClose,
  onSubmit,
}: {
  first: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: { url: string; caption: string | null; isCover: boolean }) => void;
}) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [isCover, setIsCover] = useState(first);
  const [issues, setIssues] = useState<Record<string, string>>({});
  return (
    <FormDialog
      title="เพิ่มรูป"
      icon={ImagePlus}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = matchImageInput.safeParse({
          url,
          caption: caption.trim() === "" ? null : caption,
          isCover,
          sortOrder: 0,
        });
        if (!parsed.success) {
          setIssues(issuesOf(parsed.error));
          return;
        }
        onSubmit(parsed.data);
      }}
    >
      <ImageUrlField
        id="match-image"
        label="รูป"
        value={url}
        onChange={setUrl}
        error={issues.url}
        selectTitle="เลือกรูปแมตช์"
      />
      <TextField
        id="match-image-caption"
        label="คำบรรยาย"
        value={caption}
        onChange={setCaption}
        error={issues.caption}
      />
      <Field orientation="horizontal">
        <Checkbox id="match-image-cover" checked={isCover} onCheckedChange={setIsCover} />
        <FormLabel htmlFor="match-image-cover" icon={Star} className="font-normal">
          ใช้เป็นรูปปกของแมตช์
        </FormLabel>
      </Field>
    </FormDialog>
  );
}
