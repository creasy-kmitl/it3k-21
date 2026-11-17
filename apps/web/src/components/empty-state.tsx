import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A dashed box for a page with nothing to show yet: no events open, no
 * tickets, or the thing asked for is not there.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed p-12 text-center text-muted-foreground">
      <Icon className="size-10" aria-hidden />
      {title || description ? (
        <div className="flex flex-col gap-1">
          {title ? <h2 className="text-lg font-semibold text-foreground">{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
