// Short-link rules shared by the API and the web app. Kept free of Drizzle so
// the browser bundle can import it.

/** Where a short link is served, on the web app's own host: `/l/<slug>`. */
export const SHORT_LINK_PATH = "/l/";

/**
 * Why a short link sends nobody on. The API names it in this header, and the
 * web worker answers with the web app's own page for it, so the page looks
 * like the rest of the site.
 */
export const UNAVAILABLE_REASONS = ["missing", "disabled", "expired", "locked"] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];
export const LINK_UNAVAILABLE_HEADER = "X-Short-Link-Unavailable";

export const isUnavailableReason = (value: unknown): value is UnavailableReason =>
  (UNAVAILABLE_REASONS as readonly unknown[]).includes(value);

/**
 * The pages the web app shows at `/l/<slug>`: the API's reasons, plus "error"
 * for when the web worker could not get an answer from the API at all.
 */
export const LINK_PAGE_REASONS = [...UNAVAILABLE_REASONS, "error"] as const;
export type LinkPageReason = (typeof LINK_PAGE_REASONS)[number];

export const isLinkPageReason = (value: unknown): value is LinkPageReason =>
  (LINK_PAGE_REASONS as readonly unknown[]).includes(value);

/**
 * Why the last password typed for a locked link did not open it: it was
 * wrong, or too many wrong ones were tried this minute. The API names it in
 * this header, next to LINK_UNAVAILABLE_HEADER's "locked".
 */
export const UNLOCK_FAILURES = ["wrong", "limited"] as const;
export type UnlockFailure = (typeof UNLOCK_FAILURES)[number];
export const LINK_UNLOCK_HEADER = "X-Short-Link-Unlock";

export const isUnlockFailure = (value: unknown): value is UnlockFailure =>
  (UNLOCK_FAILURES as readonly unknown[]).includes(value);

export const PASSWORD_MIN = 4;
export const PASSWORD_MAX = 64;
/** Wrong passwords a link takes per minute before it stops checking them. */
export const UNLOCK_ATTEMPTS_PER_MINUTE = 10;

/**
 * Added to the link a QR code encodes, so a visit through the QR is told apart
 * from one through the link itself. Someone who scans and then shares that
 * URL counts as a QR visit; the stats say "through QR", not "scans".
 */
export const QR_MARKER = "qr";

/** Lowercase letters, digits and inner hyphens: safe to print and to type. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 64;

/** Random slugs skip look-alikes (0/o, 1/l/i) so a printed link can be typed back. */
export const RANDOM_SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const RANDOM_SLUG_LENGTH = 7;

export const DESTINATION_MAX = 2048;
export const TITLE_MAX = 120;

/** How a visit arrived: through the QR code or through the link as text. */
export const VISIT_SOURCES = ["qr", "link"] as const;
export type VisitSource = (typeof VISIT_SOURCES)[number];

export const SHORT_LINK_CHANGE_ACTIONS = ["create", "update", "enable", "disable"] as const;
export type ShortLinkChangeAction = (typeof SHORT_LINK_CHANGE_ACTIONS)[number];

/** The spans of days a link's visit chart can show, today included. */
export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];
export const DEFAULT_STATS_RANGE: StatsRange = 30;

/** Tags group links, e.g. by game or campaign; a few short ones each. */
export const TAG_MAX_COUNT = 5;
export const TAG_MAX_LENGTH = 24;

/**
 * A tag as stored: trimmed, lowercase, inner spaces as hyphens, so "Valorant
 * Finals" and "valorant-finals" are one tag. Thai is kept as typed.
 */
export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, TAG_MAX_LENGTH);
}

/** The UTM parameters the link form helps fill in on a destination. */
export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

/** A visit's calendar day in Bangkok, `YYYY-MM-DD`, which is how visits are counted. */
export function bangkokDay(ms: number): string {
  // Bangkok has no daylight saving: always UTC+7.
  return new Date(ms + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type DestinationProblem = "not-url" | "not-https" | "credentials" | "loop";

/**
 * Why a destination is refused, or null when it is fine. Only https, no
 * user:password part (a classic way to disguise the real host), and never
 * another short link on `shortLinkHost`, which could loop.
 */
export function destinationProblem(
  destination: string,
  shortLinkHost: string,
): DestinationProblem | null {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    return "not-url";
  }
  if (url.protocol !== "https:") return "not-https";
  if (url.username || url.password) return "credentials";
  if (url.host === shortLinkHost && url.pathname.startsWith(SHORT_LINK_PATH)) return "loop";
  return null;
}
