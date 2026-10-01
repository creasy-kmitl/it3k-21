import { cn } from "@it3k/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Text with a leading icon, for select options, values and other labels. */
export function IconLabel({
  icon: Icon,
  children,
  className,
  iconClassName,
  title,
}: {
  icon?: LucideIcon | null;
  children: ReactNode;
  className?: string;
  iconClassName?: string;
  /** Shown on hover, e.g. the full text when `children` is shortened. */
  title?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} title={title}>
      {Icon && (
        <Icon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground", iconClassName)} />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}
