import type { University } from "@it3k/db/match-rules";
import { cn } from "@it3k/ui/lib/utils";

import { universityLabel } from "@/lib/matches";

const TEAM_COLOR: Record<University, string> = {
  kmutt: "bg-blue-600",
  kmutnb: "bg-red-700",
  kmitl: "bg-orange-500",
};

export function TeamChip({ team, size = "sm" }: { team: University; size?: "sm" | "lg" }) {
  return (
    <div className={cn("rounded-lg","text-white","font-semibold","flex items-center justify-center",size === "sm" && "size-9 text-[10px]",size === "lg" && "size-14 text-xs",TEAM_COLOR[team])}>
      {universityLabel(team)}
    </div>
  );
}
