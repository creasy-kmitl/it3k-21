import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { CheckIcon, PipetteIcon } from "lucide-react"

import { Button } from "@it3k/ui/components/button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@it3k/ui/components/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@it3k/ui/components/popover"

/** Hue in degrees; saturation and value from 0 to 1. */
type Hsv = { h: number; s: number; v: number }

const HEX = /^#[0-9a-f]{6}$/i

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value))

function hexToHsv(hex: string): Hsv | null {
  if (!HEX.test(hex)) return null
  const channel = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16) / 255
  const r = channel(1)
  const g = channel(3)
  const b = channel(5)
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  let h = 0
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
  }
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${channel(5)}${channel(3)}${channel(1)}`
}

/** Where a pointer sits inside an element, from 0 to 1 on each axis. */
function pointerPosition(event: React.PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / (rect.width || 1)),
    y: clamp((event.clientY - rect.top) / (rect.height || 1)),
  }
}

/** The saturation (across) by brightness (down) square for the current hue. */
function ColorArea({
  hsv,
  onChange,
  label,
}: {
  hsv: Hsv
  onChange: (hsv: Hsv) => void
  label: string
}) {
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = pointerPosition(event)
    onChange({ ...hsv, s: x, v: 1 - y })
  }
  const percent = (value: number) => `${Math.round(value * 100)}%`

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={`ความสด ${percent(hsv.s)} ความสว่าง ${percent(hsv.v)}`}
      data-slot="color-picker-area"
      className="relative h-36 w-full cursor-crosshair touch-none rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)`,
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        move(event)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) move(event)
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.1 : 0.01
        const change: Partial<Record<string, Partial<Hsv>>> = {
          ArrowLeft: { s: clamp(hsv.s - step) },
          ArrowRight: { s: clamp(hsv.s + step) },
          ArrowUp: { v: clamp(hsv.v + step) },
          ArrowDown: { v: clamp(hsv.v - step) },
        }
        const patch = change[event.key]
        if (!patch) return
        event.preventDefault()
        onChange({ ...hsv, ...patch })
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: hsvToHex(hsv),
        }}
      />
    </div>
  )
}

function HueSlider({
  hue,
  onChange,
  label,
}: {
  hue: number
  onChange: (hue: number) => void
  label: string
}) {
  return (
    <SliderPrimitive.Root
      value={hue}
      min={0}
      max={360}
      onValueChange={(value) => onChange(value as number)}
      thumbAlignment="edge"
      data-slot="color-picker-hue"
    >
      <SliderPrimitive.Control className="flex h-4 w-full touch-none items-center">
        <SliderPrimitive.Track
          className="relative h-3 w-full rounded-full"
          style={{
            background:
              "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
          }}
        >
          <SliderPrimitive.Thumb
            aria-label={label}
            getAriaValueText={(_, value) => `${Math.round(value)} องศา`}
            className="size-4 rounded-full border-2 border-white shadow-md ring-1 ring-black/20 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            style={{ background: `hsl(${hue} 100% 50%)` }}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

type EyeDropperApi = { open: () => Promise<{ sRGBHex: string }> }
type EyeDropperWindow = Window & { EyeDropper?: new () => EyeDropperApi }

export type ColorSwatch = { value: string; label: string }

/**
 * A `#rrggbb` colour: a hex box with a swatch that opens a picker (shade
 * square, hue bar, preset swatches and, where supported, an eyedropper).
 * Only a complete colour is passed on; a half-typed one waits.
 */
function ColorPicker({
  id,
  value,
  onValueChange,
  label = "สี",
  swatches = [],
  disabled,
  className,
}: {
  id?: string
  value: string
  onValueChange: (value: string) => void
  /** Names the picker's parts for screen readers, e.g. "สีพื้นหลัง". */
  label?: string
  swatches?: ColorSwatch[]
  disabled?: boolean
  className?: string
}) {
  const [draft, setDraft] = React.useState(value)
  const [hsv, setHsv] = React.useState<Hsv>(
    () => hexToHsv(value) ?? { h: 0, s: 0, v: 0 }
  )
  // The last colour this picker sent out, so its own changes don't reset the
  // hue when the colour comes back as a grey.
  const sent = React.useRef(value.toLowerCase())

  React.useEffect(() => {
    setDraft(value)
    if (value.toLowerCase() === sent.current) return
    sent.current = value.toLowerCase()
    const next = hexToHsv(value)
    if (next) setHsv((current) => (next.s === 0 ? { ...next, h: current.h } : next))
  }, [value])

  const commitHsv = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    sent.current = hex
    setDraft(hex)
    onValueChange(hex)
  }

  const commitHex = (hex: string) => {
    const next = hexToHsv(hex)
    if (!next) return
    commitHsv(next.s === 0 ? { ...next, h: hsv.h } : next)
  }

  const eyeDropper =
    typeof window !== "undefined"
      ? (window as EyeDropperWindow).EyeDropper
      : undefined
  const invalid = !HEX.test(draft)

  return (
    <InputGroup
      data-slot="color-picker"
      data-disabled={disabled}
      className={className}
    >
      <InputGroupAddon>
        <Popover>
          <PopoverTrigger
            disabled={disabled}
            render={
              <button
                type="button"
                aria-label={`เลือก${label}`}
                className="size-6 shrink-0 cursor-pointer rounded-full ring-1 ring-foreground/15 outline-none ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed"
                style={{ background: HEX.test(value) ? value : "transparent" }}
              />
            }
          />
          <PopoverContent align="start" className="w-64 gap-3 p-3">
            <ColorArea
              hsv={hsv}
              onChange={commitHsv}
              label={`ความสดและความสว่างของ${label}`}
            />
            <HueSlider
              hue={hsv.h}
              onChange={(h) => commitHsv({ ...hsv, h })}
              label={`เฉดสีของ${label}`}
            />
            {swatches.length > 0 && (
              <fieldset
                aria-label="สีที่ใช้บ่อย"
                className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
              >
                {swatches.map((swatch) => {
                  const selected =
                    swatch.value.toLowerCase() === value.toLowerCase()
                  return (
                    <button
                      key={swatch.value}
                      type="button"
                      aria-label={swatch.label}
                      aria-pressed={selected}
                      title={swatch.label}
                      onClick={() => commitHex(swatch.value)}
                      className="flex size-7 cursor-pointer items-center justify-center rounded-full ring-1 ring-foreground/15 outline-none ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      style={{ background: swatch.value }}
                    >
                      {selected && (
                        <CheckIcon
                          aria-hidden
                          className="size-3.5 text-white mix-blend-difference"
                        />
                      )}
                    </button>
                  )
                })}
              </fieldset>
            )}
            {eyeDropper && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  new eyeDropper()
                    .open()
                    .then((result) => commitHex(result.sRGBHex))
                    // Escape cancels the eyedropper; nothing to do.
                    .catch(() => {})
                }}
              >
                <PipetteIcon data-icon="inline-start" />
                ดูดสีจากหน้าจอ
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        value={draft}
        maxLength={7}
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={invalid}
        className="font-mono uppercase"
        onChange={(event) => {
          const next = event.target.value.trim()
          setDraft(next)
          if (HEX.test(next)) commitHex(next.toLowerCase())
        }}
        onBlur={() => setDraft(value)}
      />
    </InputGroup>
  )
}

export { ColorPicker, hexToHsv, hsvToHex }
