import { GAMES, type Game, type PublicStatus } from "@it3k/db/calendar-rules";
import { Button, buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, CalendarPlus, Download, Gamepad2, LayoutGrid, Trophy } from "lucide-react";
import { useState } from "react";

import { formatBangkok, formatRange, sameDay, startOfDay } from "@/lib/bangkok-time";
import { CATEGORY_ICONS, PUBLIC_STATUS_ICONS } from "@/lib/calendar-icons";
import { CATEGORY_LABELS, GAME_LABELS } from "@/lib/calendar-labels";
import { type PublicCalendarItem, publicCalendarApi } from "@/lib/public-calendar";

export const Route = createFileRoute("/calendar")({
  loader: () => publicCalendarApi.list(),
  head: () => ({ meta: [{ title: "ตารางการแข่งขัน · IT3K" }] }),
  component: RouteComponent,
  errorComponent: () => (
    <p role="alert" className="container mx-auto px-6 py-10 text-destructive">
      โหลดตารางไม่สำเร็จ ลองรีเฟรชอีกครั้ง
    </p>
  ),
});

function RouteComponent() {
  const page = Route.useLoaderData();
  return <PublicCalendar items={page.items} now={Date.now()} feedUrl={publicCalendarApi.feedUrl} />;
}

const STATUS: Record<PublicStatus, { label: string; className: string } | null> = {
  scheduled: null,
  live: { label: "Live", className: "bg-red-600 text-white" },
  completed: { label: "จบแล้ว", className: "bg-muted text-muted-foreground" },
  delayed: { label: "ล่าช้า", className: "bg-amber-500 text-black" },
  cancelled: { label: "ยกเลิก", className: "bg-muted text-muted-foreground line-through" },
};

/** Calendar apps subscribe with webcal://; browsers download the https link. */
const webcal = (url: string) => url.replace(/^https?:\/\//, "webcal://");

export function PublicCalendar({
  items,
  now,
  feedUrl,
}: {
  items: PublicCalendarItem[];
  now: number;
  feedUrl: string;
}) {
  const [game, setGame] = useState<Game>();
  const shown = [...(game ? items.filter((item) => item.game === game) : items)].sort(
    (a, b) => a.startAt - b.startAt,
  );
  const days = [...new Set(shown.map((item) => startOfDay(item.startAt)))].sort((a, b) => a - b);

  return (
    <div className="container mx-auto flex flex-col px-6 py-10">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <Link to="/" className="text-sm text-muted-foreground hover:underline">
            IT·3·Kings
          </Link>
          <h1 className="flex items-center gap-3 text-4xl font-bold tracking-tight text-primary">
            <CalendarDays aria-hidden className="size-9" />
            ตารางการแข่งขัน
          </h1>
          <p className="text-sm text-muted-foreground">
            เวลาทั้งหมดเป็นเวลาไทย (UTC+07:00) · แสดงเฉพาะรายการที่ยืนยันแล้ว
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={webcal(feedUrl)} className={cn(buttonVariants({ size: "sm" }))}>
              <CalendarPlus data-icon="inline-start" />
              เพิ่มลงปฏิทินของฉัน
            </a>
            <a
              href={feedUrl}
              className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
              download
            >
              <Download data-icon="inline-start" />
              ดาวน์โหลด .ics
            </a>
          </div>
        </header>

        <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-label="เกม">
          <Button
            size="sm"
            variant={game ? "outline" : "default"}
            aria-pressed={!game}
            onClick={() => setGame(undefined)}
          >
            <LayoutGrid data-icon="inline-start" />
            ทุกเกม
          </Button>
          {GAMES.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={game === value ? "default" : "outline"}
              aria-pressed={game === value}
              onClick={() => setGame(value)}
            >
              <Gamepad2 data-icon="inline-start" />
              {GAME_LABELS[value]}
            </Button>
          ))}
        </fieldset>

        {days.length === 0 ? (
          <p className="rounded-2xl border p-6 text-center text-muted-foreground">
            ยังไม่มีรายการที่ประกาศในช่วงนี้
          </p>
        ) : (
          days.map((day) => (
            <section key={day} aria-label={formatBangkok(day, "longDay")}>
              <h2 className={cn("mb-2 text-sm font-semibold", sameDay(day, now) && "text-primary")}>
                {formatBangkok(day, "longDay")}
                {sameDay(day, now) && " · วันนี้"}
              </h2>
              <ul className="divide-y rounded-2xl border">
                {shown
                  .filter((item) => startOfDay(item.startAt) === day)
                  .map((item) => (
                    <PublicItem key={item.id} item={item} />
                  ))}
              </ul>
            </section>
          ))
        )}
      </article>
    </div>
  );
}

function PublicItem({ item }: { item: PublicCalendarItem }) {
  const status = STATUS[item.status];
  const Icon = CATEGORY_ICONS[item.category];
  const StatusIcon = PUBLIC_STATUS_ICONS[item.status];
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
      >
        <Icon className="size-4" />
      </span>
      <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatRange(item.startAt, item.endAt)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={cn("font-medium", item.status === "cancelled" && "line-through opacity-60")}
          >
            {item.title}
          </span>
          {status && (
            <span
              className={cn(
                "inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-semibold",
                status.className,
              )}
            >
              {StatusIcon && <StatusIcon aria-hidden className="size-3" />}
              {status.label}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {[
            item.game && GAME_LABELS[item.game],
            CATEGORY_LABELS[item.category],
            item.teams.length > 0 && item.teams.join(" vs "),
            item.venue,
            item.streamPlatform && `ถ่ายทอดสด: ${item.streamPlatform}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {item.scoreboardUrl && (
          <a
            href={item.scoreboardUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-xs text-primary underline"
          >
            <Trophy aria-hidden className="size-3.5" />
            ดูผลคะแนน
          </a>
        )}
      </span>
    </li>
  );
}
