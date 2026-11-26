// Leaflet's own stylesheet. Without this import the map renders unstyled and
// its panes collapse to zero height.
import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect } from "react";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import type { Coords } from "@/hooks/use-user-location";
import { CAMPUS_CENTER, USER_LOCATION_COLOR } from "@/lib/map";

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
  // The colour comes from the constant rather than a palette class, so the dot,
  // its halo and the accuracy circle cannot drift apart.
  html: `<span class="relative flex size-5 items-center justify-center"><span class="absolute size-5 animate-ping rounded-full opacity-60" style="background-color:${USER_LOCATION_COLOR}"></span><span class="size-5 rounded-full ring-[3px] ring-background shadow" style="background-color:${USER_LOCATION_COLOR}"></span></span>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/**
 * The campus marker, so the "จุดเริ่มต้น" option flies somewhere that is
 * visibly labelled rather than to a bare patch of map.
 */
const CAMPUS_ICON = L.divIcon({
  className: "",
  html: `<span class="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18],
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
    map.flyTo([CAMPUS_CENTER.lat, CAMPUS_CENTER.lng], CAMPUS_CENTER.zoom, { duration: 0.6 });
  }, [request, map]);

  useEffect(() => {
    if (request.target !== "user" || !coords) return;
    map.flyTo([coords.lat, coords.lng], Math.max(map.getZoom(), CAMPUS_CENTER.zoom), {
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
      center={[CAMPUS_CENTER.lat, CAMPUS_CENTER.lng]}
      zoom={CAMPUS_CENTER.zoom}
      // Leaflet needs a concrete height; the panel gives it one.
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      <Marker
        position={[CAMPUS_CENTER.lat, CAMPUS_CENTER.lng]}
        icon={CAMPUS_ICON}
        interactive={false}
      >
        <Popup>จุดเริ่มต้น · KMITL</Popup>
      </Marker>

      {user && (
        <>
          {/* A phone fix is only good to perhaps 20m, so draw the uncertainty
              rather than implying precision the hardware cannot deliver.
              `interactive={false}` keeps both off the click path so dragging
              the map never catches on them. */}
          <Circle
            center={[user.lat, user.lng]}
            radius={user.accuracy}
            interactive={false}
            pathOptions={{ color: USER_LOCATION_COLOR, fillOpacity: 0.08, weight: 1 }}
          />
          <Marker position={[user.lat, user.lng]} icon={USER_ICON} interactive={false} />
        </>
      )}

      <FocusTarget coords={user} request={request} />
    </MapContainer>
  );
}