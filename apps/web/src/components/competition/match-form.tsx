// The dialog that creates a match by hand or edits one: its division, stage,
// time and place, and its sides, each a team, another match's winner or loser
// (a knockout slot the bracket draws), or a placeholder label until known.
import {
  type MatchInput,
  SIDE_SOURCE_LABELS,
  type SideSource,
  matchInput,
} from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldError } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CornerDownRight,
  Crown,
  Hash,
  PenLine,
  Layers,
  MapPin,
  Plus,
  Shapes,
  Swords,
  TextAlignStart,
  Trash2,
  Trophy,
  Type,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/calendar/date-time-picker";
import {
  FormDialog,
  FormLabel,
  TextAreaField,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import { useApis } from "@/lib/api-context";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import type { MatchDetail } from "@/lib/competition-matches";
import { toastError } from "@/lib/errors";

import { MatchSelect } from "./match-select";

export type MatchFormDivision = { id: string; name: string; sportName: string };
export type MatchFormVenue = { id: string; name: string };

type SideSourceDraft = { matchId: string; result: SideSource };
type SideDraft = { teamId: string | null; label: string; source: SideSourceDraft | null };

const EMPTY_SIDE: SideDraft = { teamId: null, label: "", source: null };
const sourceKey = (source: SideSourceDraft) => `${source.result}:${source.matchId}`;
function parseSourceKey(key: string): SideSourceDraft {
  const [result, matchId] = key.split(":") as [SideSource, string];
  return { result, matchId };
}

const DEFAULT_STAGE = "รอบแบ่งกลุ่ม";
const numberOrNull = (text: string) => (text.trim() === "" ? null : Number(text));

export function MatchForm({
  divisions,
  venues,
  initial,
  divisionId: fixedDivisionId,
  onClose,
  onSaved,
}: {
  divisions: MatchFormDivision[];
  venues: MatchFormVenue[];
  /** The match being edited; null creates one. */
  initial: MatchDetail | null;
  /** Starts a new match in this division. */
  divisionId?: string | null;
  onClose: () => void;
  onSaved: (match: MatchDetail) => void;
}) {
  const { competitionMatches: api } = useApis();
  const queryClient = useQueryClient();
  const [divisionId, setDivisionId] = useState<string | null>(
    initial?.divisionId ?? fixedDivisionId ?? null,
  );
  const [stageName, setStageName] = useState(initial?.stageName ?? DEFAULT_STAGE);
  const [groupId, setGroupId] = useState<string | null>(initial?.groupId ?? null);
  const [roundNo, setRoundNo] = useState(initial?.roundNo?.toString() ?? "");
  const [matchNo, setMatchNo] = useState<string | null>(initial?.matchNo?.toString() ?? null);
  const [startAt, setStartAt] = useState(
    initial?.startAt != null ? toDatetimeLocal(initial.startAt) : "",
  );
  const [venueId, setVenueId] = useState<string | null>(initial?.venueId ?? null);
  const [court, setCourt] = useState(initial?.court ?? "");
  const [friendly, setFriendly] = useState<boolean | null>(initial?.friendly ?? null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [sides, setSides] = useState<SideDraft[]>(
    initial?.participants.map((p) => ({
      teamId: p.teamId,
      label: p.label ?? "",
      source:
        p.sourceMatchId && p.sourceResult
          ? { matchId: p.sourceMatchId, result: p.sourceResult }
          : null,
    })) ?? [EMPTY_SIDE, EMPTY_SIDE],
  );
  const [issues, setIssues] = useState<Record<string, string>>({});

  const setup = useQuery({
    queryKey: ["competition-matches", "setup", divisionId],
    queryFn: () => api.setup(divisionId as string),
    enabled: divisionId !== null,
  });
  const teams = setup.data?.teams ?? [];
  const groups = setup.data?.groups ?? [];
  // A knockout side may wait on any other match of the division.
  const sourceMatches = (setup.data?.matches ?? []).filter((m) => m.id !== initial?.id);
  const matchName = (m: { matchNo: number | null; stageName: string }) =>
    m.matchNo !== null ? `M${m.matchNo}` : m.stageName;
  // New matches take the next number and the division's friendly default until staff change them.
  const shownMatchNo = matchNo ?? (initial ? "" : (setup.data?.nextMatchNo.toString() ?? ""));
  const shownFriendly = friendly ?? setup.data?.friendlyByDefault ?? false;

  const save = useMutation({
    mutationFn: async (input: MatchInput) =>
      initial
        ? (await api.update(initial.id, { ...input, version: initial.version })).match
        : (await api.create(input)).match,
    onSuccess: (match) => {
      toast.success(initial ? "บันทึกแล้ว" : "สร้างแมตช์แล้ว");
      void queryClient.invalidateQueries({ queryKey: ["competition-matches"] });
      onSaved(match);
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
  });

  const setSide = (index: number, patch: Partial<SideDraft>) =>
    setSides((current) => current.map((side, i) => (i === index ? { ...side, ...patch } : side)));

  const submit = () => {
    if (!divisionId) {
      setIssues({ divisionId: "เลือกประเภท" });
      return;
    }
    const start = startAt === "" ? null : fromDatetimeLocal(startAt);
    if (startAt !== "" && start === null) {
      setIssues({ startAt: "เวลาไม่ถูกต้อง" });
      return;
    }
    const parsed = matchInput.safeParse({
      divisionId,
      parentMatchId: initial?.parentMatchId ?? null,
      groupId,
      stageName,
      roundNo: numberOrNull(roundNo),
      matchNo: numberOrNull(shownMatchNo),
      startAt: start,
      venueId,
      court: court.trim() === "" ? null : court,
      friendly: shownFriendly,
      scoringConfig: initial?.scoringConfig ?? null,
      notes: notes.trim() === "" ? null : notes,
      participants: sides.map((side) => ({
        teamId: side.teamId,
        // A sourced side is named after its source by the server.
        label: side.teamId || side.source ? null : side.label,
        source: side.source,
      })),
    });
    if (!parsed.success) {
      setIssues(issuesOf(parsed.error));
      return;
    }
    setIssues({});
    save.mutate(parsed.data);
  };

  const teamItems = [
    { value: null, label: "ยังไม่รู้ทีม" },
    ...teams.map((team) => ({ value: team.id, label: team.name })),
  ];
  const sourceItems = [
    {
      value: null,
      label: "ใส่ชื่อชั่วคราวเอง",
      icon: <PenLine aria-hidden className="text-muted-foreground" />,
    },
    ...sourceMatches.flatMap((m) =>
      (["winner", "loser"] as const).map((result) => ({
        value: sourceKey({ matchId: m.id, result }),
        label: `${SIDE_SOURCE_LABELS[result]} ${matchName(m)} · ${m.stageName}`,
        icon:
          result === "winner" ? (
            <Crown aria-hidden className="text-amber-500" />
          ) : (
            <CornerDownRight aria-hidden className="text-muted-foreground" />
          ),
      })),
    ),
  ];
  const sourceText = (source: SideSourceDraft) => {
    const m = setup.data?.matches.find((item) => item.id === source.matchId);
    return `${SIDE_SOURCE_LABELS[source.result]} ${m ? matchName(m) : "แมตช์ที่เลือก"}`;
  };

  return (
    <FormDialog
      title={initial ? "แก้ไขแมตช์" : "สร้างแมตช์"}
      icon={initial ? Swords : Plus}
      pending={save.isPending}
      onClose={onClose}
      onSubmit={submit}
    >
      <Field data-invalid={!!issues.divisionId}>
        <FormLabel htmlFor="match-division" icon={Shapes}>
          ประเภท
        </FormLabel>
        <MatchSelect
          id="match-division"
          label="ประเภท"
          disabled={initial !== null}
          items={[
            { value: null, label: "เลือกประเภท" },
            ...divisions.map((d) => ({ value: d.id, label: `${d.sportName} · ${d.name}` })),
          ]}
          value={divisionId}
          onChange={(next) => {
            setDivisionId(next);
            setGroupId(null);
            setSides((current) => current.map(() => EMPTY_SIDE));
          }}
        />
        <FieldError>{issues.divisionId}</FieldError>
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Users className="size-4 text-muted-foreground" aria-hidden /> ผู้แข่ง
        </legend>
        {sides.map((side, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-2xl border p-3">
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-sm text-muted-foreground">ฝั่ง {index + 1}</span>
              <MatchSelect
                label={`ทีมฝั่ง ${index + 1}`}
                items={teamItems}
                value={side.teamId}
                disabled={divisionId === null}
                onChange={(teamId) => setSide(index, { teamId })}
              />
              {sides.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`ลบฝั่ง ${index + 1}`}
                  onClick={() => setSides((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {side.teamId === null && (
              <MatchSelect
                label={`ฝั่ง ${index + 1} มาจาก`}
                items={sourceItems}
                value={side.source ? sourceKey(side.source) : null}
                disabled={divisionId === null}
                onChange={(key) =>
                  setSide(index, { source: key ? parseSourceKey(key) : null, label: "" })
                }
              />
            )}
            {side.teamId === null && !side.source && (
              <Input
                aria-label={`ชื่อชั่วคราวฝั่ง ${index + 1}`}
                placeholder="เช่น อันดับ 1 สาย A"
                value={side.label}
                onChange={(event) => setSide(index, { label: event.target.value })}
              />
            )}
            {side.teamId !== null && side.source && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CornerDownRight className="size-3.5" aria-hidden />
                เลื่อนมาจาก{sourceText(side.source)}
              </p>
            )}
          </div>
        ))}
        {issues.participants && <p className="text-sm text-destructive">{issues.participants}</p>}
        {sides.length < 16 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setSides((current) => [...current, EMPTY_SIDE])}
          >
            <Plus /> เพิ่มฝั่ง
          </Button>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="match-stage"
          label="รอบ"
          icon={Layers}
          value={stageName}
          onChange={setStageName}
          error={issues.stageName}
        />
        <Field>
          <FormLabel htmlFor="match-group" icon={Layers}>
            สาย
          </FormLabel>
          <MatchSelect
            id="match-group"
            label="สาย"
            items={[
              { value: null, label: "ไม่มีสาย" },
              ...groups.map((g) => ({ value: g.id, label: `${g.stageName} · สาย ${g.name}` })),
            ]}
            value={groupId}
            onChange={setGroupId}
          />
        </Field>
        <TextField
          id="match-no"
          label="หมายเลขแมตช์"
          icon={Hash}
          inputMode="numeric"
          value={shownMatchNo}
          onChange={setMatchNo}
          error={issues.matchNo}
        />
        <TextField
          id="match-round"
          label="นัดที่"
          icon={Hash}
          inputMode="numeric"
          value={roundNo}
          onChange={setRoundNo}
          error={issues.roundNo}
        />
      </div>

      <Field data-invalid={!!issues.startAt}>
        <FormLabel htmlFor="match-start" icon={CalendarClock}>
          วันเวลาแข่ง
        </FormLabel>
        <DateTimePicker id="match-start" label="แข่ง" value={startAt} onChange={setStartAt} />
        <FieldError>{issues.startAt}</FieldError>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FormLabel htmlFor="match-venue" icon={MapPin}>
            สถานที่
          </FormLabel>
          <MatchSelect
            id="match-venue"
            label="สถานที่"
            items={[
              { value: null, label: "ยังไม่กำหนด" },
              ...venues.map((v) => ({ value: v.id, label: v.name })),
            ]}
            value={venueId}
            onChange={setVenueId}
          />
        </Field>
        <TextField
          id="match-court"
          label="คอร์ต / สนาม"
          icon={Type}
          value={court}
          onChange={setCourt}
          error={issues.court}
        />
      </div>

      <Field orientation="horizontal">
        <Checkbox
          id="match-friendly"
          checked={shownFriendly}
          onCheckedChange={(checked) => setFriendly(checked)}
        />
        <FormLabel htmlFor="match-friendly" icon={Trophy} className="font-normal">
          กระชับมิตร (ไม่นับคะแนนและเหรียญ)
        </FormLabel>
      </Field>

      <TextAreaField
        id="match-notes"
        label="หมายเหตุ"
        icon={TextAlignStart}
        value={notes}
        onChange={setNotes}
        error={issues.notes}
      />
    </FormDialog>
  );
}
