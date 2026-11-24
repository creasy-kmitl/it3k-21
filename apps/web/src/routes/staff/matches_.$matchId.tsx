import { createFileRoute } from "@tanstack/react-router";
import { Swords } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Placeholder: the matches stream (B2) builds this page.
export const Route = createFileRoute("/staff/matches_/$matchId")({
  head: () => ({ meta: [{ title: "แมตช์ · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <StreamPlaceholder icon={Swords} title="แมตช์" description="ผู้แข่ง กรรมการ รูป และรายชื่อลงแข่ง" />
  );
}
