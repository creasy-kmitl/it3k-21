import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";

import type { ScoreboardPlayer } from "@/lib/competition-scores";

/** Big shirt-number buttons for who scored; "ไม่ระบุ" scores without a name. */
export function PlayerPicker({
  open,
  title,
  players,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  players: ScoreboardPlayer[];
  onPick: (registrationId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>เลือกเบอร์เสื้อของผู้ทำแต้ม</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {players.map((player) => (
            <Button
              key={player.registrationId}
              variant={player.role === "sub" ? "outline" : "secondary"}
              className="h-auto flex-col gap-0.5 rounded-2xl py-3"
              onClick={() => onPick(player.registrationId)}
            >
              <span className="text-2xl font-semibold tabular-nums">
                {player.shirtNumber ?? "–"}
              </span>
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {player.displayName}
              </span>
            </Button>
          ))}
          <Button variant="ghost" className="h-auto rounded-2xl py-3" onClick={() => onPick(null)}>
            ไม่ระบุ
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
