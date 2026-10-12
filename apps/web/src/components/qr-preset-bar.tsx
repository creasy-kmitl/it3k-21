import { Button } from "@it3k/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@it3k/ui/components/popover";
import { Spinner } from "@it3k/ui/components/spinner";
import { PRESET_NAME_MAX, type PresetDesign } from "@it3k/db/qr-preset-rules";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Palette, PencilLine, Save, Sparkles, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { FormSection, type Option, OptionSelect } from "@/components/qr-design-form";
import { useApis } from "@/lib/api-context";
import { type QrPreset, samePresetDesign } from "@/lib/qr-presets";

const CUSTOM = "__custom__";

/** Asks for a name, then saves. */
function SaveAsNew({ onSave, saving }: { onSave: (name: string) => void; saving: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim());
    setOpen(false);
    setName("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <BookmarkPlus data-icon="inline-start" />
        บันทึกเป็น preset
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="qr-preset-name">ชื่อ preset</FieldLabel>
            <Input
              id="qr-preset-name"
              value={name}
              maxLength={PRESET_NAME_MAX}
              placeholder="เช่น โปสเตอร์ PR"
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription>ทุกคนในทีมเลือกใช้ได้ รวมถึงโลโก้ที่ใส่อยู่</FieldDescription>
          </Field>
          <Button type="submit" size="sm" disabled={!name.trim() || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
            บันทึก
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The team's saved QR designs: pick one to apply it, save the current design
 * as a new one, or update or delete one you may edit. The select shows the
 * preset the current design matches, so it never claims a preset that has
 * since been changed.
 */
export function QrPresetBar({
  current,
  onApply,
}: {
  current: PresetDesign;
  onApply: (preset: QrPreset) => void;
}) {
  const { qrPresets } = useApis();
  const queryClient = useQueryClient();
  // The preset last applied or saved, so it can be updated after tweaks.
  const [baseId, setBaseId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const list = useQuery({ queryKey: ["qr-presets"], queryFn: () => qrPresets.list() });
  const presets = list.data?.items ?? [];
  const matching = presets.find((preset) => samePresetDesign(preset.design, current));
  const base = presets.find((preset) => preset.id === baseId) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["qr-presets"] });
  const failed = (error: Error) => toast.error(`บันทึก preset ไม่สำเร็จ: ${error.message}`);

  const create = useMutation({
    mutationFn: (name: string) => qrPresets.create({ name, design: current }),
    onSuccess: async (preset) => {
      setBaseId(preset.id);
      toast.success(`บันทึก preset “${preset.name}” แล้ว`);
      await refresh();
    },
    onError: failed,
  });
  const update = useMutation({
    mutationFn: (preset: QrPreset) => qrPresets.update(preset.id, { design: current }),
    onSuccess: async (preset) => {
      toast.success(`อัปเดต “${preset.name}” แล้ว`);
      await refresh();
    },
    onError: failed,
  });
  const remove = useMutation({
    mutationFn: (preset: QrPreset) => qrPresets.remove(preset.id),
    onSuccess: async (_done, preset) => {
      setBaseId(null);
      setConfirmingDelete(false);
      toast.success(`ลบ “${preset.name}” แล้ว`);
      await refresh();
    },
    onError: (error) => toast.error(`ลบ preset ไม่สำเร็จ: ${error.message}`),
  });

  const options: Option<string>[] = [
    ...(matching
      ? []
      : [{ value: CUSTOM, label: "ดีไซน์ที่ปรับเอง", icon: PencilLine } as Option<string>]),
    ...presets.map((preset) => ({ value: preset.id, label: preset.name, icon: Palette })),
  ];
  const canCreate = list.data?.canCreate ?? false;

  return (
    <FormSection icon={Sparkles} title="Preset ของทีม">
      {presets.length > 0 ? (
        <OptionSelect
          id="qr-preset"
          label="ใช้ดีไซน์ที่ทีมบันทึกไว้"
          hint="เลือกแล้วรูปทรง สี โลโก้ และขนาดไฟล์จะเปลี่ยนตาม preset ทันที ปรับต่อได้ตามสบาย"
          options={options}
          value={matching?.id ?? CUSTOM}
          onChange={(id) => {
            const preset = presets.find((candidate) => candidate.id === id);
            if (!preset) return;
            setBaseId(preset.id);
            setConfirmingDelete(false);
            onApply(preset);
          }}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {list.isPending ? "กำลังโหลด preset…" : "ยังไม่มี preset บันทึกดีไซน์นี้ไว้ให้ทั้งทีมใช้ซ้ำได้"}
        </p>
      )}
      {canCreate && (
        <div className="flex flex-wrap gap-2">
          <SaveAsNew onSave={(name) => create.mutate(name)} saving={create.isPending} />
          {base?.canEdit && !samePresetDesign(base.design, current) && (
            <Button
              variant="outline"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate(base)}
            >
              {update.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              บันทึกทับ “{base.name}”
            </Button>
          )}
          {matching?.canEdit && (
            <Button
              variant={confirmingDelete ? "destructive" : "ghost"}
              size="sm"
              disabled={remove.isPending}
              onClick={() =>
                confirmingDelete ? remove.mutate(matching) : setConfirmingDelete(true)
              }
              onBlur={() => setConfirmingDelete(false)}
            >
              <Trash2 data-icon="inline-start" />
              {confirmingDelete ? `กดอีกครั้งเพื่อลบ “${matching.name}”` : "ลบ preset"}
            </Button>
          )}
        </div>
      )}
    </FormSection>
  );
}
