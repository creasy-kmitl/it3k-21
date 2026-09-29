import { createFileRoute } from "@tanstack/react-router";
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
import { Card, CardContent, CardHeader, CardTitle } from "@it3k/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { LeadershipApi, LeadershipDepartment, LeadershipSummary } from "@/lib/leadership";

import LeadershipContactButton from "@/components/leadership-contact";
import LeadershipDirectory from "@/components/leadership-directory";
import LeadershipForm, { type FormMode } from "@/components/leadership-form";
import { useApis } from "@/lib/api-context";

export const Route = createFileRoute("/staff/head")({
  component: HeadPage,
});

/**
 * The directory plus the controls the server allows on each seat. The flags
 * only decide what to show; the API enforces the same rules.
 */
function HeadPage() {
  const { leadership: api } = useApis();
  const [editing, setEditing] = useState<FormMode | null>(null);

  const renderActions = useCallback(
    (seat: LeadershipSummary, department?: LeadershipDepartment) => (
      <>
        <LeadershipContactButton seat={seat} department={department} api={api} />
        {seat.canEdit && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`แก้ไข ${seat.displayName}`}
            // Only managers may delete, so canDelete doubles as "can edit every field".
            onClick={() => setEditing({ kind: "edit", seat, selfOnly: !seat.canDelete })}
          >
            <Pencil />
          </Button>
        )}
        {seat.canDelete && <DeleteSeatButton seat={seat} api={api} />}
      </>
    ),
    [api],
  );

  return (
    <LeadershipDirectory
      api={api}
      renderActions={renderActions}
      createAction={
        <Button onClick={() => setEditing({ kind: "create" })}>
          <Plus /> เพิ่มตำแหน่ง
        </Button>
      }
      panel={
        editing && (
          <Card>
            <CardHeader>
              <CardTitle>
                {editing.kind === "create" ? "เพิ่มตำแหน่ง" : `แก้ไข ${editing.seat.displayName}`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <LeadershipForm
                key={editing.kind === "create" ? "create" : editing.seat.id}
                mode={editing}
                api={api}
                onCancel={() => setEditing(null)}
                onDone={() => {
                  toast.success("บันทึกแล้ว");
                  setEditing(null);
                }}
              />
            </CardContent>
          </Card>
        )
      }
    />
  );
}

function DeleteSeatButton({ seat, api }: { seat: LeadershipSummary; api: LeadershipApi }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const remove = useMutation({
    mutationFn: () => api.remove(seat.id),
    onSuccess: async () => {
      setOpen(false);
      toast.success("ลบแล้ว");
      await queryClient.invalidateQueries({ queryKey: ["leadership", "list"] });
    },
    onError: (error) => toast.error(`ลบไม่สำเร็จ: ${error.message}`),
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`ลบ ${seat.displayName}`}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="text-destructive" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ลบ {seat.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            ตำแหน่งและช่องทางติดต่อของตำแหน่งนี้จะถูกลบ บัญชีผู้ใช้จะไม่ถูกลบ
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            ลบ
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
