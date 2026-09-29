import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@it3k/ui/components/sidebar";
import { Link, useLocation } from "@tanstack/react-router";
import type * as React from "react";

export type NavMainItem = {
  title: string;
  to: "/staff/dashboard" | "/staff/head" | "/staff/departments" | "/staff/users";
  icon: React.ReactNode;
};

export type NavMainGroup = { label: string; items: NavMainItem[] };

/** One sidebar group per entry; a group the user can see nothing in is left out. */
export function NavMain({ groups }: { groups: NavMainGroup[] }) {
  const pathname = useLocation({ select: (location) => location.pathname });

  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => (
      <SidebarGroup key={group.label}>
        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                tooltip={item.title}
                isActive={pathname.startsWith(item.to)}
                render={<Link to={item.to} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    ));
}
