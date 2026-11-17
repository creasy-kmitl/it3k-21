import { buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CalendarRange } from "lucide-react";
import type { ReactNode } from "react";

import { SignOutGuardProvider } from "@/lib/sign-out-guard";
import { SessionBoundary } from "./session-boundary";
import UserMenu from "./user-menu";

export function ParticipantShell({
  children,
  role,
  userId,
}: {
  children: ReactNode;
  role: string;
  userId: string;
}) {
  return (
    <SessionBoundary key={userId} userId={userId}>
      <SignOutGuardProvider>
        <div className="flex w-full flex-col">
          <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
              <Link to="/" className="text-xl font-bold tracking-tight text-primary">
                IT3Kings
              </Link>
              <nav className="flex items-center gap-1 sm:gap-2" aria-label="บัญชีผู้เข้าร่วม">
                <Link
                  to="/events"
                  aria-label="กิจกรรม"
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "text-muted-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground",
                  )}
                >
                  <CalendarRange data-icon="inline-start" aria-hidden />
                  <span className="hidden sm:inline">กิจกรรม</span>
                </Link>
                <UserMenu role={role} />
              </nav>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl p-4 sm:p-6">{children}</main>
        </div>
      </SignOutGuardProvider>
    </SessionBoundary>
  );
}
