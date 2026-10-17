import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RefreshCw, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ParticipantForm } from "@/components/participant-form";
import { ParticipantShell } from "@/components/participant-shell";
import { useApis } from "@/lib/api-context";
import { authClient } from "@/lib/auth-client";
import { requireParticipantSession } from "@/lib/participant-auth";
import { useState } from "react";

export const Route = createFileRoute("/signup")({
  ssr: false,
  beforeLoad: async ({ context, location }) => ({
    session: await requireParticipantSession(context.queryClient, location.href),
  }),
  head: () => ({
    meta: [{ title: "ลงทะเบียนผู้เข้าร่วม · IT3Kings" }, { name: "robots", content: "noindex" }],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { session } = Route.useRouteContext();
  const navigate = useNavigate();
  const client = useQueryClient();
  return (
    <ParticipantShell userId={session.user.id} role={session.user.role ?? "guest"}>
      <SignupEditor
        userId={session.user.id}
        onComplete={async () => {
          await authClient.getSession({ query: { disableCookieCache: true } });
          authClient.$store.notify("$sessionSignal");
          await Promise.all([
            client.invalidateQueries({ queryKey: ["profile"] }),
            client.invalidateQueries({ queryKey: ["users"] }),
          ]);
          toast.success("บันทึกข้อมูลเรียบร้อยแล้ว");
          await navigate({ to: "/me" });
        }}
      />
    </ParticipantShell>
  );
}

export function SignupEditor({
  userId,
  onComplete,
}: {
  userId: string;
  onComplete: () => Promise<void>;
}) {
  const { profile } = useApis();
  // Each visit waits for a fresh draft before initializing the form. Later
  // background refetches must not reset an editor that already has local edits.
  const [visitId] = useState(() => crypto.randomUUID());
  const me = useQuery({
    queryKey: ["profile", "editor", userId, visitId],
    queryFn: () => profile.me(userId),
    gcTime: 0,
  });
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={UserRoundPlus}
        title={me.data?.profile ? "แก้ไขโปรไฟล์" : "ลงทะเบียนผู้เข้าร่วม"}
        description="ข้อมูลที่กรอกจะบันทึกเป็นร่างอัตโนมัติ คุณกลับมากรอกต่อได้"
      />
      {me.data ? (
        <ParticipantForm key={me.data.account.id} data={me.data} onComplete={onComplete} />
      ) : me.isError ? (
        <div role="alert">
          <p>{me.error.message}</p>
          <Button onClick={() => void me.refetch()}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            ลองอีกครั้ง
          </Button>
        </div>
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
    </div>
  );
}
