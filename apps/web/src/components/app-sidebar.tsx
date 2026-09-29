import { can } from "@it3k/auth/permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@it3k/ui/components/sidebar";
import { Link } from "@tanstack/react-router";
import {
  Building2Icon,
  LayoutDashboardIcon,
  TrophyIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react";
import type * as React from "react";

import { NavMain, type NavMainItem } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { useMe } from "@/lib/users";

export function AppSidebar({
  userRole,
  ...props
}: React.ComponentProps<typeof Sidebar> & { userRole: string | null | undefined }) {
  const { data: me } = useMe();
  const items: NavMainItem[] = [
    { title: "Dashboard", to: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "หัวหน้าฝ่าย", to: "/head", icon: <UsersIcon /> },
    ...(me?.canManageUsers ? [{ title: "ผู้ใช้", to: "/users", icon: <UserCogIcon /> } as const] : []),
    ...(can(userRole, { department: ["read"] })
      ? [{ title: "Departments", to: "/departments", icon: <Building2Icon /> } as const]
      : []),
  ];

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <TrophyIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">IT3Kings</span>
                <span className="truncate text-xs">Dashboard</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
