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
  to: "/dashboard" | "/head" | "/departments";
  icon: React.ReactNode;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const pathname = useLocation({ select: (location) => location.pathname });

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Menu</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => (
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
  );
}
