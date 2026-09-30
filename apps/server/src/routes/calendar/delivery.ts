// Delivery: what an item waits on (dependencies), the gates before a release,
// and the monitoring that follows one.
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  MONITORING_WINDOW_MS,
  SATISFIED_STATUSES,
  calendarDependency,
  calendarItem,
} from "@it3k/db/schema/calendar";
import { type SQL, and, desc, eq, inArray, isNull, notExists, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  abortUnless,
  constraintError,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { stillCalendarEditor } from "../../policies/calendar";
import {
  conflictResponse,
  editorOnly,
  id,
  idParam,
  logChange,
  optionalText,
  searchText,
} from "./shared";
import { containsAny } from "../leadership";

const SEARCH_LIMIT = 10;
/** How deep the cycle check follows upstream links. */
const MAX_DEPTH = 50;

const upstream = alias(calendarItem, "upstream");

/** SQL: how many of the item's dependencies are not finished (SATISFIED_STATUSES) yet. */
export const waitingOn = sql<number>`(select count(*) from ${calendarDependency} inner join ${calendarItem} ${upstream} on ${upstream.id} = ${calendarDependency.dependsOnId} where ${calendarDependency.itemId} = ${calendarItem.id} and ${upstream.status} not in (${sql.join(
  SATISFIED_STATUSES.map((status) => sql`${status}`),
  sql`, `,
)}))`;

/** SQL: nothing the item depends on is still unfinished. For abortUnless. */
export function dependenciesSatisfied(db: Database, itemId: string): SQL {
  return notExists(
    db
      .select({ id: calendarDependency.id })
      .from(calendarDependency)
      .innerJoin(upstream, eq(upstream.id, calendarDependency.dependsOnId))
      .where(
        and(
          eq(calendarDependency.itemId, itemId),
          notInArray(upstream.status, [...SATISFIED_STATUSES]),
        ),
      ),
  );
}

type ReleaseState = {
  environment: string | null;
  qaResult: string | null;
  releaseApprovedAt: Date | null;
  rollbackPlan: string | null;
  monitoringOwnerId: string | null;
};

/** What a release still lacks before it may be marked released. */
export async function releaseProblems(
  db: Database,
  itemId: string | null,
  release: ReleaseState,
): Promise<string[]> {
  const missing: string[] = [];
  if (!release.environment) missing.push("environment");
  if (release.qaResult !== "passed") missing.push("qa");
  if (!release.releaseApprovedAt) missing.push("approval");
  if (!release.rollbackPlan?.trim()) missing.push("rollbackPlan");
  if (!release.monitoringOwnerId) missing.push("monitoringOwner");
  if (itemId) {
    const [waiting] = await db
      .select({ id: calendarDependency.id })
      .from(calendarDependency)
      .innerJoin(upstream, eq(upstream.id, calendarDependency.dependsOnId))
      .where(
        and(
          eq(calendarDependency.itemId, itemId),
          notInArray(upstream.status, [...SATISFIED_STATUSES]),
        ),
      )
      .limit(1);
    if (waiting) missing.push("dependencies");
  }
  return missing;
}

/**
 * The monitoring item that follows a release: owned by its monitoring owner,
 * starting when the release window ends, and depending on the release.
 */
export function monitoringWrites(
  db: Database,
  actor: CurrentUser,
  release: {
    id: string;
    title: string;
    endAt: Date;
    feature: string | null;
    environment: string | null;
    monitoringOwnerId: string | null;
  },
  now: Date,
) {
  const monitoringId = crypto.randomUUID();
  const startAt = new Date(Math.max(release.endAt.getTime(), now.getTime()));
  const values = {
    id: monitoringId,
    title: `Monitor: ${release.title}`,
    mode: "delivery" as const,
    category: "monitoring" as const,
    status: "in_progress" as const,
    startAt,
    endAt: new Date(startAt.getTime() + MONITORING_WINDOW_MS),
    ownerId: release.monitoringOwnerId,
    source: `Release: ${release.title}`,
    feature: release.feature,
    environment: release.environment,
    lastConfirmedAt: now,
    lastConfirmedById: actor.id,
    createdById: actor.id,
  };
  return [
    db.insert(calendarItem).values(values),
    db
      .insert(calendarDependency)
      .values({ itemId: monitoringId, dependsOnId: release.id, createdById: actor.id }),
    logChange(db, actor, monitoringId, "create", {
      title: [null, values.title],
      dependsOn: [null, release.title],
    }),
  ];
}

const counterpart = alias(calendarItem, "counterpart");
const counterpartOwner = alias(user, "counterpart_owner");

/** What the item waits on, and what waits on it. */
export async function loadDependencies(db: Database, itemId: string) {
  const select = (link: SQL, other: SQL) =>
    db
      .select({
        id: calendarDependency.id,
        impact: calendarDependency.impact,
        itemId: counterpart.id,
        title: counterpart.title,
        status: counterpart.status,
        category: counterpart.category,
        startAt: counterpart.startAt,
        ownerName: counterpartOwner.name,
      })
      .from(calendarDependency)
      .innerJoin(counterpart, other)
      .leftJoin(counterpartOwner, eq(counterpartOwner.id, counterpart.ownerId))
      .where(link)
      .orderBy(counterpart.startAt);
  const shape = (rows: Awaited<ReturnType<typeof select>>) =>
    rows.map((row) => ({
      id: row.id,
      impact: row.impact,
      item: {
        id: row.itemId,
        title: row.title,
        status: row.status,
        category: row.category,
        startAt: row.startAt.getTime(),
        owner: row.ownerName,
      },
      satisfied: SATISFIED_STATUSES.includes(row.status),
    }));
  const dependsOn = await select(
    eq(calendarDependency.itemId, itemId),
    eq(counterpart.id, calendarDependency.dependsOnId),
  );
  const blocks = await select(
    eq(calendarDependency.dependsOnId, itemId),
    eq(counterpart.id, calendarDependency.itemId),
  );
  return { dependsOn: shape(dependsOn), blocks: shape(blocks) };
}

/** True if `from` already depends, directly or not, on `to`. */
async function reaches(db: Database, from: string, to: string) {
  let frontier = [from];
  const seen = new Set(frontier);
  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
    const rows = await db
      .select({ next: calendarDependency.dependsOnId })
      .from(calendarDependency)
      .where(inArray(calendarDependency.itemId, frontier));
    frontier = [];
    for (const { next } of rows) {
      if (next === to) return true;
      if (!seen.has(next)) {
        seen.add(next);
        frontier.push(next);
      }
    }
  }
  return false;
}

const dependencyInput = z.strictObject({ dependsOnId: id, impact: optionalText(300) });
const itemSearchQuery = z.strictObject({ q: searchText.pipe(z.string().min(1)) });

export const createDeliveryRoutes = () =>
  new Hono<CurrentUserEnv>()
    // Item picker for dependencies: any time, newest first.
    .get("/search", validate("query", itemSearchQuery), async (c) => {
      const { q } = c.req.valid("query");
      const rows = await c.var.db
        .select({
          id: calendarItem.id,
          title: calendarItem.title,
          status: calendarItem.status,
          category: calendarItem.category,
          startAt: calendarItem.startAt,
        })
        .from(calendarItem)
        .where(
          and(
            isNull(calendarItem.archivedAt),
            containsAny([calendarItem.title, calendarItem.matchId, calendarItem.feature], q),
          ),
        )
        .orderBy(desc(calendarItem.startAt))
        .limit(SEARCH_LIMIT);
      return c.json(
        { items: rows.map((row) => ({ ...row, startAt: row.startAt.getTime() })) },
        200,
      );
    })

    .post(
      "/items/:id/dependencies",
      editorOnly,
      validate("param", idParam),
      validate("json", dependencyInput),
      async (c) => {
        const { id: itemId } = c.req.valid("param");
        const { dependsOnId, impact } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        if (dependsOnId === itemId) {
          return c.json({ message: "An item cannot depend on itself" }, 400);
        }
        const found = await db
          .select({ id: calendarItem.id, title: calendarItem.title })
          .from(calendarItem)
          .where(inArray(calendarItem.id, [itemId, dependsOnId]));
        const other = found.find((row) => row.id === dependsOnId);
        if (!found.some((row) => row.id === itemId) || !other) {
          return c.json({ message: "Item not found" }, 404);
        }
        if (await reaches(db, dependsOnId, itemId)) {
          return c.json({ message: "That would make the items wait on each other" }, 400);
        }
        try {
          await db.batch([
            abortUnless(db, actor.id, stillCalendarEditor()),
            db
              .insert(calendarDependency)
              .values({ itemId, dependsOnId, impact: impact ?? null, createdById: actor.id }),
            logChange(db, actor, itemId, "dependency", {
              dependsOn: [null, other.title],
              ...(impact ? { impact: [null, impact] } : {}),
            }),
          ]);
        } catch (error) {
          if (constraintError(error) === "unique") {
            return c.json({ message: "That dependency already exists" }, 409);
          }
          const conflict = conflictResponse(error);
          if (conflict) return c.json({ message: conflict.message }, conflict.status);
          throw error;
        }
        return c.json({ ok: true }, 201);
      },
    )

    .delete("/dependencies/:id", editorOnly, validate("param", idParam), async (c) => {
      const { id: dependencyId } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db
        .select({
          itemId: calendarDependency.itemId,
          title: upstream.title,
        })
        .from(calendarDependency)
        .innerJoin(upstream, eq(upstream.id, calendarDependency.dependsOnId))
        .where(eq(calendarDependency.id, dependencyId));
      if (!current) return c.json({ message: "Dependency not found" }, 404);
      try {
        await db.batch([
          abortUnless(db, actor.id, stillCalendarEditor()),
          db.delete(calendarDependency).where(eq(calendarDependency.id, dependencyId)),
          logChange(db, actor, current.itemId, "dependency", { dependsOn: [current.title, null] }),
        ]);
      } catch (error) {
        const conflict = conflictResponse(error);
        if (conflict) return c.json({ message: conflict.message }, conflict.status);
        throw error;
      }
      return c.body(null, 204);
    });
