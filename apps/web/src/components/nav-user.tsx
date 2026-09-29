import { type Role, parseRoles } from "@it3k/auth/permissions";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Badge } from "@it3k/ui/components/badge";
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
import { cn } from "@it3k/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  CrownIcon,
  LogOutIcon,
  type LucideIcon,
  ShieldCheckIcon,
  StarIcon,
  UserIcon,
} from "lucide-react";

import { DepartmentBadge } from "@/components/department-icon";
import { authClient } from "@/lib/auth-client";
import { leadershipApi } from "@/lib/leadership";

const ROLE_BADGES: Record<
  Role,
  { label: string; icon: LucideIcon; variant: "default" | "secondary" | "outline" }
> = {
  admin: { label: "Admin", icon: ShieldCheckIcon, variant: "default" },
  head: { label: "หัวหน้าฝ่าย", icon: CrownIcon, variant: "default" },
  vicehead: { label: "รองหัวหน้าฝ่าย", icon: StarIcon, variant: "secondary" },
  staff: { label: "Staff", icon: UserIcon, variant: "outline" },
};

function RoleBadge({ role }: { role: Role }) {
  const { label, icon: Icon, variant } = ROLE_BADGES[role];
  return (
    <Badge variant={variant}>
      <Icon data-icon="inline-start" />
      {label}
    </Badge>
  );
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending } = authClient.useSession();
  const departmentId = session?.user.departmentId;
  // Shares the cache with the leadership pages; any signed-in user may read it.
  const { data: department } = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => leadershipApi.departments(),
    staleTime: 5 * 60_000,
    enabled: Boolean(departmentId),
    select: (departments) => departments.find((d) => d.id === departmentId),
  });

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
  const badges = (className: string) => (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {parseRoles(user.role).map((role) => (
        <RoleBadge key={role} role={role} />
      ))}
      {department && <DepartmentBadge department={department} />}
    </span>
  );
  const identity = (
    <div className="grid flex-1 gap-1 text-left text-sm leading-tight">
      <span className="truncate font-medium">{user.name}</span>
      {/* The lg menu button has a fixed height, so keep the badges on one line. */}
      {badges("overflow-hidden")}
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
                <div className="px-1 pb-1.5">{badges("flex-wrap")}</div>
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
