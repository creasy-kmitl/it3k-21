import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@it3k/ui/components/sidebar";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { hasRole } from "@it3k/auth/permissions";
import { Link } from "@tanstack/react-router";
import {
  CalendarRangeIcon,
  ChevronsUpDownIcon,
  EyeIcon,
  HouseIcon,
  LogOutIcon,
  TicketIcon,
  UserRoundIcon,
} from "lucide-react";
import { useState } from "react";

import { AccountAvatar, AccountMenuLabel, useSignOut } from "@/components/account-menu";
import { DepartmentBadge } from "@/components/department-icon";
import { RoleBadge, standingText } from "@/components/role-badge";
import { ViewAsDialog } from "@/components/view-as-dialog";
import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/users";

export function NavUser() {
  const { isMobile } = useSidebar();
  const { data: session, isPending } = authClient.useSession();
  const { data: me } = useMe();
  const signOut = useSignOut();
  const [viewing, setViewing] = useState(false);

  if (isPending || !session) {
    return <Skeleton className="h-12 w-full" />;
  }

  const { user } = session;
  // The session's role is the real one; `me` already reflects any view-as.
  const canViewAs =
    hasRole(user.role, "admin") && !session.session.impersonatedBy && me?.viewingAs === false;
  const badges = me && (
    <span className="flex flex-wrap items-center gap-1">
      {me.role === "admin" && <RoleBadge kind="admin" />}
      {me.seatRole ? (
        <RoleBadge kind={me.seatRole} department={me.department} />
      ) : (
        <>
          {me.role !== "admin" && <RoleBadge kind={me.role} />}
          {me.department && <DepartmentBadge department={me.department} />}
        </>
      )}
    </span>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            <AccountAvatar user={user} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{user.name}</span>
              {/* The lg menu button has a fixed height: one line here, badges in the menu. */}
              <span className="truncate text-xs text-muted-foreground">
                {me ? standingText(me) : user.email}
              </span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-64 rounded-xl"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={8}
          >
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
              <DropdownMenuItem render={<Link to="/events" />}>
                <CalendarRangeIcon />
                กิจกรรม
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link to="/" />}>
                <HouseIcon />
                หน้าแรก
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {canViewAs && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setViewing(true)}>
                  <EyeIcon />
                  จำลองมุมมอง…
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={signOut}>
              <LogOutIcon />
              ออกจากระบบ
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {viewing && <ViewAsDialog onClose={() => setViewing(false)} />}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
