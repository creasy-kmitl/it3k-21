/**
 * Where the map opens before the browser reports a position: the KMITL campus.
 *
 * NOTE: these are the campus centroid from OpenStreetMap, not the main
 * building. OpenStreetMap knows where the campus boundary is but not which
 * building is "main". To point at a specific building, drop a pin at
 * https://www.openstreetmap.org and copy the numbers out of the URL, which
 * ends in `#map=19/13.xxxxxx/100.xxxxxx`.
 */
export const VENUE_CENTER = {
  lat: 13.7299,
  lng: 100.783,
  zoom: 17,
} as const;