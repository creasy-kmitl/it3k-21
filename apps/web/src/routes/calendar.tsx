import { Button, buttonVariants } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, CalendarPlus, Download, LayoutGrid, MapPin } from "lucide-react";
import { useState } from "react";

import { DepartmentBadge, DepartmentIcon } from "@/components/department-icon";
import { formatBangkok, formatRange, sameDay, startOfDay } from "@/lib/bangkok-time";
import { type PublicCalendarItem, publicCalendarApi } from "@/lib/public-calendar";

export const Route = createFileRoute("/calendar")({
  loader: () => publicCalendarApi.list(),
  head: () => ({ meta: [{ title: "ปฏิทินกิจกรรม · IT3K" }] }),
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
  const [departmentId, setDepartmentId] = useState<string>();
  // Only departments with something published get a filter button.
  const departments = [
    ...new Map(items.map((item) => [item.department.id, item.department])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name, "th"));
  const shown = [
    ...(departmentId ? items.filter((item) => item.department.id === departmentId) : items),
  ].sort((a, b) => a.startAt - b.startAt);
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
            ปฏิทินกิจกรรม
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

        {departments.length > 1 && (
          <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0" aria-label="แผนก">
            <Button
              size="sm"
              variant={departmentId ? "outline" : "default"}
              aria-pressed={!departmentId}
              onClick={() => setDepartmentId(undefined)}
            >
              <LayoutGrid data-icon="inline-start" />
              ทุกแผนก
            </Button>
            {departments.map((department) => (
              <Button
                key={department.id}
                size="sm"
                variant={departmentId === department.id ? "default" : "outline"}
                aria-pressed={departmentId === department.id}
                onClick={() => setDepartmentId(department.id)}
              >
                {department.name}
              </Button>
            ))}
          </fieldset>
        )}

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
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <DepartmentIcon department={item.department} className="size-8" />
      <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">
        {formatRange(item.startAt, item.endAt)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium">{item.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <DepartmentBadge department={item.department} />
          {item.venue && (
            <span className="inline-flex items-center gap-1">
              <MapPin aria-hidden className="size-3.5" />
              {item.venue}
            </span>
          )}
        </span>
      </span>
    </li>
  );
}
