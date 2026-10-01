import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@it3k/ui/components/input-group";
import { Spinner } from "@it3k/ui/components/spinner";
import {
  DESTINATION_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  SHORT_LINK_PATH,
  SLUG_MAX,
  SLUG_MIN,
  SLUG_PATTERN,
  TITLE_MAX,
  destinationProblem,
} from "@it3k/db/short-link-rules";
import { Check, Eye, EyeOff, LockKeyhole, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { DateTimePicker } from "@/components/calendar/date-time-picker";
import { HelpHint } from "@/components/help-hint";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import { LINK_ERROR_MESSAGES, type LinkErrorField, type ShortLink } from "@/lib/links";

import { TagInput } from "./tag-input";
import { UtmFields } from "./utm-fields";

const DAY_MS = 24 * 60 * 60 * 1000;

export type LinkFormValues = {
  title: string;
  destination: string;
  /** Blank asks the API for a random one; only sent when creating. */
  slug: string;
  expiresAt: number | null;
  /** Blank means none. */
  fallbackUrl: string;
  tags: string[];
  /** A new password, null to remove the one set, or undefined to leave it as is. */
  password?: string | null;
};

/** What happens to the link's password on save. */
type PasswordMode = "keep" | "set" | "remove";

type Errors = Partial<Record<keyof LinkFormValues, string>>;

function passwordProblem(mode: PasswordMode, password: string) {
  if (mode !== "set") return null;
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return `รหัสผ่านยาว ${PASSWORD_MIN}–${PASSWORD_MAX} ตัวอักษร`;
  }
  return null;
}

/** The same rules the API applies, checked first so mistakes show at once. */
function validate(values: LinkFormValues, creating: boolean, now: number): Errors {
  const errors: Errors = {};
  if (!values.title.trim()) errors.title = "ตั้งชื่อลิงก์ไว้ให้ทีมจำได้";
  const problem = destinationProblem(values.destination.trim(), window.location.host);
  if (!values.destination.trim()) errors.destination = "ใส่ URL ปลายทาง";
  else if (problem) errors.destination = LINK_ERROR_MESSAGES[problem];
  const fallback = values.fallbackUrl.trim();
  const fallbackProblem = fallback ? destinationProblem(fallback, window.location.host) : null;
  if (fallbackProblem) errors.fallbackUrl = LINK_ERROR_MESSAGES[fallbackProblem];
  const slug = values.slug.trim();
  if (creating && slug) {
    if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
      errors.slug = `ยาว ${SLUG_MIN}–${SLUG_MAX} ตัวอักษร`;
    } else if (!SLUG_PATTERN.test(slug)) {
      errors.slug = "ใช้ได้แค่ a–z, 0–9 และขีดกลาง (ห้ามขึ้นต้นหรือลงท้ายด้วยขีด)";
    }
  }
  if (values.expiresAt !== null && values.expiresAt <= now) {
    errors.expiresAt = LINK_ERROR_MESSAGES["expiry-past"];
  }
  return errors;
}

/**
 * Create or edit a short link. The slug is chosen only when creating: once a
 * QR code is printed with it, it can never change.
 */
export function LinkForm({
  link,
  submitting,
  serverError,
  knownTags,
  onSubmit,
  onCancel,
}: {
  /** The link being edited, or nothing to create one. */
  link?: ShortLink;
  submitting: boolean;
  /** Why the API refused the last save, in Thai, and which field it is about. */
  serverError?: { field: LinkErrorField; message: string } | null;
  /** Tags on other links, offered while typing. */
  knownTags?: string[];
  onSubmit: (values: LinkFormValues) => void;
  onCancel?: () => void;
}) {
  const creating = !link;
  const hadPassword = link?.hasPassword ?? false;
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("keep");
  const [password, setPassword] = useState("");
  const [passwordShown, setPasswordShown] = useState(false);
  const [values, setValues] = useState<LinkFormValues>({
    title: link?.title ?? "",
    destination: link?.destination ?? "",
    slug: "",
    expiresAt: link?.expiresAt ?? null,
    fallbackUrl: link?.fallbackUrl ?? "",
    tags: link?.tags ?? [],
  });
  // Errors show once someone tries to save, then update as they fix them.
  const [tried, setTried] = useState(false);
  // The API's refusal shows on its field until the form finds a problem itself.
  const passwordError = tried ? passwordProblem(passwordMode, password) : null;
  const errors: Errors = {
    ...(serverError ? { [serverError.field]: serverError.message } : {}),
    ...(tried ? validate(values, creating, Date.now()) : {}),
    ...(passwordError ? { password: passwordError } : {}),
  };
  const set = (patch: Partial<LinkFormValues>) =>
    setValues((current) => ({ ...current, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (Object.keys(validate(values, creating, Date.now())).length > 0) return;
    if (passwordProblem(passwordMode, password)) return;
    onSubmit({
      ...values,
      title: values.title.trim(),
      destination: values.destination.trim(),
      slug: values.slug.trim(),
      fallbackUrl: values.fallbackUrl.trim(),
      password: passwordMode === "set" ? password : passwordMode === "remove" ? null : undefined,
    });
  }

  const host = `${window.location.host}${SHORT_LINK_PATH}`;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="link-title">ชื่อลิงก์</FieldLabel>
          <Input
            id="link-title"
            value={values.title}
            maxLength={TITLE_MAX}
            placeholder="เช่น ฟอร์มลงทะเบียนนักกีฬา"
            aria-invalid={!!errors.title}
            onChange={(event) => set({ title: event.target.value })}
          />
          <FieldError>{errors.title}</FieldError>
        </Field>

        <Field data-invalid={!!errors.destination}>
          <FieldLabel htmlFor="link-destination">ปลายทาง</FieldLabel>
          <Input
            id="link-destination"
            type="url"
            inputMode="url"
            value={values.destination}
            maxLength={DESTINATION_MAX}
            placeholder="https://"
            aria-invalid={!!errors.destination}
            onChange={(event) => set({ destination: event.target.value })}
          />
          <FieldDescription>เปลี่ยนภายหลังได้ QR ที่พิมพ์ไปแล้วจะพาไปปลายทางใหม่ทันที</FieldDescription>
          <FieldError>{errors.destination}</FieldError>
        </Field>

        <UtmFields
          destination={values.destination}
          onChange={(destination) => set({ destination })}
        />

        {creating && (
          <Field data-invalid={!!errors.slug}>
            <div className="flex items-center gap-1.5">
              <FieldLabel htmlFor="link-slug">ชื่อท้ายลิงก์ (ไม่บังคับ)</FieldLabel>
              <HelpHint label="ชื่อท้ายลิงก์">
                ตั้งแล้วเปลี่ยนไม่ได้ เพราะพิมพ์อยู่ใน QR ถ้าเว้นว่างจะสุ่มชื่อสั้น ๆ ที่อ่านง่ายให้
              </HelpHint>
            </div>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>{host}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="link-slug"
                value={values.slug}
                maxLength={SLUG_MAX}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="สุ่มให้"
                aria-invalid={!!errors.slug}
                onChange={(event) => set({ slug: event.target.value.toLowerCase() })}
              />
            </InputGroup>
            <FieldError>{errors.slug}</FieldError>
          </Field>
        )}

        <Field data-invalid={!!errors.expiresAt}>
          <Field orientation="horizontal">
            <Checkbox
              id="link-expires"
              checked={values.expiresAt !== null}
              onCheckedChange={(checked) =>
                set({ expiresAt: checked ? Date.now() + 30 * DAY_MS : null })
              }
            />
            <FieldLabel htmlFor="link-expires" className="font-normal">
              ปิดลิงก์อัตโนมัติเมื่อถึงวันที่กำหนด
            </FieldLabel>
          </Field>
          {values.expiresAt !== null && (
            <>
              <DateTimePicker
                id="link-expires-at"
                label="หมดอายุ"
                value={toDatetimeLocal(values.expiresAt)}
                onChange={(value) => set({ expiresAt: fromDatetimeLocal(value) })}
                invalid={!!errors.expiresAt}
              />
              <FieldDescription>เวลาไทย หลังจากนี้ผู้สแกนจะเห็นหน้าแจ้งว่าลิงก์หมดอายุ</FieldDescription>
            </>
          )}
          <FieldError>{errors.expiresAt}</FieldError>
        </Field>

        <Field data-invalid={!!errors.fallbackUrl}>
          <div className="flex items-center gap-1.5">
            <FieldLabel htmlFor="link-fallback">ปลายทางสำรอง (ไม่บังคับ)</FieldLabel>
            <HelpHint label="ปลายทางสำรอง">
              เมื่อปิดลิงก์หรือลิงก์หมดอายุ คนที่สแกนจะถูกพาไปที่นี่แทนหน้าแจ้งว่าลิงก์ใช้ไม่ได้ ถ้าปลายทางหลักล่ม
              ปิดลิงก์ไว้ก่อนแล้วทุกคนจะไปที่ปลายทางสำรองทันที
            </HelpHint>
          </div>
          <Input
            id="link-fallback"
            type="url"
            inputMode="url"
            value={values.fallbackUrl}
            maxLength={DESTINATION_MAX}
            placeholder="เช่น หน้าเพจของงาน"
            aria-invalid={!!errors.fallbackUrl}
            onChange={(event) => set({ fallbackUrl: event.target.value })}
          />
          <FieldError>{errors.fallbackUrl}</FieldError>
        </Field>

        <Field data-invalid={!!errors.password}>
          {hadPassword && passwordMode !== "set" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex flex-1 items-center gap-1.5 text-sm">
                <LockKeyhole aria-hidden className="size-4 text-primary" />
                {passwordMode === "remove" ? "จะเอารหัสผ่านออกเมื่อบันทึก" : "ลิงก์นี้ต้องใส่รหัสผ่านก่อนเปิด"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPasswordMode("set")}
              >
                เปลี่ยนรหัส
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPasswordMode(passwordMode === "remove" ? "keep" : "remove")}
              >
                {passwordMode === "remove" ? "เก็บรหัสไว้" : "เอารหัสออก"}
              </Button>
            </div>
          ) : (
            <Field orientation="horizontal">
              <Checkbox
                id="link-locked"
                checked={passwordMode === "set"}
                onCheckedChange={(checked) => setPasswordMode(checked ? "set" : "keep")}
              />
              <FieldLabel htmlFor="link-locked" className="font-normal">
                {hadPassword ? "ตั้งรหัสผ่านใหม่" : "ต้องใส่รหัสผ่านก่อนเปิดลิงก์"}
              </FieldLabel>
            </Field>
          )}
          {passwordMode === "set" && (
            <>
              <InputGroup>
                <InputGroupInput
                  id="link-password"
                  aria-label="รหัสผ่านของลิงก์"
                  // Hidden while typed, like any password; shown on request,
                  // since staff pass it on to the people who should get in.
                  type={passwordShown ? "text" : "password"}
                  value={password}
                  maxLength={PASSWORD_MAX}
                  // Not the staff member's own sign-in, so the browser must not fill it.
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-invalid={!!errors.password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={passwordShown ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={passwordShown}
                    onClick={() => setPasswordShown(!passwordShown)}
                  >
                    {passwordShown ? <EyeOff /> : <Eye />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>
                บอกรหัสนี้กับคนที่ควรเข้าได้ ระบบเก็บแบบเข้ารหัส จึงดูย้อนหลังไม่ได้
              </FieldDescription>
            </>
          )}
          <FieldError>{errors.password}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="link-tags">แท็ก (ไม่บังคับ)</FieldLabel>
          <TagInput
            id="link-tags"
            value={values.tags}
            suggestions={knownTags}
            onChange={(tags) => set({ tags })}
          />
          <FieldDescription>จัดกลุ่มลิงก์ เช่น ตามเกม ฝ่าย หรือแคมเปญ แล้วกรองในหน้ารายการ</FieldDescription>
        </Field>
      </FieldGroup>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            ยกเลิก
          </Button>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? (
            <Spinner data-icon="inline-start" />
          ) : creating ? (
            <Plus data-icon="inline-start" />
          ) : (
            <Check data-icon="inline-start" />
          )}
          {creating ? "สร้างลิงก์" : "บันทึก"}
        </Button>
      </div>
    </form>
  );
}
