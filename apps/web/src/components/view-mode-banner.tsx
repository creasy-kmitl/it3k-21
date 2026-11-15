import { hasRole } from "@it3k/auth/permissions";
import { INSTITUTIONS } from "@it3k/db/profile";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon, LogOutIcon, UserRoundCogIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { LoadingButton } from "@/components/loading-button";
import { ROLE_BADGES } from "@/components/role-badge";
import { authClient, authError } from "@/lib/auth-client";
import { toastError } from "@/lib/errors";
import { type ActiveView, type ViewAsApi, loadViewAs, reloadAt, viewAsApi } from "@/lib/view-as";

/** Matches IMPERSONATION_MAX_AGE in packages/auth: the API refuses the session after it. */
const IMPERSONATION_MS = 60 * 60 * 1000;

export type BannerSessionClient = {
  useSession: () => {
    data: {
      user: { name: string; role?: string | null };
      session: { impersonatedBy?: string | null; createdAt: Date | string };
    } | null;
  };
  admin: {
    stopImpersonating: () => Promise<{ error: { status: number; message?: string } | null }>;
  };
};

export function describeView(view: ActiveView) {
  const parts: string[] = [ROLE_BADGES[view.kind].label];
  if (view.department) parts.push(view.department.name);
  const institution = INSTITUTIONS.find((i) => i.id === view.institution);
  if (institution) parts.push(institution.short);
  return parts.join(" · ");
}

/**
 * Says, on every page, when an admin is acting as another account or viewing
 * the app as another role, with the way back. Client-only: it renders nothing
 * until mounted, so server-rendered pages hydrate without it.
 */
export function ViewModeBanner({
  client = authClient as unknown as BannerSessionClient,
  api = viewAsApi,
  navigate = reloadAt,
}: {
  client?: BannerSessionClient;
  api?: ViewAsApi;
  navigate?: (path: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { data: session } = client.useSession();
  const impersonatedBy = session?.session.impersonatedBy ?? null;
  const realAdmin = !!session && !impersonatedBy && hasRole(session.user.role, "admin");

  const view = useQuery({
    queryKey: ["view-as"],
    queryFn: () => loadViewAs(api),
    enabled: mounted && realAdmin,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const stopImpersonating = useMutation({
    mutationFn: async () => {
      const { error } = await client.admin.stopImpersonating();
      if (error) throw authError(error);
    },
    onSuccess: () => navigate("/staff/users"),
    onError: (error) => toastError(error, "กลับสู่บัญชีของคุณไม่สำเร็จ"),
  });
  const stopViewing = useMutation({
    mutationFn: () => api.stop(),
    onSuccess: () => navigate("/staff/dashboard"),
    onError: (error) => toastError(error, "ออกจากโหมดจำลองไม่สำเร็จ"),
  });

  if (!mounted || !session) return null;

  if (impersonatedBy) {
    const expired = new Date(session.session.createdAt).getTime() + IMPERSONATION_MS <= Date.now();
    return (
      <Banner icon={UserRoundCogIcon}>
        <span>
          {expired ? (
            <>
              หมดเวลาสวมบัญชีของ <strong>{session.user.name}</strong> แล้ว
            </>
          ) : (
            <>
              คุณกำลังใช้บัญชีของ <strong>{session.user.name}</strong> · ทุกการแก้ไขจะบันทึกว่าคุณเป็นผู้ทำ
            </>
          )}
        </span>
        <LoadingButton
          size="sm"
          variant="outline"
          icon={LogOutIcon}
          loading={stopImpersonating.isPending}
          onClick={() => stopImpersonating.mutate()}
        >
          กลับสู่บัญชีของฉัน
        </LoadingButton>
      </Banner>
    );
  }

  if (view.data?.active) {
    return (
      <Banner icon={EyeIcon}>
        <span>
          กำลังจำลองมุมมอง: <strong>{describeView(view.data)}</strong> (ดูอย่างเดียว)
        </span>
        <LoadingButton
          size="sm"
          variant="outline"
          icon={LogOutIcon}
          loading={stopViewing.isPending}
          onClick={() => stopViewing.mutate()}
        >
          ออกจากโหมดจำลอง
        </LoadingButton>
      </Banner>
    );
  }

  return null;
}

function Banner({ icon: Icon, children }: { icon: typeof EyeIcon; children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-label="โหมดผู้ดูแลระบบ"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-500/60 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg dark:bg-amber-950 dark:text-amber-50"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        {children}
      </div>
    </div>
  );
}
