import {
  FORMAT_LABELS,
  GENDER_LABELS,
  type RegistrationStatus,
  STATUS_LABELS,
} from "@it3k/db/sport-rules";
import { Badge } from "@it3k/ui/components/badge";

import type { Division } from "@/lib/sports";

type DivisionSummary = Pick<
  Division,
  "gender" | "format" | "requiresShirtNumber" | "requiresBadmintonRank" | "requiresGameProfile"
> & { maxPerInstitution?: number | null };

export function DivisionBadges({ division }: { division: DivisionSummary }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge variant="secondary">{GENDER_LABELS[division.gender]}</Badge>
      <Badge variant="secondary">{FORMAT_LABELS[division.format]}</Badge>
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
