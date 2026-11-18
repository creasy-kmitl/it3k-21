// Small form pieces shared by the staff catalog pages (sports, venues, events).
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
} from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Textarea } from "@it3k/ui/components/textarea";
import { cn } from "@it3k/ui/lib/utils";
import { type LucideIcon, Save } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { z } from "zod";

import { IconLabel } from "./calendar/icon-label";
import { LoadingButton } from "./loading-button";

const LABEL_ICON = "items-center [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";

/** A field label with its icon in front, as in the calendar and participant forms. */
export function FormLabel({
  htmlFor,
  icon: Icon,
  className,
  children,
}: {
  htmlFor: string;
  icon?: LucideIcon;
  className?: string;
  children: ReactNode;
}) {
  return (
    <FieldLabel htmlFor={htmlFor} className={cn(LABEL_ICON, className)}>
      {Icon && <Icon aria-hidden />}
      {children}
    </FieldLabel>
  );
}

/** A group legend with its icon in front, for sets of checkboxes. */
export function FormLegend({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <FieldLegend variant="label" className={cn("flex gap-2", LABEL_ICON)}>
      {Icon && <Icon aria-hidden />}
      {children}
    </FieldLegend>
  );
}

export function ConfirmDelete({
  name,
  description,
  pending,
  onClose,
  onConfirm,
}: {
  name: string;
  description: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ลบ {name}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <LoadingButton variant="destructive" loading={pending} onClick={onConfirm}>
            ลบ
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The first message per field, keyed by the field's name. */
export function issuesOf(error: z.ZodError) {
  const issues: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    issues[key] ??= issue.message;
  }
  return issues;
}

export function FormDialog({
  title,
  icon: Icon,
  description,
  pending,
  onClose,
  onSubmit,
  submitLabel = "บันทึก",
  submitIcon = Save,
  children,
}: {
  title: string;
  /** Shown before the title, as the calendar's side panel does. */
  icon?: LucideIcon;
  description?: string;
  submitLabel?: string;
  submitIcon?: LucideIcon;
  pending: boolean;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {Icon && <Icon aria-hidden className="size-5 shrink-0 text-primary" />}
              {title}
            </DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <FieldGroup>{children}</FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton type="submit" icon={submitIcon} loading={pending}>
              {submitLabel}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TextField({
  id,
  label,
  icon,
  value,
  onChange,
  error,
  hint,
  ...props
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
} & Omit<ComponentProps<"input">, "value" | "onChange" | "id">) {
  return (
    <Field data-invalid={!!error}>
      <FormLabel htmlFor={id} icon={icon}>
        {label}
      </FormLabel>
      <Input
        id={id}
        value={value}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function TextAreaField({
  id,
  label,
  icon,
  value,
  onChange,
  error,
  hint,
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <Field data-invalid={!!error}>
      <FormLabel htmlFor={id} icon={icon}>
        {label}
      </FormLabel>
      <Textarea
        id={id}
        value={value}
        aria-invalid={!!error}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export type Choice<T extends string> = {
  value: T;
  label: string;
  /** Shown before the label, in the list and on the closed select. */
  icon?: LucideIcon | null;
  /** Replaces the icon and label, e.g. for a picture. */
  content?: ReactNode;
};

export function ChoiceField<T extends string>({
  id,
  label,
  icon,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
}) {
  const labelOf = (option: Choice<T>) =>
    option.content ?? <IconLabel icon={option.icon}>{option.label}</IconLabel>;
  return (
    <Field>
      <FormLabel htmlFor={id} icon={icon}>
        {label}
      </FormLabel>
      <Select
        // Labels are elements, so the closed select shows the chosen option's icon too.
        items={options.map((option) => ({ value: option.value, label: labelOf(option) }))}
        value={value}
        onValueChange={(next: T | null) => next && onChange(next)}
      >
        <SelectTrigger id={id} aria-label={label} className="w-full">
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
    </Field>
  );
}
