import { Badge } from "@it3k/ui/components/badge";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@it3k/ui/components/card";
import { Crown, type LucideIcon, ShieldUser } from "lucide-react";
import type { ReactNode } from "react";

import type { LeadershipSummary } from "@/lib/leadership";

export const ROLE_LABELS: Record<LeadershipSummary["role"], string> = {
  head: "หัวหน้าฝ่าย",
  vicehead: "รองหัวหน้าฝ่าย",
};

const ROLE_ICONS: Record<LeadershipSummary["role"], LucideIcon> = {
  head: Crown,
  vicehead: ShieldUser,
};

export function RoleBadge({ role }: { role: LeadershipSummary["role"] }) {
  const Icon = ROLE_ICONS[role];
  return (
    <Badge variant={role === "head" ? "default" : "secondary"}>
      <Icon data-icon="inline-start" aria-hidden />
      {ROLE_LABELS[role]}
    </Badge>
  );
}

type Props = {
  departmentName: string;
  seats: LeadershipSummary[];
  /** Contact / edit / delete controls for one seat, decided by the parent. */
  renderActions: (seat: LeadershipSummary) => ReactNode;
};

/** One card per seat, stacked as a list at every breakpoint. */
export default function LeadershipList({ departmentName, seats, renderActions }: Props) {
  return (
    <ul aria-label={departmentName} className="flex flex-col gap-2">
      {seats.map((seat) => (
        <li key={seat.id}>
          <Card size="sm">
            <CardHeader>
              <CardTitle>{seat.displayName}</CardTitle>
              <CardDescription>
                <RoleBadge role={seat.role} />
              </CardDescription>
              <CardAction className="flex gap-1">{renderActions(seat)}</CardAction>
            </CardHeader>
          </Card>
        </li>
      ))}
    </ul>
  );
}
