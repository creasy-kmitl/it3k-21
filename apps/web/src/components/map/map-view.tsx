// Leaflet's own stylesheet. Without this import the map renders unstyled and
// its panes collapse to zero height.
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap } from "react-leaflet";

import type { Coords } from "@/hooks/use-user-location";
import { VENUE_CENTER } from "@/lib/map";

/**
 * The user's marker is a styled `<div>` rather than Leaflet's bundled PNG.
 *
 * Leaflet locates its default marker image by computing a URL relative to the
 * library file, which no bundler can follow, so the stock marker renders as a
 * broken image in every Vite/webpack build. A `divIcon` sidesteps that and
 * lets the dot use the project's own palette.
 *
 * The `class` attributes below sit inside an HTML string that Leaflet injects
 * with innerHTML, not JSX, so they are correctly `class` and not `className`.
 */
const USER_ICON = L.divIcon({
  className: "",
  html: `<span class="relative flex size-5 items-center justify-center"><span class="absolute size-5 animate-ping rounded-full bg-sky-400/60"></span><span class="size-5 rounded-full bg-sky-500 ring-[3px] ring-background shadow"></span></span>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/**
 * Moves the map to whichever anchor is selected.
 *
 * Two effects rather than one, because `coords` changes every time the GPS
 * reports a fix. A single effect would re-run on every fix and, with the
 * campus selected, drag the map back from wherever the user had panned it to.
 * The first effect does not depend on the coordinates at all, so it fires only
 * when the target changes or a re-centre is asked for; the second depends on
 * the coordinates but does nothing unless the user is the target.
 *
 * This is the bridge between the two worlds: React is declarative, Leaflet is
 * imperative. React tells us the request changed; the effects below are what
 * actually tell Leaflet to move. `useMap` only works inside `MapContainer`,
 * which is why this needs to be its own component.
 */
function FocusTarget({
  coords,
  request,
}: {
  coords: Coords | null;
  request: CenterRequest;
}) {
  const map = useMap();

  useEffect(() => {
    if (request.target !== "venue") return;
    map.flyTo([VENUE_CENTER.lat, VENUE_CENTER.lng], VENUE_CENTER.zoom, { duration: 0.6 });
  }, [request, map]);

  useEffect(() => {
    if (request.target !== "user" || !coords) return;
    map.flyTo([coords.lat, coords.lng], Math.max(map.getZoom(), VENUE_CENTER.zoom), {
      duration: 0.6,
    });
  }, [coords, request, map]);

  return null;
}

/** Which anchor the map returns to: the campus, or the live user position. */
export type CenterTarget = "venue" | "user";

/**
 * What the map should be looking at.
 *
 * `nonce` changes on every request so that asking for the anchor that is
 * already selected still flies there. A segmented control is a radio, so
 * re-picking the option that is already active fires no change of its own, and
 * the map would stay wherever the user had panned it to.
 */
export type CenterRequest = {
  target: CenterTarget;
  nonce: number;
};

export type MapViewProps = {
  user: Coords | null;
  /** Which anchor to fly to, and which request to answer. */
  request: CenterRequest;
};

/**
 * The map itself: the campus as the fixed centre point, plus the live user
 * marker. Venue pins are deliberately absent for now, so `lib/map.ts` holds a
 * single coordinate rather than a list.
 */
export function MapView({ user, request }: MapViewProps) {
  return (
    <MapContainer
      center={[VENUE_CENTER.lat, VENUE_CENTER.lng]}
      zoom={VENUE_CENTER.zoom}
      // Leaflet needs a concrete height; the panel gives it one.
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {user && (
        <>
          {/* A phone fix is only good to perhaps 20m, so draw the uncertainty
              rather than implying precision the hardware cannot deliver. */}
          <Circle
            center={[user.lat, user.lng]}
            radius={user.accuracy}
            pathOptions={{ color: "#0ea5e9", fillOpacity: 0.08, weight: 1 }}
          />
          <Marker position={[user.lat, user.lng]} icon={USER_ICON} />
        </>
      )}

      <FocusTarget coords={user} request={request} />
    </MapContainer>
  );
}