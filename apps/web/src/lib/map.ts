/**
 * Where the map opens, and what the "จุดเริ่มต้น" option flies back to: the
 * KMITL campus.
 *
 * NOTE: these are the campus centroid from OpenStreetMap, not the main
 * building. OpenStreetMap knows where the campus boundary is but not which
 * building is "main". To point at a specific building, drop a pin at
 * https://www.openstreetmap.org and copy the numbers out of the URL, which
 * ends in `#map=19/13.xxxxxx/100.xxxxxx`.
 */
export const CAMPUS_CENTER = {
  lat: 13.7299,
  lng: 100.783,
  zoom: 17,
} as const;

/**
 * The user's dot and the halo around it.
 *
 * Leaflet paints its shapes with SVG attributes rather than Tailwind classes,
 * so this has to be a concrete colour. Keeping it here means the dot, the halo
 * and the accuracy circle all read from one place.
 */
export const USER_LOCATION_COLOR = "#0ea5e9";