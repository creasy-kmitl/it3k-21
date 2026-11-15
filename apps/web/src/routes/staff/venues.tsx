import { type VenueInput, venueInput } from "@it3k/db/event-rules";
import { Button } from "@it3k/ui/components/button";
import { Input } from "@it3k/ui/components/input";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Spinner } from "@it3k/ui/components/spinner";
import { cn } from "@it3k/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Link2,
  LocateFixed,
  MapPin,
  MapPinned,
  Move,
  MoveHorizontal,
  MoveVertical,
  Pencil,
  Plus,
  Search,
  TextAlignStart,
  Trash2,
  Type,
} from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import {
  ConfirmDelete,
  FormDialog,
  TextAreaField,
  TextField,
  issuesOf,
} from "@/components/form-dialog";
import type { LngLat } from "@/components/venues/venue-map";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import type { Venue } from "@/lib/venues";

export const Route = createFileRoute("/staff/venues")({
  component: VenuesPage,
});

/** A link to open the venue: its own link, else a map pin from its position. */
export function venueMapUrl(venue: Pick<Venue, "externalUrl" | "latitude" | "longitude">) {
  if (venue.externalUrl) return venue.externalUrl;
  if (venue.latitude === null || venue.longitude === null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
}

type Dialog =
  | { kind: "venue"; venue: Venue | null; position?: LngLat }
  | { kind: "delete"; venue: Venue };

/** What the map is doing besides showing venues. */
type Mode =
  | { kind: "browse" }
  | { kind: "draft"; position: LngLat }
  | { kind: "move"; venue: Venue; position: LngLat | null };

const VenueMap = lazy(() =>
  import("@/components/venues/venue-map").then((module) => ({ default: module.VenueMap })),
);

const hasPosition = (venue: Venue) => venue.latitude !== null && venue.longitude !== null;
/** Six decimals is about 10cm, more than a pin dropped by finger can mean. */
const round = (value: number) => Number(value.toFixed(6));
const formatPosition = ({ lat, lng }: LngLat) => `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

/**
 * Places events happen, on a map that fills the page. Managers tap the map to
 * drop a pin for a new venue, or move an existing pin. The API enforces who may edit.
 * Phones get the venue list as a sheet along the bottom; wider screens get it
 * as a card floating on the left.
 */
export function VenuesPage() {
  const { venues: api } = useApis();
  const queryClient = useQueryClient();
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => api.list() });
  const canManage = venues.data?.canManage ?? false;
  const items = venues.data?.items ?? [];

  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: "browse" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<(LngLat & { key: number }) | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Same breakpoint as Tailwind's `md:`, where the sheet becomes a side card.
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [panel, setPanel] = useState<HTMLElement | null>(null);
  const panelSize = useElementSize(panel);

  const selected = items.find((venue) => venue.id === selectedId) ?? null;
  const fly = (position: LngLat) => setFlyTo({ ...position, key: Date.now() });

  const save = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      setDialog(null);
      setMode({ kind: "browse" });
    },
    onError: (error) => toastError(error, "บันทึกไม่สำเร็จ"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["venues"] }),
  });

  // Escape drops an unsaved pin or a move, unless a dialog is open to take it.
  useEffect(() => {
    if (dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMode({ kind: "browse" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  const onMapClick = useCallback(
    (position: LngLat) => {
      if (mode.kind === "move") {
        setMode({ ...mode, position });
      } else if (canManage) {
        // A second tap moves the draft instead of stacking pins.
        setMode({ kind: "draft", position });
        setSelectedId(null);
      } else {
        setSelectedId(null);
      }
    },
    [mode, canManage],
  );

  const select = (venue: Venue) => {
    if (mode.kind === "move") return;
    setMode({ kind: "browse" });
    setSelectedId(venue.id);
    if (venue.latitude !== null && venue.longitude !== null) {
      fly({ lat: venue.latitude, lng: venue.longitude });
    }
  };

  const startMove = (venue: Venue) => {
    setSelectedId(venue.id);
    setMode({
      kind: "move",
      venue,
      position:
        venue.latitude !== null && venue.longitude !== null
          ? { lat: venue.latitude, lng: venue.longitude }
          : null,
    });
  };

  const saveMove = (venue: Venue, position: LngLat) =>
    save.mutate(() =>
      api.update(venue.id, {
        name: venue.name,
        description: venue.description ?? "",
        latitude: round(position.lat),
        longitude: round(position.lng),
        externalUrl: venue.externalUrl ?? "",
      }),
    );

  const dropAtMyLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("อุปกรณ์นี้หาตำแหน่งไม่ได้");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = { lat: coords.latitude, lng: coords.longitude };
        setSelectedId(null);
        setMode({ kind: "draft", position });
        fly(position);
      },
      () => toast.error("หาตำแหน่งไม่ได้ ลองอนุญาตให้เข้าถึงตำแหน่ง"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  // Keep centred pins clear of the sheet (phones) or the side card (wider screens).
  const padding = useMemo(
    () =>
      isMobile
        ? { bottom: Math.round(panelSize.height), left: 0 }
        : { bottom: 0, left: Math.round(panelSize.width) + 12 },
    [isMobile, panelSize.height, panelSize.width],
  );

  return (
    <div className="relative flex-1">
      {venues.isPending ? (
        <Skeleton className="absolute inset-0 rounded-none" />
      ) : venues.isError ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <ErrorState error={venues.error} onRetry={venues.refetch} title="โหลดสถานที่ไม่สำเร็จ" />
        </div>
      ) : (
        <Suspense fallback={<Skeleton className="absolute inset-0 rounded-none" />}>
          <VenueMap
            venues={items}
            selectedId={selectedId}
            draft={mode.kind === "draft" ? mode.position : null}
            moving={mode.kind === "move" ? { id: mode.venue.id, position: mode.position } : null}
            flyTo={flyTo}
            padding={padding}
            compactLabels={isMobile}
            onMapClick={onMapClick}
            onSelect={(id) => {
              const venue = items.find((item) => item.id === id);
              if (venue) select(venue);
            }}
            onDraftMove={(position) => setMode({ kind: "draft", position })}
            onMovePin={(position) =>
              setMode((current) => (current.kind === "move" ? { ...current, position } : current))
            }
          />
        </Suspense>
      )}

      {!venues.isError && (
        <section
          ref={setPanel}
          aria-label="สถานที่"
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 flex max-h-[70%] flex-col rounded-t-2xl border-t bg-background shadow-[0_-4px_16px_rgb(0_0_0/0.08)] pb-[env(safe-area-inset-bottom)]",
            "md:inset-x-auto md:top-3 md:bottom-auto md:left-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-2xl md:border md:pb-0 md:shadow-lg",
          )}
        >
          {/* Phones: tap the handle to open or fold the list. */}
          <button
            type="button"
            className="flex h-6 w-full shrink-0 items-center justify-center md:hidden"
            aria-label={expanded ? "ย่อรายการสถานที่" : "ขยายรายการสถานที่"}
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </button>

          <div className="flex shrink-0 items-center gap-2 px-4 pb-3 md:pt-3">
            <h1 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold tracking-tight">
              <MapPinned className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="truncate">สถานที่</span>
              {venues.data && (
                <span className="text-sm font-normal text-muted-foreground">
                  {items.length} แห่ง
                </span>
              )}
            </h1>
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label="ปักหมุดตรงที่ฉันอยู่"
                  onClick={dropAtMyLocation}
                >
                  <LocateFixed />
                </Button>
                <Button size="sm" onClick={() => setDialog({ kind: "venue", venue: null })}>
                  <Plus /> เพิ่มสถานที่
                </Button>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
            {venues.isPending ? (
              <div role="status" className="flex flex-col gap-2 p-4">
                <span className="sr-only">กำลังโหลด</span>
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : mode.kind === "draft" ? (
              <DraftCard
                position={mode.position}
                onAdd={() =>
                  setDialog({
                    kind: "venue",
                    venue: null,
                    position: { lat: round(mode.position.lat), lng: round(mode.position.lng) },
                  })
                }
                onCancel={() => setMode({ kind: "browse" })}
              />
            ) : mode.kind === "move" ? (
              <MoveCard
                venue={mode.venue}
                position={mode.position}
                pending={save.isPending}
                onSave={(position) => saveMove(mode.venue, position)}
                onCancel={() => setMode({ kind: "browse" })}
              />
            ) : selected ? (
              <VenueCard
                venue={selected}
                canManage={canManage}
                onBack={() => setSelectedId(null)}
                onEdit={() => setDialog({ kind: "venue", venue: selected })}
                onMove={() => startMove(selected)}
                onDelete={() => setDialog({ kind: "delete", venue: selected })}
              />
            ) : (
              <div className={cn(!expanded && "hidden md:block")}>
                <VenueList venues={items} canManage={canManage} onSelect={select} />
              </div>
            )}
          </div>
        </section>
      )}

      {dialog?.kind === "venue" && (
        <VenueForm
          key={dialog.venue?.id ?? "new"}
          initial={dialog.venue}
          initialPosition={dialog.position}
          pending={save.isPending}
          onClose={() => setDialog(null)}
          onSubmit={(input) => {
            const { venue } = dialog;
            save.mutate(() => (venue ? api.update(venue.id, input) : api.create(input)));
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDelete
          name={dialog.venue.name}
          description="ลบได้เมื่อไม่มีกิจกรรมใช้สถานที่นี้"
          pending={save.isPending}
          onClose={() => setDialog(null)}
          onConfirm={() => {
            const { venue } = dialog;
            save.mutate(async () => {
              await api.remove(venue.id);
              setSelectedId((id) => (id === venue.id ? null : id));
            });
          }}
        />
      )}
    </div>
  );
}

function useElementSize(element: HTMLElement | null) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.target.getBoundingClientRect();
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

function VenueList({
  venues,
  canManage,
  onSelect,
}: {
  venues: Venue[];
  canManage: boolean;
  onSelect: (venue: Venue) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? venues.filter((venue) => venue.name.toLowerCase().includes(needle))
    : venues;

  return (
    <div className="flex flex-col gap-2 p-3">
      {canManage && (
        <p className="px-1 text-sm text-muted-foreground">แตะแผนที่เพื่อปักหมุดสถานที่ใหม่</p>
      )}
      {venues.length > 5 && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="ค้นหาสถานที่"
            placeholder="ค้นหาสถานที่"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
      )}
      {venues.length === 0 ? (
        <p className="px-1 py-2 text-muted-foreground">ยังไม่มีสถานที่</p>
      ) : shown.length === 0 ? (
        <p className="px-1 py-2 text-muted-foreground">ไม่พบสถานที่ที่ค้นหา</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((venue) => (
            <li key={venue.id}>
              <button
                type="button"
                onClick={() => onSelect(venue)}
                className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <MapPin
                  className={cn(
                    "size-5 shrink-0",
                    hasPosition(venue) ? "text-primary" : "text-muted-foreground/50",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">{venue.name}</span>
                {!hasPosition(venue) && (
                  <span className="shrink-0 text-xs text-muted-foreground">ไม่มีพิกัด</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VenueCard({
  venue,
  canManage,
  onBack,
  onEdit,
  onMove,
  onDelete,
}: {
  venue: Venue;
  canManage: boolean;
  onBack: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const mapUrl = venueMapUrl(venue);
  const pinned = hasPosition(venue);
  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
        <ArrowLeft /> สถานที่ทั้งหมด
      </Button>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{venue.name}</h2>
        {venue.description && (
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{venue.description}</p>
        )}
        {pinned ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatPosition({ lat: venue.latitude ?? 0, lng: venue.longitude ?? 0 })}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">ไม่มีพิกัด</p>
        )}
      </div>
      {mapUrl && (
        <a
          href={mapUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
        >
          เปิดแผนที่ <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      {canManage && (
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" aria-label={`แก้ไข ${venue.name}`} onClick={onEdit}>
            <Pencil /> แก้ไข
          </Button>
          <Button variant="outline" onClick={onMove}>
            <Move /> {pinned ? "ย้ายหมุด" : "ปักหมุด"}
          </Button>
          <Button variant="outline" aria-label={`ลบ ${venue.name}`} onClick={onDelete}>
            <Trash2 className="text-destructive" /> ลบ
          </Button>
        </div>
      )}
    </div>
  );
}

function DraftCard({
  position,
  onAdd,
  onCancel,
}: {
  position: LngLat;
  onAdd: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">หมุดใหม่</h2>
        <p className="text-xs text-muted-foreground tabular-nums">{formatPosition(position)}</p>
        <p className="text-sm text-muted-foreground">ลากหมุดหรือแตะจุดอื่นเพื่อปรับตำแหน่ง</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" className="flex-1" onClick={onAdd}>
          <Plus /> เพิ่มสถานที่ที่นี่
        </Button>
        <Button size="lg" variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}

function MoveCard({
  venue,
  position,
  pending,
  onSave,
  onCancel,
}: {
  venue: Venue;
  position: LngLat | null;
  pending: boolean;
  onSave: (position: LngLat) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">ย้ายหมุด {venue.name}</h2>
        {position && (
          <p className="text-xs text-muted-foreground tabular-nums">{formatPosition(position)}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {position ? "ลากหมุดหรือแตะจุดใหม่บนแผนที่" : "แตะแผนที่เพื่อวางหมุด"}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse">
        <Button
          size="lg"
          className="flex-1"
          disabled={!position || pending}
          onClick={() => position && onSave(position)}
        >
          {pending ? <Spinner /> : <Check />} บันทึกตำแหน่ง
        </Button>
        <Button size="lg" variant="outline" onClick={onCancel}>
          ยกเลิก
        </Button>
      </div>
    </div>
  );
}

/** Blank is no coordinate; anything else must read as a number. */
const coordinate = (text: string) => (text.trim() === "" ? null : Number(text));

function VenueForm({
  initial,
  initialPosition,
  pending,
  onClose,
  onSubmit,
}: {
  initial: Venue | null;
  /** A pin dropped on the map, filled in for a new venue. */
  initialPosition?: LngLat;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: VenueInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [latitude, setLatitude] = useState(
    (initial?.latitude ?? initialPosition?.lat)?.toString() ?? "",
  );
  const [longitude, setLongitude] = useState(
    (initial?.longitude ?? initialPosition?.lng)?.toString() ?? "",
  );
  const [externalUrl, setExternalUrl] = useState(initial?.externalUrl ?? "");
  const [issues, setIssues] = useState<Record<string, string>>({});

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : "เพิ่มสถานที่"}
      icon={initial ? MapPin : Plus}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = venueInput.safeParse({
          name,
          description,
          latitude: coordinate(latitude),
          longitude: coordinate(longitude),
          externalUrl,
        });
        if (!parsed.success) {
          setIssues(issuesOf(parsed.error));
          return;
        }
        setIssues({});
        onSubmit(parsed.data);
      }}
    >
      <TextField
        id="venue-name"
        label="ชื่อสถานที่"
        icon={Type}
        value={name}
        onChange={setName}
        error={issues.name}
      />
      <TextAreaField
        id="venue-description"
        label="รายละเอียด"
        icon={TextAlignStart}
        value={description}
        onChange={setDescription}
        error={issues.description}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="venue-latitude"
          label="ละติจูด"
          icon={MoveVertical}
          inputMode="decimal"
          placeholder="13.7299"
          value={latitude}
          onChange={setLatitude}
          error={issues.latitude}
        />
        <TextField
          id="venue-longitude"
          label="ลองจิจูด"
          icon={MoveHorizontal}
          inputMode="decimal"
          placeholder="100.7782"
          value={longitude}
          onChange={setLongitude}
          error={issues.longitude}
        />
      </div>
      <TextField
        id="venue-url"
        label="ลิงก์แผนที่"
        icon={Link2}
        inputMode="url"
        placeholder="https://maps.app.goo.gl/..."
        value={externalUrl}
        onChange={setExternalUrl}
        error={issues.externalUrl}
        hint="ไม่ใส่ก็ได้ ถ้ามีพิกัด ระบบจะลิงก์ไป Google Maps ให้"
      />
    </FormDialog>
  );
}
