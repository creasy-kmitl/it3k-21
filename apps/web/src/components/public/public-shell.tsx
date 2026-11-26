import { cn } from "@it3k/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { CalendarDays, type LucideIcon, Medal, Radio } from "lucide-react";
import type { ReactNode } from "react";

const LINKS: { to: "/matches" | "/live" | "/standings"; label: string; icon: LucideIcon }[] = [
  { to: "/matches", label: "โปรแกรมและผล", icon: CalendarDays },
  { to: "/live", label: "กำลังแข่ง", icon: Radio },
  { to: "/standings", label: "ตารางคะแนน", icon: Medal },
];

/**
 * The frame of the public competition pages, read signed out: the brand and
 * the three pages, a bar at the top on wide screens and at the bottom on phones.
 */
export function PublicShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-svh w-full flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4">
          <Link to="/" className="text-lg font-bold tracking-tight text-primary">
            IT·3·Kings
          </Link>
          <nav aria-label="หน้าการแข่งขัน" className="ml-auto hidden gap-1 sm:flex">
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center gap-1.5 rounded-4xl px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
              >
                <link.icon className="size-4" aria-hidden />
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pt-6 pb-24 sm:pb-10",
          className,
        )}
      >
        {children}
      </main>
      <nav
        aria-label="หน้าการแข่งขัน"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex flex-col items-center gap-0.5 py-2 text-xs font-medium text-muted-foreground data-[status=active]:text-primary"
          >
            <link.icon className="size-5" aria-hidden />
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
