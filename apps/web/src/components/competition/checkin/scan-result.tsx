import { INSTITUTIONS } from "@it3k/db/profile";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, CircleX, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { RESULT_MS } from "@/components/checkin/scan-checkin";
import { useApis } from "@/lib/api-context";
import { formatBangkok } from "@/lib/bangkok-time";
import type { ScanOutcome } from "@/lib/competition-checkins";
import { createScanGate } from "@/lib/kiosk";

import { matchTitle } from "./match-checkin-card";

const SAME_CODE_MS = 5000;

/** The query key of one match's check-in state, shared by its page and its kiosk. */
export const matchCheckinKey = (matchId: string) =>
  ["competition-checkins", "match", matchId] as const;

/**
 * Scanning at a match's kiosk: codes from the camera or the box become
 * check-ins, the same badge twice in a row is ignored, and the latest result
 * stays until it clears itself.
 */
export function useMatchScan(matchId: string) {
  const { competitionCheckins: api } = useApis();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [gate] = useState(() => createScanGate(SAME_CODE_MS));

  const scan = useMutation({
    mutationFn: (code: string) => api.scan(matchId, code),
    onSuccess: (result) => {
      setFailure(null);
      setOutcome(result);
    },
    onError: (error) => {
      setOutcome(null);
      setFailure(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: matchCheckinKey(matchId) }),
  });

  // The camera loop calls the latest version without restarting the camera.
  const pending = scan.isPending;
  const onCode = useRef<(code: string) => void>(() => {});
  onCode.current = (raw: string) => {
    if (pending) return;
    const code = gate(raw);
    if (code) scan.mutate(code);
  };
  const handleCode = useCallback((code: string) => onCode.current(code), []);

  useEffect(() => {
    if (!outcome && !failure) return;
    const timer = setTimeout(() => {
      setOutcome(null);
      setFailure(null);
    }, RESULT_MS);
    return () => clearTimeout(timer);
  }, [outcome, failure]);

  const clear = useCallback(() => {
    setOutcome(null);
    setFailure(null);
  }, []);

  return { outcome, failure, pending, handleCode, clear };
}

const TONES = {
  success: "bg-emerald-600 text-white",
  warning: "bg-amber-500 text-black",
  error: "bg-destructive text-white",
} as const;

/** How to show a scan: its colour, icon, headline and the lines under it. */
export function describeScan(outcome: ScanOutcome | null, failure: string | null) {
  const tone =
    outcome?.code === "checked-in"
      ? "success"
      : outcome?.code === "duplicate"
        ? "warning"
        : "error";
  const icon: LucideIcon =
    tone === "success" ? CircleCheck : tone === "warning" ? CircleAlert : CircleX;
  let title = failure ?? "";
  if (outcome && "side" in outcome) {
    title =
      outcome.code === "checked-in"
        ? "รายงานตัวสำเร็จ"
        : `รายงานตัวไปแล้วเมื่อ ${formatBangkok(Date.parse(outcome.checkedInAt), "time")}`;
  } else if (outcome) {
    title = outcome.opensAt
      ? `${outcome.message} (เปิด ${formatBangkok(Date.parse(outcome.opensAt), "time")})`
      : outcome.message;
  }
  const person = outcome && "person" in outcome ? (outcome.person ?? null) : null;
  const match = outcome && "match" in outcome ? (outcome.match ?? null) : null;
  const institution = INSTITUTIONS.find((item) => item.id === person?.institution)?.short;
  const name = person
    ? [person.shirtNumber !== null ? `#${person.shirtNumber}` : null, person.name]
        .filter(Boolean)
        .join(" ")
    : null;
  const side = outcome && "side" in outcome ? outcome.side : null;
  return {
    tone,
    toneClass: TONES[tone],
    icon,
    title,
    person,
    name,
    institution,
    matchLine: match ? matchTitle(match) : null,
    countLine: side ? `${side.label} รายงานตัวแล้ว ${side.checkedIn} / ${side.min} คน` : null,
  };
}

/** A React key per result, so each new result mounts fresh instead of shifting text. */
export const scanKey = (outcome: ScanOutcome | null, failure: string | null) =>
  outcome
    ? `${outcome.code}:${"person" in outcome ? (outcome.person?.userId ?? "") : ""}`
    : `failure:${failure}`;

/** The result, filling the screen so athletes can read it from afar. */
export function ScanResult({
  outcome,
  failure,
  onDismiss,
}: {
  outcome: ScanOutcome | null;
  failure: string | null;
  onDismiss: () => void;
}) {
  const {
    toneClass,
    icon: Icon,
    title,
    person,
    name,
    institution,
    matchLine,
    countLine,
  } = describeScan(outcome, failure);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      className={cn(
        "fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center",
        toneClass,
      )}
      onClick={onDismiss}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "Enter") onDismiss();
      }}
    >
      <Icon className="size-24 wide:size-32 wide-xl:size-40" aria-hidden />
      <p className="text-3xl font-semibold text-balance md:text-5xl wide-xl:text-7xl">{title}</p>
      {person && (
        <div className="flex flex-col items-center gap-2 wide-xl:gap-4">
          {person.image && (
            <img
              src={person.image}
              alt=""
              className="size-24 rounded-full border-4 border-white/70 object-cover wide:size-32 wide-xl:size-44"
            />
          )}
          <p className="text-2xl md:text-4xl wide-xl:text-6xl">
            {name}
            {institution && <span className="opacity-80"> · {institution}</span>}
          </p>
        </div>
      )}
      {matchLine && <p className="text-lg opacity-90 wide-xl:text-2xl">{matchLine}</p>}
      {countLine && (
        <p className="rounded-full bg-black/15 px-4 py-1 text-xl font-medium wide-xl:text-3xl">
          {countLine}
        </p>
      )}
      <p className="text-sm opacity-80 wide-xl:text-lg">แตะเพื่อสแกนคนถัดไป</p>
    </div>
  );
}
