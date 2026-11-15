import {
  type DivisionFormat,
  type DivisionGender,
  FORMAT_LABELS,
  GENDER_LABELS,
  type RegistrationStatus,
  STATUS_LABELS,
} from "@it3k/db/sport-rules";
import { Badge } from "@it3k/ui/components/badge";
import { cn } from "@it3k/ui/lib/utils";
import { Mars, User, Venus, VenusAndMars } from "lucide-react";

import type { Division } from "@/lib/sports";

type DivisionSummary = Pick<
  Division,
  "gender" | "format" | "requiresShirtNumber" | "requiresBadmintonRank" | "requiresGameProfile"
> & { maxPerInstitution?: number | null };

/** The division's tags as athletes see them, then what staff set on it. */
export function DivisionBadges({ division }: { division: DivisionSummary }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <GenderTag gender={division.gender} />
      <FormatTag format={division.format} />
      {division.requiresShirtNumber && <Badge variant="outline">เบอร์เสื้อ</Badge>}
      {division.requiresBadmintonRank && <Badge variant="outline">มือ 1/2</Badge>}
      {division.requiresGameProfile && <Badge variant="outline">IGN · Discord</Badge>}
      {division.maxPerInstitution != null && (
        <Badge variant="outline">สูงสุด {division.maxPerInstitution} คน/สถาบัน</Badge>
      )}
    </span>
  );
}

const STATUS_VARIANTS: Record<RegistrationStatus, "secondary" | "default" | "destructive"> = {
  review: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}

const GENDER_STYLES: Record<DivisionGender, { className: string; icon: typeof Mars | null }> = {
  male: { className: "bg-sky-500/10 text-sky-700 dark:text-sky-300", icon: Mars },
  female: { className: "bg-pink-500/10 text-pink-700 dark:text-pink-300", icon: Venus },
  mixed: { className: "bg-violet-500/10 text-violet-700 dark:text-violet-300", icon: VenusAndMars },
  open: { className: "bg-muted text-muted-foreground", icon: null },
};

/** One figure per player for individual and pair, three for a team. */
const FORMAT_PEOPLE: Record<DivisionFormat, number> = { individual: 1, pair: 2, team: 3 };

/** The gender as a tinted chip with its symbol: sky for men, pink for women. */
export function GenderTag({ gender }: { gender: DivisionGender }) {
  const style = GENDER_STYLES[gender];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium",
        style.className,
      )}
    >
      {Icon && <Icon className="size-3" aria-hidden />}
      {GENDER_LABELS[gender]}
    </span>
  );
}

/** The format with one, two or three figures. */
export function FormatTag({ format }: { format: DivisionFormat }) {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full border px-2 text-xs text-muted-foreground">
      <span className="flex -space-x-1" aria-hidden>
        {Array.from({ length: FORMAT_PEOPLE[format] }, (_, i) => (
          <User key={i} className="size-3" />
        ))}
      </span>
      {FORMAT_LABELS[format]}
    </span>
  );
}

/**
 * Gender and format at a glance: a tinted chip with the gender symbol, then
 * the format with one, two or three figures.
 */
export function DivisionTags({
  division,
  className,
}: {
  division: Pick<Division, "gender" | "format">;
  className?: string;
}) {
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <GenderTag gender={division.gender} />
      <FormatTag format={division.format} />
    </span>
  );
}
