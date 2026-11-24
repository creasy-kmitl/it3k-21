import { createFileRoute } from "@tanstack/react-router";
import { CalendarRange } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Placeholder: the matches stream (B2) builds this page.
export const Route = createFileRoute("/staff/matches_/generate")({
  head: () => ({ meta: [{ title: "สร้างตารางแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <StreamPlaceholder
      icon={CalendarRange}
      title="สร้างตารางแข่ง"
      description="สร้างเองหรือให้ระบบจัดพบกันหมด แล้วดูตัวอย่างก่อนยืนยัน"
    />
  );
}
