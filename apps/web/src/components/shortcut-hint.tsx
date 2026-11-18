import { type RegisterableHotkey, formatForDisplay } from "@tanstack/react-hotkeys";
import { cn } from "@it3k/ui/lib/utils";

/**
 * A keyboard shortcut drawn next to a button's label, as "⌘S" on a Mac or
 * "Ctrl+S" elsewhere. Hidden on phones, which have no keyboard to press it on.
 */
export function ShortcutHint({ hotkey, className }: {
  hotkey: RegisterableHotkey;
  className?: string;
}) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "pointer-events-none ml-1 hidden rounded-md border border-current/20 px-1.5 font-sans text-[0.7rem] leading-5 opacity-70 sm:inline-block",
        className,
      )}
    >
      {formatForDisplay(hotkey as Parameters<typeof formatForDisplay>[0])}
    </kbd>
  );
}
