import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { toastError } from "@/lib/errors";
import { useSignOutGuard } from "@/lib/sign-out-guard";

export type AccountUser = { name: string; email: string; image?: string | null };

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export function AccountAvatar({
  user,
  size,
}: {
  user: Pick<AccountUser, "name" | "image">;
  size?: "default" | "sm" | "lg";
}) {
  return (
    <Avatar size={size}>
      <AvatarImage src={user.image ?? undefined} alt="" />
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

/** The top of an account menu: who is signed in, and what they are here. */
export function AccountMenuLabel({ user, badges }: { user: AccountUser; badges?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 px-1 py-1.5">
      <div className="flex items-center gap-2.5 text-left text-sm">
        <AccountAvatar user={user} size="lg" />
        <div className="grid min-w-0 flex-1 leading-tight">
          <span className="truncate font-medium text-foreground">{user.name}</span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </div>
      </div>
      {badges}
    </div>
  );
}

export type SignOutClient = Pick<typeof authClient, "signOut">;

/**
 * Signs out from any account menu: lets a mounted form save its draft first,
 * then drops everything cached for the account and goes home.
 */
export function useSignOut(client: SignOutClient = authClient) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOutGuard = useSignOutGuard();

  return async () => {
    try {
      await signOutGuard?.current?.();
    } catch {
      toast.error("บันทึกร่างไม่สำเร็จ ข้อมูลล่าสุดอาจสูญหายเมื่อออกจากระบบ");
    }
    try {
      await client.signOut({
        fetchOptions: {
          onSuccess: () => {
            // Nothing fetched for this account should outlive its session.
            queryClient.clear();
            navigate({ to: "/", ignoreBlocker: true });
          },
        },
      });
    } catch (error) {
      toastError(error, "ออกจากระบบไม่สำเร็จ");
    }
  };
}
