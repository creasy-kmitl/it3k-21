import { teamOfficialInput } from "@it3k/db/competition-rules";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";
import { Button } from "@it3k/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { BadgeCheck, ImageIcon, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ConfirmDelete,
  FormDialog,
  TextAreaField,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import { ImageUrlField } from "@/components/image-url-field";
import { useApis } from "@/lib/api-context";
import type { TeamOfficial } from "@/lib/competition-teams";
import { toastError } from "@/lib/errors";

type Dialog =
  | { kind: "edit"; official: TeamOfficial | null }
  | { kind: "delete"; official: TeamOfficial };

/** A team's coaches and managers: a name, a position and a picture each. */
export function TeamOfficials({
  teamId,
  officials,
  max,
  canManage,
  onChanged,
}: {
  teamId: string;
  officials: readonly TeamOfficial[];
  max: number;
  canManage: boolean;
  onChanged: () => unknown;
}) {
  const { competitionTeams: api } = useApis();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const remove = useMutation({
    mutationFn: (official: TeamOfficial) => api.removeOfficial(teamId, official.id),
    onSuccess: () => {
      toast.success("ลบเจ้าหน้าที่ทีมแล้ว");
      setDialog(null);
    },
    onError: (error) => toastError(error, "ลบไม่สำเร็จ"),
    onSettled: onChanged,
  });

  return (
    <section aria-labelledby="team-officials-title" className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h3 id="team-officials-title" className="font-medium">
          เจ้าหน้าที่ทีม
          <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">
            {officials.length} / {max}
          </span>
        </h3>
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={officials.length >= max}
            onClick={() => setDialog({ kind: "edit", official: null })}
          >
            <Plus data-icon="inline-start" aria-hidden /> เพิ่ม
          </Button>
        )}
      </header>
      {officials.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีเจ้าหน้าที่ทีม</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {officials.map((official) => (
            <li key={official.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar className="size-10">
                {official.photoUrl && <AvatarImage src={official.photoUrl} alt="" />}
                <AvatarFallback>
                  <UserRound className="size-4" aria-hidden />
                </AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{official.name}</span>
                {(official.position || official.description) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {[official.position, official.description].filter(Boolean).join(" · ")}
                  </span>
                )}
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`แก้ไข ${official.name}`}
                    onClick={() => setDialog({ kind: "edit", official })}
                  >
                    <Pencil aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`ลบ ${official.name}`}
                    onClick={() => setDialog({ kind: "delete", official })}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog?.kind === "edit" && (
        <OfficialDialog
          teamId={teamId}
          official={dialog.official}
          sortOrder={officials.length}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            onChanged();
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDelete
          name={dialog.official.name}
          description="เจ้าหน้าที่คนนี้จะหายจากทีม"
          pending={remove.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => remove.mutate(dialog.official)}
        />
      )}
    </section>
  );
}

function OfficialDialog({
  teamId,
  official,
  sortOrder,
  onClose,
  onSaved,
}: {
  teamId: string;
  official: TeamOfficial | null;
  sortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { competitionTeams: api } = useApis();
  const [name, setName] = useState(official?.name ?? "");
  const [position, setPosition] = useState(official?.position ?? "");
  const [description, setDescription] = useState(official?.description ?? "");
  const [photoUrl, setPhotoUrl] = useState(official?.photoUrl ?? "");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const parsed = teamOfficialInput.safeParse({
        name,
        position: position.trim() || null,
        description: description.trim() || null,
        photoUrl: photoUrl.trim() || null,
        sortOrder: official?.sortOrder ?? sortOrder,
      });
      if (!parsed.success) {
        setIssues(issuesOf(parsed.error));
        return null;
      }
      return official
        ? api.updateOfficial(teamId, official.id, parsed.data)
        : api.addOfficial(teamId, parsed.data);
    },
    onSuccess: (result) => {
      if (!result) return;
      toast.success("บันทึกแล้ว");
      onSaved();
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
  });

  return (
    <FormDialog
      title={official ? "แก้ไขเจ้าหน้าที่ทีม" : "เพิ่มเจ้าหน้าที่ทีม"}
      icon={BadgeCheck}
      pending={save.isPending}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <TextField
        id="official-name"
        label="ชื่อ-นามสกุล"
        value={name}
        onChange={setName}
        error={issues.name}
        maxLength={100}
        autoFocus
      />
      <TextField
        id="official-position"
        label="ตำแหน่ง"
        value={position}
        onChange={setPosition}
        error={issues.position}
        hint="เช่น ผู้ฝึกสอน ผู้จัดการทีม"
        maxLength={60}
      />
      <TextAreaField
        id="official-description"
        label="รายละเอียด"
        value={description}
        onChange={setDescription}
        error={issues.description}
      />
      <ImageUrlField
        id="official-photo"
        label="รูปภาพ"
        icon={ImageIcon}
        value={photoUrl}
        onChange={setPhotoUrl}
        error={issues.photoUrl}
        selectTitle="เลือกรูปเจ้าหน้าที่ทีม"
      />
    </FormDialog>
  );
}
