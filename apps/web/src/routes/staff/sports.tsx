import {
  DIVISION_FORMATS,
  DIVISION_GENDERS,
  type DivisionInput,
  FORMAT_LABELS,
  GENDER_LABELS,
  SPORT_ICONS,
  type SportIcon,
  type SportInput,
  divisionInput,
  sportInput,
} from "@it3k/db/sport-rules";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Lock, Medal, Pencil, Plus, Trash2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { SportArt, SportThumbnail } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import type { Division, Sport } from "@/lib/sports";

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
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดกีฬาไม่สำเร็จ: {sports.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void sports.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
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
      <SportThumbnail src={sport.thumbnailUrl} icon={sport.icon} seed={sport.id} label={sport.name} />
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

export function DivisionBadges({ division }: { division: Division }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="secondary">{GENDER_LABELS[division.gender]}</Badge>
      <Badge variant="secondary">{FORMAT_LABELS[division.format]}</Badge>
      {division.requiresShirtNumber && <Badge variant="outline">เบอร์เสื้อ</Badge>}
      {division.requiresBadmintonRank && <Badge variant="outline">มือ 1/2</Badge>}
      {division.requiresGameProfile && <Badge variant="outline">IGN · Discord</Badge>}
      {division.maxPerInstitution !== null && (
        <Badge variant="outline">สูงสุด {division.maxPerInstitution} คน/สถาบัน</Badge>
      )}
    </span>
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
    onError: (error) => toast.error(error.message),
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
          onSubmit={(input) =>
            run(() => (sport ? api.update(sport.id, input) : api.create(input)))
          }
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
              division ? api.updateDivision(division.id, input) : api.createDivision(sport.id, input),
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

function ConfirmDelete({
  name,
  description,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  description: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ลบ {name}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            ลบ
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The first message per field, keyed by the field's name. */
function issuesOf(error: z.ZodError) {
  const issues: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    issues[key] ??= issue.message;
  }
  return issues;
}

function FormDialog({
  title,
  description,
  pending,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  description?: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={pending}>
              บันทึก
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "id">) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {(error ?? hint) && <FieldDescription>{error ?? hint}</FieldDescription>}
    </Field>
  );
}

function ChoiceField<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select items={options} value={value} onValueChange={(next: T | null) => next && onChange(next)}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
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
      <SportArt
        icon={icon}
        seed={initial?.id ?? code}
        label="ภาพตัวอย่าง"
        className="rounded-xl"
      />
      <TextField id="sport-name" label="ชื่อ" value={name} onChange={setName} error={issues.name} />
      <TextField
        id="sport-code"
        label="รหัส"
        value={code}
        onChange={(value) => setCode(value.toLowerCase())}
        error={issues.code}
        hint="ตัวพิมพ์เล็ก a-z, 0-9 และ - เช่น football"
        className="font-mono"
      />
      <Field data-invalid={!!issues.description}>
        <FieldLabel htmlFor="sport-description">คำอธิบาย</FieldLabel>
        <Textarea
          id="sport-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {issues.description && <FieldDescription>{issues.description}</FieldDescription>}
      </Field>
      <ChoiceField
        id="sport-icon"
        label="ภาพประกอบ"
        value={icon}
        options={SPORT_ICONS.map((value) => ({ value, label: ICON_LABELS[value] }))}
        onChange={setIcon}
      />
      <TextField
        id="sport-thumbnail"
        label="ลิงก์รูปหน้าปก"
        value={thumbnailUrl}
        onChange={setThumbnailUrl}
        error={issues.thumbnailUrl}
        hint="เว้นว่างไว้เพื่อใช้ภาพประกอบด้านบน"
        inputMode="url"
      />
      <TextField
        id="sport-order"
        label="ลำดับการแสดง"
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
    ["requiresShirtNumber", "ต้องกรอกเบอร์เสื้อ"],
    ["requiresBadmintonRank", "ต้องเลือกมือ 1 หรือ มือ 2"],
    ["requiresGameProfile", "ต้องกรอก IGN, Facebook และเชื่อม Discord"],
    ["registrationOpen", "เปิดรับสมัคร"],
  ] as const;

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : `เพิ่มประเภทใน ${sport.name}`}
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
        value={values.name}
        onChange={(value) => set("name", value)}
        error={issues.name}
      />
      <TextField
        id="division-code"
        label="รหัส"
        value={values.code}
        onChange={(value) => set("code", value.toLowerCase())}
        error={issues.code}
        className="font-mono"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <ChoiceField
          id="division-gender"
          label="เพศ"
          value={values.gender}
          options={DIVISION_GENDERS.map((value) => ({ value, label: GENDER_LABELS[value] }))}
          onChange={(value) => set("gender", value)}
        />
        <ChoiceField
          id="division-format"
          label="รูปแบบ"
          value={values.format}
          options={DIVISION_FORMATS.map((value) => ({ value, label: FORMAT_LABELS[value] }))}
          onChange={(value) => set("format", value)}
        />
      </div>
      {flags.map(([key, label]) => (
        <Field key={key} orientation="horizontal">
          <Checkbox
            id={`division-${key}`}
            checked={values[key]}
            onCheckedChange={(checked) => set(key, checked)}
          />
          <FieldLabel htmlFor={`division-${key}`}>{label}</FieldLabel>
        </Field>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="division-max"
          label="จำนวนสูงสุดต่อสถาบัน"
          type="number"
          min={1}
          value={maxPerInstitution}
          onChange={setMax}
          error={issues.maxPerInstitution}
          hint="เว้นว่างถ้าไม่จำกัด"
        />
        <TextField
          id="division-order"
          label="ลำดับการแสดง"
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
