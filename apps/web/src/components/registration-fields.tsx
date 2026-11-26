import { type RegistrationFields, missingFields, registrationFields } from "@it3k/db/sport-rules";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@it3k/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { AtSign, Gamepad2, type LucideIcon, Medal, Shirt, Trophy, Volume2 } from "lucide-react";
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
  /** The Facebook username; stored as a full link. */
  facebookUrl: string;
};

type StoredFields = {
  shirtNumber?: number | null;
  badmintonRank?: number | null;
  ign?: string | null;
  ignReading?: string | null;
  facebookUrl?: string | null;
};

const FACEBOOK_LINK = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:facebook\.com|fb\.com|fb\.me)(?:\/|$)/i;

/**
 * The username part of whatever was typed or pasted: a full link loses its
 * host, tracking query and trailing slash ("https://www.facebook.com/jane.doe/?mibextid=x"
 * becomes "jane.doe"); a numeric profile keeps its id ("profile.php?id=100").
 * Anything that is not a link is left as typed, apart from a leading "@".
 */
export function facebookUsername(input: string): string {
  const text = input.trim();
  if (!FACEBOOK_LINK.test(text)) return text.replace(/^@/, "");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return text;
  }
  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  const id = url.searchParams.get("id");
  if (path === "profile.php" && id) return `profile.php?id=${id}`;
  return path;
}

const FACEBOOK_USERNAME = /^(?:[a-z0-9.]+|profile\.php\?id=\d+)$/i;

/** The link stored for a username, or "" when there is none. */
export function facebookLink(username: string): string {
  const name = facebookUsername(username);
  return name ? `https://facebook.com/${name}` : "";
}

export function toDraft(fields: StoredFields = {}): FieldsDraft {
  return {
    shirtNumber: fields.shirtNumber == null ? "" : String(fields.shirtNumber),
    badmintonRank: fields.badmintonRank === 1 ? "1" : fields.badmintonRank === 2 ? "2" : "",
    ign: fields.ign ?? "",
    ignReading: fields.ignReading ?? "",
    facebookUrl: facebookUsername(fields.facebookUrl ?? ""),
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
    facebookUrl: facebookLink(draft.facebookUrl),
  });
  if (!parsed.success) {
    const issues: FieldIssues = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldsDraft;
      issues[key] ??=
        key === "shirtNumber"
          ? "เบอร์เสื้อ 0-99"
          : key === "facebookUrl"
            ? "ชื่อผู้ใช้ Facebook ไม่ถูกต้อง"
            : issue.message;
    }
    return { ok: false, issues };
  }
  const username = facebookUsername(draft.facebookUrl);
  if (division.requiresGameProfile && username && !FACEBOOK_USERNAME.test(username)) {
    return {
      ok: false,
      issues: { facebookUrl: "ชื่อผู้ใช้ Facebook ใช้ได้แค่ตัวอักษรอังกฤษ ตัวเลข และจุด" },
    };
  }
  const missing = missingFields(division, parsed.data);
  if (Object.keys(missing).length > 0) {
    return {
      ok: false,
      issues: {
        ...missing,
        ...(missing.facebookUrl ? { facebookUrl: "กรอกชื่อผู้ใช้ Facebook" } : {}),
      },
    };
  }
  return { ok: true, fields: parsed.data };
}

/** A field label with its icon in front, as in the participant form. */
export function IconLabel({
  htmlFor,
  icon: Icon,
  children,
}: {
  htmlFor: string;
  icon: LucideIcon;
  children: string;
}) {
  return (
    <FieldLabel htmlFor={htmlFor} className="items-center [&_svg]:size-4 [&_svg]:shrink-0">
      <Icon className="text-muted-foreground" aria-hidden />
      {children}
    </FieldLabel>
  );
}

function TextInput({
  id,
  label,
  icon,
  value,
  error,
  hint,
  onChange,
  ...props
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  error?: string;
  hint?: string;
  onChange: (value: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "id">) {
  return (
    <Field data-invalid={!!error}>
      <IconLabel htmlFor={id} icon={icon}>
        {label}
      </IconLabel>
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
          icon={Shirt}
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
          <IconLabel htmlFor="registration-rank" icon={Trophy}>
            มือ
          </IconLabel>
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
                  <Medal
                    aria-hidden
                    className={rank.value === "1" ? "text-amber-500" : "text-slate-400"}
                  />
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
            icon={Gamepad2}
            value={draft.ign}
            error={issues.ign}
            onChange={(value) => set("ign", value)}
          />
          <TextInput
            id="registration-ign-reading"
            label="คำอ่านชื่อในเกม"
            icon={Volume2}
            value={draft.ignReading}
            error={issues.ignReading}
            hint="สำหรับพิธีกรและผู้บรรยาย เช่น เฟเกอร์"
            onChange={(value) => set("ignReading", value)}
          />
          <Field data-invalid={!!issues.facebookUrl}>
            <IconLabel htmlFor="registration-facebook" icon={AtSign}>
              Facebook
            </IconLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>facebook.com/</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="registration-facebook"
                value={draft.facebookUrl}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!issues.facebookUrl}
                onChange={(event) => set("facebookUrl", event.target.value)}
                // A pasted link keeps only the username straight away; a typed
                // one is trimmed on leaving the field, so typing is never cut short.
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  if (!pasted) return;
                  event.preventDefault();
                  set("facebookUrl", facebookUsername(pasted));
                }}
                onBlur={() => set("facebookUrl", facebookUsername(draft.facebookUrl))}
              />
            </InputGroup>
            <FieldDescription>
              {issues.facebookUrl ?? "ชื่อผู้ใช้ หรือวางลิงก์โปรไฟล์ทั้งลิงก์ก็ได้"}
            </FieldDescription>
          </Field>
        </>
      )}
    </>
  );
}
