import { Badge } from "@it3k/ui/components/badge";
import { ColorPicker, type ColorSwatch } from "@it3k/ui/components/color-picker";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@it3k/ui/components/collapsible";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { cn } from "@it3k/ui/lib/utils";
import {
  ChevronDown,
  Circle,
  CircleDot,
  Frame,
  Grid3x3,
  type LucideIcon,
  Maximize2,
  Palette,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Spline,
  Square,
  SquareRoundCorner,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { IconLabel } from "@/components/calendar/icon-label";
import { HelpHint } from "@/components/help-hint";
import {
  DEFAULT_DESIGN,
  EXPORT_SIZES,
  QR_COLORS,
  type DotStyle,
  type Ecc,
  type ExportSize,
  type MarkerShape,
  type QrDesign,
} from "@/lib/qr";

export type Option<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** The full text on hover, when `label` is shortened. */
  title?: string;
};

const DOT_OPTIONS: Option<DotStyle>[] = [
  { value: "square", label: "สี่เหลี่ยม", icon: Grid3x3 },
  { value: "circle", label: "วงกลม", icon: CircleDot },
  { value: "joined", label: "เชื่อมต่อกัน", icon: Spline },
];

const MARKER_OPTIONS: Option<MarkerShape>[] = [
  { value: "square", label: "สี่เหลี่ยม", icon: Square },
  { value: "rounded", label: "มุมมน", icon: SquareRoundCorner },
  { value: "circle", label: "วงกลม", icon: Circle },
];

const ECC_OPTIONS: Option<Ecc>[] = [
  { value: "L", label: "L (กู้คืนได้ 7%)" },
  { value: "M", label: "M (กู้คืนได้ 15%)" },
  { value: "Q", label: "Q (กู้คืนได้ 25%)" },
  { value: "H", label: "H (กู้คืนได้ 30%)" },
].map((option) => ({ ...option, icon: ShieldCheck }) as Option<Ecc>);

const QUIET_ZONE_OPTIONS: Option<string>[] = [4, 6, 8, 10].map((m) => ({
  value: String(m),
  label: `${m} ช่อง`,
  icon: Frame,
}));

const SIZE_OPTIONS: Option<string>[] = EXPORT_SIZES.map((px) => ({
  value: String(px),
  label: `${px} × ${px} px`,
  icon: Maximize2,
}));

/** The defaults first, then dark colours that scan well on white, and a light background. */
export const QR_SWATCHES: ColorSwatch[] = [
  { value: QR_COLORS.dark, label: "ดำ" },
  { value: QR_COLORS.light, label: "ขาว" },
  { value: "#b91c1c", label: "แดงเข้ม" },
  { value: "#1e3a8a", label: "น้ำเงินเข้ม" },
  { value: "#14532d", label: "เขียวเข้ม" },
  { value: "#581c87", label: "ม่วงเข้ม" },
  { value: "#fef3c7", label: "ครีม" },
];

/** A field label with an optional (?) beside it, outside the `<label>`. */
export function LabelRow({
  htmlFor,
  label,
  hint,
}: {
  htmlFor: string;
  label: string;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {hint && <HelpHint label={label}>{hint}</HelpHint>}
    </div>
  );
}

/** A heading with its icon, over one group of fields. */
export function FormSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden className="size-4 shrink-0 text-primary" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function OptionSelect<T extends string>({
  id,
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
  description,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  description?: string;
}) {
  const labelOf = (option: Option<T>) => (
    <IconLabel icon={option.icon} title={option.title}>
      {option.label}
    </IconLabel>
  );
  return (
    <Field data-disabled={disabled}>
      <LabelRow htmlFor={id} label={label} hint={hint} />
      <Select
        // Labels are elements, so the trigger shows the chosen option's icon too.
        items={options.map((option) => ({ value: option.value, label: labelOf(option) }))}
        value={value}
        disabled={disabled}
        onValueChange={(next: T | null) => {
          if (next) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {labelOf(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field>
      <LabelRow htmlFor={id} label={label} hint={hint} />
      <ColorPicker
        id={id}
        label={label}
        value={value}
        onValueChange={onChange}
        swatches={QR_SWATCHES}
      />
    </Field>
  );
}

export function ShapeFields({
  design,
  onChange,
}: {
  design: QrDesign;
  onChange: (patch: Partial<QrDesign>) => void;
}) {
  return (
    <FormSection icon={Shapes} title="รูปทรง">
      <OptionSelect
        id="qr-dot-style"
        label="รูปแบบจุด"
        hint="ทุกแบบสแกนได้ แบบสี่เหลี่ยมอ่านง่ายที่สุดเมื่อพิมพ์เล็กหรือแสงน้อย"
        options={DOT_OPTIONS}
        value={design.dotStyle}
        onChange={(dotStyle) => onChange({ dotStyle })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <OptionSelect
          id="qr-marker-border"
          label="กรอบมุม"
          hint="กรอบของสี่เหลี่ยมใหญ่สามมุม ที่เครื่องสแกนใช้หาตำแหน่ง QR"
          options={MARKER_OPTIONS}
          value={design.markerBorder}
          onChange={(markerBorder) => onChange({ markerBorder })}
        />
        <OptionSelect
          id="qr-marker-center"
          label="จุดกลางมุม"
          options={MARKER_OPTIONS}
          value={design.markerCenter}
          onChange={(markerCenter) => onChange({ markerCenter })}
        />
      </div>
    </FormSection>
  );
}

export function ColorFields({
  design,
  onChange,
}: {
  design: QrDesign;
  onChange: (patch: Partial<QrDesign>) => void;
}) {
  return (
    <FormSection icon={Palette} title="สี">
      <div className="grid gap-4 sm:grid-cols-3">
        <ColorField
          id="qr-dot-color"
          label="สีจุด"
          value={design.dotColor}
          onChange={(dotColor) => onChange({ dotColor })}
        />
        <ColorField
          id="qr-marker-color"
          label="สีมุม"
          value={design.markerColor}
          onChange={(markerColor) => onChange({ markerColor })}
        />
        <ColorField
          id="qr-background"
          label="สีพื้นหลัง"
          hint="ใช้สีอ่อนกว่าจุดและมุมมากๆ ถ้าสีใกล้กันเกินไปจะดาวน์โหลดไม่ได้ เพราะเครื่องสแกนอ่านไม่ออก"
          value={design.background}
          onChange={(background) => onChange({ background })}
        />
      </div>
    </FormSection>
  );
}

/** Settings most people leave alone, folded away like the calendar's optional details. */
export function AdvancedFields({
  design,
  onChange,
  exportSize,
  onExportSizeChange,
}: {
  design: QrDesign;
  onChange: (patch: Partial<QrDesign>) => void;
  exportSize: ExportSize;
  onExportSizeChange: (size: ExportSize) => void;
}) {
  const [open, setOpen] = useState(false);
  const changed =
    (design.quietZone !== DEFAULT_DESIGN.quietZone ? 1 : 0) +
    (!design.logo && design.ecc !== DEFAULT_DESIGN.ecc ? 1 : 0) +
    (exportSize !== EXPORT_SIZES[1] ? 1 : 0);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl border">
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50"
          />
        }
      >
        <SlidersHorizontal aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">ตั้งค่าขั้นสูง (ไม่บังคับ)</span>
        {changed > 0 && <Badge variant="secondary">ปรับแล้ว {changed}</Badge>}
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="grid gap-4 border-t p-3 sm:grid-cols-2">
        <OptionSelect
          id="qr-quiet-zone"
          label="ขอบว่างรอบ QR"
          hint="พื้นที่ว่างรอบ QR ช่วยให้เครื่องสแกนแยก QR ออกจากสิ่งรอบข้าง ต้องมีอย่างน้อย 4 ช่อง"
          options={QUIET_ZONE_OPTIONS}
          value={String(design.quietZone)}
          onChange={(zone) => onChange({ quietZone: Number(zone) })}
        />
        <OptionSelect
          id="qr-ecc"
          label="การกู้คืนข้อมูล"
          hint="ระดับสูงสแกนได้แม้ QR เปื้อนหรือถูกบังบางส่วน แต่ QR จะหนาแน่นขึ้น"
          options={ECC_OPTIONS}
          value={design.logo ? "H" : design.ecc}
          disabled={design.logo !== null}
          onChange={(ecc) => onChange({ ecc })}
          description={design.logo ? "ใช้ระดับ H เสมอเมื่อมีโลโก้" : undefined}
        />
        <OptionSelect
          id="qr-export-size"
          label="ขนาดไฟล์ PNG/JPG"
          hint="SVG เป็นภาพเวกเตอร์ ขยายได้ไม่จำกัด ขนาดนี้ใช้กับ PNG, JPG และการคัดลอกรูป"
          options={SIZE_OPTIONS}
          value={String(exportSize)}
          onChange={(size) => onExportSizeChange(Number(size) as ExportSize)}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
