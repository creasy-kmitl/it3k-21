import { PHOTO_TYPES } from "@it3k/db/profile";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldDescription, FieldError } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { cn } from "@it3k/ui/lib/utils";
import { ImagePlus, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { FileLibrary } from "@/components/file-library";
import { FormLabel } from "@/components/form-dialog";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { publicFileUrl } from "@/lib/files";
import { useMe } from "@/lib/users";

const isPhoto = (type: string) => PHOTO_TYPES.some((allowed) => allowed === type);

/**
 * A picture chosen from (or uploaded to) the file library, with a preview.
 * A link from elsewhere can still be pasted below it.
 */
export function ImageUrlField({
  id,
  label,
  icon,
  value,
  onChange,
  error,
  hint,
  selectTitle,
  fallback,
  className,
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  /** The file library's title while picking. */
  selectTitle: string;
  /** Shown in the preview while there is no picture, such as the generated art. */
  fallback?: ReactNode;
  className?: string;
}) {
  const apis = useApis();
  const me = useMe(apis.users);
  const [picking, setPicking] = useState(false);
  // A broken link shows the fallback instead of a broken image.
  const [failed, setFailed] = useState<string | null>(null);
  const url = value.trim();
  const showImage = url !== "" && failed !== url;

  return (
    <Field data-invalid={!!error} className={className}>
      <FormLabel htmlFor={id} icon={icon}>
        {label}
      </FormLabel>
      <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted">
        {showImage ? (
          <img
            src={url}
            alt={`ตัวอย่าง${label}`}
            className="size-full object-cover"
            onError={() => setFailed(url)}
          />
        ) : (
          (fallback ?? (
            <div className="flex size-full flex-col items-center justify-center gap-1 text-sm text-muted-foreground">
              <ImagePlus className="size-6" aria-hidden />
              {url !== "" ? "โหลดรูปจากลิงก์นี้ไม่ได้" : "ยังไม่มีรูป"}
            </div>
          ))
        )}
      </div>
      <div className={cn("grid gap-2", url !== "" && "grid-cols-2 sm:flex")}>
        <Button
          type="button"
          variant="outline"
          className="h-11 sm:h-9"
          disabled={!me.data}
          onClick={() => setPicking(true)}
        >
          <ImagePlus data-icon="inline-start" aria-hidden />
          {url !== "" ? "เปลี่ยนรูป" : "อัปโหลดหรือเลือกรูป"}
        </Button>
        {url !== "" && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={() => onChange("")}
          >
            <X data-icon="inline-start" aria-hidden />
            เอารูปออก
          </Button>
        )}
      </div>
      <Input
        id={id}
        value={value}
        inputMode="url"
        placeholder="หรือวางลิงก์รูป https://…"
        aria-invalid={!!error}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
      {picking && me.data && (
        <FileLibrary
          userId={me.data.id}
          onClose={() => setPicking(false)}
          selectTitle={selectTitle}
          selectHint="รองรับ JPG, PNG และ WebP ภาพแนวนอน 16:9 จะพอดีที่สุด"
          onSelect={(file) => {
            setPicking(false);
            if (!isPhoto(file.contentType)) {
              toastError(new Error("เลือกได้เฉพาะรูป JPG, PNG และ WebP"));
              return;
            }
            onChange(publicFileUrl(file.id));
          }}
        />
      )}
    </Field>
  );
}
