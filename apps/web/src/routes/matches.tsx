import { createFileRoute } from "@tanstack/react-router";
import { Trophy } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Public, read signed out. Placeholder: the public stream (B5) builds this page.
export const Route = createFileRoute("/matches")({
  head: () => ({ meta: [{ title: "ผลการแข่งขัน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl p-4">
      <StreamPlaceholder
        icon={Trophy}
        title="ผลการแข่งขัน"
        description="ค้นหาแมตช์ ดูผลสด และผลที่จบแล้ว"
      />
    </main>
  );
}
