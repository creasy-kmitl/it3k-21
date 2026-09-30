import { Button } from "@it3k/ui/components/button";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bell, CheckCheck, Inbox } from "lucide-react";
import { useState } from "react";

import { useApis } from "@/lib/api-context";
import { dateKey, formatBangkok } from "@/lib/bangkok-time";
import type { CalendarInbox, CalendarNotification } from "@/lib/calendar";
import { NOTIFICATION_ICONS } from "@/lib/calendar-icons";
import { describeNotification } from "@/lib/calendar-labels";

import { SideDrawer } from "./side-drawer";

function NoticeIcon({ kind }: { kind: CalendarNotification["kind"] }) {
  const Icon = NOTIFICATION_ICONS[kind];
  return <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

/** The inbox itself: notifications, newest first. */
export function NotificationList({
  inbox,
  onOpen,
  onReadAll,
}: {
  inbox: CalendarInbox;
  onOpen: (target: { itemId: string; startAt?: number; notificationId?: string }) => void;
  onReadAll: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="การแจ้งเตือน" className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Inbox aria-hidden className="size-4 text-primary" />
            การแจ้งเตือน
          </h3>
          {inbox.unread > 0 && (
            <Button variant="ghost" size="sm" onClick={onReadAll}>
              <CheckCheck data-icon="inline-start" />
              อ่านทั้งหมด
            </Button>
          )}
        </div>
        {inbox.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {inbox.items.map((notice: CalendarNotification) => (
              <li key={notice.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start gap-2 p-2 text-left text-sm hover:bg-muted/60",
                    notice.readAt === null && "bg-primary/5",
                  )}
                  onClick={() =>
                    onOpen({
                      itemId: notice.itemId,
                      notificationId: notice.readAt === null ? notice.id : undefined,
                      startAt:
                        typeof notice.data.startAt === "number" ? notice.data.startAt : undefined,
                    })
                  }
                >
                  <NoticeIcon kind={notice.kind} />
                  {notice.readAt === null && (
                    <>
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                      />
                      <span className="sr-only">ยังไม่อ่าน</span>
                    </>
                  )}
                  <span className="flex flex-col">
                    <span>{describeNotification(notice)}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatBangkok(notice.createdAt, "dateTime")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Header bell with the unread count; opens the inbox in a sheet. */
export function NotificationBell() {
  const { calendar } = useApis();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: ["calendar", "notifications"],
    queryFn: () => calendar.notifications(),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (ids: string[] | "all") => calendar.markRead(ids),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["calendar", "notifications"] }),
  });
  const count = inbox.data?.unread ?? 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative ml-auto"
        aria-label={count > 0 ? `การแจ้งเตือน ${count} รายการใหม่` : "การแจ้งเตือน"}
        onClick={() => setOpen(true)}
      >
        <Bell />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Button>
      <SideDrawer
        open={open}
        onOpenChange={setOpen}
        title="การแจ้งเตือน"
        description="รายการในปฏิทินที่คุณรับผิดชอบ"
        width="28rem"
      >
        <div>
          {inbox.data ? (
            <NotificationList
              inbox={inbox.data}
              onReadAll={() => markRead.mutate("all")}
              onOpen={({ itemId, startAt, notificationId }) => {
                if (notificationId) markRead.mutate([notificationId]);
                setOpen(false);
                void navigate({
                  to: "/staff/calendar",
                  search: {
                    item: itemId,
                    ...(startAt ? { view: "day" as const, date: dateKey(startAt) } : {}),
                  },
                });
              }}
            />
          ) : inbox.isError ? (
            <p role="alert" className="text-sm text-destructive">
              โหลดการแจ้งเตือนไม่สำเร็จ
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">กำลังโหลด</p>
          )}
        </div>
      </SideDrawer>
    </>
  );
}
