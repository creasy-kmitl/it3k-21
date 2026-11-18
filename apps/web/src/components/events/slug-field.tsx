import { EVENT_SLUG_MAX } from "@it3k/db/event-rules";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldDescription, FieldError } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Link2, Sparkles } from "lucide-react";

import { FormLabel } from "@/components/form-dialog";

/** Where the event's pages live, for the URL preview. */
const appOrigin = () => (typeof window === "undefined" ? "" : window.location.origin);

/** The event's address in links, with a preview of the URLs it makes. */
export function SlugField({
  value,
  typed,
  error,
  onChange,
  onReset,
}: {
  value: string;
  typed: boolean;
  error?: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const shown = value.replace(/-+$/, "") || "…";
  return (
    <Field data-invalid={!!error}>
      <div className="flex items-center justify-between gap-2">
        <FormLabel htmlFor="event-slug" icon={Link2}>
          ลิงก์กิจกรรม (slug)
        </FormLabel>
        {typed && (
          <Button type="button" variant="ghost" size="xs" onClick={onReset}>
            <Sparkles data-icon="inline-start" aria-hidden /> สร้างจากชื่อ
          </Button>
        )}
      </div>
      <Input
        id="event-slug"
        value={value}
        maxLength={EVENT_SLUG_MAX}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={!!error}
        aria-describedby="event-slug-preview"
        inputMode="url"
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldDescription id="event-slug-preview" className="flex flex-col gap-0.5">
        <span>
          {typed
            ? "a-z, 0-9 และขีดกลาง ลบให้ว่างเพื่อสร้างจากชื่ออีกครั้ง"
            : "สร้างจากตัวอักษรอังกฤษและตัวเลขในชื่อ ถ้าไม่มีจะใช้ประเภทกับวันที่แทน ถ้าซ้ำจะเติมเลขต่อท้าย"}
        </span>
        <span className="font-mono text-xs break-all">
          {appOrigin()}/events/{shown}
        </span>
        <span className="font-mono text-xs break-all">
          {appOrigin()}/kiosk/{shown}
        </span>
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}

