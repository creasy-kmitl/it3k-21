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
import { authClient } from "@/lib/auth-client";
import { clearCacheOnUserChange } from "@/lib/query-cache";

// Every staff page uses the same reading width.
const COLUMN = "mx-auto w-full max-w-3xl";

const PAGE_TITLES: Record<string, string> = {
  "/staff/dashboard": "หน้าหลัก",
  "/staff/head": "หัวหน้าฝ่าย",
  "/staff/departments": "ฝ่าย",
  "/staff/users": "ผู้ใช้",
};

export const Route = createFileRoute("/staff")({
  ssr: false,
  component: AuthLayout,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    clearCacheOnUserChange(context.queryClient, session.data?.user.id ?? null);
    if (!session.data) {
      // Explain why before sending them to sign in; the 401 page links to /login.
      throw redirect({
        to: "/unauthorized",
      });
    }
    // Guests wait outside until a user manager makes them staff.
    if (!isMember(session.data.user.role)) {
      throw redirect({ to: "/" });
    }
    return { session };
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
        <SidebarInset>
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
