// Finishing a match, and results without play (walkover, forfeit, no contest,
// or ranks typed in by hand).
import { MATCH_OUTCOME_LABELS, type ParticipantOutcome } from "@it3k/db/competition-rules";
import { outcomeFor } from "@it3k/db/scoring/shared";
import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Input } from "@it3k/ui/components/input";
import { Flag, Save } from "lucide-react";
import { useState } from "react";

import { LoadingButton } from "@/components/loading-button";
import type { MatchResultBody, ScoreboardSide } from "@/lib/competition-scores";

export function FinishDialog({
  open,
  onOpenChange,
  decided,
  pending,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  decided: boolean;
  pending: number;
  loading: boolean;
  onConfirm: (force: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>จบแมตช์</DialogTitle>
          <DialogDescription>
            {decided
              ? "ผลตามกติกาครบแล้ว เมื่อยืนยัน ผลนี้จะแสดงในหน้าสาธารณะและตารางคะแนน"
              : "ตามกติกายังไม่มีผลแพ้ชนะ ถ้าจบตอนนี้ ระบบจะจัดอันดับตามคะแนนที่มีอยู่"}
          </DialogDescription>
        </DialogHeader>
        {pending > 0 && (
          <p role="alert" className="text-sm text-destructive">
            ยังมี {pending} รายการที่ส่งไม่ถึงเซิร์ฟเวอร์ รอให้ส่งครบก่อนจบแมตช์
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            กลับไปใส่คะแนน
          </Button>
          <LoadingButton
            icon={Flag}
            loading={loading}
            disabled={pending > 0}
            variant={decided ? "default" : "destructive"}
            onClick={() => onConfirm(!decided)}
          >
            {decided ? "ยืนยันจบแมตช์" : "จบตามคะแนนตอนนี้"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Kind = MatchResultBody["outcome"];
const KINDS: Kind[] = ["walkover", "forfeit", "no_contest", "played"];

/** The ranks body for a result kind, from a winner or typed-in ranks. */
export function resultRanks(
  kind: Kind,
  sides: { id: string }[],
  winner: string | null,
  typed: Record<string, number | null>,
): MatchResultBody["ranks"] {
  if (kind === "no_contest") {
    return sides.map((s) => ({ participantId: s.id, rank: null, outcome: null }));
  }
  if (kind === "played") {
    const ranks = sides.map((s) => typed[s.id] ?? null);
    return sides.map((s, i) => ({
      participantId: s.id,
      rank: ranks[i] ?? null,
      outcome: ranks[i] == null ? null : outcomeFor(ranks[i] ?? null, ranks),
    }));
  }
  const won: ParticipantOutcome = kind === "walkover" ? "walkover_win" : "win";
  return sides.map((s) => ({
    participantId: s.id,
    rank: s.id === winner ? 1 : 2,
    outcome: s.id === winner ? won : "forfeit",
  }));
}

export function ResultDialog({
  open,
  onOpenChange,
  sides,
  loading,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sides: ScoreboardSide[];
  loading: boolean;
  onSave: (outcome: Kind, ranks: MatchResultBody["ranks"]) => void;
}) {
  const [kind, setKind] = useState<Kind>("walkover");
  const [winner, setWinner] = useState<string | null>(null);
  const [typed, setTyped] = useState<Record<string, number | null>>({});
  const needsWinner = kind === "walkover" || kind === "forfeit";
  const ready = needsWinner
    ? winner !== null
    : kind === "no_contest" || sides.every((s) => typed[s.id] != null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกผลพิเศษ</DialogTitle>
          <DialogDescription>ใช้เมื่อไม่ได้แข่งตามปกติ หรือต้องแก้ผลที่บันทึกไปแล้ว</DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">ผลการแข่งขัน</legend>
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map((item) => (
              <Button
                key={item}
                variant={item === kind ? "default" : "outline"}
                aria-pressed={item === kind}
                onClick={() => setKind(item)}
              >
                {MATCH_OUTCOME_LABELS[item]}
              </Button>
            ))}
          </div>
        </fieldset>
        {needsWinner && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">ฝ่ายที่ชนะ</legend>
            {sides.map((side) => (
              <Button
                key={side.id}
                variant={winner === side.id ? "default" : "outline"}
                aria-pressed={winner === side.id}
                onClick={() => setWinner(side.id)}
              >
                {side.name}
              </Button>
            ))}
          </fieldset>
        )}
        {kind === "played" && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">อันดับของแต่ละฝ่าย</legend>
            {sides.map((side) => (
              <div key={side.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate" aria-hidden>
                  {side.name}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={64}
                  className="w-20"
                  aria-label={`อันดับของ ${side.name}`}
                  value={typed[side.id] ?? ""}
                  onChange={(event) =>
                    setTyped((prev) => ({
                      ...prev,
                      [side.id]: event.target.value === "" ? null : Number(event.target.value),
                    }))
                  }
                />
              </div>
            ))}
          </fieldset>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <LoadingButton
            icon={Save}
            loading={loading}
            disabled={!ready}
            onClick={() => onSave(kind, resultRanks(kind, sides, winner, typed))}
          >
            บันทึกผล
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
