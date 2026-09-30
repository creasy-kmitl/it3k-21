import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, LayoutDashboard, Users } from "lucide-react";

import { Upcoming } from "@/components/calendar/upcoming";
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
      <Upcoming now={now} departmentId={session.data?.user.departmentId ?? null} />
      <div className="flex gap-4">
        <Link
          to="/staff/calendar"
          className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
        >
          <CalendarDays aria-hidden className="size-4" />
          ปฏิทิน
        </Link>
        <Link
          to="/staff/head"
          className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
        >
          <Users aria-hidden className="size-4" />
          หัวหน้าฝ่าย
        </Link>
      </div>
    </div>
  );
}
