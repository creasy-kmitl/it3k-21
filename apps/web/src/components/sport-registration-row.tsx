import type { ReactNode } from "react";

import { SportThumbnail } from "@/components/sport-art";
import { StatusBadge } from "@/components/sport-badges";
import type { MyRegistration } from "@/lib/registrations";

type Registration = Pick<
  MyRegistration,
  "status" | "shirtNumber" | "badmintonRank" | "ign" | "reviewNote" | "division" | "sport"
>;

/**
 * One registration as a row: sport thumbnail, division and status, then the
 * details the athlete filled in. /sports adds edit and withdraw as `actions`;
 * /me shows the same row without them.
 */
export function RegistrationRow({
  registration,
  actions,
}: {
  registration: Registration;
  actions?: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <SportThumbnail
        src={registration.sport.thumbnailUrl}
        icon={registration.sport.icon}
        seed={registration.sport.id}
        label={registration.sport.name}
        className="aspect-square size-10 w-10 shrink-0 rounded-xl"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex flex-wrap items-center gap-2 font-medium">
          {registration.division.name}
          <StatusBadge status={registration.status} />
        </span>
        <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{registration.sport.name}</span>
          {registration.shirtNumber !== null && <span>เบอร์ {registration.shirtNumber}</span>}
          {registration.badmintonRank !== null && <span>มือ {registration.badmintonRank}</span>}
          {registration.ign && <span>IGN {registration.ign}</span>}
        </span>
        {registration.reviewNote && (
          <p className="text-xs text-destructive">เหตุผล: {registration.reviewNote}</p>
        )}
      </div>
      {actions && <div className="flex">{actions}</div>}
    </li>
  );
}

/** The bordered list the rows sit in. */
export function RegistrationRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y rounded-2xl border bg-card">{children}</ul>;
}
