import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  DESTINATION_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  type DestinationProblem,
  QR_MARKER,
  RANDOM_SLUG_ALPHABET,
  RANDOM_SLUG_LENGTH,
  SHORT_LINK_PATH,
  SLUG_MAX,
  SLUG_MIN,
  SLUG_PATTERN,
  DEFAULT_STATS_RANGE,
  STATS_RANGES,
  type ShortLinkChangeAction,
  type StatsRange,
  TAG_MAX_COUNT,
  TAG_MAX_LENGTH,
  TITLE_MAX,
  type VisitSource,
  bangkokDay,
  destinationProblem,
  normalizeTag,
  shortLink,
  shortLinkChange,
  shortLinkVisitDay,
} from "@it3k/db/schema/short-link";
import { type SQL, and, desc, eq, exists, gte, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import {
  canCreateLinks,
  canEditLink,
  canManageAllLinks,
  stillLinkCreator,
  stillLinkEditor,
} from "../../policies/short-links";
import {
  type Change,
  comparable,
  epochMs,
  idParam,
  ms,
  same,
  searchText,
} from "../calendar/shared";
import { containsAny } from "../leadership";
import { hashLinkPassword } from "./password";

export type LinkRouteDeps = RouteDeps & {
  /** The web app's origin, which serves `/l/<slug>`; e.g. `https://it3k.creasy.club`. */
  webOrigin: string;
};

export const LIST_LIMIT = 200;
const CHANGE_LOG_LIMIT = 50;
const RANDOM_SLUG_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export const STALE_MESSAGE = "This link changed while you were editing; reload and try again";

/** Machine-readable reasons, which the web app words in Thai. */
export type LinkErrorCode = DestinationProblem | "slug-taken" | "slug-duplicate" | "expiry-past";

/** Most links one bulk request may create. */
export const BULK_MAX = 100;
/** D1 allows 100 bound parameters per statement; multi-row inserts stay under it. */
const MAX_PARAMS = 100;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(SLUG_MIN)
  .max(SLUG_MAX)
  .regex(SLUG_PATTERN, "Use a-z, 0-9 and hyphens, not at either end");
const title = z.string().trim().min(1).max(TITLE_MAX);
const destination = z.string().trim().min(1).max(DESTINATION_MAX);
/** Blank means none. */
const fallbackUrl = z
  .string()
  .trim()
  .max(DESTINATION_MAX)
  .transform((value) => value || null)
  .nullable();
/** What visitors must type first; it is hashed at once and never returned. */
const password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);

/** Normalized, blanks dropped, duplicates merged, in the order given. */
const tags = z
  .array(z.string().max(TAG_MAX_LENGTH * 2))
  .transform((list) => [...new Set(list.map(normalizeTag).filter(Boolean))])
  .pipe(z.array(z.string()).max(TAG_MAX_COUNT));

const listQuery = z.strictObject({
  q: searchText.optional(),
  /** Only the viewer's own links. */
  mine: z.enum(["1"]).optional(),
  /** Only links with this tag. */
  tag: z
    .string()
    .max(TAG_MAX_LENGTH * 2)
    .transform(normalizeTag)
    .optional(),
});

const detailQuery = z.strictObject({
  /** Days of visits to chart, today included. */
  days: z
    .enum(STATS_RANGES.map(String) as [string, ...string[]])
    .transform((days) => Number(days) as StatsRange)
    .optional(),
});

const createInput = z.strictObject({
  title,
  destination,
  /** Chosen by the creator, or a random one when left out. */
  slug: slug.optional(),
  expiresAt: epochMs.nullable().optional(),
  fallbackUrl: fallbackUrl.optional(),
  tags: tags.default([]),
  password: password.optional(),
});

const bulkInput = z.strictObject({ links: z.array(createInput).min(1).max(BULK_MAX) });

const visitsQuery = z.strictObject({
  days: detailQuery.shape.days,
  mine: listQuery.shape.mine,
  tag: listQuery.shape.tag,
});

const updateInput = z
  .strictObject({
    title: title.optional(),
    destination: destination.optional(),
    enabled: z.boolean().optional(),
    expiresAt: epochMs.nullable().optional(),
    fallbackUrl: fallbackUrl.optional(),
    tags: tags.optional(),
    /** A new password, or null to remove it. */
    password: password.nullable().optional(),
    /** The version the client read; a newer one means someone else saved first. */
    version: z.number().int().min(1),
  })
  .refine((input) => Object.keys(input).some((key) => key !== "version"), "Nothing to update");

/** `list` in runs of at most `size`. */
function chunks<T>(list: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) =>
    list.slice(i * size, (i + 1) * size),
  );
}

type CreateInput = z.infer<typeof createInput>;

/** A new link's stored values, minus its id and slug. */
function newLinkValues(input: CreateInput, actor: CurrentUser) {
  return {
    title: input.title,
    destination: input.destination,
    fallbackUrl: input.fallbackUrl ?? null,
    tags: input.tags,
    enabled: true,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    ownerId: actor.id,
  };
}

/** The change-log entry for a new link: every field it was given. */
function createdChange(slug: string, values: ReturnType<typeof newLinkValues>): Change {
  const logged: Change = { slug: [null, slug] };
  for (const [key, value] of Object.entries(values)) {
    const after = comparable(value);
    const empty = after === null || (Array.isArray(after) && after.length === 0);
    if (!empty && key !== "ownerId") logged[key] = [null, after];
  }
  return logged;
}

/** Which of `slugs` already belong to a link. */
async function takenSlugs(db: Database, slugs: string[]) {
  const taken = new Set<string>();
  for (const run of chunks(slugs, MAX_PARAMS)) {
    const rows = await db
      .select({ slug: shortLink.slug })
      .from(shortLink)
      .where(inArray(shortLink.slug, run));
    for (const row of rows) taken.add(row.slug);
  }
  return taken;
}

function randomSlug() {
  const bytes = crypto.getRandomValues(new Uint8Array(RANDOM_SLUG_LENGTH));
  return Array.from(bytes, (byte) => RANDOM_SLUG_ALPHABET[byte % RANDOM_SLUG_ALPHABET.length]).join(
    "",
  );
}

/** Live, switched off, or past its expiry: what a visitor to the link gets. */
export function linkState(
  link: { enabled: boolean; expiresAt: Date | null },
  now = Date.now(),
): "active" | "disabled" | "expired" {
  if (!link.enabled) return "disabled";
  if (link.expiresAt && link.expiresAt.getTime() <= now) return "expired";
  return "active";
}

const visitsFrom = (source: VisitSource) =>
  sql<number>`(select coalesce(sum(${shortLinkVisitDay.count}), 0) from ${shortLinkVisitDay} where ${shortLinkVisitDay.linkId} = ${shortLink.id} and ${shortLinkVisitDay.source} = ${source})`;

function selectLinks(db: Database) {
  return db
    .select({
      link: shortLink,
      ownerName: user.name,
      qrVisits: visitsFrom("qr"),
      linkVisits: visitsFrom("link"),
    })
    .from(shortLink)
    .leftJoin(user, eq(user.id, shortLink.ownerId));
}

type LinkRow = Awaited<ReturnType<ReturnType<typeof selectLinks>["all"]>>[number];

/** A link as the API returns it. Times are epoch milliseconds (UTC). */
function toLink(row: LinkRow, actor: CurrentUser, webOrigin: string) {
  const { link } = row;
  const shortUrl = `${webOrigin}${SHORT_LINK_PATH}${link.slug}`;
  return {
    id: link.id,
    slug: link.slug,
    title: link.title,
    destination: link.destination,
    fallbackUrl: link.fallbackUrl,
    tags: link.tags,
    /** Whether visitors must type a password first; the password itself never leaves the API. */
    hasPassword: link.passwordHash !== null,
    enabled: link.enabled,
    expiresAt: ms(link.expiresAt),
    state: linkState(link),
    /** The link to share as text. */
    shortUrl,
    /** The link to put in a QR code, so its visits are counted apart. */
    qrUrl: `${shortUrl}?${QR_MARKER}`,
    owner: link.ownerId ? { id: link.ownerId, name: row.ownerName ?? "" } : null,
    visits: { qr: Number(row.qrVisits), link: Number(row.linkVisits) },
    version: link.version,
    createdAt: link.createdAt.getTime(),
    updatedAt: link.updatedAt.getTime(),
    canEdit: canEditLink(actor, link.ownerId),
  };
}

export type ShortLink = ReturnType<typeof toLink>;

async function findLink(db: Database, linkId: string, actor: CurrentUser, webOrigin: string) {
  const [row] = await selectLinks(db).where(eq(shortLink.id, linkId));
  return row ? toLink(row, actor, webOrigin) : null;
}

/** Visits per Bangkok day for the last `span` days, oldest first, with empty days as 0. */
async function dailyVisits(db: Database, linkId: string, span: StatsRange, now = Date.now()) {
  const days = Array.from({ length: span }, (_, i) => bangkokDay(now - (span - 1 - i) * DAY_MS));
  const rows = await db
    .select({
      day: shortLinkVisitDay.day,
      source: shortLinkVisitDay.source,
      count: shortLinkVisitDay.count,
    })
    .from(shortLinkVisitDay)
    .where(and(eq(shortLinkVisitDay.linkId, linkId), gte(shortLinkVisitDay.day, days[0] ?? "")));
  const byDay = new Map(days.map((day) => [day, { day, qr: 0, link: 0 }]));
  for (const row of rows) {
    const entry = byDay.get(row.day);
    if (entry) entry[row.source] += row.count;
  }
  return [...byDay.values()];
}

/** Same link, same version: nobody saved in between. For abortUnless. */
function linkIsAsRead(db: Database, linkId: string, version: number) {
  return exists(
    db
      .select({ id: shortLink.id })
      .from(shortLink)
      .where(and(eq(shortLink.id, linkId), eq(shortLink.version, version))),
  );
}

function logChange(
  db: Database,
  actor: CurrentUser,
  linkId: string,
  action: ShortLinkChangeAction,
  changes: Change,
) {
  return db.insert(shortLinkChange).values({
    linkId,
    actorUserId: actor.id,
    impersonatedBy: actor.impersonatedBy,
    action,
    changes,
  });
}

/** An enable or disable on its own reads better in the log than a generic update. */
function actionFor(changes: Change): ShortLinkChangeAction {
  const keys = Object.keys(changes);
  if (keys.length === 1 && keys[0] === "enabled") {
    return changes.enabled?.[1] ? "enable" : "disable";
  }
  return "update";
}

/** Which input a refusal is about, so the form can mark that field. */
export type LinkErrorField = "destination" | "fallbackUrl" | "slug" | "expiresAt";

const refuse = (code: LinkErrorCode, field: LinkErrorField, message: string) => ({
  code,
  field,
  message,
});

function expiryProblem(expiresAt: number | null | undefined) {
  if (expiresAt && expiresAt <= Date.now()) {
    return refuse(
      "expiry-past",
      "expiresAt",
      "The expiry must be in the future; switch the link off instead",
    );
  }
  return null;
}

export const createLinkRoutes = (deps: LinkRouteDeps) => {
  const shortLinkHost = new URL(deps.webOrigin).host;
  const checkUrl = (value: string | null | undefined, field: "destination" | "fallbackUrl") => {
    const problem = value ? destinationProblem(value, shortLinkHost) : null;
    return problem ? refuse(problem, field, `The ${field} is not allowed (${problem})`) : null;
  };

  return (
    new Hono<CurrentUserEnv>()
      .use(requireJsonPosts)
      .use(requireUser(deps))
      .use(requireMember)

      .get("/", validate("query", listQuery), async (c) => {
        const { q, mine, tag } = c.req.valid("query");
        const filters: (SQL | undefined)[] = [];
        if (mine) filters.push(eq(shortLink.ownerId, c.var.user.id));
        if (tag) {
          filters.push(
            sql`exists (select 1 from json_each(${shortLink.tags}) where value = ${tag})`,
          );
        }
        if (q) {
          filters.push(
            containsAny([shortLink.title, shortLink.slug, shortLink.destination, user.name], q),
          );
        }
        const rows = await selectLinks(c.var.db)
          .where(and(...filters))
          // rowid puts the newer of two links saved in the same millisecond first.
          .orderBy(desc(shortLink.updatedAt), sql`${shortLink}.rowid desc`)
          .limit(LIST_LIMIT + 1);
        // Every tag in use, for the filter; few links, so this stays small.
        const tagRows = await c.var.db
          .select({ tag: sql<string>`distinct json_each.value` })
          .from(sql`${shortLink}, json_each(${shortLink.tags})`)
          .orderBy(sql`json_each.value`);
        return c.json(
          {
            items: rows.slice(0, LIST_LIMIT).map((row) => toLink(row, c.var.user, deps.webOrigin)),
            truncated: rows.length > LIST_LIMIT,
            tags: tagRows.map((row) => row.tag),
            canCreate: canCreateLinks(c.var.user),
            canManageAll: canManageAllLinks(c.var.user),
          },
          200,
        );
      })

      // Visits per link per day, for a spreadsheet. Only days with visits.
      // Registered before "/:id", which would otherwise take the path.
      .get("/visits", validate("query", visitsQuery), async (c) => {
        const { days = DEFAULT_STATS_RANGE, mine, tag } = c.req.valid("query");
        const now = Date.now();
        const from = bangkokDay(now - (days - 1) * DAY_MS);
        const filters: (SQL | undefined)[] = [gte(shortLinkVisitDay.day, from)];
        if (mine) filters.push(eq(shortLink.ownerId, c.var.user.id));
        if (tag) {
          filters.push(
            sql`exists (select 1 from json_each(${shortLink.tags}) where value = ${tag})`,
          );
        }
        const rows = await c.var.db
          .select({
            slug: shortLink.slug,
            title: shortLink.title,
            day: shortLinkVisitDay.day,
            qr: sql<number>`sum(case when ${shortLinkVisitDay.source} = 'qr' then ${shortLinkVisitDay.count} else 0 end)`,
            link: sql<number>`sum(case when ${shortLinkVisitDay.source} = 'link' then ${shortLinkVisitDay.count} else 0 end)`,
          })
          .from(shortLinkVisitDay)
          .innerJoin(shortLink, eq(shortLink.id, shortLinkVisitDay.linkId))
          .where(and(...filters))
          .groupBy(shortLink.id, shortLinkVisitDay.day)
          .orderBy(shortLink.slug, shortLinkVisitDay.day);
        return c.json(
          {
            from,
            to: bangkokDay(now),
            rows: rows.map((row) => ({ ...row, qr: Number(row.qr), link: Number(row.link) })),
          },
          200,
        );
      })

      .get("/:id", validate("param", idParam), validate("query", detailQuery), async (c) => {
        const { id: linkId } = c.req.valid("param");
        const { days = DEFAULT_STATS_RANGE } = c.req.valid("query");
        const db = c.var.db;
        const link = await findLink(db, linkId, c.var.user, deps.webOrigin);
        if (!link) return c.json({ message: "Link not found" }, 404);
        const [changes, daily] = await Promise.all([
          db
            .select({
              id: shortLinkChange.id,
              action: shortLinkChange.action,
              changes: shortLinkChange.changes,
              actorUserId: shortLinkChange.actorUserId,
              actorName: user.name,
              createdAt: shortLinkChange.createdAt,
            })
            .from(shortLinkChange)
            .leftJoin(user, eq(user.id, shortLinkChange.actorUserId))
            .where(eq(shortLinkChange.linkId, linkId))
            // rowid breaks ties between changes saved in the same millisecond.
            .orderBy(desc(shortLinkChange.createdAt), sql`${shortLinkChange}.rowid desc`)
            .limit(CHANGE_LOG_LIMIT),
          dailyVisits(db, linkId, days),
        ]);
        return c.json(
          {
            ...link,
            daily,
            changes: changes.map((change) => ({
              ...change,
              createdAt: change.createdAt.getTime(),
            })),
          },
          200,
        );
      })

      .post("/", validate("json", createInput), async (c) => {
        const input = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        if (!canCreateLinks(actor)) return c.json({ message: "Forbidden" }, 403);
        const invalid =
          checkUrl(input.destination, "destination") ??
          checkUrl(input.fallbackUrl, "fallbackUrl") ??
          expiryProblem(input.expiresAt);
        if (invalid) return c.json(invalid, 400);

        const values = newLinkValues(input, actor);
        const passwordHash = input.password ? await hashLinkPassword(input.password) : null;
        // A chosen slug gets one try; a random one retries on the rare clash.
        const attempts = input.slug ? 1 : RANDOM_SLUG_ATTEMPTS;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const linkId = crypto.randomUUID();
          const chosen = input.slug ?? randomSlug();
          const logged = createdChange(chosen, values);
          // Logged as set, never as the password itself.
          if (passwordHash) logged.password = [false, true];
          try {
            await db.batch([
              abortUnless(db, actor.id, stillLinkCreator()),
              db.insert(shortLink).values({ id: linkId, slug: chosen, passwordHash, ...values }),
              logChange(db, actor, linkId, "create", logged),
            ]);
          } catch (error) {
            const kind = constraintError(error);
            if (kind === "unique" && attempt < attempts) continue;
            if (kind === "unique") {
              return c.json(refuse("slug-taken", "slug", "That short name is already in use"), 409);
            }
            if (kind === "stale") return c.json({ message: "Forbidden" }, 403);
            throw error;
          }
          const link = await findLink(db, linkId, actor, deps.webOrigin);
          if (!link) throw new Error("Created link is missing");
          return c.json(link, 201);
        }
        throw new Error("unreachable");
      })

      // Many links at once, e.g. one per booth from a spreadsheet. Every row is
      // checked first and the problems are reported by row; then all are
      // created in one batch, so it is all or nothing.
      .post("/bulk", validate("json", bulkInput), async (c) => {
        const { links } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        if (!canCreateLinks(actor)) return c.json({ message: "Forbidden" }, 403);

        const rowProblems = async () => {
          const rows: (ReturnType<typeof refuse> & { index: number })[] = [];
          const firstUse = new Map<string, number>();
          links.forEach((link, index) => {
            const problem =
              checkUrl(link.destination, "destination") ??
              checkUrl(link.fallbackUrl, "fallbackUrl") ??
              expiryProblem(link.expiresAt);
            if (problem) rows.push({ index, ...problem });
            if (!link.slug) return;
            if (firstUse.has(link.slug)) {
              rows.push({
                index,
                ...refuse("slug-duplicate", "slug", "The same short name appears twice"),
              });
            } else firstUse.set(link.slug, index);
          });
          const taken = await takenSlugs(db, [...firstUse.keys()]);
          for (const [slug, index] of firstUse) {
            if (taken.has(slug)) {
              rows.push({
                index,
                ...refuse("slug-taken", "slug", "That short name is already in use"),
              });
            }
          }
          return rows.sort((a, b) => a.index - b.index);
        };
        const refused = (status: 400 | 409, rows: Awaited<ReturnType<typeof rowProblems>>) =>
          c.json({ code: "rows" as const, message: "Some rows cannot be created", rows }, status);

        const problems = await rowProblems();
        if (problems.length > 0) return refused(400, problems);

        const attempts = links.some((link) => !link.slug) ? RANDOM_SLUG_ATTEMPTS : 1;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const rows = links.map((link) => {
            const values = newLinkValues(link, actor);
            const slug = link.slug ?? randomSlug();
            return { id: crypto.randomUUID(), slug, values };
          });
          const linkColumns = Object.keys(rows[0]?.values ?? {}).length + 2;
          try {
            await db.batch([
              abortUnless(db, actor.id, stillLinkCreator()),
              ...chunks(rows, Math.floor(MAX_PARAMS / linkColumns)).map((run) =>
                db
                  .insert(shortLink)
                  .values(run.map((row) => ({ id: row.id, slug: row.slug, ...row.values }))),
              ),
              ...chunks(rows, Math.floor(MAX_PARAMS / 6)).map((run) =>
                db.insert(shortLinkChange).values(
                  run.map((row) => ({
                    linkId: row.id,
                    actorUserId: actor.id,
                    impersonatedBy: actor.impersonatedBy,
                    action: "create" as const,
                    changes: createdChange(row.slug, row.values),
                  })),
                ),
              ),
            ]);
          } catch (error) {
            const kind = constraintError(error);
            if (kind === "stale") return c.json({ message: "Forbidden" }, 403);
            if (kind !== "unique") throw error;
            // Someone took a chosen slug in between, or a random one clashed.
            const late = await rowProblems();
            if (late.length > 0) return refused(409, late);
            if (attempt < attempts) continue;
            throw error;
          }
          const ids: string[] = rows.map((row) => row.id);
          const created = [];
          for (const run of chunks(ids, MAX_PARAMS)) {
            created.push(...(await selectLinks(db).where(inArray(shortLink.id, run))));
          }
          const order = new Map(ids.map((id, index) => [id, index]));
          created.sort((a, b) => (order.get(a.link.id) ?? 0) - (order.get(b.link.id) ?? 0));
          return c.json({ items: created.map((row) => toLink(row, actor, deps.webOrigin)) }, 201);
        }
        throw new Error("unreachable");
      })

      .patch("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
        const { id: linkId } = c.req.valid("param");
        const { version, ...fields } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const [current] = await db.select().from(shortLink).where(eq(shortLink.id, linkId));
        if (!current) return c.json({ message: "Link not found" }, 404);
        if (!canEditLink(actor, current.ownerId)) return c.json({ message: "Forbidden" }, 403);
        if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);

        const set: Partial<typeof shortLink.$inferInsert> = {};
        const changes: Change = {};
        const record = <K extends keyof typeof shortLink.$inferInsert>(
          key: K,
          value: (typeof shortLink.$inferInsert)[K],
        ) => {
          const before = comparable(current[key as keyof typeof current]);
          const after = comparable(value);
          if (same(before, after)) return;
          set[key] = value;
          changes[key] = [before, after];
        };
        if (fields.title !== undefined) record("title", fields.title);
        if (fields.destination !== undefined) record("destination", fields.destination);
        if (fields.fallbackUrl !== undefined) record("fallbackUrl", fields.fallbackUrl);
        if (fields.tags !== undefined) record("tags", fields.tags);
        if (fields.password !== undefined) {
          // A new password is always a change; the log says only whether one is set.
          set.passwordHash =
            fields.password === null ? null : await hashLinkPassword(fields.password);
          if (fields.password !== null || current.passwordHash !== null) {
            changes.password = [current.passwordHash !== null, fields.password !== null];
          }
        }
        if (fields.enabled !== undefined) record("enabled", fields.enabled);
        if (fields.expiresAt !== undefined) {
          record("expiresAt", fields.expiresAt === null ? null : new Date(fields.expiresAt));
        }

        if (Object.keys(changes).length === 0) {
          const link = await findLink(db, linkId, actor, deps.webOrigin);
          if (!link) return c.json({ message: "Link not found" }, 404);
          return c.json(link, 200);
        }
        // Only what changes is checked, so an old link can still be switched off.
        const invalid =
          ("destination" in changes ? checkUrl(fields.destination, "destination") : null) ??
          ("fallbackUrl" in changes ? checkUrl(fields.fallbackUrl, "fallbackUrl") : null) ??
          ("expiresAt" in changes ? expiryProblem(fields.expiresAt) : null);
        if (invalid) return c.json(invalid, 400);

        let updated: { id: string }[];
        try {
          const results = await db.batch([
            abortUnless(
              db,
              actor.id,
              and(stillLinkEditor(current.ownerId), linkIsAsRead(db, linkId, version)) ?? sql`1`,
            ),
            db
              .update(shortLink)
              .set({ ...set, version: sql`${shortLink.version} + 1`, updatedAt: new Date() })
              .where(and(eq(shortLink.id, linkId), eq(shortLink.version, version)))
              .returning({ id: shortLink.id }),
            logChange(db, actor, linkId, actionFor(changes), changes),
          ]);
          updated = results[1] as { id: string }[];
        } catch (error) {
          if (constraintError(error) === "stale") return c.json({ message: STALE_MESSAGE }, 409);
          throw error;
        }
        if (updated.length === 0) return c.json({ message: STALE_MESSAGE }, 409);
        const link = await findLink(db, linkId, actor, deps.webOrigin);
        if (!link) return c.json({ message: "Link not found" }, 404);
        return c.json(link, 200);
      })
  );
};

export type LinkRoutes = ReturnType<typeof createLinkRoutes>;
