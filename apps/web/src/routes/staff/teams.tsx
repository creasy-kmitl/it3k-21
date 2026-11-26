import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Settings2, Users2 } from "lucide-react";

import { TeamIssueBadge } from "@/components/competition/team-issues";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { SportArt } from "@/components/sport-art";
import { useApis } from "@/lib/api-context";
import type { CompetitionDivision } from "@/lib/competition-divisions";

export const Route = createFileRoute("/staff/teams")({
  head: () => ({ meta: [{ title: "ทีมแข่ง · IT3Kings" }] }),
  component: TeamsOverview,
});

type SportGroup = {
  sportId: string;
  sportName: string;
  sportIcon: CompetitionDivision["sportIcon"];
  divisions: CompetitionDivision[];
};

function groupBySport(divisions: readonly CompetitionDivision[]) {
  const groups: SportGroup[] = [];
  for (const division of divisions) {
    let group = groups.find((item) => item.sportId === division.sportId);
    if (!group) {
      group = {
        sportId: division.sportId,
        sportName: division.sportName,
        sportIcon: division.sportIcon,
        divisions: [],
      };
      groups.push(group);
    }
    group.divisions.push(division);
  }
  return groups;
}

/** Every division with how many teams it has and how many still lack something. */
export function TeamsOverview() {
  const apis = useApis();
  const divisions = useQuery({
    queryKey: ["competition-divisions"],
    queryFn: () => apis.competitionDivisions.list(),
  });
  const teams = useQuery({
    queryKey: ["competition-teams", "all"],
    queryFn: () => apis.competitionTeams.list(),
  });

  const counts = new Map<string, { teams: number; withIssues: number }>();
  for (const team of teams.data?.items ?? []) {
    const count = counts.get(team.divisionId) ?? { teams: 0, withIssues: 0 };
    count.teams += 1;
    if (team.issues.length > 0) count.withIssues += 1;
    counts.set(team.divisionId, count);
  }
  const failed = divisions.isError ? divisions : teams.isError ? teams : null;

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        icon={Users2}
        title="ทีมแข่ง"
        description="ทีมของแต่ละมหาลัยในแต่ละประเภท เลือกประเภทเพื่อจัดนักกีฬาเข้าทีม"
      />
      {divisions.isPending || teams.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : failed ? (
        <ErrorState error={failed.error} onRetry={failed.refetch} title="โหลดทีมไม่สำเร็จ" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groupBySport(divisions.data?.items ?? []).map((group) => (
            <section
              key={group.sportId}
              aria-labelledby={`sport-${group.sportId}`}
              className="flex flex-col overflow-hidden rounded-3xl border"
            >
              <header className="flex items-center gap-3 border-b p-3">
                <span aria-hidden className="shrink-0">
                  <SportArt
                    icon={group.sportIcon}
                    seed={group.sportId}
                    label=""
                    className="h-10 w-16 rounded-xl"
                  />
                </span>
                <h2 id={`sport-${group.sportId}`} className="font-semibold">
                  {group.sportName}
                </h2>
              </header>
              <ul className="flex flex-col divide-y">
                {group.divisions.map((division) => {
                  const count = counts.get(division.id) ?? { teams: 0, withIssues: 0 };
                  return (
                    <li key={division.id} className="flex items-center gap-1 pr-2">
                      <Link
                        to="/staff/teams/$divisionId"
                        params={{ divisionId: division.id }}
                        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">{division.name}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {count.teams} ทีม
                            <TeamIssueBadge count={count.withIssues} />
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </Link>
                      {divisions.data?.canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`ตั้งค่าการแข่งขัน ${division.name}`}
                          render={
                            <Link
                              to="/staff/competition/$divisionId"
                              params={{ divisionId: division.id }}
                            />
                          }
                          nativeButton={false}
                        >
                          <Settings2 aria-hidden />
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
