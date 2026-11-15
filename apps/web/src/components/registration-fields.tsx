import { type RegistrationFields, missingFields, registrationFields } from "@it3k/db/sport-rules";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import type { ComponentProps } from "react";

export type Requirements = {
  requiresShirtNumber: boolean;
  requiresBadmintonRank: boolean;
  requiresGameProfile: boolean;
};

/** The editable form of RegistrationFields: numbers as text while typing. */
export type FieldsDraft = {
  shirtNumber: string;
  badmintonRank: "" | "1" | "2";
  ign: string;
  ignReading: string;
  facebookUrl: string;
};

type StoredFields = {
  shirtNumber?: number | null;
  badmintonRank?: number | null;
  ign?: string | null;
  ignReading?: string | null;
  facebookUrl?: string | null;
};

export function toDraft(fields: StoredFields = {}): FieldsDraft {
  return {
    shirtNumber: fields.shirtNumber == null ? "" : String(fields.shirtNumber),
    badmintonRank: fields.badmintonRank === 1 ? "1" : fields.badmintonRank === 2 ? "2" : "",
    ign: fields.ign ?? "",
    ignReading: fields.ignReading ?? "",
    facebookUrl: fields.facebookUrl ?? "",
  };
}

export type FieldIssues = Partial<Record<keyof FieldsDraft, string>>;

/** Parses the draft, or returns what is wrong with it field by field. */
export function parseDraft(
  division: Requirements,
  draft: FieldsDraft,
): { ok: true; fields: RegistrationFields } | { ok: false; issues: FieldIssues } {
  const parsed = registrationFields.safeParse({
    shirtNumber: draft.shirtNumber.trim() === "" ? null : Number(draft.shirtNumber),
    badmintonRank: draft.badmintonRank === "" ? null : Number(draft.badmintonRank),
    ign: draft.ign,
    ignReading: draft.ignReading,
    facebookUrl: draft.facebookUrl,
  });
  if (!parsed.success) {
    const issues: FieldIssues = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldsDraft;
      issues[key] ??= key === "shirtNumber" ? "เบอร์เสื้อ 0-99" : issue.message;
    }
    return { ok: false, issues };
  }
  const missing = missingFields(division, parsed.data);
  if (Object.keys(missing).length > 0) return { ok: false, issues: missing };
  return { ok: true, fields: parsed.data };
}

function TextInput({
  id,
  label,
  value,
  error,
  hint,
  onChange,
  ...props
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  onChange: (value: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "id">) {
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

/** The division's own fields: shirt number, badminton rank, game profile. */
export function RegistrationFieldsEditor({
  division,
  draft,
  issues,
  onChange,
}: {
  division: Requirements;
  draft: FieldsDraft;
  issues: FieldIssues;
  onChange: (draft: FieldsDraft) => void;
}) {
  const set = <K extends keyof FieldsDraft>(key: K, value: FieldsDraft[K]) =>
    onChange({ ...draft, [key]: value });
  const ranks = [
    { value: "1", label: "มือ 1" },
    { value: "2", label: "มือ 2" },
  ] as const;

  return (
    <>
      {division.requiresShirtNumber && (
        <TextInput
          id="registration-shirt"
          label="เบอร์เสื้อ"
          type="number"
          inputMode="numeric"
          min={0}
          max={99}
          value={draft.shirtNumber}
          error={issues.shirtNumber}
          hint="0-99 ไม่ซ้ำกับคนอื่นในทีมของสถาบัน"
          onChange={(value) => set("shirtNumber", value)}
        />
      )}
      {division.requiresBadmintonRank && (
        <Field data-invalid={!!issues.badmintonRank}>
          <FieldLabel htmlFor="registration-rank">มือ</FieldLabel>
          <Select
            items={ranks}
            value={draft.badmintonRank || null}
            onValueChange={(value: "1" | "2" | null) => set("badmintonRank", value ?? "")}
          >
            <SelectTrigger id="registration-rank" aria-label="มือ">
              <SelectValue placeholder="เลือกมือ" />
            </SelectTrigger>
            <SelectContent>
              {ranks.map((rank) => (
                <SelectItem key={rank.value} value={rank.value}>
                  {rank.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            {issues.badmintonRank ?? "แต่ละสถาบันมีมือ 1 และมือ 2 ได้อย่างละคน"}
          </FieldDescription>
        </Field>
      )}
      {division.requiresGameProfile && (
        <>
          <TextInput
            id="registration-ign"
            label="ชื่อภายในเกม (IGN)"
            value={draft.ign}
            error={issues.ign}
            onChange={(value) => set("ign", value)}
          />
          <TextInput
            id="registration-ign-reading"
            label="คำอ่านชื่อในเกม"
            value={draft.ignReading}
            error={issues.ignReading}
            hint="สำหรับพิธีกรและผู้บรรยาย เช่น เฟเกอร์"
            onChange={(value) => set("ignReading", value)}
          />
          <TextInput
            id="registration-facebook"
            label="ลิงก์ Facebook"
            inputMode="url"
            placeholder="https://facebook.com/..."
            value={draft.facebookUrl}
            error={issues.facebookUrl}
            onChange={(value) => set("facebookUrl", value)}
          />
        </>
      )}
    </>
  );
}
