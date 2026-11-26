import {
  MATCH_STATUSES,
  MATCH_STATUS_LABELS,
  type MatchStatus,
  THIRD_PLACE_STAGE,
  nextStageName,
  previousStageName,
} from "@it3k/db/competition-rules";
import { Button } from "@it3k/ui/components/button";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleDot, Layers, List, MapPin, Network, Plus, Swords, Trophy } from "lucide-react";
import { useState } from "react";

import {
  type BracketAddRequest,
  BracketView,
  bracketMatchTitle,
  buildBrackets,
  fromStaffMatch,
} from "@/components/competition/bracket";
import { BracketBuilder } from "@/components/competition/bracket-builder";
import { MatchCard } from "@/components/competition/match-card";
import { EMPTY_SIDE, MatchForm, type MatchPreset } from "@/components/competition/match-form";
import { MatchSelect } from "@/components/competition/match-select";
import { MATCH_STATUS_DOT } from "@/components/competition/match-status-badge";
import { StatusDot } from "@/components/icon-select";
import { SportMark } from "@/components/sport-art";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { dateKey, formatBangkok } from "@/lib/bangkok-time";
import type { MatchFilters, MatchListItem } from "@/lib/competition-matches";

export const Route = createFileRoute("/staff/matches")({
  head: () => ({ meta: [{ title: "แมตช์ · IT3Kings" }] }),
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  return (
    <MatchesPage
      onCreated={(matchId) => void navigate({ to: "/staff/matches/$matchId", params: { matchId } })}
    />
  );
}

/** Matches by Bangkok day, in time order; matches without a time come last. */
export function groupByDay(matches: MatchListItem[]) {
  const days = new Map<string, { label: string; matches: MatchListItem[] }>();
  for (const match of matches) {
    const key = match.startAt === null ? "none" : dateKey(match.startAt);
    const label =
      match.startAt === null ? "ยังไม่กำหนดเวลา" : formatBangkok(match.startAt, "longDay");
    const day = days.get(key) ?? { label, matches: [] };
    day.matches.push(match);
    days.set(key, day);
  }
  return [...days.entries()].map(([key, day]) => ({ key, ...day }));
}

type View = "list" | "bracket";

/** The new match a bracket's add button asks for. */
export function bracketPreset(request: BracketAddRequest): MatchPreset {
  const { match } = request;
  if (request.kind === "next") {
    return {
      divisionId: match.divisionId,
      stageName: nextStageName(match.stageName),
      sides: [
        { teamId: null, label: "", source: { matchId: match.id, result: "winner" } },
        EMPTY_SIDE,
      ],
    };
  }
  if (request.kind === "third") {
    return {
      divisionId: match.divisionId,
      stageName: THIRD_PLACE_STAGE,
      sides: request.feeders.map((feeder) => ({
        teamId: null,
        label: "",
        source: { matchId: feeder.id, result: "loser" as const },
      })),
    };
  }
  return {
    divisionId: match.divisionId,
    stageName: previousStageName(match.stageName),
    sides: [EMPTY_SIDE, EMPTY_SIDE],
    feeds: {
      matchId: match.id,
      slot: request.slot,
      version: match.version,
      description: `ฝั่ง ${request.slot} ของ ${bracketMatchTitle(match)}`,
    },
  };
}

/**
 * Every match, filtered by sport, division, venue and status, grouped by day;
 * or each division's knockout bracket, which needs every match of its rounds
 * and so is filtered by sport and division only.
 */
export function MatchesPage({ onCreated }: { onCreated: (matchId: string) => void }) {
  const apis = useApis();
  const [filters, setFilters] = useState<MatchFilters>({});
  // The bracket is the main view; the list by day is one click away.
  const [view, setView] = useState<View>("bracket");
  const [creating, setCreating] = useState(false);
  const [preset, setPreset] = useState<MatchPreset | null>(null);
  const [building, setBuilding] = useState(false);
  const shown: MatchFilters =
    view === "bracket"
      ? {
          ...(filters.sportId ? { sportId: filters.sportId } : {}),
          ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
        }
      : filters;
  const matches = useQuery({
    queryKey: ["competition-matches", "list", shown],
    queryFn: () => apis.competitionMatches.list(shown),
  });
  const divisions = useQuery({
    queryKey: ["competition-divisions"],
    queryFn: () => apis.competitionDivisions.list(),
  });
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => apis.venues.list() });

  const divisionItems = divisions.data?.items ?? [];
  const sports = [
    ...new Map(
      divisionItems.map((d) => [
        d.sportId,
        { id: d.sportId, name: d.sportName, icon: d.sportIcon },
      ]),
    ).values(),
  ];
  const shownDivisions = filters.sportId
    ? divisionItems.filter((d) => d.sportId === filters.sportId)
    : divisionItems;
  const venueItems = venues.data?.items ?? [];
  const canManage = matches.data?.canManage ?? false;
  const set = (patch: MatchFilters) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader icon={Swords} title="แมตช์" description="ตารางแข่งทุกประเภท" />
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={view === "bracket" ? "outline" : "default"}
              onClick={() => setCreating(true)}
            >
              <Plus /> สร้างแมตช์
            </Button>
            {view === "bracket" && (
              <Button onClick={() => setBuilding(true)}>
                <Network /> เพิ่มสายการแข่ง
              </Button>
            )}
          </div>
        )}
      </div>

      <SegmentedControl<View>
        label="มุมมอง"
        className="w-fit"
        segments={[
          { value: "bracket", label: "สายการแข่ง", icon: Network },
          { value: "list", label: "รายการ", icon: List },
        ]}
        value={view}
        onChange={setView}
      />

      <div
        className={
          view === "bracket" ? "grid grid-cols-2 gap-2" : "grid grid-cols-2 gap-2 lg:grid-cols-4"
        }
      >
        <MatchSelect
          label="กีฬา"
          icon={<Trophy aria-hidden className="text-muted-foreground" />}
          items={[
            { value: null, label: "ทุกกีฬา" },
            ...sports.map((s) => ({
              value: s.id,
              label: s.name,
              icon: <SportMark icon={s.icon} seed={s.id} />,
            })),
          ]}
          value={filters.sportId ?? null}
          onChange={(sportId) => set({ sportId: sportId ?? undefined, divisionId: undefined })}
        />
        <MatchSelect
          label="ประเภท"
          icon={<Layers aria-hidden className="text-muted-foreground" />}
          items={[
            { value: null, label: "ทุกประเภท" },
            ...shownDivisions.map((d) => ({ value: d.id, label: `${d.sportName} · ${d.name}` })),
          ]}
          value={filters.divisionId ?? null}
          onChange={(divisionId) => set({ divisionId: divisionId ?? undefined })}
        />
        {view === "list" && (
          <MatchSelect
            label="สถานที่"
            icon={<MapPin aria-hidden className="text-muted-foreground" />}
            items={[
              { value: null, label: "ทุกสถานที่" },
              ...venueItems.map((v) => ({ value: v.id, label: v.name })),
            ]}
            value={filters.venueId ?? null}
            onChange={(venueId) => set({ venueId: venueId ?? undefined })}
          />
        )}
        {view === "list" && (
          <MatchSelect<MatchStatus>
            label="สถานะ"
            icon={<CircleDot aria-hidden className="text-muted-foreground" />}
            items={[
              { value: null, label: "ทุกสถานะ" },
              ...MATCH_STATUSES.map((status) => ({
                value: status,
                label: MATCH_STATUS_LABELS[status],
                icon: <StatusDot className={MATCH_STATUS_DOT[status]} />,
              })),
            ]}
            value={filters.status ?? null}
            onChange={(status) => set({ status: status ?? undefined })}
          />
        )}
      </div>

      {matches.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
      ) : matches.isError ? (
        <ErrorState error={matches.error} onRetry={matches.refetch} title="โหลดแมตช์ไม่สำเร็จ" />
      ) : view === "bracket" ? (
        <Brackets
          items={matches.data.items}
          onAdd={canManage ? (request) => setPreset(bracketPreset(request)) : undefined}
          onBuild={canManage ? () => setBuilding(true) : undefined}
        />
      ) : matches.data.items.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="ยังไม่มีแมตช์"
          description={
            Object.values(filters).some(Boolean) ? "ไม่มีแมตช์ที่ตรงกับตัวกรอง" : "กดสร้างแมตช์เพื่อเพิ่มแมตช์แรก"
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groupByDay(matches.data.items).map((day) => (
            <section key={day.key} aria-label={day.label} className="flex flex-col gap-2">
              <h2 className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 text-sm font-semibold text-muted-foreground backdrop-blur">
                {day.label}
                <span className="ml-2 font-normal">{day.matches.length} แมตช์</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {day.matches.map((match) => (
                  <li key={match.id}>
                    <MatchCard match={match} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {creating && (
        <MatchForm
          divisions={divisionItems}
          venues={venueItems}
          initial={null}
          divisionId={filters.divisionId ?? null}
          onClose={() => setCreating(false)}
          onSaved={(match) => {
            setCreating(false);
            onCreated(match.id);
          }}
        />
      )}
      {preset && (
        <MatchForm
          divisions={divisionItems}
          venues={venueItems}
          initial={null}
          preset={preset}
          onClose={() => setPreset(null)}
          onSaved={() => setPreset(null)}
        />
      )}
      {building && (
        <BracketBuilder
          divisions={divisionItems}
          divisionId={filters.divisionId ?? null}
          onClose={() => setBuilding(false)}
          onBuilt={() => setBuilding(false)}
        />
      )}
    </div>
  );
}

function Brackets({
  items,
  onAdd,
  onBuild,
}: {
  items: MatchListItem[];
  /** Managers only: the add buttons on cards and the empty state. */
  onAdd?: (request: BracketAddRequest) => void;
  onBuild?: () => void;
}) {
  const brackets = buildBrackets(items.map(fromStaffMatch));
  if (brackets.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="ยังไม่มีสายการแข่ง"
        description={
          onBuild
            ? "กดเพิ่มสายการแข่งเพื่อสร้างแมตช์น็อกเอาต์ทั้งสาย หรือสร้างแมตช์เองแล้วเลือกให้ฝั่งมาจาก “ผู้ชนะ” ของแมตช์ก่อนหน้า"
            : "สร้างแมตช์รอบน็อกเอาต์ แล้วเลือกให้ฝั่งมาจาก “ผู้ชนะ” ของแมตช์ก่อนหน้า สายจะขึ้นที่นี่"
        }
        action={
          onBuild && (
            <Button onClick={onBuild}>
              <Network /> เพิ่มสายการแข่ง
            </Button>
          )
        }
      />
    );
  }
  return <BracketView brackets={brackets} matchRoute="/staff/matches/$matchId" onAdd={onAdd} />;
}
