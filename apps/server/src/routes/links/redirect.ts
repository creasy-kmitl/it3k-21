// The public side of short links: `/l/<slug>` sends a visitor on to the
// link's destination. The web app's worker forwards these paths here, so
// links live on the web host while the database stays with the API.
import type { Database } from "@it3k/db";
import {
  LINK_UNAVAILABLE_HEADER,
  LINK_UNLOCK_HEADER,
  QR_MARKER,
  SLUG_MAX,
  SLUG_PATTERN,
  UNLOCK_ATTEMPTS_PER_MINUTE,
  type UnavailableReason,
  type UnlockFailure,
  type VisitSource,
  bangkokDay,
  shortLink,
  shortLinkUnlockAttempt,
  shortLinkVisitDay,
} from "@it3k/db/schema/short-link";
import { and, eq, lt, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";

import type { RouteDeps } from "../../middleware/current-user";
import { linkState } from ".";
import { verifyLinkPassword } from "./password";

// Link-preview fetchers and crawlers open links nobody chose to visit.
// Counted visits are meant to be people, so these are left out.
const AUTOMATED = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|embedly/i;

const UNAVAILABLE: Record<UnavailableReason, { status: 403 | 404 | 410; text: string }> = {
  missing: { status: 404, text: "ไม่พบลิงก์นี้" },
  disabled: { status: 410, text: "ลิงก์นี้ถูกปิดแล้ว" },
  expired: { status: 410, text: "ลิงก์นี้หมดอายุแล้ว" },
  locked: { status: 403, text: "ลิงก์นี้ต้องใช้รหัสผ่าน" },
};

/**
 * No redirect: the status, plus the reason in LINK_UNAVAILABLE_HEADER. The
 * web worker swaps this body for its own page, styled like the rest of the
 * site; the plain text is only seen on the API's own host. Nothing from the
 * requested path is echoed.
 */
function unavailable(c: Context, reason: UnavailableReason, failure?: UnlockFailure) {
  const { status, text } = UNAVAILABLE[reason];
  c.header(LINK_UNAVAILABLE_HEADER, reason);
  c.header("Cache-Control", "no-store");
  c.header("X-Robots-Tag", "noindex");
  if (failure) c.header(LINK_UNLOCK_HEADER, failure);
  if (failure === "limited") {
    c.header("Retry-After", "60");
    return c.text("ลองรหัสผิดหลายครั้งเกินไป รอสักครู่แล้วลองใหม่", 429);
  }
  return c.text(text, status);
}

const minuteOf = (ms: number) => Math.floor(ms / 60_000);

/** Wrong passwords tried on the link so far this minute. */
async function wrongThisMinute(db: Database, linkId: string, now: number) {
  const [row] = await db
    .select({ count: shortLinkUnlockAttempt.count })
    .from(shortLinkUnlockAttempt)
    .where(
      and(
        eq(shortLinkUnlockAttempt.linkId, linkId),
        eq(shortLinkUnlockAttempt.minute, minuteOf(now)),
      ),
    );
  return row?.count ?? 0;
}

function countWrong(db: Database, linkId: string, now: number) {
  return db.batch([
    db
      .insert(shortLinkUnlockAttempt)
      .values({ linkId, minute: minuteOf(now), count: 1 })
      .onConflictDoUpdate({
        target: [shortLinkUnlockAttempt.linkId, shortLinkUnlockAttempt.minute],
        set: { count: sql`${shortLinkUnlockAttempt.count} + 1` },
      }),
    // Past minutes no longer matter.
    db
      .delete(shortLinkUnlockAttempt)
      .where(
        and(
          eq(shortLinkUnlockAttempt.linkId, linkId),
          lt(shortLinkUnlockAttempt.minute, minuteOf(now)),
        ),
      ),
  ]);
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

type Link = { id: string; destination: string };

/** Counts a visit that reached its destination, then sends the visitor there. */
async function arrive(c: Context, db: Database, link: Link, now: number) {
  const automated = AUTOMATED.test(c.req.header("user-agent") ?? "");
  if (c.req.method !== "HEAD" && !automated) {
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
}

export const createShortLinkRedirect = (deps: Pick<RouteDeps, "getDb">) => {
  /** The link at `/:slug`, or the answer to give when there is nothing to open. */
  async function resolve(c: Context) {
    // Links are made lowercase; someone typing one from a poster may not.
    const slug = (c.req.param("slug") ?? "").toLowerCase();
    if (slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug)) {
      return { answer: unavailable(c, "missing") };
    }
    const db = deps.getDb();
    const [link] = await db
      .select({
        id: shortLink.id,
        destination: shortLink.destination,
        fallbackUrl: shortLink.fallbackUrl,
        passwordHash: shortLink.passwordHash,
        enabled: shortLink.enabled,
        expiresAt: shortLink.expiresAt,
      })
      .from(shortLink)
      .where(eq(shortLink.slug, slug));
    if (!link) return { answer: unavailable(c, "missing") };
    const now = Date.now();
    const state = linkState(link, now);
    // Not counted: the visit did not reach the link's destination.
    if (state !== "active" && link.fallbackUrl) return { answer: sendTo(c, link.fallbackUrl) };
    if (state !== "active") return { answer: unavailable(c, state) };
    return { db, link, now };
  }

  return (
    new Hono()
      // GET also answers HEAD, which is never counted: nobody is sent anywhere.
      .get("/:slug", async (c) => {
        const found = await resolve(c);
        if ("answer" in found) return found.answer;
        // The web app shows a password form for this; it posts back here.
        if (found.link.passwordHash) return unavailable(c, "locked");
        return arrive(c, found.db, found.link, found.now);
      })

      // The password form on a locked link's page.
      .post("/:slug", async (c) => {
        const found = await resolve(c);
        if ("answer" in found) return found.answer;
        const { db, link, now } = found;
        if (!link.passwordHash) return arrive(c, db, link, now);
        if ((await wrongThisMinute(db, link.id, now)) >= UNLOCK_ATTEMPTS_PER_MINUTE) {
          return unavailable(c, "locked", "limited");
        }
        const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
        const typed = typeof body.password === "string" ? body.password : "";
        if (typed && (await verifyLinkPassword(typed, link.passwordHash))) {
          return arrive(c, db, link, now);
        }
        await countWrong(db, link.id, now);
        return unavailable(c, "locked", "wrong");
      })
  );
};
