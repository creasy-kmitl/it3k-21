import { createFileRoute } from "@tanstack/react-router";
import { Medal } from "lucide-react";

import { StreamPlaceholder } from "@/components/competition/stream-placeholder";

// Public, read signed out. Placeholder: the public stream (B5) builds this page.
export const Route = createFileRoute("/standings")({
  head: () => ({ meta: [{ title: "ตารางคะแนน · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl p-4">
      <StreamPlaceholder
        icon={Medal}
        title="ตารางคะแนน"
        description="ตารางคะแนนในสายและตารางเหรียญ"
      />
    </main>
  );
}
