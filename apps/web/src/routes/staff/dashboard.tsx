import { Link, createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";

import { RunSheet } from "@/components/calendar/run-sheet";
import { PageHeader } from "@/components/page-header";
import { useNow } from "@/hooks/use-now";

export const Route = createFileRoute("/staff/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();
  const now = useNow();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={LayoutDashboard}
        title="หน้าหลัก"
        description={`ยินดีต้อนรับ ${session.data?.user.name ?? ""}`}
      />
      <RunSheet now={now} />
      <div className="flex gap-4">
        <Link to="/staff/calendar" className="text-primary underline-offset-4 hover:underline">
          ปฏิทิน Tech/Live
        </Link>
        <Link to="/staff/head" className="text-primary underline-offset-4 hover:underline">
          หัวหน้าฝ่าย
        </Link>
      </div>
    </div>
  );
}
