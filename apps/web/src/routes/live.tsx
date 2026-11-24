import { createFileRoute } from "@tanstack/react-router";
import { Radio } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Public, read signed out. Placeholder: the public stream (B5) builds this page.
export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "กำลังแข่ง · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl p-4">
      <StreamPlaceholder icon={Radio} title="กำลังแข่ง" description="ทุกแมตช์ที่กำลังแข่งอยู่ตอนนี้" />
    </main>
  );
}
