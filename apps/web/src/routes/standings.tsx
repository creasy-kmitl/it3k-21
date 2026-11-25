import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Medal, Table2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { DivisionResults, MedalTable } from "@/components/public/medal-table";
import { PublicShell } from "@/components/public/public-shell";
import { DivisionStandings } from "@/components/public/standings-table";
import { useApis } from "@/lib/api-context";
import { PUBLIC_COMPETITION_KEY } from "@/lib/public-competition";

// Public, read signed out.
export const Route = createFileRoute("/standings")({
  head: () => ({ meta: [{ title: "ตารางคะแนน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PublicShell>
      <StandingsView />
    </PublicShell>
  );
}

const loading = (
  <div role="status" className="flex flex-col gap-3">
    <span className="sr-only">กำลังโหลด</span>
    <Skeleton className="h-6 w-40" />
    <Skeleton className="h-48" />
  </div>
);

/** The medal table first, then each division's group tables. */
export function StandingsView() {
  const { publicCompetition: api } = useApis();
  const medals = useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "medals"],
    queryFn: () => api.medals(),
    refetchInterval: 60_000,
  });
  const standings = useQuery({
    queryKey: [...PUBLIC_COMPETITION_KEY, "standings"],
    queryFn: () => api.standings(),
    refetchInterval: 30_000,
  });

  return (
    <>
      <PageHeader icon={Medal} title="ตารางคะแนน" description="ตารางเหรียญรวมและตารางคะแนนในสาย" />

      <section aria-labelledby="medal-table" className="flex flex-col gap-3">
        <h2 id="medal-table" className="text-lg font-semibold">
          ตารางเหรียญ
        </h2>
        {medals.isPending ? (
          loading
        ) : medals.isError ? (
          <ErrorState
            error={medals.error}
            onRetry={() => medals.refetch()}
            title="โหลดตารางเหรียญไม่สำเร็จ"
            size="sm"
          />
        ) : (
          <MedalTable rows={medals.data.rows} />
        )}
      </section>

      {medals.data && <DivisionResults divisions={medals.data.divisions} />}

      <section aria-labelledby="group-tables" className="flex flex-col gap-6">
        <h2 id="group-tables" className="sr-only">
          ตารางคะแนนในสาย
        </h2>
        {standings.isPending ? (
          loading
        ) : standings.isError ? (
          <ErrorState
            error={standings.error}
            onRetry={() => standings.refetch()}
            title="โหลดตารางคะแนนไม่สำเร็จ"
            size="sm"
          />
        ) : standings.data.divisions.length === 0 ? (
          <EmptyState
            icon={Table2}
            title="ยังไม่มีตารางคะแนนในสาย"
            description="จะแสดงเมื่อจัดสายการแข่งขันแล้ว"
          />
        ) : (
          standings.data.divisions.map((division) => (
            <DivisionStandings key={division.id} division={division} />
          ))
        )}
      </section>
    </>
  );
}
