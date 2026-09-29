import type { Role } from "@it3k/auth/permissions";
import { Badge } from "@it3k/ui/components/badge";
import { cn } from "@it3k/ui/lib/utils";
import {
  CircleDashedIcon,
  CrownIcon,
  type LucideIcon,
  ShieldCheckIcon,
  StarIcon,
  UserIcon,
} from "lucide-react";

import type { LeadershipSummary } from "@/lib/leadership";

import { DEPARTMENT_COLORS, type DepartmentColorKey } from "./department-icon";

export type SeatRole = LeadershipSummary["role"];

// Account roles plus the seat an account holds, if any.
export const ROLE_BADGES: Record<
  Role | SeatRole,
  { label: string; icon: LucideIcon; variant: "default" | "secondary" | "outline" }
> = {
  admin: { label: "Admin", icon: ShieldCheckIcon, variant: "default" },
  head: { label: "หัวหน้าฝ่าย", icon: CrownIcon, variant: "default" },
  vicehead: { label: "รองหัวหน้าฝ่าย", icon: StarIcon, variant: "secondary" },
  staff: { label: "Staff", icon: UserIcon, variant: "outline" },
  guest: { label: "Guest", icon: CircleDashedIcon, variant: "outline" },
};

/**
 * A role, or a seat followed by its department ("หัวหน้าฝ่าย Tech/Live") on
 * that department's color.
 */
export function RoleBadge({
  role,
  department,
}: {
  role: Role | SeatRole;
  department?: { name: string; color: DepartmentColorKey } | null;
}) {
  const { label, icon: Icon, variant } = ROLE_BADGES[role];
  return (
    <Badge
      variant={variant}
      className={cn(department && (DEPARTMENT_COLORS[department.color] ?? DEPARTMENT_COLORS.slate))}
    >
      <Icon data-icon="inline-start" />
      {department ? `${label} ${department.name}` : label}
    </Badge>
  );
}

type Standing = {
  role: Role;
  seatRole: SeatRole | null;
  department: { name: string } | null;
};

/** One line for tight spaces, e.g. "Admin · หัวหน้าฝ่าย · Tech/Live". */
export function standingText({ role, seatRole, department }: Standing) {
  const parts: string[] = [];
  if (role === "admin") parts.push(ROLE_BADGES.admin.label);
  if (seatRole) parts.push(ROLE_BADGES[seatRole].label);
  else if (role !== "admin") parts.push(ROLE_BADGES[role].label);
  if (department) parts.push(department.name);
  return parts.join(" · ");
}
