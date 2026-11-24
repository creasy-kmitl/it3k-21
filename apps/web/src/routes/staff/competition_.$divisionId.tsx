import { createFileRoute } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Placeholder: the teams stream (B1) builds this page.
export const Route = createFileRoute("/staff/competition_/$divisionId")({
  head: () => ({ meta: [{ title: "ตั้งค่าการแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <StreamPlaceholder
      icon={Settings2}
      title="ตั้งค่าการแข่งขัน"
      description="จำนวนคน รายชื่อลงแข่ง การนับคะแนน และการรายงานตัวของประเภทนี้"
    />
  );
}
