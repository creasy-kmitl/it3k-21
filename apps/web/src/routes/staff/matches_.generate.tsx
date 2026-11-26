import { type RoundRobinInput, roundRobinInput } from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldError } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  CalendarClock,
  CalendarRange,
  Check,
  Eye,
  Hand,
  Layers,
  MapPin,
  Plus,
  Repeat,
  Shapes,
  Shuffle,
  Timer,
  Trash2,
  Wand2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { DateTimePicker } from "@/components/calendar/date-time-picker";
import { MatchCard } from "@/components/competition/match-card";
import { MatchForm } from "@/components/competition/match-form";
import { MatchScheduleTable } from "@/components/competition/match-schedule-table";
import { MatchSelect } from "@/components/competition/match-select";
import { EmptyState } from "@/components/empty-state";
import { FormLabel, TextField } from "@/components/form-dialog";
import { LoadingButton } from "@/components/loading-button";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import {
  DAY_MS,
  HOUR_MS,
  formatBangkok,
  fromDatetimeLocal,
  startOfDay,
  toDatetimeLocal,
} from "@/lib/bangkok-time";
import type { MatchSetup, SchedulePlan } from "@/lib/competition-matches";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/staff/matches_/generate")({
  head: () => ({ meta: [{ title: "จัดตารางแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  return <GeneratePage onDone={() => void navigate({ to: "/staff/matches" })} />;
}

type Mode = "auto" | "manual";
type Court = { venueId: string | null; court: string };

const GROUP_LETTERS = "ABCDEFGHIJKLMNOP";
const MAX_GROUPS = 8;

/** Teams spread over `groupCount` groups as evenly as possible, in a random order. */
export function shuffleIntoGroups(
  teamIds: readonly string[],
  groupCount: number,
  random: () => number = Math.random,
) {
  const order = [...teamIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  return Object.fromEntries(order.map((id, index) => [id, index % groupCount]));
}

/**
 * Two ways to build a schedule: match by match by hand, or a round robin the
 * system works out from groups, a start time, slot length and courts. The
 * automatic way always shows the planned schedule before anything is saved.
 */
export function GeneratePage({
  onDone,
  random = Math.random,
}: {
  onDone: () => void;
  random?: () => number;
}) {
  const apis = useApis();
  const [mode, setMode] = useState<Mode>("auto");
  const [divisionId, setDivisionId] = useState<string | null>(null);
  const divisions = useQuery({
    queryKey: ["competition-divisions"],
    queryFn: () => apis.competitionDivisions.list(),
  });
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => apis.venues.list() });
  const divisionItems = divisions.data?.items ?? [];
  const venueItems = venues.data?.items ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        render={<Link to="/staff/matches" />}
        nativeButton={false}
      >
        <ArrowLeft /> แมตช์ทั้งหมด
      </Button>
      <PageHeader
        icon={CalendarRange}
        title="จัดตารางแข่ง"
        description="เลือกประเภท แบ่งสาย ตั้งเวลาและสนาม ดูตัวอย่างแล้วยืนยัน ระบบสร้างแมตช์ให้ทุกคู่ (หรือเลือก “สร้างเอง” เพื่อเพิ่มทีละนัด)"
      />

      <SegmentedControl<Mode>
        label="วิธีสร้างตาราง"
        className="w-fit"
        segments={[
          { value: "auto", label: "จัดพบกันหมดอัตโนมัติ", icon: Wand2 },
          { value: "manual", label: "สร้างเอง", icon: Hand },
        ]}
        value={mode}
        onChange={setMode}
      />

      <Step number={1} title="เลือกประเภท">
        {divisions.isPending ? (
          <Skeleton className="h-9 w-full" />
        ) : (
          <MatchSelect
            label="ประเภท"
            items={[
              { value: null, label: "เลือกประเภท" },
              ...divisionItems.map((d) => ({ value: d.id, label: `${d.sportName} · ${d.name}` })),
            ]}
            value={divisionId}
            onChange={setDivisionId}
          />
        )}
      </Step>

      {divisionId &&
        (mode === "auto" ? (
          <AutoSchedule
            key={divisionId}
            divisionId={divisionId}
            venues={venueItems}
            random={random}
            onDone={onDone}
          />
        ) : (
          <ManualSchedule
            key={divisionId}
            divisionId={divisionId}
            divisions={divisionItems}
            venues={venueItems}
          />
        ))}
    </div>
  );
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-3xl border p-4">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function ManualSchedule({
  divisionId,
  divisions,
  venues,
}: {
  divisionId: string;
  divisions: { id: string; name: string; sportName: string }[];
  venues: { id: string; name: string }[];
}) {
  const { competitionMatches: api } = useApis();
  const [creating, setCreating] = useState(false);
  const matches = useQuery({
    queryKey: ["competition-matches", "list", { divisionId }],
    queryFn: () => api.list({ divisionId }),
  });
  const items = matches.data?.items ?? [];
  return (
    <Step number={2} title="สร้างแมตช์ทีละนัด">
      <p className="text-sm text-muted-foreground">
        เลือกทีมแต่ละฝั่ง หรือใส่ชื่อชั่วคราว เช่น “ผู้ชนะ M3” แล้วค่อยใส่ทีมจริงภายหลัง
      </p>
      <Button className="w-fit" onClick={() => setCreating(true)}>
        <Plus /> สร้างแมตช์
      </Button>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((match) => (
            <li key={match.id}>
              <MatchCard match={match} />
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <MatchForm
          divisions={divisions}
          venues={venues}
          initial={null}
          divisionId={divisionId}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
    </Step>
  );
}

function AutoSchedule({
  divisionId,
  venues,
  random,
  onDone,
}: {
  divisionId: string;
  venues: { id: string; name: string }[];
  random: () => number;
  onDone: () => void;
}) {
  const { competitionMatches: api } = useApis();
  const setup = useQuery({
    queryKey: ["competition-matches", "setup", divisionId],
    queryFn: () => api.setup(divisionId),
  });
  if (setup.isPending) return <Skeleton className="h-48 w-full rounded-3xl" />;
  if (setup.isError) {
    return <p className="text-destructive">โหลดทีมของประเภทนี้ไม่สำเร็จ</p>;
  }
  if (setup.data.teams.length < 2) {
    return (
      <EmptyState
        icon={Shapes}
        title="ทีมยังไม่พอ"
        description="ประเภทนี้ต้องมีอย่างน้อย 2 ทีมก่อนจัดตารางพบกันหมด"
      />
    );
  }
  return <AutoScheduleForm setup={setup.data} venues={venues} random={random} onDone={onDone} />;
}

function AutoScheduleForm({
  setup,
  venues,
  random,
  onDone,
}: {
  setup: MatchSetup;
  venues: { id: string; name: string }[];
  random: () => number;
  onDone: () => void;
}) {
  const { competitionMatches: api } = useApis();
  const queryClient = useQueryClient();
  const teams = setup.teams;
  const [groupCount, setGroupCount] = useState(1);
  const [assignment, setAssignment] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(teams.map((team) => [team.id, 0])),
  );
  const [stageName, setStageName] = useState("รอบแบ่งกลุ่ม");
  // Tomorrow at 09:00, Bangkok time, until staff pick another.
  const [startAt, setStartAt] = useState(() =>
    toDatetimeLocal(startOfDay(Date.now()) + DAY_MS + 9 * HOUR_MS),
  );
  const [slotMinutes, setSlotMinutes] = useState("60");
  const [courts, setCourts] = useState<Court[]>([{ venueId: null, court: "1" }]);
  const [legs, setLegs] = useState<1 | 2>(1);
  const [issue, setIssue] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; plan: SchedulePlan } | null>(null);

  const groups = Array.from({ length: groupCount }, (_, index) => ({
    name: GROUP_LETTERS[index] ?? String(index + 1),
    teamIds: teams.filter((team) => assignment[team.id] === index).map((team) => team.id),
  }));

  const body = ((): RoundRobinInput | string => {
    const first = fromDatetimeLocal(startAt);
    if (first === null) return "เลือกวันเวลาเริ่มแข่ง";
    const parsed = roundRobinInput.safeParse({
      divisionId: setup.division.id,
      stageName,
      groups,
      firstStartAt: first,
      slotMinutes: Number(slotMinutes),
      courts: courts.map((c) => ({ venueId: c.venueId, court: c.court.trim() || null })),
      legs,
    });
    if (!parsed.success) {
      const problem = parsed.error.issues[0];
      if (problem?.path[0] === "groups") return "ทุกสายต้องมีอย่างน้อย 2 ทีม";
      if (problem?.path[0] === "slotMinutes") return "ระยะห่างต้องอยู่ระหว่าง 5 นาทีถึง 24 ชั่วโมง";
      return problem?.message ?? "ข้อมูลไม่ครบ";
    }
    return parsed.data;
  })();
  const bodyKey = typeof body === "string" ? null : JSON.stringify(body);
  // A preview counts only while nothing has changed since it was made.
  const plan = preview && preview.key === bodyKey ? preview.plan : null;

  const previewMutation = useMutation({
    mutationFn: (input: RoundRobinInput) => api.previewSchedule(input),
    onSuccess: (result, input) => setPreview({ key: JSON.stringify(input), plan: result.plan }),
    onError: (error) => toastError(error, "ดูตัวอย่างไม่สำเร็จ"),
  });
  const commit = useMutation({
    mutationFn: (input: RoundRobinInput) => api.commitSchedule(input),
    onSuccess: (result) => {
      toast.success(`สร้าง ${result.matchIds.length} แมตช์แล้ว`);
      void queryClient.invalidateQueries({ queryKey: ["competition-matches"] });
      onDone();
    },
    onError: (error) => toastError(error, "สร้างตารางไม่สำเร็จ"),
  });

  const changeGroupCount = (count: number) => {
    setGroupCount(count);
    setAssignment((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, group]) => [
          id,
          group !== null && group >= count ? 0 : group,
        ]),
      ),
    );
  };
  const setCourt = (index: number, patch: Partial<Court>) =>
    setCourts((current) => current.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const groupItems = [
    ...groups.map((group, index) => ({ value: String(index), label: `สาย ${group.name}` })),
    { value: null, label: "ไม่ลงรอบนี้" },
  ];

  return (
    <>
      <Step number={2} title="แบ่งสาย">
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-40">
            <FormLabel htmlFor="rr-group-count" icon={Layers}>
              จำนวนสาย
            </FormLabel>
            <MatchSelect
              id="rr-group-count"
              label="จำนวนสาย"
              items={Array.from({ length: MAX_GROUPS }, (_, i) => ({
                value: String(i + 1),
                label: `${i + 1} สาย`,
              }))}
              value={String(groupCount)}
              onChange={(value) => changeGroupCount(Number(value ?? 1))}
            />
          </Field>
          <Button
            variant="outline"
            onClick={() =>
              setAssignment(
                shuffleIntoGroups(
                  teams.map((team) => team.id),
                  groupCount,
                  random,
                ),
              )
            }
          >
            <Shuffle /> สุ่มสาย
          </Button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-2 rounded-2xl border px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{team.name}</span>
              <MatchSelect
                label={`สายของ ${team.name}`}
                className="w-36"
                items={groupItems}
                value={assignment[team.id] == null ? null : String(assignment[team.id])}
                onChange={(value) =>
                  setAssignment((current) => ({
                    ...current,
                    [team.id]: value === null ? null : Number(value),
                  }))
                }
              />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          {groups.map((group) => (
            <span key={group.name} className="rounded-full bg-muted px-2.5 py-0.5">
              สาย {group.name}: {group.teamIds.length} ทีม
            </span>
          ))}
        </div>
      </Step>

      <Step number={3} title="เวลาและสนาม">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="rr-stage"
            label="ชื่อรอบ"
            icon={Layers}
            value={stageName}
            onChange={setStageName}
          />
          <Field>
            <FormLabel htmlFor="rr-legs" icon={Repeat}>
              จำนวนครั้งที่พบกัน
            </FormLabel>
            <SegmentedControl<1 | 2>
              label="จำนวนครั้งที่พบกัน"
              className="w-fit"
              segments={[
                { value: 1, label: "นัดเดียว" },
                { value: 2, label: "เหย้า-เยือน" },
              ]}
              value={legs}
              onChange={setLegs}
            />
          </Field>
          <Field>
            <FormLabel htmlFor="rr-start" icon={CalendarClock}>
              เริ่มแมตช์แรก
            </FormLabel>
            <DateTimePicker id="rr-start" label="เริ่ม" value={startAt} onChange={setStartAt} />
          </Field>
          <TextField
            id="rr-slot"
            label="แมตช์ละ (นาที)"
            icon={Timer}
            inputMode="numeric"
            value={slotMinutes}
            onChange={setSlotMinutes}
            hint="รวมเวลาพักระหว่างแมตช์"
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
            <MapPin className="size-4 text-muted-foreground" aria-hidden /> สนามที่แข่งพร้อมกัน
          </legend>
          {courts.map((court, index) => (
            <div key={index} className="flex items-center gap-2">
              <MatchSelect
                label={`สถานที่ของสนามที่ ${index + 1}`}
                items={[
                  { value: null, label: "ไม่ระบุสถานที่" },
                  ...venues.map((v) => ({ value: v.id, label: v.name })),
                ]}
                value={court.venueId}
                onChange={(venueId) => setCourt(index, { venueId })}
              />
              <Input
                aria-label={`ชื่อคอร์ตของสนามที่ ${index + 1}`}
                placeholder="คอร์ต"
                className="w-28"
                value={court.court}
                onChange={(event) => setCourt(index, { court: event.target.value })}
              />
              {courts.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`ลบสนามที่ ${index + 1}`}
                  onClick={() => setCourts((current) => current.filter((_, i) => i !== index))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          {courts.length < 16 && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() =>
                setCourts((current) => [
                  ...current,
                  { venueId: current.at(-1)?.venueId ?? null, court: String(current.length + 1) },
                ])
              }
            >
              <Plus /> เพิ่มสนาม
            </Button>
          )}
        </fieldset>
      </Step>

      <Step number={4} title="ดูตัวอย่างตาราง">
        <Field data-invalid={!!issue}>
          <LoadingButton
            variant={plan ? "outline" : "default"}
            className="w-fit"
            icon={Eye}
            loading={previewMutation.isPending}
            onClick={() => {
              if (typeof body === "string") {
                setIssue(body);
                return;
              }
              setIssue(null);
              previewMutation.mutate(body);
            }}
          >
            ดูตัวอย่าง
          </LoadingButton>
          <FieldError>{issue}</FieldError>
        </Field>
        {preview && !plan && (
          <p className="text-sm text-muted-foreground">มีการแก้ไขหลังดูตัวอย่าง กดดูตัวอย่างอีกครั้ง</p>
        )}
        {plan && (
          <>
            <p className="text-sm">
              {plan.matches.length} แมตช์ · {plan.slots} ช่วงเวลา · จบประมาณ{" "}
              {formatBangkok(plan.endsAt, "dateTime")}
              {plan.friendly && " · ทีมไม่ถึง 3 ทีม ทุกแมตช์เป็นกระชับมิตร"}
            </p>
            <MatchScheduleTable matches={plan.matches} />
          </>
        )}
      </Step>

      <Step number={5} title="ยืนยัน">
        <p className="text-sm text-muted-foreground">
          {plan ? "ระบบจะสร้างสายและแมตช์ตามตัวอย่างด้านบน" : "ดูตัวอย่างตารางก่อนยืนยัน"}
        </p>
        <LoadingButton
          className="w-fit"
          icon={Check}
          loading={commit.isPending}
          disabled={!plan || typeof body === "string"}
          onClick={() => typeof body !== "string" && commit.mutate(body)}
        >
          ยืนยันสร้างตาราง
        </LoadingButton>
      </Step>
    </>
  );
}
