import { Link, createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";

import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/staff/dashboard")({
  component: RouteComponent,
});

function RouteComponent() {
  const { session } = Route.useRouteContext();

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={LayoutDashboard}
        title="หน้าหลัก"
        description={`ยินดีต้อนรับ ${session.data?.user.name ?? ""}`}
      />
      <Link to="/staff/head" className="text-primary underline-offset-4 hover:underline">
        หัวหน้าฝ่าย
      </Link>
    </div>
  );
}
