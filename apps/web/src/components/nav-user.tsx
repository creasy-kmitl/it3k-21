import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
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
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDownIcon, LogOutIcon } from "lucide-react";

import { DepartmentBadge } from "@/components/department-icon";
import { RoleBadge, standingText } from "@/components/role-badge";
import { authClient } from "@/lib/auth-client";
import { useMe } from "@/lib/users";

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const { data: me } = useMe();

  if (isPending || !session) {
    return <Skeleton className="h-12 w-full" />;
  }

  const { user } = session;
  const avatar = (
    <Avatar>
      <AvatarImage src={user.image ?? undefined} alt={user.name} />
      <AvatarFallback>{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
  const badges = me && (
    <span className="flex flex-wrap items-center gap-1">
      {me.role === "admin" && <RoleBadge role="admin" />}
      {me.seatRole ? (
        <RoleBadge role={me.seatRole} department={me.department} />
      ) : (
        <>
          {me.role !== "admin" && <RoleBadge role={me.role} />}
          {me.department && <DepartmentBadge department={me.department} />}
        </>
      )}
    </span>
  );
  const identity = (
    <div className="grid flex-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.name}</span>
      {/* The lg menu button has a fixed height: one line here, badges in the menu. */}
      <span className="truncate text-xs text-muted-foreground">
        {me ? standingText(me) : user.email}
      </span>
    </div>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<SidebarMenuButton size="lg" className="aria-expanded:bg-muted" />}
          >
            {avatar}
            {identity}
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  {avatar}
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </div>
                {badges && <div className="px-1 pb-1.5">{badges}</div>}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      // Nothing fetched for this account should outlive its session.
                      queryClient.clear();
                      navigate({ to: "/" });
                    },
                  },
                });
              }}
            >
              <LogOutIcon />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
