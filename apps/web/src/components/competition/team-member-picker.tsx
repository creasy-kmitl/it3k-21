import { STATUS_LABELS } from "@it3k/db/sport-rules";
import { MEMBER_GENDER_LABELS } from "@it3k/db/team-rules";
import { Badge } from "@it3k/ui/components/badge";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { cn } from "@it3k/ui/lib/utils";
import { UserRound } from "lucide-react";

import type { TeamAthlete } from "@/lib/competition-teams";

export function athleteName(athlete: Pick<TeamAthlete, "firstName" | "lastName" | "nickname">) {
  const full = [athlete.firstName, athlete.lastName].filter(Boolean).join(" ");
  return athlete.nickname ? `${full} (${athlete.nickname})` : full;
}

/**
 * The institution's athletes in a division as a checklist for one team.
 * Only approved athletes not in another team can be ticked, up to the team's
 * maximum; a member no longer approved can still be unticked.
 */
export function TeamMemberPicker({
  athletes,
  selected,
  onChange,
  max,
  otherTeamOf,
  disabled = false,
}: {
  athletes: readonly TeamAthlete[];
  selected: readonly string[];
  onChange: (registrationIds: string[]) => void;
  max: number | null;
  /** The label of another team an athlete is in, if any. */
  otherTeamOf: (registrationId: string) => string | null;
  disabled?: boolean;
}) {
  const chosen = new Set(selected);
  const full = max !== null && selected.length >= max;

  const toggle = (registrationId: string, checked: boolean) => {
    if (checked) onChange([...selected, registrationId]);
    else onChange(selected.filter((id) => id !== registrationId));
  };

  return (
    <section aria-labelledby="team-members-title" className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-2">
        <h3 id="team-members-title" className="font-medium">
          นักกีฬา
        </h3>
        <p
          className={cn("text-sm tabular-nums text-muted-foreground", full && "text-foreground")}
          aria-live="polite"
        >
          เลือกแล้ว {selected.length}
          {max !== null && ` / สูงสุด ${max}`}
        </p>
      </header>
      {athletes.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          ยังไม่มีนักกีฬาของมหาลัยนี้สมัครประเภทนี้
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {athletes.map((athlete) => {
            const id = athlete.registrationId;
            const checked = chosen.has(id);
            const elsewhere = checked ? null : otherTeamOf(id);
            const approved = athlete.status === "approved";
            const locked = disabled || (!checked && (!approved || elsewhere !== null || full));
            const inputId = `member-${id}`;
            return (
              <li
                key={id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5",
                  locked && !checked && "opacity-60",
                )}
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={locked}
                  onCheckedChange={(next) => toggle(id, next === true)}
                />
                <label htmlFor={inputId} className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {athlete.shirtNumber !== null && (
                      <span className="mr-1.5 tabular-nums text-muted-foreground">
                        #{athlete.shirtNumber}
                      </span>
                    )}
                    {athleteName(athlete)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {athlete.gender && (
                      <span className="flex items-center gap-1">
                        <UserRound className="size-3" aria-hidden />
                        {MEMBER_GENDER_LABELS[athlete.gender]}
                      </span>
                    )}
                    {athlete.badmintonRank !== null && <span>มือ {athlete.badmintonRank}</span>}
                    {elsewhere && <span>อยู่ใน {elsewhere}</span>}
                  </span>
                </label>
                {!approved && (
                  <Badge variant={checked ? "destructive" : "outline"}>
                    {STATUS_LABELS[athlete.status]}
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
