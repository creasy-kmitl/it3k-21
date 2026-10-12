import { isMember } from "@it3k/auth/permissions";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@it3k/ui/components/breadcrumb";
import { Separator } from "@it3k/ui/components/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@it3k/ui/components/sidebar";
import { TooltipProvider } from "@it3k/ui/components/tooltip";
import { cn } from "@it3k/ui/lib/utils";
import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/calendar/notification-bell";
import { authClient } from "@/lib/auth-client";
import { clearCacheOnUserChange } from "@/lib/query-cache";

// Every staff page shares one column, so the header and page title stay put
// when moving between pages. Pages that read better narrow cap their own content.
const COLUMN = "mx-auto w-full max-w-7xl";

const PAGE_TITLES: Record<string, string> = {
  "/staff/dashboard": "หน้าหลัก",
  "/staff/calendar": "ปฏิทิน",
  "/staff/head": "หัวหน้าฝ่าย",
  "/staff/departments": "ฝ่าย",
  "/staff/users": "ผู้ใช้",
  "/staff/qr-code": "QR Code",
  "/staff/links": "ลิงก์สั้น",
};

/**
 * Where to send someone who may not see staff pages, or null to let them in.
 * `href` is the page they asked for, so signing in can bring them back to it.
 */
export function staffRedirect(user: { role?: string | null } | undefined, href: string) {
  if (!user) return { to: "/login", search: { to: href } } as const;
  // Guests wait outside until a user manager makes them staff.
  if (!isMember(user.role)) return { to: "/pending" } as const;
  return null;
}

export const Route = createFileRoute("/staff")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async ({ context, location }) => {
    const session = await authClient.getSession();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    const away = staffRedirect(session.data?.user, location.href);
    if (away) throw redirect(away);
    return { session };
  },
  head: ({ matches }) => {
    const title = PAGE_TITLES[matches.at(-1)?.pathname ?? ""];
    return { meta: title ? [{ title: `${title} · IT3Kings` }] : [] };
  },
});

function AuthLayout() {
  const { session } = Route.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  const title = PAGE_TITLES[pathname];

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar userRole={session.data?.user.role} />
        {/* A plain border like the boxes on each page, instead of the inset's shadow. */}
        <SidebarInset className="md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:border md:peer-data-[variant=inset]:shadow-none">
          {/* Header and page share one centered column, so the breadcrumb lines up
              with the content whether the sidebar is open or closed. */}
          <header className="flex h-16 shrink-0 items-center px-4">
            <div className={cn(COLUMN, "flex items-center gap-2")}>
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              {title && (
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem>
                      <BreadcrumbPage>{title}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              )}
              <NotificationBell />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className={cn(COLUMN, "flex flex-1 flex-col gap-4")}>
              <Outlet />
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
