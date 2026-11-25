import type { TeamIssue } from "@it3k/db/team-rules";
import { Badge } from "@it3k/ui/components/badge";
import { CircleAlert, CircleCheck } from "lucide-react";

/** What a team still lacks, or that it is ready. */
export function TeamIssueList({ issues }: { issues: readonly TeamIssue[] }) {
  if (issues.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        ทีมครบตามเงื่อนไขแล้ว
      </p>
    );
  }
  return (
    <ul
      aria-label="สิ่งที่ยังไม่ครบ"
      className="flex flex-col gap-1.5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
    >
      {issues.map((issue) => (
        <li key={`${issue.code}-${issue.message}`} className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

/** A count of issues for lists and tabs; nothing when the team is ready. */
export function TeamIssueBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200"
    >
      <CircleAlert data-icon="inline-start" aria-hidden />
      {count} เรื่อง
    </Badge>
  );
}
