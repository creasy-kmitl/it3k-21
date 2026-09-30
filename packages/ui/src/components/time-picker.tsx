import * as React from "react"
import { cn } from "cn"
import { ClockIcon } from "lucide-react"

import { Button } from "@it3k/ui/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@it3k/ui/components/popover"

const pad = (value: number) => String(value).padStart(2, "0")

function parse(value: string | undefined) {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "")
  if (!match) return null
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

function TimeColumn({
  label,
  values,
  selected,
  onPick,
}: {
  label: string
  values: number[]
  selected: number | undefined
  onPick: (value: number) => void
}) {
  return (
    <fieldset
      aria-label={label}
      data-slot="time-picker-column"
      className="m-0 flex max-h-56 w-14 min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain border-0 p-1 [scrollbar-width:thin]"
    >
      {values.map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          variant={value === selected ? "default" : "ghost"}
          aria-pressed={value === selected}
          className="w-full shrink-0 tabular-nums"
          onClick={() => onPick(value)}
        >
          {pad(value)}
        </Button>
      ))}
    </fieldset>
  )
}

/**
 * A 24-hour time as `HH:mm`: an outline trigger that opens hour and minute
 * columns. Picking the hour keeps the popover open; picking the minute
 * closes it.
 */
function TimePicker({
  id,
  value,
  onValueChange,
  onBlur,
  minuteStep = 5,
  placeholder = "เลือกเวลา",
  hourLabel = "ชั่วโมง",
  minuteLabel = "นาที",
  className,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "value" | "onBlur"> & {
  value: string
  onValueChange: (value: string) => void
  onBlur?: () => void
  minuteStep?: number
  placeholder?: string
  hourLabel?: string
  minuteLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const content = React.useRef<HTMLDivElement>(null)
  const time = parse(value)

  const hours = Array.from({ length: 24 }, (_, hour) => hour)
  const minutes = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, index) => index * minuteStep
  )
  // Keep an off-step minute (e.g. 09:07) pickable rather than hiding it.
  if (time && !minutes.includes(time.minute)) {
    minutes.push(time.minute)
    minutes.sort((a, b) => a - b)
  }

  React.useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      for (const column of content.current?.querySelectorAll(
        "[data-slot=time-picker-column]"
      ) ?? []) {
        column
          .querySelector("[aria-pressed=true]")
          ?.scrollIntoView?.({ block: "center" })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  const pick = (hour: number, minute: number) =>
    onValueChange(`${pad(hour)}:${pad(minute)}`)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onBlur?.()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              "justify-between font-normal tabular-nums",
              !time && "text-muted-foreground",
              className
            )}
            {...props}
          />
        }
      >
        {time ? `${pad(time.hour)}:${pad(time.minute)}` : placeholder}
        <ClockIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        className="w-auto flex-row gap-0 divide-x p-0"
        align="end"
      >
        <TimeColumn
          label={hourLabel}
          values={hours}
          selected={time?.hour}
          onPick={(hour) => pick(hour, time?.minute ?? 0)}
        />
        <TimeColumn
          label={minuteLabel}
          values={minutes}
          selected={time?.minute}
          onPick={(minute) => {
            pick(time?.hour ?? 0, minute)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { TimePicker }
