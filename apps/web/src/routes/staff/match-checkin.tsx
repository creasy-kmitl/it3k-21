import { createFileRoute } from "@tanstack/react-router";
import { ScanLine } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Placeholder: the check-in stream (B4) builds this page.
export const Route = createFileRoute("/staff/match-checkin")({
  head: () => ({ meta: [{ title: "รายงานตัวแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <StreamPlaceholder
      icon={ScanLine}
      title="รายงานตัวแข่งขัน"
      description="เปิด kiosk ประจำสนาม และเช็คอินนักกีฬา Esports ด้วยตัวเอง"
    />
  );
}
