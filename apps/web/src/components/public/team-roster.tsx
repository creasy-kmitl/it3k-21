import { LINEUP_ROLE_LABELS } from "@it3k/db/competition-rules";
import { Avatar, AvatarFallback, AvatarImage } from "@it3k/ui/components/avatar";

import type { MatchPageSide } from "@/lib/public-competition";

type Member = MatchPageSide["members"][number];

function ShirtNumber({ value }: { value: number | null }) {
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold tabular-nums">
      {value ?? "–"}
    </span>
  );
}

function MemberList({ members }: { members: Member[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {members.map((member, index) => (
        <li
          key={`${member.shirtNumber}-${member.name}-${index}`}
          className="flex items-center gap-2"
        >
          <ShirtNumber value={member.shirtNumber} />
          <span className="truncate">{member.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A side's athletes (first name and shirt number), split into starters and
 * subs when the match has a lineup, and the team's officials.
 */
export function TeamRoster({ side }: { side: MatchPageSide }) {
  const starters = side.members.filter((m) => m.role === "starter");
  const subs = side.members.filter((m) => m.role === "sub");
  const unassigned = side.members.filter((m) => m.role === null);
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <h3 className="font-semibold">{side.name || "รอผล"}</h3>
      {side.members.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีรายชื่อนักกีฬา</p>
      ) : (
        <div className="flex flex-col gap-3">
          {starters.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                {LINEUP_ROLE_LABELS.starter}
              </h4>
              <MemberList members={starters} />
            </div>
          )}
          {subs.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h4 className="text-xs font-medium text-muted-foreground">
                {LINEUP_ROLE_LABELS.sub}
              </h4>
              <MemberList members={subs} />
            </div>
          )}
          {unassigned.length > 0 && <MemberList members={unassigned} />}
        </div>
      )}
      {side.officials.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h4 className="text-xs font-medium text-muted-foreground">เจ้าหน้าที่ทีม</h4>
          <ul className="flex flex-col gap-2">
            {side.officials.map((official, index) => (
              <li key={`${official.name}-${index}`} className="flex items-center gap-3">
                <Avatar>
                  {official.photoUrl && <AvatarImage src={official.photoUrl} alt="" />}
                  <AvatarFallback>{official.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{official.name}</span>
                  {(official.position || official.description) && (
                    <span className="text-xs text-muted-foreground">
                      {[official.position, official.description].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
