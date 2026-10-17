import { Button } from "@it3k/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";
import { useSignOutGuard } from "@/lib/sign-out-guard";
import { toast } from "sonner";

export type UserMenuClient = Pick<typeof authClient, "signOut"> & {
  useSession: () => {
    isPending: boolean;
    data: { user: { name: string; email: string } } | null;
  };
};

export default function UserMenu({ client = authClient }: { client?: UserMenuClient }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOutGuard = useSignOutGuard();
  const { data: session, isPending } = client.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline">Sign In</Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>บัญชีของฉัน</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/me" />}>โปรไฟล์ของฉัน</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={async () => {
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
                      navigate({
                        to: "/",
                        ignoreBlocker: true,
                      });
                    },
                  },
                });
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "ออกจากระบบไม่สำเร็จ");
              }
            }}
          >
            ออกจากระบบ
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
