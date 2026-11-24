import type { University } from "@it3k/db/match-rules";
import { cn } from "@it3k/ui/lib/utils";

import { universityLabel } from "@/lib/matches";

const TEAM_LOGO: Record<University, string> = {
  kmutt: "/institutions/kmutt.png",
  kmutnb: "/institutions/kmutnb.png",
  kmitl: "/institutions/kmitl.png",
};

export function TeamChip({ team, size = "sm" }: { team: University; size?: "sm" | "lg" }) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-full bg-white",
        size === "sm" && "size-9",
        size === "lg" && "size-14",
      )}
    >
      <img src={TEAM_LOGO[team]} alt={universityLabel(team)} className="size-full object-contain" />
    </div>
  );
}
