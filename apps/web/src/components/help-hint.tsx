import { Popover, PopoverContent, PopoverTrigger } from "@it3k/ui/components/popover";
import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A (?) beside a label that explains the field. It opens on hover and focus
 * like a tooltip, and on tap too, so it works on phones. Keep it outside the
 * `<label>`: inside, its name would join the field's name.
 */
export function HelpHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <button
            type="button"
            aria-label={`คำอธิบาย: ${label}`}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <CircleHelp aria-hidden className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72 p-3 text-xs leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}
