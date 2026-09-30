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

import { downloadIcs, eventFor, googleCalendarUrl, outlookUrl } from "@/lib/add-to-calendar";
import type { CalendarItem } from "@/lib/calendar";

const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");

/**
 * Copies one item into the viewer's own calendar app. Cancelled items have
 * nothing to add. Internal notes stay behind; the event links back here.
 */
export function AddToCalendar({ item }: { item: CalendarItem }) {
  if (item.status === "cancelled") return null;
  const event = () => eventFor(item, window.location.origin);
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
          <DropdownMenuItem onClick={() => open(googleCalendarUrl(event()))}>
            <SiGooglecalendar aria-hidden />
            Google Calendar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => downloadIcs(event(), item.title)}>
            <SiApple aria-hidden />
            Apple Calendar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => open(outlookUrl(event(), "personal"))}>
            <Mail aria-hidden />
            Outlook.com
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => open(outlookUrl(event(), "work"))}>
            <Building aria-hidden />
            Microsoft 365 (องค์กร/มหาวิทยาลัย)
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => downloadIcs(event(), item.title)}>
          <Download aria-hidden />
          ดาวน์โหลดไฟล์ .ics
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
