import {
  CHECKIN_MODES,
  type CheckinMode,
  type DivisionCompetitionInput,
  type ScoringConfig,
  type StandingsConfig,
  TIEBREAK_LABELS,
  TIEBREAKS,
  type Tiebreak,
  divisionCompetitionInput,
} from "@it3k/db/competition-rules";
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
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useBlocker } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ClipboardList,
  Medal,
  Plus,
  QrCode,
  Settings2,
  Trophy,
  Undo2,
  Users2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { ScoringConfigFields } from "@/components/competition/scoring-config-fields";
import { ErrorState } from "@/components/error-state";
import { issuesOf } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import type { CompetitionDivision } from "@/lib/competition-divisions";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/staff/competition_/$divisionId")({
  head: () => ({ meta: [{ title: "ตั้งค่าการแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const { divisionId } = Route.useParams();
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });
  return (
    <>
      <CompetitionSettingsPage divisionId={divisionId} onDirtyChange={setDirty} />
      <AlertDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => !open && blocker.reset?.()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ทิ้งการตั้งค่าที่ยังไม่ได้บันทึก?</AlertDialogTitle>
            <AlertDialogDescription>สิ่งที่แก้ไว้จะหายไป</AlertDialogDescription>
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

const CHECKIN_MODE_LABELS: Record<CheckinMode, string> = {
  kiosk: "สแกนที่สนาม",
  manual: "เจ้าหน้าที่ติ๊ก",
};

const DEFAULT_STANDINGS: StandingsConfig = {
  win: 3,
  draw: 1,
  loss: 0,
  forfeit: 0,
  tiebreaks: ["headToHead", "scoreDiff", "scoreFor"],
};

/** The form keeps numbers as typed; blank means "not set" where the setting allows it. */
type Form = {
  maxTeamsPerInstitution: string;
  teamMinSize: string;
  teamMaxSize: string;
  genderMale: string;
  genderFemale: string;
  maxOfficials: string;
  lineupStarters: string;
  lineupMaxSubs: string;
  scoringCustom: boolean;
  scoringConfig: ScoringConfig;
  standings: StandingsConfig | null;
  checkinMode: CheckinMode;
  checkinOpensMin: string;
  checkinClosesMin: string;
  checkinMinPlayers: string;
  awardsMedals: boolean;
  version: number;
};

const text = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);
const optionalNumber = (value: string) => (value.trim() === "" ? null : Number(value));
const requiredNumber = (value: string) => (value.trim() === "" ? Number.NaN : Number(value));

function toForm(division: CompetitionDivision): Form {
  return {
    maxTeamsPerInstitution: text(division.maxTeamsPerInstitution),
    teamMinSize: text(division.teamMinSize),
    teamMaxSize: text(division.teamMaxSize),
    genderMale: text(division.genderMinimums?.male),
    genderFemale: text(division.genderMinimums?.female),
    maxOfficials: text(division.maxOfficials),
    lineupStarters: text(division.lineupStarters),
    lineupMaxSubs: text(division.lineupMaxSubs),
    scoringCustom: !division.scoringIsDefault,
    scoringConfig: division.scoringConfig,
    standings: division.standingsConfig,
    checkinMode: division.checkinMode,
    checkinOpensMin: text(division.checkinOpensMin),
    checkinClosesMin: text(division.checkinClosesMin),
    checkinMinPlayers: text(division.checkinMinPlayers),
    awardsMedals: division.awardsMedals,
    version: division.version,
  };
}

function toInput(form: Form): unknown {
  const male = optionalNumber(form.genderMale);
  const female = optionalNumber(form.genderFemale);
  const genders = {
    ...(male !== null && male > 0 ? { male } : {}),
    ...(female !== null && female > 0 ? { female } : {}),
  };
  return {
    maxTeamsPerInstitution: requiredNumber(form.maxTeamsPerInstitution),
    teamMinSize: optionalNumber(form.teamMinSize),
    teamMaxSize: optionalNumber(form.teamMaxSize),
    genderMinimums: Object.keys(genders).length > 0 ? genders : null,
    maxOfficials: requiredNumber(form.maxOfficials),
    lineupStarters: optionalNumber(form.lineupStarters),
    lineupMaxSubs: optionalNumber(form.lineupMaxSubs),
    scoringConfig: form.scoringCustom ? form.scoringConfig : null,
    standingsConfig: form.standings,
    checkinMode: form.checkinMode,
    checkinOpensMin: requiredNumber(form.checkinOpensMin),
    checkinClosesMin: requiredNumber(form.checkinClosesMin),
    checkinMinPlayers: optionalNumber(form.checkinMinPlayers),
    awardsMedals: form.awardsMedals,
    version: form.version,
  };
}

/** How a division competes: team sizes, lineups, scoring, standings and check-in. */
export function CompetitionSettingsPage({
  divisionId,
  onDirtyChange,
}: {
  divisionId: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { competitionDivisions: api } = useApis();
  const division = useQuery({
    queryKey: ["competition-divisions", divisionId],
    queryFn: () => api.get(divisionId),
  });

  return (
    <div className="flex flex-1 flex-col gap-4 sm:gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start"
        render={<Link to="/staff/teams" />}
        nativeButton={false}
      >
        <ArrowLeft data-icon="inline-start" aria-hidden /> ทีมแข่ง
      </Button>
      {division.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : division.isError ? (
        <ErrorState error={division.error} onRetry={division.refetch} title="โหลดการตั้งค่าไม่สำเร็จ" />
      ) : (
        <SettingsForm
          key={division.data.division.version}
          division={division.data.division}
          canManage={division.data.canManage}
          onDirtyChange={onDirtyChange}
        />
      )}
    </div>
  );
}

function SettingsForm({
  division,
  canManage,
  onDirtyChange,
}: {
  division: CompetitionDivision;
  canManage: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { competitionDivisions: api } = useApis();
  const queryClient = useQueryClient();
  const initial = toForm(division);
  const [form, setForm] = useState(initial);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [discarding, setDiscarding] = useState(false);
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((before) => ({ ...before, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = divisionCompetitionInput.safeParse(toInput(form));
      if (!parsed.success) {
        setIssues(issuesOf(parsed.error));
        throw new Error("ตรวจสอบค่าที่กรอก");
      }
      setIssues({});
      return api.save(division.id, parsed.data satisfies DivisionCompetitionInput);
    },
    onSuccess: () => {
      toast.success("บันทึกการตั้งค่าแล้ว");
      onDirtyChange?.(false);
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["competition-divisions"] }),
  });
  const disabled = !canManage || save.isPending;

  return (
    <form
      noValidate
      className={dirty ? "flex flex-col gap-6 pb-24 sm:pb-0" : "flex flex-col gap-6"}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={Settings2}
          title={`ตั้งค่า ${division.name}`}
          description="จำนวนคน รายชื่อลงแข่ง การนับคะแนน และการรายงานตัวของประเภทนี้"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          render={<Link to="/staff/teams/$divisionId" params={{ divisionId: division.id }} />}
          nativeButton={false}
        >
          <Users2 data-icon="inline-start" aria-hidden /> จัดทีม
        </Button>
      </div>
      {!canManage && (
        <p className="text-sm text-muted-foreground">ดูได้อย่างเดียว ผู้จัดการแข่งขันเท่านั้นที่แก้ไขได้</p>
      )}

      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-6">
        <Section title="ทีม" icon={Users2}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <NumberField
              id="max-teams"
              label="ทีมต่อมหาลัย"
              value={form.maxTeamsPerInstitution}
              onChange={(value) => set("maxTeamsPerInstitution", value)}
              error={issues.maxTeamsPerInstitution}
            />
            <NumberField
              id="team-min"
              label="นักกีฬาขั้นต่ำ"
              value={form.teamMinSize}
              onChange={(value) => set("teamMinSize", value)}
              error={issues.teamMinSize}
              optional
            />
            <NumberField
              id="team-max"
              label="นักกีฬาสูงสุด"
              value={form.teamMaxSize}
              onChange={(value) => set("teamMaxSize", value)}
              error={issues.teamMaxSize}
              optional
            />
            <NumberField
              id="gender-male"
              label="ชายอย่างน้อย"
              value={form.genderMale}
              onChange={(value) => set("genderMale", value)}
              error={issues.genderMinimums}
              optional
            />
            <NumberField
              id="gender-female"
              label="หญิงอย่างน้อย"
              value={form.genderFemale}
              onChange={(value) => set("genderFemale", value)}
              optional
            />
            <NumberField
              id="max-officials"
              label="เจ้าหน้าที่ทีมสูงสุด"
              value={form.maxOfficials}
              onChange={(value) => set("maxOfficials", value)}
              error={issues.maxOfficials}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            เว้นจำนวนนักกีฬาว่างไว้เพื่อใช้ตามรูปแบบ (เดี่ยว 1 คน คู่ 2 คน)
          </p>
        </Section>

        <Section title="รายชื่อลงแข่ง" icon={ClipboardList}>
          <div className="grid grid-cols-2 gap-4">
            <NumberField
              id="lineup-starters"
              label="ตัวจริง"
              value={form.lineupStarters}
              onChange={(value) => set("lineupStarters", value)}
              error={issues.lineupStarters}
              optional
            />
            <NumberField
              id="lineup-subs"
              label="ตัวสำรองสูงสุด"
              value={form.lineupMaxSubs}
              onChange={(value) => set("lineupMaxSubs", value)}
              error={issues.lineupMaxSubs}
              optional
            />
          </div>
          <p className="text-sm text-muted-foreground">
            เว้นตัวจริงว่างไว้ถ้าแมตช์ไม่ต้องส่งรายชื่อ ทุกคนในทีมลงได้
          </p>
        </Section>

        <Section title="การนับคะแนน" icon={Trophy}>
          <CheckboxField
            id="scoring-custom"
            label="กำหนดการนับคะแนนเอง"
            hint="ไม่เลือก: ใช้ค่าตั้งต้นของประเภทนี้"
            checked={form.scoringCustom}
            onChange={(checked) => set("scoringCustom", checked)}
          />
          <ScoringConfigFields
            value={form.scoringConfig}
            onChange={(value) => set("scoringConfig", value)}
            disabled={disabled || !form.scoringCustom}
          />
          {issues.scoringConfig && (
            <p className="text-sm text-destructive">{issues.scoringConfig}</p>
          )}
        </Section>

        <Section title="ตารางคะแนน" icon={Medal}>
          <CheckboxField
            id="standings-on"
            label="มีตารางคะแนนรอบแบ่งกลุ่ม"
            checked={form.standings !== null}
            onChange={(checked) =>
              set("standings", checked ? (division.standingsConfig ?? DEFAULT_STANDINGS) : null)
            }
          />
          {form.standings && (
            <StandingsFields
              value={form.standings}
              onChange={(value) => set("standings", value)}
              error={issues.standingsConfig}
            />
          )}
          <CheckboxField
            id="awards-medals"
            label="มอบเหรียญและคะแนนรวม"
            hint="ประเภทที่มีไม่ถึง 3 ทีมเป็นการแข่งขันกระชับมิตร"
            checked={form.awardsMedals}
            onChange={(checked) => set("awardsMedals", checked)}
          />
        </Section>

        <Section title="รายงานตัว" icon={QrCode}>
          <SegmentedControl
            label="วิธีรายงานตัว"
            segments={CHECKIN_MODES.map((mode) => ({
              value: mode,
              label: CHECKIN_MODE_LABELS[mode],
            }))}
            value={form.checkinMode}
            onChange={(value) => set("checkinMode", value)}
            className="self-start"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <NumberField
              id="checkin-opens"
              label="เปิดก่อนแข่ง (นาที)"
              value={form.checkinOpensMin}
              onChange={(value) => set("checkinOpensMin", value)}
              error={issues.checkinOpensMin}
            />
            <NumberField
              id="checkin-closes"
              label="ปิดก่อนแข่ง (นาที)"
              value={form.checkinClosesMin}
              onChange={(value) => set("checkinClosesMin", value)}
              error={issues.checkinClosesMin}
            />
            <NumberField
              id="checkin-min"
              label="ต้องมาอย่างน้อย (คน)"
              value={form.checkinMinPlayers}
              onChange={(value) => set("checkinMinPlayers", value)}
              error={issues.checkinMinPlayers}
              optional
            />
          </div>
        </Section>
      </fieldset>

      {dirty && canManage && (
        <section
          aria-label="บันทึกการแก้ไข"
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur sm:sticky sm:inset-x-auto sm:bottom-4 sm:rounded-2xl sm:border sm:p-3"
        >
          <div className="flex items-center gap-2">
            <p className="hidden flex-1 text-sm text-muted-foreground sm:block">
              มีการแก้ไขที่ยังไม่ได้บันทึก
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-11 sm:h-9"
              onClick={() => setDiscarding(true)}
            >
              <Undo2 data-icon="inline-start" aria-hidden /> ยกเลิก
            </Button>
            <LoadingButton
              type="submit"
              className="h-11 flex-1 sm:h-9 sm:flex-none"
              loading={save.isPending}
            >
              บันทึก
            </LoadingButton>
          </div>
        </section>
      )}

      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยกเลิกการแก้ไข?</AlertDialogTitle>
            <AlertDialogDescription>สิ่งที่แก้ไว้ตั้งแต่บันทึกครั้งล่าสุดจะหายไป</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>แก้ไขต่อ</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setForm(initial);
                setIssues({});
                setDiscarding(false);
              }}
            >
              ยกเลิกการแก้ไข
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Users2;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4 rounded-3xl border p-4 sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon className="size-4 text-primary" aria-hidden />
        {title}
      </h2>
      {children}
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  error,
  optional = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  optional?: boolean;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        placeholder={optional ? "ไม่กำหนด" : undefined}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError>{error}</FieldError>
    </Field>
  );
}

function CheckboxField({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <div className="flex flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {hint && <FieldDescription>{hint}</FieldDescription>}
      </div>
    </Field>
  );
}

/** Points for each result and the tiebreaks, tried in order. */
function StandingsFields({
  value,
  onChange,
  error,
}: {
  value: StandingsConfig;
  onChange: (value: StandingsConfig) => void;
  error?: string;
}) {
  const points = (key: "win" | "draw" | "loss" | "forfeit", typed: string) =>
    onChange({ ...value, [key]: typed.trim() === "" ? Number.NaN : Number(typed) });
  const move = (index: number, by: number) => {
    const next = [...value.tiebreaks];
    const [item] = next.splice(index, 1);
    if (item) next.splice(index + by, 0, item);
    onChange({ ...value, tiebreaks: next });
  };
  const unused = TIEBREAKS.filter((tiebreak) => !value.tiebreaks.includes(tiebreak));
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NumberField
          id="points-win"
          label="ชนะ"
          value={text(value.win)}
          onChange={(v) => points("win", v)}
        />
        <NumberField
          id="points-draw"
          label="เสมอ"
          value={text(value.draw)}
          onChange={(v) => points("draw", v)}
        />
        <NumberField
          id="points-loss"
          label="แพ้"
          value={text(value.loss)}
          onChange={(v) => points("loss", v)}
        />
        <NumberField
          id="points-forfeit"
          label="ปรับแพ้"
          value={text(value.forfeit)}
          onChange={(v) => points("forfeit", v)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">เมื่อคะแนนเท่ากัน ตัดสินด้วย (ตามลำดับ)</p>
        {value.tiebreaks.length > 0 && (
          <ol className="flex flex-col divide-y rounded-2xl border">
            {value.tiebreaks.map((tiebreak: Tiebreak, index) => (
              <li key={tiebreak} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-5 tabular-nums text-muted-foreground">{index + 1}.</span>
                <span className="flex-1">{TIEBREAK_LABELS[tiebreak]}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`เลื่อน ${TIEBREAK_LABELS[tiebreak]} ขึ้น`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`เลื่อน ${TIEBREAK_LABELS[tiebreak]} ลง`}
                  disabled={index === value.tiebreaks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`เอา ${TIEBREAK_LABELS[tiebreak]} ออก`}
                  onClick={() =>
                    onChange({ ...value, tiebreaks: value.tiebreaks.filter((t) => t !== tiebreak) })
                  }
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {unused.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unused.map((tiebreak) => (
              <Button
                key={tiebreak}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...value, tiebreaks: [...value.tiebreaks, tiebreak] })}
              >
                <Plus data-icon="inline-start" aria-hidden /> {TIEBREAK_LABELS[tiebreak]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
