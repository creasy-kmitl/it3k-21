// The map half of /staff/venues. It only draws pins and reports taps; the page
// owns every decision (what is selected, the draft pin, moving a pin) and shows
// the buttons. Kept in its own module so the page can lazy-load maplibre and
// tests can swap this file for a stub, since jsdom has no WebGL.
import {
  MapControls,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  Map as MapView,
  useMap,
} from "@it3k/ui/components/map";
import { cn } from "@it3k/ui/lib/utils";
import { MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Venue } from "@/lib/venues";

export type LngLat = { lng: number; lat: number };

/** Where the map opens when no venue has a position yet: KMITL. */
export const DEFAULT_CENTER: LngLat = { lng: 100.7782, lat: 13.7299 };

export type VenueMapProps = {
  venues: Venue[];
  selectedId: string | null;
  /** A pin a manager dropped but has not saved as a venue yet. */
  draft: LngLat | null;
  /** A venue whose pin is being dragged to a new spot; null position until placed. */
  moving: { id: string; position: LngLat | null } | null;
  /** Fly here when it changes. `key` lets the same spot fly again. */
  flyTo: (LngLat & { key: number }) | null;
  /** Room the overlays take, so centering keeps pins out from under them. */
  padding: { bottom: number; left: number };
  /** Hide pin names until zoomed in, so small screens don't fill up with text. */
  compactLabels: boolean;
  onMapClick: (position: LngLat) => void;
  onSelect: (id: string) => void;
  onDraftMove: (position: LngLat) => void;
  onMovePin: (position: LngLat) => void;
};

type Pinned = Venue & { latitude: number; longitude: number };
const hasPosition = (venue: Venue): venue is Pinned =>
  venue.latitude !== null && venue.longitude !== null;

const LABEL_ZOOM = 15;

export function VenueMap(props: VenueMapProps) {
  const pinned = useMemo(() => props.venues.filter(hasPosition), [props.venues]);

  // Open on every venue at once; the map reads this only when it is created.
  const initialView = useMemo(() => {
    if (pinned.length === 0) {
      return { center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat] as [number, number], zoom: 15 };
    }
    const lngs = pinned.map((venue) => venue.longitude);
    const lats = pinned.map((venue) => venue.latitude);
    return {
      bounds: [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ] as [[number, number], [number, number]],
      fitBoundsOptions: { padding: 64, maxZoom: 16 },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MapView {...initialView} className="absolute inset-0">
      <MapEvents {...props} />
      <MapControls
        position="top-right"
        showLocate
        className="top-3 right-3 md:top-auto md:right-3 md:bottom-10"
      />

      {pinned.map((venue) => {
        const isMoving = props.moving?.id === venue.id;
        if (isMoving && props.moving?.position) return null;
        return (
          <VenuePin
            key={venue.id}
            venue={venue}
            selected={props.selectedId === venue.id}
            dimmed={props.moving !== null && !isMoving}
            compactLabels={props.compactLabels}
            onSelect={props.onSelect}
          />
        );
      })}

      {props.moving?.position && (
        <MapMarker
          key={`moving-${props.moving.id}`}
          longitude={props.moving.position.lng}
          latitude={props.moving.position.lat}
          anchor="bottom"
          draggable
          onDragEnd={props.onMovePin}
        >
          <MarkerContent className="cursor-move">
            <PinIcon tone="moving" />
          </MarkerContent>
        </MapMarker>
      )}

      {props.draft && (
        <MapMarker
          longitude={props.draft.lng}
          latitude={props.draft.lat}
          anchor="bottom"
          draggable
          onDragEnd={props.onDraftMove}
        >
          <MarkerContent className="cursor-move">
            <PinIcon tone="draft" />
          </MarkerContent>
        </MapMarker>
      )}
    </MapView>
  );
}

function VenuePin({
  venue,
  selected,
  dimmed,
  compactLabels,
  onSelect,
}: {
  venue: Pinned;
  selected: boolean;
  dimmed: boolean;
  compactLabels: boolean;
  onSelect: (id: string) => void;
}) {
  const { map } = useMap();
  const zoom = useZoom();
  const showLabel = selected || !compactLabels || zoom >= LABEL_ZOOM;

  // Bring the chosen pin above its neighbours.
  useEffect(() => {
    const element = map
      ?.getCanvasContainer()
      .querySelector<HTMLElement>(`[data-venue-pin="${CSS.escape(venue.id)}"]`)
      ?.closest<HTMLElement>(".maplibregl-marker");
    if (element) element.style.zIndex = selected ? "2" : "";
  }, [map, selected, venue.id]);

  return (
    <MapMarker
      longitude={venue.longitude}
      latitude={venue.latitude}
      anchor="bottom"
      onClick={(event) => {
        event.stopPropagation();
        onSelect(venue.id);
      }}
    >
      <MarkerContent>
        {/* A real button so keyboards reach pins; its click bubbles to the marker. */}
        <button
          type="button"
          data-venue-pin={venue.id}
          aria-label={venue.name}
          aria-pressed={selected}
          className={cn(
            "block rounded-full transition-opacity focus-visible:outline-2 focus-visible:outline-ring",
            dimmed && "opacity-40",
          )}
        >
          <PinIcon tone={selected ? "selected" : "venue"} />
        </button>
        {showLabel && (
          <MarkerLabel
            position="top"
            className={cn(
              "max-w-40 truncate rounded-md bg-background/90 px-1.5 py-0.5 text-xs shadow-sm",
              selected && "font-semibold",
            )}
          >
            {venue.name}
          </MarkerLabel>
        )}
      </MarkerContent>
    </MapMarker>
  );
}

const PIN_TONES = {
  venue: "size-8 fill-primary text-primary-foreground",
  selected: "size-11 fill-primary text-primary-foreground",
  draft: "size-11 animate-bounce fill-amber-500 text-white [animation-iteration-count:1]",
  moving: "size-11 fill-amber-500 text-white",
};

/** A pin whose tip sits on the spot. The box is at least 44px so fingers can hit it. */
function PinIcon({ tone }: { tone: keyof typeof PIN_TONES }) {
  return (
    <div className="flex size-11 items-end justify-center">
      <MapPin
        aria-hidden
        strokeWidth={1.5}
        className={cn("drop-shadow-md transition-all", PIN_TONES[tone])}
      />
    </div>
  );
}

function useZoom() {
  const { map } = useMap();
  const [zoom, setZoom] = useState(() => map?.getZoom() ?? 0);
  useEffect(() => {
    if (!map) return;
    const update = () => setZoom(map.getZoom());
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map]);
  return zoom;
}

/** Map-level wiring: taps on empty ground, flying to a spot, overlay padding. */
function MapEvents({
  flyTo,
  padding,
  onMapClick,
}: Pick<VenueMapProps, "flyTo" | "padding" | "onMapClick">) {
  const { map } = useMap();

  useEffect(() => {
    if (!map) return;
    // MapLibre skips `click` after a pan or pinch, so moving the map never drops a pin.
    const handle = (event: { lngLat: LngLat; originalEvent: MouseEvent }) => {
      const target = event.originalEvent.target as Element | null;
      if (target?.closest(".maplibregl-marker, .maplibregl-ctrl")) return;
      onMapClick({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    };
    map.on("click", handle);
    return () => {
      map.off("click", handle);
    };
  }, [map, onMapClick]);

  useEffect(() => {
    if (!map) return;
    map.easeTo({ padding: { top: 0, right: 0, ...padding }, duration: 300 });
  }, [map, padding.bottom, padding.left]);

  useEffect(() => {
    if (!map || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: Math.max(map.getZoom(), 16),
      duration: 800,
    });
  }, [map, flyTo?.key]);

  return null;
}
