import { SiApple, SiGooglecalendar } from "@icons-pack/react-simple-icons";
import { Button } from "@it3k/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@it3k/ui/components/dropdown-menu";
import { Building, CalendarPlus, ChevronDown, Download, Mail } from "lucide-react";
import type { ComponentType } from "react";

import { downloadIcs, eventFor, googleCalendarUrl, outlookUrl } from "@/lib/add-to-calendar";
import type { CalendarItem } from "@/lib/calendar";

const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
const event = (item: CalendarItem) => eventFor(item, window.location.origin);

type CalendarTarget = {
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean }>;
  add: (item: CalendarItem) => void;
};

/** Where an item can be copied to, in menu order. */
export const CALENDAR_TARGETS: CalendarTarget[] = [
  {
    label: "Google Calendar",
    icon: SiGooglecalendar,
    add: (item) => open(googleCalendarUrl(event(item))),
  },
  { label: "Apple Calendar", icon: SiApple, add: (item) => downloadIcs(event(item), item.title) },
  { label: "Outlook.com", icon: Mail, add: (item) => open(outlookUrl(event(item), "personal")) },
  {
    label: "Microsoft 365 (องค์กร/มหาวิทยาลัย)",
    icon: Building,
    add: (item) => open(outlookUrl(event(item), "work")),
  },
];

/** The same file Apple Calendar gets, for any other calendar app. */
export const ICS_TARGET: CalendarTarget = {
  label: "ดาวน์โหลดไฟล์ .ics",
  icon: Download,
  add: (item) => downloadIcs(event(item), item.title),
};

/**
 * Copies one item into the viewer's own calendar app. Cancelled items have
 * nothing to add. Internal notes stay behind; the event links back here.
 */
export function AddToCalendar({ item }: { item: CalendarItem }) {
  if (item.status === "cancelled") return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}>
        <CalendarPlus data-icon="inline-start" />
        เพิ่มลงปฏิทิน
        <ChevronDown data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>เพิ่มลงปฏิทินของฉัน</DropdownMenuLabel>
          {CALENDAR_TARGETS.map((target) => (
            <DropdownMenuItem key={target.label} onClick={() => target.add(item)}>
              <target.icon aria-hidden />
              {target.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => ICS_TARGET.add(item)}>
          <ICS_TARGET.icon aria-hidden />
          {ICS_TARGET.label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
