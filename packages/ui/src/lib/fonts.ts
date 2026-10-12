import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import plexThai400 from "@fontsource/ibm-plex-sans-thai/files/ibm-plex-sans-thai-thai-400-normal.woff2?url";
import plexThai500 from "@fontsource/ibm-plex-sans-thai/files/ibm-plex-sans-thai-thai-500-normal.woff2?url";
import plexThai700 from "@fontsource/ibm-plex-sans-thai/files/ibm-plex-sans-thai-thai-700-normal.woff2?url";

/**
 * The font files the first paint needs: Inter for Latin text and IBM Plex
 * Sans Thai for Thai at the body (400), UI (500) and heading (700) weights.
 * Preloading them lets the browser fetch them alongside the CSS instead of
 * only after parsing it, so text does not paint in a fallback font first.
 * These resolve to the same hashed files globals.css references.
 */
export const PRELOAD_FONTS = [interLatin, plexThai400, plexThai500, plexThai700];
