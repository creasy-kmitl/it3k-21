import { Badge } from "@it3k/ui/components/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@it3k/ui/components/collapsible";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { cn } from "@it3k/ui/lib/utils";
import { UTM_KEYS, type UtmKey } from "@it3k/db/short-link-rules";
import { ChevronDown, Megaphone } from "lucide-react";
import { useState } from "react";

const FIELDS: Record<UtmKey, { label: string; placeholder: string }> = {
  utm_source: { label: "มาจากที่ไหน (source)", placeholder: "เช่น poster, instagram" },
  utm_medium: { label: "ช่องทาง (medium)", placeholder: "เช่น qr, social" },
  utm_campaign: { label: "แคมเปญ (campaign)", placeholder: "เช่น it3k-21" },
};

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** The UTM values already in a destination, empty where there are none. */
export function readUtm(destination: string): Record<UtmKey, string> {
  const url = parse(destination);
  return Object.fromEntries(
    UTM_KEYS.map((key) => [key, url?.searchParams.get(key) ?? ""]),
  ) as Record<UtmKey, string>;
}

/** `destination` with one UTM parameter set, or removed when blank. */
export function withUtm(destination: string, key: UtmKey, value: string): string {
  const url = parse(destination);
  if (!url) return destination;
  // Not trimmed while typing, or a space between words could never be typed.
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  return url.toString();
}

/**
 * Fills in UTM parameters on the destination itself, so the destination's own
 * analytics can tell which poster or post a visit came from. What is typed
 * here is written straight into the URL above it.
 */
export function UtmFields({
  destination,
  onChange,
}: {
  destination: string;
  onChange: (destination: string) => void;
}) {
  const utm = readUtm(destination);
  const filled = UTM_KEYS.filter((key) => utm[key]).length;
  const [open, setOpen] = useState(filled > 0);
  const valid = parse(destination) !== null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50"
          />
        }
      >
        <Megaphone aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">UTM สำหรับติดตามแคมเปญ (ไม่บังคับ)</span>
        {filled > 0 && <Badge variant="secondary">ใส่แล้ว {filled}</Badge>}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t p-3">
        <FieldDescription>
          {valid
            ? "ค่าที่ใส่จะต่อท้าย URL ปลายทาง ให้ Google Analytics ของปลายทางรู้ว่าคนมาจากสื่อไหน"
            : "ใส่ URL ปลายทางให้ถูกต้องก่อน แล้วค่อยใส่ UTM"}
        </FieldDescription>
        {UTM_KEYS.map((key) => (
          <Field key={key}>
            <FieldLabel htmlFor={`link-${key}`}>{FIELDS[key].label}</FieldLabel>
            <Input
              id={`link-${key}`}
              value={utm[key]}
              disabled={!valid}
              placeholder={FIELDS[key].placeholder}
              onChange={(event) => onChange(withUtm(destination, key, event.target.value))}
            />
          </Field>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
