import {
  DIVISION_FORMATS,
  DIVISION_GENDERS,
  type DivisionFormat,
  type DivisionGender,
  type DivisionInput,
  FORMAT_LABELS,
  GENDER_LABELS,
  SPORT_ICONS,
  type SportIcon,
  type SportInput,
  divisionInput,
  sportInput,
} from "@it3k/db/sport-rules";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field } from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownUp,
  DoorOpen,
  Gamepad2,
  Hash,
  ImageIcon,
  Layers,
  Lock,
  type LucideIcon,
  Mars,
  Medal,
  Palette,
  Pencil,
  Plus,
  Shirt,
  TextAlignStart,
  Trash2,
  Trophy,
  Type,
  User,
  UserCheck,
  Users,
  UsersRound,
  Venus,
  VenusAndMars,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ChoiceField,
  ConfirmDelete,
  FormDialog,
  FormLabel,
  TextAreaField,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { DivisionBadges } from "@/components/sport-badges";
import { SportArt, SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import type { Division, Sport } from "@/lib/sports";
import { ErrorState } from "@/components/error-state";
import { toastError } from "@/lib/errors";

export const Route = createFileRoute("/staff/sports")({
  component: SportsPage,
});

export const ICON_LABELS: Record<SportIcon, string> = {
  football: "ฟุตบอล",
  athletics: "กรีฑา",
  basketball: "บาสเกตบอล",
  "table-tennis": "เทเบิลเทนนิส",
  chairball: "แชร์บอล",
  badminton: "แบดมินตัน",
  petanque: "เปตอง",
  folk: "กีฬาพื้นบ้าน",
  esports: "Esports",
  general: "ทั่วไป",
};

const GENDER_ICONS: Record<DivisionGender, LucideIcon> = {
  male: Mars,
  female: Venus,
  mixed: VenusAndMars,
  open: Users,
};

const FORMAT_ICONS: Record<DivisionFormat, LucideIcon> = {
  individual: User,
  pair: UsersRound,
  team: Users,
};

/** The illustration as a small swatch, so the list shows what each one looks like. */
function IconChoice({ icon }: { icon: SportIcon }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden className="shrink-0">
        <SportArt icon={icon} seed={icon} label="" className="h-5 w-9 rounded" />
      </span>
      <span className="truncate">{ICON_LABELS[icon]}</span>
    </span>
  );
}

type Editing =
  | { kind: "sport"; sport: Sport | null }
  | { kind: "division"; sport: Sport; division: Division | null }
  | { kind: "delete-sport"; sport: Sport }
  | { kind: "delete-division"; division: Division };

/** Sports and the divisions athletes register for. The API enforces who may edit. */
export function SportsPage() {
  const { sports: api } = useApis();
  const sports = useQuery({ queryKey: ["sports"], queryFn: () => api.list() });
  const [editing, setEditing] = useState<Editing | null>(null);
  const canManage = sports.data?.canManage ?? false;
  const divisionCount = sports.data?.items.reduce((n, s) => n + s.divisions.length, 0) ?? 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          icon={Medal}
          title="กีฬา"
          description={
            sports.data
              ? `${sports.data.items.length} กีฬา · ${divisionCount} ประเภท`
              : "ประเภทกีฬาที่เปิดให้นักกีฬาสมัคร"
          }
        />
        {canManage && (
          <Button onClick={() => setEditing({ kind: "sport", sport: null })}>
            <Plus /> เพิ่มกีฬา
          </Button>
        )}
      </div>

      {sports.isPending ? (
        <div role="status" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : sports.isError ? (
        <ErrorState error={sports.error} onRetry={sports.refetch} title="โหลดกีฬาไม่สำเร็จ" />
      ) : sports.data.items.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีกีฬา</p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sports.data.items.map((sport) => (
            <SportCard key={sport.id} sport={sport} canManage={canManage} onEdit={setEditing} />
          ))}
        </ul>
      )}

      {editing && <EditingDialog editing={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SportCard({
  sport,
  canManage,
  onEdit,
}: {
  sport: Sport;
  canManage: boolean;
  onEdit: (editing: Editing) => void;
}) {
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border bg-card">
      <SportThumbnail
        src={sport.thumbnailUrl}
        icon={sport.icon}
        seed={sport.id}
        label={sport.name}
      />
      <div className="flex items-start gap-2 p-4 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{sport.name}</h2>
          <code className="text-xs text-muted-foreground">{sport.code}</code>
        </div>
        {canManage && (
          <div className="flex shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`แก้ไข ${sport.name}`}
              onClick={() => onEdit({ kind: "sport", sport })}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`ลบ ${sport.name}`}
              onClick={() => onEdit({ kind: "delete-sport", sport })}
            >
              <Trash2 className="text-destructive" />
            </Button>
          </div>
        )}
      </div>
      {sport.description && (
        <p className="px-4 pb-2 text-sm text-muted-foreground">{sport.description}</p>
      )}
      <ul className="flex flex-1 flex-col divide-y border-t">
        {sport.divisions.map((division) => (
          <li key={division.id} className="flex items-center gap-2 px-4 py-2 text-sm">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-center gap-1 truncate font-medium">
                {!division.registrationOpen && (
                  <Lock className="size-3.5 text-muted-foreground" aria-label="ปิดรับสมัคร" />
                )}
                {division.name}
              </span>
              <DivisionBadges division={division} />
            </div>
            {canManage && (
              <div className="flex shrink-0">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`แก้ไข ${division.name}`}
                  onClick={() => onEdit({ kind: "division", sport, division })}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`ลบ ${division.name}`}
                  onClick={() => onEdit({ kind: "delete-division", division })}
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onEdit({ kind: "division", sport, division: null })}
          >
            <Plus /> เพิ่มประเภท
          </Button>
        </div>
      )}
    </li>
  );
}

function EditingDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const { sports: api } = useApis();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      onClose();
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["sports"] }),
  });
  const run = (action: () => Promise<unknown>) => save.mutate(action);

  switch (editing.kind) {
    case "sport": {
      const { sport } = editing;
      return (
        <SportForm
          initial={sport}
          pending={save.isPending}
          onClose={onClose}
          onSubmit={(input) => run(() => (sport ? api.update(sport.id, input) : api.create(input)))}
        />
      );
    }
    case "division": {
      const { sport, division } = editing;
      return (
        <DivisionForm
          sport={sport}
          initial={division}
          pending={save.isPending}
          onClose={onClose}
          onSubmit={(input) =>
            run(() =>
              division
                ? api.updateDivision(division.id, input)
                : api.createDivision(sport.id, input),
            )
          }
        />
      );
    }
    case "delete-sport":
      return (
        <ConfirmDelete
          name={editing.sport.name}
          description="ลบได้เมื่อกีฬานี้ไม่มีประเภทย่อยเหลืออยู่"
          pending={save.isPending}
          onClose={onClose}
          onConfirm={() => run(() => api.remove(editing.sport.id))}
        />
      );
    case "delete-division":
      return (
        <ConfirmDelete
          name={editing.division.name}
          description="ลบได้เมื่อยังไม่มีผู้สมัครหรือกิจกรรมในประเภทนี้"
          pending={save.isPending}
          onClose={onClose}
          onConfirm={() => run(() => api.removeDivision(editing.division.id))}
        />
      );
  }
}

function SportForm({
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  initial: Sport | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: SportInput) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<SportIcon>(initial?.icon ?? "general");
  const [thumbnailUrl, setThumbnailUrl] = useState(initial?.thumbnailUrl ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [issues, setIssues] = useState<Record<string, string>>({});

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : "เพิ่มกีฬา"}
      icon={initial ? Medal : Plus}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = sportInput.safeParse({
          code,
          name,
          description,
          icon,
          thumbnailUrl,
          sortOrder: Number(sortOrder),
        });
        if (!parsed.success) return setIssues(issuesOf(parsed.error));
        setIssues({});
        onSubmit(parsed.data);
      }}
    >
      <SportArt icon={icon} seed={initial?.id ?? code} label="ภาพตัวอย่าง" className="rounded-xl" />
      <TextField
        id="sport-name"
        label="ชื่อ"
        icon={Type}
        value={name}
        onChange={setName}
        error={issues.name}
      />
      <TextField
        id="sport-code"
        label="รหัส"
        icon={Hash}
        value={code}
        onChange={(value) => setCode(value.toLowerCase())}
        error={issues.code}
        hint="ตัวพิมพ์เล็ก a-z, 0-9 และ - เช่น football"
        className="font-mono"
      />
      <TextAreaField
        id="sport-description"
        label="คำอธิบาย"
        icon={TextAlignStart}
        value={description}
        onChange={setDescription}
        error={issues.description}
      />
      <ChoiceField
        id="sport-icon"
        label="ภาพประกอบ"
        icon={Palette}
        value={icon}
        options={SPORT_ICONS.map((value) => ({
          value,
          label: ICON_LABELS[value],
          content: <IconChoice icon={value} />,
        }))}
        onChange={setIcon}
      />
      <TextField
        id="sport-thumbnail"
        label="ลิงก์รูปหน้าปก"
        icon={ImageIcon}
        value={thumbnailUrl}
        onChange={setThumbnailUrl}
        error={issues.thumbnailUrl}
        hint="เว้นว่างไว้เพื่อใช้ภาพประกอบด้านบน"
        inputMode="url"
      />
      <TextField
        id="sport-order"
        label="ลำดับการแสดง"
        icon={ArrowDownUp}
        type="number"
        min={0}
        value={sortOrder}
        onChange={setSortOrder}
        error={issues.sortOrder}
      />
    </FormDialog>
  );
}

function DivisionForm({
  sport,
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  sport: Sport;
  initial: Division | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: DivisionInput) => void;
}) {
  const [values, setValues] = useState({
    code: initial?.code ?? `${sport.code}-`,
    name: initial?.name ?? "",
    gender: initial?.gender ?? "open",
    format: initial?.format ?? "individual",
    requiresShirtNumber: initial?.requiresShirtNumber ?? false,
    requiresBadmintonRank: initial?.requiresBadmintonRank ?? false,
    requiresGameProfile: initial?.requiresGameProfile ?? false,
    registrationOpen: initial?.registrationOpen ?? true,
  });
  const [maxPerInstitution, setMax] = useState(
    initial?.maxPerInstitution == null ? "" : String(initial.maxPerInstitution),
  );
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  const flags = [
    ["requiresShirtNumber", "ต้องกรอกเบอร์เสื้อ", Shirt],
    ["requiresBadmintonRank", "ต้องเลือกมือ 1 หรือ มือ 2", Trophy],
    ["requiresGameProfile", "ต้องกรอก IGN, Facebook และเชื่อม Discord", Gamepad2],
    ["registrationOpen", "เปิดรับสมัคร", DoorOpen],
  ] as const;

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : `เพิ่มประเภทใน ${sport.name}`}
      icon={initial ? Layers : Plus}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = divisionInput.safeParse({
          ...values,
          maxPerInstitution: maxPerInstitution.trim() === "" ? null : Number(maxPerInstitution),
          sortOrder: Number(sortOrder),
        });
        if (!parsed.success) return setIssues(issuesOf(parsed.error));
        setIssues({});
        onSubmit(parsed.data);
      }}
    >
      <TextField
        id="division-name"
        label="ชื่อ"
        icon={Type}
        value={values.name}
        onChange={(value) => set("name", value)}
        error={issues.name}
      />
      <TextField
        id="division-code"
        label="รหัส"
        icon={Hash}
        value={values.code}
        onChange={(value) => set("code", value.toLowerCase())}
        error={issues.code}
        className="font-mono"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceField
          id="division-gender"
          label="เพศ"
          icon={VenusAndMars}
          value={values.gender}
          options={DIVISION_GENDERS.map((value) => ({
            value,
            label: GENDER_LABELS[value],
            icon: GENDER_ICONS[value],
          }))}
          onChange={(value) => set("gender", value)}
        />
        <ChoiceField
          id="division-format"
          label="รูปแบบ"
          icon={Users}
          value={values.format}
          options={DIVISION_FORMATS.map((value) => ({
            value,
            label: FORMAT_LABELS[value],
            icon: FORMAT_ICONS[value],
          }))}
          onChange={(value) => set("format", value)}
        />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border p-3">
        {flags.map(([key, label, icon]) => (
          <Field key={key} orientation="horizontal">
            <Checkbox
              id={`division-${key}`}
              checked={values[key]}
              onCheckedChange={(checked) => set(key, checked)}
            />
            <FormLabel htmlFor={`division-${key}`} icon={icon} className="font-normal">
              {label}
            </FormLabel>
          </Field>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="division-max"
          label="จำนวนสูงสุดต่อสถาบัน"
          icon={UserCheck}
          type="number"
          min={1}
          value={maxPerInstitution}
          onChange={setMax}
          error={issues.maxPerInstitution}
          hint="นับเฉพาะคนที่อนุมัติแล้ว เว้นว่างถ้าไม่จำกัด"
        />
        <TextField
          id="division-order"
          label="ลำดับการแสดง"
          icon={ArrowDownUp}
          type="number"
          min={0}
          value={sortOrder}
          onChange={setSortOrder}
          error={issues.sortOrder}
        />
      </div>
    </FormDialog>
  );
}
