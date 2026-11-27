import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flag, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { useApis } from "@/lib/api-context";
import type { RosterEntry, RosterSide } from "@/lib/competition-checkins";
import { toastError } from "@/lib/errors";

import { windowLabel } from "./match-checkin-card";
import { ConfirmForfeit, SideRoster } from "./match-roster";
import { matchCheckinKey } from "./scan-result";

/** How often the page refreshes counts while staff and the kiosk work side by side. */
const REFRESH_MS = 15_000;

/**
 * One match's check-in on its staff page: each side's players to tick in by
 * hand (esports over Discord, or anyone the kiosk missed), the way to the
 * match's kiosk, and forfeiting a side still short once check-in has closed.
 */
export function MatchCheckinPanel({ matchId }: { matchId: string }) {
  const { competitionCheckins: api } = useApis();
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: matchCheckinKey(matchId),
    queryFn: () => api.match(matchId),
    refetchInterval: REFRESH_MS,
  });
  const [confirming, setConfirming] = useState<RosterSide[] | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: matchCheckinKey(matchId) }),
      // A forfeit changes the match itself.
      queryClient.invalidateQueries({ queryKey: ["competition-matches"] }),
    ]);

  const toggle = useMutation({
    mutationFn: ({
      side,
      entry,
      checked,
    }: {
      side: RosterSide;
      entry: RosterEntry;
      checked: boolean;
    }) =>
      checked
        ? api.checkIn(matchId, side.participantId, entry.userId)
        : api.undo(matchId, entry.userId),
    onError: (error) => toastError(error, "บันทึกการเช็คอินไม่สำเร็จ"),
    onSettled: refresh,
  });

  const forfeit = useMutation({
    mutationFn: ({ sides, version }: { sides: RosterSide[]; version: number }) =>
      api.forfeit(
        matchId,
        sides.map((side) => side.participantId),
        version,
      ),
    onSuccess: () => {
      toast.success("ปรับแพ้แล้ว");
      setConfirming(null);
    },
    onError: (error) => toastError(error, "ปรับแพ้ไม่สำเร็จ"),
    onSettled: refresh,
  });

  if (detail.isPending) {
    return (
      <div role="status" className="flex flex-col gap-3">
        <span className="sr-only">กำลังโหลด</span>
        <Skeleton className="h-5 w-64 max-w-full" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }
  if (detail.isError && !detail.data) {
    return (
      <ErrorState
        error={detail.error}
        onRetry={() => detail.refetch()}
        title="โหลดการรายงานตัวไม่สำเร็จ"
        size="sm"
      />
    );
  }
  const { match, canCheckIn, canForfeit } = detail.data;
  const short = match.sides.filter((side) => side.checkedIn < match.minPlayers);
  const kiosk = match.checkinMode === "kiosk";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {[windowLabel(match.window), `ขั้นต่ำ ${match.minPlayers} คนต่อฝั่ง`].join(" · ")}
        </p>
        {kiosk && canCheckIn && (
          <Button
            size="sm"
            variant="secondary"
            render={<Link to="/kiosk/matches/$matchId" params={{ matchId }} />}
            nativeButton={false}
          >
            <MonitorSmartphone data-icon="inline-start" aria-hidden /> เปิด kiosk
          </Button>
        )}
      </div>
      {!kiosk && (
        <p className="text-sm text-muted-foreground">
          ประเภทนี้รายงานตัวผ่าน Discord: ติ๊กชื่อนักกีฬาที่รายงานตัวแล้ว
        </p>
      )}
      {!canCheckIn && (
        <p className="text-sm text-muted-foreground">แมตช์นี้เริ่มแข่ง จบ หรือยกเลิกแล้ว</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {match.sides.map((side) => (
          <SideRoster
            key={side.participantId}
            side={side}
            min={match.minPlayers}
            canCheckIn={canCheckIn}
            busyUserId={toggle.isPending ? (toggle.variables?.entry.userId ?? null) : null}
            onToggle={(entry, checked) => toggle.mutate({ side, entry, checked })}
          />
        ))}
      </div>

      {canForfeit && short.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-destructive/40 p-4">
          <p className="text-sm">
            ปิดรายงานตัวแล้ว {short.map((side) => side.label).join(" และ ")} ยังมีผู้เล่นไม่ครบ
          </p>
          <div className="flex flex-wrap gap-2">
            {short.map((side) => (
              <Button
                key={side.participantId}
                variant="destructive"
                onClick={() => setConfirming([side])}
              >
                <Flag data-icon="inline-start" aria-hidden /> ปรับแพ้ {side.label}
              </Button>
            ))}
            {short.length > 1 && (
              <Button variant="outline" onClick={() => setConfirming(short)}>
                ปรับแพ้ทุกฝั่งที่ไม่ครบ
              </Button>
            )}
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmForfeit
          sides={confirming}
          totalSides={match.sides.length}
          min={match.minPlayers}
          pending={forfeit.isPending}
          onClose={() => setConfirming(null)}
          onConfirm={() => forfeit.mutate({ sides: confirming, version: match.version })}
        />
      )}
    </div>
  );
}
