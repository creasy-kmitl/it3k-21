import { hasRole, isMember, primaryRole } from "@it3k/auth/permissions";
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
import { Link } from "@tanstack/react-router";
import {
  BriefcaseBusinessIcon,
  ChevronDownIcon,
  LogInIcon,
  LogOutIcon,
  MedalIcon,
  TicketIcon,
  UserRoundIcon,
} from "lucide-react";

import { AccountAvatar, AccountMenuLabel, type SignOutClient, useSignOut } from "./account-menu";
import { DepartmentBadge } from "./department-icon";
import { ROLE_BADGES, RoleBadge } from "./role-badge";
import { useApis } from "@/lib/api-context";
import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/users";

export type UserMenuClient = SignOutClient & {
  useSession: () => {
    isPending: boolean;
    data: {
      user: { name: string; email: string; image?: string | null; role?: string | null };
    } | null;
  };
};

/**
 * The participant pages' account menu. `role` is the role the page runs as
 * (an admin's "view as" included); it defaults to the session's own.
 */
export default function UserMenu({
  client = authClient,
  role: viewedRole,
}: {
  client?: UserMenuClient;
  role?: string | null;
}) {
  const { data: session, isPending } = client.useSession();
  const signOut = useSignOut(client);
  const role = viewedRole ?? session?.user.role ?? null;
  const member = isMember(role);
  // Seats and departments are known only to the members' API.
  const { data: me } = useMe(useApis().users, { enabled: member && !!session });

  if (isPending) {
    return <Skeleton className="h-10 w-10 rounded-full sm:w-40" />;
  }

  if (!session) {
    return (
      <Button variant="outline" render={<Link to="/login" />} nativeButton={false}>
        <LogInIcon data-icon="inline-start" aria-hidden />
        เข้าสู่ระบบ
      </Button>
    );
  }

  const { user } = session;
  const shown = primaryRole(role);
  const seat = member ? me?.seatRole : null;
  const roleLabel = seat ? ROLE_BADGES[seat].label : ROLE_BADGES[shown].label;
  const badges = (
    <span className="flex flex-wrap items-center gap-1">
      {shown === "admin" && <RoleBadge kind="admin" />}
      {seat ? (
        <RoleBadge kind={seat} department={me?.department} />
      ) : (
        <>
          {shown !== "admin" && <RoleBadge kind={shown} />}
          {member && me?.department && <DepartmentBadge department={me.department} />}
        </>
      )}
    </span>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-auto gap-2 rounded-full p-1 sm:pr-3 aria-expanded:bg-muted"
          />
        }
      >
        <AccountAvatar user={user} />
        <span className="hidden min-w-0 flex-col items-start text-left leading-tight sm:flex">
          <span className="max-w-36 truncate text-sm font-medium">{user.name}</span>
          <span className="max-w-36 truncate text-xs font-normal text-muted-foreground">
            {roleLabel}
          </span>
        </span>
        <ChevronDownIcon className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-64 rounded-xl">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <AccountMenuLabel user={user} badges={badges} />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link to="/me" />}>
            <UserRoundIcon />
            โปรไฟล์ของฉัน
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link to="/me/tickets" />}>
            <TicketIcon />
            ตั๋วของฉัน
          </DropdownMenuItem>
          {hasRole(role, "athlete") && (
            <DropdownMenuItem render={<Link to="/sports" />}>
              <MedalIcon />
              ระบบนักกีฬา
            </DropdownMenuItem>
          )}
          {member && (
            <DropdownMenuItem render={<Link to="/staff/dashboard" />}>
              <BriefcaseBusinessIcon />
              ระบบทีมงาน
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={signOut}>
          <LogOutIcon />
          ออกจากระบบ
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
