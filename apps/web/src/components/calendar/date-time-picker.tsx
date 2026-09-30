import { Button } from "@it3k/ui/components/button";
import { Calendar } from "@it3k/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@it3k/ui/components/popover";
import { TimePicker } from "@it3k/ui/components/time-picker";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { th } from "react-day-picker/locale";

import { bangkokParts, formatBangkok, fromDatetimeLocal } from "@/lib/bangkok-time";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The day picker works in the device's zone, but calendar dates are Bangkok
 * dates. Only year, month and day cross between the two, so a device in any
 * zone shows and picks the same Bangkok day.
 */
function toPickerDay(dateKey: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromPickerDay(day: Date) {
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

function bangkokToday() {
  const { year, month, day } = bangkokParts(Date.now());
  return new Date(year, month, day);
}

/**
 * A Bangkok date and time as a `YYYY-MM-DDTHH:mm` value (the same shape as
 * `<input type="datetime-local">`): a calendar popover for the day and a time
 * picker for the hour and minute.
 */
export function DateTimePicker({
  id,
  label,
  value,
  onChange,
  onBlur,
  invalid,
}: {
  id: string;
  /** Names the time field, e.g. "เริ่ม" → "เวลาเริ่ม". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [datePart = "", timePart = ""] = value.split("T");
  const selected = toPickerDay(datePart);

  return (
    <div className="flex gap-2">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onBlur?.();
        }}
      >
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              aria-invalid={invalid}
              className="min-w-0 flex-1 justify-between font-normal"
            />
          }
        >
          <span className="truncate">
            {selected
              ? formatBangkok(fromDatetimeLocal(`${datePart}T12:00`) ?? 0, "date")
              : "เลือกวันที่"}
          </span>
          <CalendarIcon data-icon="inline-end" />
        </PopoverTrigger>
        <PopoverContent className="w-auto overflow-hidden p-0" align="start">
          <Calendar
            mode="single"
            // Picking the selected day again keeps it (and closes the popover).
            required
            locale={th}
            captionLayout="dropdown"
            selected={selected}
            defaultMonth={selected ?? bangkokToday()}
            today={bangkokToday()}
            onSelect={(day: Date) => {
              onChange(`${fromPickerDay(day)}T${timePart || "00:00"}`);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <TimePicker
        // The label replaces the button text for screen readers, so it repeats the time.
        aria-label={`เวลา${label} ${timePart || "ยังไม่เลือก"}`}
        aria-invalid={invalid}
        className="w-28 shrink-0"
        value={timePart}
        onBlur={onBlur}
        onValueChange={(time) => onChange(`${datePart || fromPickerDay(bangkokToday())}T${time}`)}
      />
    </div>
  );
}
