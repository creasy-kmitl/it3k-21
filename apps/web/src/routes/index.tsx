import { SiFacebook, SiInstagram } from "@icons-pack/react-simple-icons";
import { hasRole, isMember } from "@it3k/auth/permissions";
import { buttonVariants } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { cn } from "@it3k/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BriefcaseBusinessIcon,
  LogInIcon,
  type LucideIcon,
  MedalIcon,
  SearchIcon,
  UserRoundIcon,
  UserRoundPlusIcon,
} from "lucide-react";

import { getSessionOrThrow } from "@/lib/auth-client";

export const Route = createFileRoute("/")({
  component: HomeComponent,
});

export type HomeAction = {
  to: "/login" | "/signup" | "/events" | "/sports" | "/me" | "/staff/dashboard";
  label: string;
  icon: LucideIcon;
};

/**
 * What the home page offers, by the highest role the account holds:
 * staff (heads and viceheads included) > athlete > participant > guest.
 */
export function homeActions(role: string | null | undefined, signedIn: boolean): HomeAction[] {
  if (!signedIn) return [{ to: "/login", label: "เข้าสู่ระบบ", icon: LogInIcon }];
  if (isMember(role)) {
    return [{ to: "/staff/dashboard", label: "ระบบทีมงาน", icon: BriefcaseBusinessIcon }];
  }
  if (hasRole(role, "athlete")) return [{ to: "/me", label: "โปรไฟล์", icon: UserRoundIcon }];
  if (hasRole(role, "participant")) {
    return [
      { to: "/events", label: "ค้นหากิจกรรม", icon: SearchIcon },
      { to: "/sports", label: "สมัครนักกีฬา", icon: MedalIcon },
    ];
  }
  return [{ to: "/signup", label: "ลงทะเบียนเข้าร่วม", icon: UserRoundPlusIcon }];
}

function HomeComponent() {
  return (
    <div className="container mx-auto flex flex-col items-center justify-center px-6">
      <article className="w-full max-w-2xl">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-5xl font-bold tracking-tight text-primary">IT·3·Kings</h1>
          <span className="text-lg text-muted-foreground">/ไอ-ที-สาม-คิงส์/</span>
        </header>

        <p className="mt-2 text-sm italic text-muted-foreground">
          คำนาม <span className="not-italic">·</span> n.
        </p>

        <hr className="my-4 border-border" />

        <ol className="mb-10 list-none space-y-3">
          <li className="flex gap-3">
            <span className="font-bold text-primary">1.</span>
            <p className="leading-relaxed">
              มหกรรมแข่งขันกีฬาสานสัมพันธ์ของนักศึกษาด้านเทคโนโลยีสารสนเทศจาก 3 สถาบันพระจอมเกล้า (มจธ., มจพ.
              และ สจล.)
            </p>
          </li>
        </ol>

        <HomeActions />

        <footer className="flex items-center font-bold">
          <a
            href="https://www.facebook.com/it3kofficial"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}
          >
            <SiFacebook size={"1.2em"} />
            IT3K
          </a>
          <a
            href="https://www.instagram.com/it3k.official"
            target="_blank"
            rel="noopener"
            className={cn(buttonVariants({ variant: "ghost" }), "cursor-pointer")}
          >
            <SiInstagram size={"1.2em"} />
            it3k.official
          </a>
        </footer>
      </article>
    </div>
  );
}

/**
 * The session lives on the API's origin, so it is read in the browser; the
 * server render and the first client render both show the placeholder.
 */
function HomeActions() {
  const session = useQuery({
    queryKey: ["session", "viewed"],
    // An admin's "view as" applies here too, like on every guarded page.
    queryFn: async () => (await getSessionOrThrow()).data ?? null,
  });

  if (session.isPending) {
    return (
      <div role="status" className="mb-6 flex flex-wrap gap-2">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-9 w-36" />
      </div>
    );
  }

  const user = session.data?.user;
  const actions = homeActions(user?.role, !!user);
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {actions.map(({ to, label, icon: Icon }, index) => (
        <Link
          key={to}
          to={to}
          className={buttonVariants({ variant: index === 0 ? "default" : "outline" })}
        >
          <Icon data-icon="inline-start" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}
