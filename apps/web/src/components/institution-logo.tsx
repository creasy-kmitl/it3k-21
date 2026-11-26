import { INSTITUTIONS } from "@it3k/db/profile";
import { cn } from "@it3k/ui/lib/utils";

type InstitutionEntry = (typeof INSTITUTIONS)[number];

function entryFor(institution: string | InstitutionEntry | null | undefined) {
  if (!institution) return undefined;
  return typeof institution === "string"
    ? INSTITUTIONS.find((entry) => entry.id === institution)
    : institution;
}

/**
 * An institution's logo. It is decorative (`alt=""`): the short name always
 * sits next to it, so screen readers and option names read the name once.
 */
export function InstitutionLogo({
  institution,
  className,
}: {
  institution: string | InstitutionEntry | null | undefined;
  className?: string;
}) {
  const entry = entryFor(institution);
  if (!entry) return null;
  return (
    <img
      src={entry.logo}
      alt=""
      className={cn("size-4 shrink-0 object-contain", className)}
      loading="lazy"
    />
  );
}

/** The logo followed by the short name (สจล., มจธ., …), or the raw value if unknown. */
export function InstitutionLabel({
  institution,
  className,
}: {
  institution: string | InstitutionEntry;
  className?: string;
}) {
  const entry = entryFor(institution);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <InstitutionLogo institution={entry} />
      <span className="truncate">{entry?.short ?? String(institution)}</span>
    </span>
  );
}
