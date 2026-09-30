// Right-click (or long-press) shortcuts on the calendar: actions on an item,
// and adding an item at the day or hour under the pointer.
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@it3k/ui/components/context-menu";
import {
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CircleCheck,
  Eye,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type ReactElement, createContext, useContext, useState } from "react";
import { toast } from "sonner";

import { eventFor } from "@/lib/add-to-calendar";
import { formatBangkok, startOfDay } from "@/lib/bangkok-time";
import type { CalendarItem } from "@/lib/calendar";

import { CALENDAR_TARGETS, ICS_TARGET } from "./add-to-calendar";

/** What an item's panel should open straight into. */
export type ItemIntent = "edit" | "cancel" | "delete";

export type CalendarShortcuts = {
  open: (item: CalendarItem, intent?: ItemIntent) => void;
  confirm: (item: CalendarItem) => void;
  openDay: (day: number) => void;
  /** Null when the viewer cannot add items. */
  createAt: ((start: number) => void) | null;
};

const ShortcutsContext = createContext<CalendarShortcuts | null>(null);

export const CalendarShortcutsProvider = ShortcutsContext.Provider;

async function copyLink(item: CalendarItem) {
  try {
    await navigator.clipboard.writeText(eventFor(item, window.location.origin).url);
    toast.success("คัดลอกลิงก์แล้ว");
  } catch {
    toast.error("คัดลอกลิงก์ไม่สำเร็จ");
  }
}

/**
 * Wraps an item's own button (`children`) so a right-click or long-press
 * opens its shortcuts. Outside a calendar page it renders the button as is.
 */
export function ItemContextMenu({
  item,
  children,
}: {
  item: CalendarItem;
  children: ReactElement;
}) {
  const shortcuts = useContext(ShortcutsContext);
  if (!shortcuts) return children;
  const cancelled = item.status === "cancelled";
  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuLabel className="truncate">{item.title}</ContextMenuLabel>
          <ContextMenuItem onClick={() => shortcuts.open(item)}>
            <Eye />
            เปิดรายละเอียด
          </ContextMenuItem>
          {item.canEdit && (
            <ContextMenuItem onClick={() => shortcuts.open(item, "edit")}>
              <Pencil />
              แก้ไข
            </ContextMenuItem>
          )}
          {item.canEdit && item.status === "draft" && (
            <ContextMenuItem onClick={() => shortcuts.confirm(item)}>
              <CircleCheck />
              ยืนยันรายการ
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => shortcuts.openDay(startOfDay(item.startAt))}>
            <CalendarClock />
            ดูทั้งวัน
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          {!cancelled && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <CalendarPlus />
                เพิ่มลงปฏิทิน
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-64">
                {[...CALENDAR_TARGETS, ICS_TARGET].map((target) => (
                  <ContextMenuItem key={target.label} onClick={() => target.add(item)}>
                    <target.icon aria-hidden />
                    {target.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem onClick={() => void copyLink(item)}>
            <Link2 />
            คัดลอกลิงก์
          </ContextMenuItem>
        </ContextMenuGroup>
        {item.canEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuGroup>
              {!cancelled && (
                <ContextMenuItem onClick={() => shortcuts.open(item, "cancel")}>
                  <CalendarX />
                  ยกเลิกรายการ…
                </ContextMenuItem>
              )}
              <ContextMenuItem variant="destructive" onClick={() => shortcuts.open(item, "delete")}>
                <Trash2 />
                ลบ…
              </ContextMenuItem>
            </ContextMenuGroup>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Wraps an empty stretch of the calendar (`children`): a month day, or a
 * day column whose `timeAt` turns the pointer's position into a time.
 */
export function SlotContextMenu({
  day,
  timeAt,
  children,
}: {
  /** Bangkok midnight of the day under the pointer. */
  day: number;
  /** The time under the pointer; without it new items start at 09:00. */
  timeAt?: (event: React.MouseEvent<HTMLElement>) => number;
  children: ReactElement;
}) {
  const shortcuts = useContext(ShortcutsContext);
  const [picked, setPicked] = useState<number | null>(null);
  if (!shortcuts) return children;
  const start = timeAt && picked !== null ? picked : day + 9 * 60 * 60 * 1000;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={children}
        onContextMenu={(event) => {
          if (timeAt) setPicked(timeAt(event));
        }}
      />
      <ContextMenuContent className="w-60">
        <ContextMenuGroup>
          <ContextMenuLabel>{formatBangkok(day, "longDay")}</ContextMenuLabel>
          {shortcuts.createAt && (
            <ContextMenuItem onClick={() => shortcuts.createAt?.(start)}>
              <Plus />
              เพิ่มรายการเวลา {formatBangkok(start, "time")} น.
            </ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => shortcuts.openDay(day)}>
            <CalendarClock />
            ดูทั้งวัน
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
