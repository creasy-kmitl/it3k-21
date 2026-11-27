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
  BookOpenIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  LayoutDashboardIcon,
  MailIcon,
  Link2Icon,
  MapPinnedIcon,
  MedalIcon,
  QrCodeIcon,
  ScanLineIcon,
  SwordsIcon,
  TrophyIcon,
  UserCogIcon,
  UsersIcon,
  Users2Icon,
} from "lucide-react";
import type * as React from "react";

import { NavMain, type NavMainGroup, useCloseSidebarOnMobile } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { staffGuideUrl } from "@/lib/docs";
import { type Me, type SportPermission, useMe } from "@/lib/users";

type NavAccess = Pick<
  Me,
  "canManageUsers" | "canManageDepartments" | "canSendEmail" | "sportAccess"
>;

/** The console's menu for an account; each page and the API still check their own rights. */
export function staffNavGroups(me: NavAccess | undefined): NavMainGroup[] {
  // Shown to anyone with a right in the sport system; the API enforces each one.
  const inSports = (me?.sportAccess.permissions.length ?? 0) > 0;
  const can = (permission: SportPermission) =>
    me?.sportAccess.permissions.includes(permission) ?? false;
  return [
    {
      label: "ภาพรวม",
      items: [
        { title: "หน้าหลัก", to: "/staff/dashboard", icon: <LayoutDashboardIcon /> },
        { title: "ปฏิทิน", to: "/staff/calendar", icon: <CalendarDaysIcon /> },
      ],
    },
    {
      // Who is who: the leader directory for everyone, plus the admin pages for departments and accounts.
      label: "องค์กร",
      items: [
        { title: "หัวหน้าฝ่าย", to: "/staff/head", icon: <UsersIcon /> },
        ...(me?.canManageDepartments
          ? [{ title: "ฝ่าย", to: "/staff/departments", icon: <Building2Icon /> } as const]
          : []),
        ...(me?.canManageUsers
          ? [{ title: "ผู้ใช้", to: "/staff/users", icon: <UserCogIcon /> } as const]
          : []),
      ],
    },
    {
      // Events are not only sports, and venues host both events and matches.
      label: "กิจกรรม",
      items: inSports
        ? [
            { title: "กิจกรรม", to: "/staff/events", icon: <CalendarCheckIcon /> },
            { title: "สถานที่", to: "/staff/venues", icon: <MapPinnedIcon /> },
          ]
        : [],
    },
    {
      // In the order the work happens: sports, then who plays, then the matches.
      label: "กีฬา",
      items: [
        ...(inSports
          ? [{ title: "ประเภทกีฬา", to: "/staff/sports", icon: <MedalIcon /> } as const]
          : []),
        ...(can("athletes.read")
          ? [{ title: "นักกีฬา", to: "/staff/athletes", icon: <TrophyIcon /> } as const]
          : []),
        ...(can("competition.read")
          ? ([
              { title: "ทีมแข่ง", to: "/staff/teams", icon: <Users2Icon /> },
              { title: "แมตช์", to: "/staff/matches", icon: <SwordsIcon /> },
            ] as const)
          : []),
        ...(can("matches.checkin")
          ? [
              {
                title: "รายงานตัวแข่งขัน",
                to: "/staff/match-checkin",
                icon: <ScanLineIcon />,
              } as const,
            ]
          : []),
      ],
    },
    {
      label: "เครื่องมือ",
      items: [
        { title: "QR Code", to: "/staff/qr-code", icon: <QrCodeIcon /> },
        { title: "ลิงก์สั้น", to: "/staff/links", icon: <Link2Icon /> },
        ...(me?.canSendEmail
          ? [{ title: "ส่งอีเมล", to: "/staff/email", icon: <MailIcon /> } as const]
          : []),
      ],
    },
  ];
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { data: me } = useMe();
  const closeOnMobile = useCloseSidebarOnMobile();
  const groups = staffNavGroups(me);

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link to="/staff/dashboard" />}
              onClick={closeOnMobile}
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <TrophyIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">IT3Kings</span>
                <span className="truncate text-xs">ระบบทีมงาน</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The guide is its own site, so it opens in a new tab and keeps the console open. */}
            <SidebarMenuButton
              tooltip="คู่มือการใช้งาน"
              render={<a href={staffGuideUrl} target="_blank" rel="noopener noreferrer" />}
              onClick={closeOnMobile}
            >
              <BookOpenIcon />
              <span>คู่มือการใช้งาน</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
