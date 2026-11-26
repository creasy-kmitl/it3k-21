import { LINEUP_ROLE_LABELS } from "@it3k/db/competition-rules";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@it3k/ui/components/alert-dialog";
import { Badge } from "@it3k/ui/components/badge";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { cn } from "@it3k/ui/lib/utils";
import { Flag, ScanLine, UserCheck } from "lucide-react";

import { LoadingButton } from "@/components/loading-button";
import { formatBangkok } from "@/lib/bangkok-time";
import type { RosterEntry, RosterSide } from "@/lib/competition-checkins";

import { SideCount } from "./match-checkin-card";

const METHOD_LABELS = { scan: "สแกน", manual: "เจ้าหน้าที่" } as const;

/** A side's players with a tick each; ticking checks them in by hand. */
export function SideRoster({
  side,
  min,
  canCheckIn,
  busyUserId,
  onToggle,
}: {
  side: RosterSide;
  min: number;
  canCheckIn: boolean;
  /** The player whose tick is being saved. */
  busyUserId: string | null;
  onToggle: (entry: RosterEntry, checked: boolean) => void;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={side.label}>
      <SideCount side={side} min={min} />
      {side.roster.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          ยังไม่มีรายชื่อนักกีฬาในทีมนี้
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {side.roster.map((entry) => {
            const id = `checkin-${side.participantId}-${entry.userId}`;
            return (
              <li key={entry.userId} className="flex items-center gap-3 px-3 py-2.5">
                <Checkbox
                  id={id}
                  checked={!!entry.checkin}
                  disabled={!canCheckIn || busyUserId === entry.userId}
                  onCheckedChange={(checked) => onToggle(entry, checked === true)}
                  className="size-5"
                />
                <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col">
                  <span
                    className={cn("truncate font-medium", !entry.listed && "text-muted-foreground")}
                  >
                    {entry.shirtNumber !== null && (
                      <span className="tabular-nums text-muted-foreground">
                        #{entry.shirtNumber}{" "}
                      </span>
                    )}
                    {entry.displayName}
                  </span>
                  {entry.checkin && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {entry.checkin.method === "scan" ? (
                        <ScanLine className="size-3" aria-hidden />
                      ) : (
                        <UserCheck className="size-3" aria-hidden />
                      )}
                      {formatBangkok(Date.parse(entry.checkin.at), "time")} ·{" "}
                      {METHOD_LABELS[entry.checkin.method]}
                      {entry.checkin.by &&
                        entry.checkin.method === "manual" &&
                        ` (${entry.checkin.by})`}
                    </span>
                  )}
                </label>
                {entry.role && <Badge variant="outline">{LINEUP_ROLE_LABELS[entry.role]}</Badge>}
                {!entry.listed && <Badge variant="secondary">ไม่อยู่ในรายชื่อแล้ว</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Asks before forfeiting the sides short of the minimum. */
export function ConfirmForfeit({
  sides,
  totalSides,
  min,
  pending,
  onClose,
  onConfirm,
}: {
  sides: Pick<RosterSide, "participantId" | "label" | "checkedIn">[];
  /** Every side in the match, forfeiting or not. */
  totalSides: number;
  min: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const names = sides.map((side) => side.label).join(" และ ");
  const remaining = totalSides - sides.length;
  const result =
    remaining === 1
      ? "อีกฝั่งชนะผ่าน และแมตช์จบทันที"
      : remaining === 0
        ? "ไม่มีผู้ชนะ และแมตช์จบทันที"
        : "ฝั่งที่เหลือแข่งต่อตามปกติ";
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>ปรับแพ้ {names}?</AlertDialogTitle>
          <AlertDialogDescription>
            {sides
              .map((side) => `${side.label} รายงานตัว ${side.checkedIn} จากขั้นต่ำ ${min} คน`)
              .join(", ")}
            . {result} ย้อนกลับจากหน้านี้ไม่ได้
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ยกเลิก</AlertDialogCancel>
          <LoadingButton variant="destructive" icon={Flag} loading={pending} onClick={onConfirm}>
            ยืนยันปรับแพ้
          </LoadingButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
