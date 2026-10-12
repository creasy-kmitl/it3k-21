import { HelpHint } from "@/components/help-hint";
import { FIELD_HINTS, type HintKey } from "@/lib/calendar-hints";

/** A (?) beside a calendar field's label, with that field's explanation. */
export function Hint({ hint, label }: { hint: HintKey; label: string }) {
  return <HelpHint label={label}>{FIELD_HINTS[hint]}</HelpHint>;
}
