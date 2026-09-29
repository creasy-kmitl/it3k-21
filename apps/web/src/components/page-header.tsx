import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A signed-in page's title with its icon, styled the same on every page. */
export function PageHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <Icon className="size-6 text-primary" aria-hidden />
        {title}
      </h1>
      {description && <p className="text-muted-foreground">{description}</p>}
    </header>
  );
}
