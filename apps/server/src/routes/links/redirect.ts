// The public side of short links: `/l/<slug>` sends a visitor on to the
// link's destination. The web app's worker forwards these paths here, so
// links live on the web host while the database stays with the API.
import type { Database } from "@it3k/db";
import {
  LINK_UNAVAILABLE_HEADER,
  QR_MARKER,
  SLUG_MAX,
  SLUG_PATTERN,
  type UnavailableReason,
  type VisitSource,
  bangkokDay,
  shortLink,
  shortLinkVisitDay,
} from "@it3k/db/schema/short-link";
import { eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import type { RouteDeps } from "../../middleware/current-user";
import { linkState } from ".";

// Link-preview fetchers and crawlers open links nobody chose to visit.
// Counted visits are meant to be people, so these are left out.
const AUTOMATED = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|embedly/i;

const UNAVAILABLE: Record<UnavailableReason, { status: 404 | 410; text: string }> = {
  missing: { status: 404, text: "ไม่พบลิงก์นี้" },
  disabled: { status: 410, text: "ลิงก์นี้ถูกปิดแล้ว" },
  expired: { status: 410, text: "ลิงก์นี้หมดอายุแล้ว" },
};

/**
 * No redirect: the status, plus the reason in LINK_UNAVAILABLE_HEADER. The
 * web worker swaps this body for its own page, styled like the rest of the
 * site; the plain text is only seen on the API's own host. Nothing from the
 * requested path is echoed.
 */
function unavailable(c: Context, reason: UnavailableReason) {
  const { status, text } = UNAVAILABLE[reason];
  c.header(LINK_UNAVAILABLE_HEADER, reason);
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  return c.text(text, status);
}

function countVisit(db: Database, linkId: string, source: VisitSource, now: number) {
  return db
    .insert(shortLinkVisitDay)
    .values({ linkId, day: bangkokDay(now), source, count: 1 })
    .onConflictDoUpdate({
      target: [shortLinkVisitDay.linkId, shortLinkVisitDay.day, shortLinkVisitDay.source],
      set: { count: sql`${shortLinkVisitDay.count} + 1` },
    });
}

/**
 * Runs `work` after the response on Workers, so counting never slows the
 * redirect. Outside Workers (tests) there is no execution context, so it
 * finishes first instead.
 */
async function afterResponse(c: Context, work: Promise<unknown>) {
  let executionCtx: Context["executionCtx"] | null = null;
  try {
    executionCtx = c.executionCtx;
  } catch {
    // Hono throws when the runtime gave it no execution context.
  }
  if (executionCtx) executionCtx.waitUntil(work);
  else await work;
}

/** Not cached anywhere, so a changed destination takes effect at once. */
function sendTo(c: Context, url: string) {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex");
  return c.redirect(url, 302);
}

export const createShortLinkRedirect = (deps: Pick<RouteDeps, "getDb">) =>
  // GET also answers HEAD, which is never counted: nobody is sent anywhere.
  new Hono().get("/:slug", async (c) => {
    // Links are made lowercase; someone typing one from a poster may not.
    const slug = c.req.param("slug").toLowerCase();
    if (slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) return unavailable(c, "missing");
    const db = deps.getDb();
    const [link] = await db
      .select({
        id: shortLink.id,
        destination: shortLink.destination,
        fallbackUrl: shortLink.fallbackUrl,
        enabled: shortLink.enabled,
        expiresAt: shortLink.expiresAt,
      })
      .from(shortLink)
      .where(eq(shortLink.slug, slug));
    if (!link) return unavailable(c, "missing");
    const now = Date.now();
    const state = linkState(link, now);
    // Not counted: the visit did not reach the link's destination.
    if (state !== "active" && link.fallbackUrl) return sendTo(c, link.fallbackUrl);
    if (state !== "active") return unavailable(c, state);

    const automated = AUTOMATED.test(c.req.header("user-agent") ?? "");
    if (c.req.method === "GET" && !automated) {
      const source: VisitSource = c.req.query(QR_MARKER) !== undefined ? "qr" : "link";
      await afterResponse(
        c,
        countVisit(db, link.id, source, now).catch((error: unknown) => {
          // A lost count must never cost the visitor their redirect.
          console.error("short link visit not counted", error);
        }),
      );
    }
    return sendTo(c, link.destination);
  });
