import type { ReactNode } from "react";

/**
 * Spot illustrations from the IT·3·Kings kit (design/illustrations), copied into
 * public/illustrations as 400px WebP. The kit draws each spot twice, so swap on the theme.
 */
export type SpotName =
  | "calendar"
  | "crown"
  | "esports"
  | "flag"
  | "headset"
  | "map-pin"
  | "medal"
  | "megaphone"
  | "phone-qr"
  | "scoreboard"
  | "server"
  | "staff-card"
  | "ticket"
  | "trophy"
  | "whistle"
  | "code"
  | "keyboard"
  | "camera"
  | "jersey";

function Spot({ name, className }: { name: SpotName; className?: string }) {
  return (
    <span className={className}>
      <img
        src={`/illustrations/spot-${name}.webp`}
        alt=""
        width={400}
        height={400}
        loading="lazy"
        className="!m-0 block size-full dark:hidden"
      />
      <img
        src={`/illustrations/spot-dark-${name}.webp`}
        alt=""
        width={400}
        height={400}
        loading="lazy"
        className="!m-0 hidden size-full dark:block"
      />
    </span>
  );
}

/** A page's opening paragraph with a spot illustration beside it. */
export function PageHero({ spot, children }: { spot: SpotName; children: ReactNode }) {
  return (
    <div className="not-prose my-6 flex flex-col-reverse items-center gap-4 rounded-xl border bg-fd-card p-5 sm:flex-row sm:gap-6">
      <div className="min-w-0 flex-1 text-[0.95rem] leading-7 text-fd-muted-foreground [&_strong]:text-fd-foreground">
        {children}
      </div>
      <Spot name={spot} className="block size-28 shrink-0 sm:size-32" />
    </div>
  );
}

/** A card that links to a role's page, with its spot illustration. */
export function RoleCard({
  spot,
  title,
  href,
  children,
}: {
  spot: SpotName;
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="not-prose group flex items-center gap-3 rounded-xl border bg-fd-card p-3 no-underline transition-colors hover:bg-fd-accent"
    >
      <Spot name={spot} className="block size-16 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium text-fd-foreground">{title}</span>
        <span className="block text-sm text-fd-muted-foreground">{children}</span>
      </span>
    </a>
  );
}

export function RoleCards({ children }: { children: ReactNode }) {
  return <div className="not-prose my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}
