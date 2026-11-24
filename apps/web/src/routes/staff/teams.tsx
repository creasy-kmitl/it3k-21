import { createFileRoute } from "@tanstack/react-router";
import { Users2 } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Placeholder: the teams stream (B1) builds this page.
export const Route = createFileRoute("/staff/teams")({
  head: () => ({ meta: [{ title: "ทีมแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return <StreamPlaceholder icon={Users2} title="ทีมแข่ง" description="ทีมของแต่ละมหาลัยในแต่ละประเภท" />;
}
