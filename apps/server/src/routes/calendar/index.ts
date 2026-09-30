import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  CALENDAR_CATEGORIES,
  CALENDAR_MODES,
  CALENDAR_STATUSES,
  CALENDAR_VISIBILITIES,
  CATEGORIES_BY_MODE,
  type CalendarChangeAction,
  GAMES,
  RISK_LEVELS,
  calendarChange,
  calendarItem,
  calendarItemDepartment,
  isTbd,
  statusesFor,
} from "@it3k/db/schema/calendar";
import { department } from "@it3k/db/schema/department";
import { type SQL, and, desc, eq, exists, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
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
  canApproveCalendar,
  canEditCalendar,
  stillCalendarApprover,
  stillCalendarEditor,
} from "../../policies/calendar";
import { containsAny } from "../leadership";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Widest window one list request may cover: a month view plus its edges. */
export const MAX_RANGE_MS = 62 * DAY_MS;
/** Longest single item; anything longer is a planning mistake. */
const MAX_ITEM_MS = 31 * DAY_MS;
export const LIST_LIMIT = 500;
const PEOPLE_LIMIT = 20;
const CHANGE_LOG_LIMIT = 50;
const MAX_QUERY_CODE_POINTS = 64;

const STALE_MESSAGE = "This item changed while you were editing; reload and try again";

const epochMs = z
  .number()
  .int()
  .min(Date.UTC(2020, 0, 1))
  .max(Date.UTC(2100, 0, 1));
const id = z.string().min(1).max(64);
const idParam = z.strictObject({ id: z.uuid() });

const searchText = z
  .string()
  .trim()
  .refine((q) => [...q].length <= MAX_QUERY_CODE_POINTS, {
    message: `Search is limited to ${MAX_QUERY_CODE_POINTS} characters`,
  });

/** A comma-separated query value, e.g. `?mode=operations,delivery`. */
const csvOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));

/** Trimmed optional text where blank means "none". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

/** Links must be https so the calendar never renders javascript: or data: links. */
const optionalLink = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (!value) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Links must use https")
  .transform((value) => value || null)
  .nullable()
  .optional();

const listQuery = z
  .strictObject({
    from: z.coerce.number().pipe(epochMs),
    to: z.coerce.number().pipe(epochMs),
    mode: csvOf(CALENDAR_MODES).optional(),
    category: csvOf(CALENDAR_CATEGORIES).optional(),
    status: csvOf(CALENDAR_STATUSES).optional(),
    ownerId: id.optional(),
    departmentId: id.optional(),
    game: z.enum(GAMES).optional(),
    venue: searchText.optional(),
    streamPlatform: searchText.optional(),
    environment: searchText.optional(),
    q: searchText.optional(),
    includeArchived: z.enum(["true", "false"]).optional(),
  })
  .refine((query) => query.to > query.from, { message: "`to` must be after `from`" })
  .refine((query) => query.to - query.from <= MAX_RANGE_MS, {
    message: "The range is limited to 62 days",
  });

const peopleQuery = z.strictObject({ q: searchText.optional() });

const teams = z.array(z.string().trim().min(1).max(100)).max(16);

/** Fields a create sets and an update may change. */
const itemFields = {
  title: z.string().trim().min(1).max(200),
  mode: z.enum(CALENDAR_MODES),
  category: z.enum(CALENDAR_CATEGORIES),
  status: z.enum(CALENDAR_STATUSES),
  startAt: epochMs,
  endAt: epochMs,
  ownerId: id,
  source: z.string().trim().min(1).max(200),
  visibility: z.enum(CALENDAR_VISIBILITIES),
  riskLevel: z.enum(RISK_LEVELS).nullable().optional(),
  blockedReason: optionalText(500),
  notes: optionalText(4000),
  game: z.enum(GAMES).nullable().optional(),
  matchId: optionalText(64),
  teams: teams.nullable().optional(),
  venue: optionalText(120),
  streamPlatform: optionalText(64),
  scoreboardUrl: optionalLink,
  meetingLink: optionalLink,
  agenda: optionalText(4000),
  feature: optionalText(200),
  environment: optionalText(64),
};

const departmentIds = z
  .array(id)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Each department may only be listed once");

const createInput = z.strictObject({
  ...itemFields,
  visibility: itemFields.visibility.default("internal"),
  departmentIds: departmentIds.default([]),
  /** Records that the details were checked against their source just now. */
  confirm: z.boolean().default(false),
});

const updateInput = z
  .strictObject({
    title: itemFields.title.optional(),
    mode: itemFields.mode.optional(),
    category: itemFields.category.optional(),
    status: itemFields.status.optional(),
    startAt: itemFields.startAt.optional(),
    endAt: itemFields.endAt.optional(),
    ownerId: itemFields.ownerId.optional(),
    source: itemFields.source.optional(),
    visibility: itemFields.visibility.optional(),
    riskLevel: itemFields.riskLevel,
    blockedReason: itemFields.blockedReason,
    notes: itemFields.notes,
    game: itemFields.game,
    matchId: itemFields.matchId,
    teams: itemFields.teams,
    venue: itemFields.venue,
    streamPlatform: itemFields.streamPlatform,
    scoreboardUrl: itemFields.scoreboardUrl,
    meetingLink: itemFields.meetingLink,
    agenda: itemFields.agenda,
    feature: itemFields.feature,
    environment: itemFields.environment,
    departmentIds: departmentIds.optional(),
    confirm: z.literal(true).optional(),
    archived: z.boolean().optional(),
    reason: optionalText(500),
    /** The version the client read; a newer one means someone else saved first. */
    version: z.number().int().min(1),
  })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "version" && key !== "reason"),
    "Nothing to update",
  );

const duplicateInput = z.strictObject({});

type ItemInput = {
  mode: (typeof CALENDAR_MODES)[number];
  category: (typeof CALENDAR_CATEGORIES)[number];
  status: (typeof CALENDAR_STATUSES)[number];
  startAt: number;
  endAt: number;
};

/** Rules that span fields, checked on the item as it would be saved. */
function itemProblem(item: ItemInput): string | null {
  if (!CATEGORIES_BY_MODE[item.mode].includes(item.category)) {
    return `Category ${item.category} does not belong to ${item.mode}`;
  }
  if (!statusesFor(item.mode).includes(item.status)) {
    return `Status ${item.status} does not apply to ${item.mode}`;
  }
  if (item.endAt <= item.startAt) return "The end must be after the start";
  if (item.endAt - item.startAt > MAX_ITEM_MS) return "An item may last at most 31 days";
  return null;
}

const departmentIdList = sql<
  string | null
>`(select group_concat(${calendarItemDepartment.departmentId}) from ${calendarItemDepartment} where ${calendarItemDepartment.itemId} = ${calendarItem.id})`;

function selectItems(db: Database) {
  return db
    .select({ item: calendarItem, ownerName: user.name, departmentIds: departmentIdList })
    .from(calendarItem)
    .leftJoin(user, eq(user.id, calendarItem.ownerId));
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof selectItems>["all"]>>[number];

const ms = (date: Date | null) => (date ? date.getTime() : null);

/** An item as the API returns it. Times are epoch milliseconds (UTC). */
function toItem(row: ItemRow, actor: CurrentUser) {
  const { item } = row;
  return {
    id: item.id,
    title: item.title,
    mode: item.mode,
    category: item.category,
    status: item.status,
    startAt: item.startAt.getTime(),
    endAt: item.endAt.getTime(),
    timezone: item.timezone,
    owner: item.ownerId ? { id: item.ownerId, name: row.ownerName ?? "" } : null,
    source: item.source,
    lastConfirmedAt: ms(item.lastConfirmedAt),
    visibility: item.visibility,
    approvedAt: ms(item.approvedAt),
    riskLevel: item.riskLevel,
    blockedReason: item.blockedReason,
    notes: item.notes,
    game: item.game,
    matchId: item.matchId,
    teams: item.teams ?? [],
    venue: item.venue,
    streamPlatform: item.streamPlatform,
    scoreboardUrl: item.scoreboardUrl,
    meetingLink: item.meetingLink,
    agenda: item.agenda,
    feature: item.feature,
    environment: item.environment,
    archivedAt: ms(item.archivedAt),
    version: item.version,
    updatedAt: item.updatedAt.getTime(),
    departmentIds: row.departmentIds ? row.departmentIds.split(",") : [],
    tbd: isTbd(item),
    canEdit: canEditCalendar(actor),
  };
}

export type CalendarItem = ReturnType<typeof toItem>;

async function findItem(db: Database, itemId: string, actor: CurrentUser) {
  const [row] = await selectItems(db).where(eq(calendarItem.id, itemId));
  return row ? toItem(row, actor) : null;
}

/** The owner must be a staff member or admin. */
async function ownerProblem(db: Database, ownerId: string): Promise<string | null> {
  const [owner] = await db.select({ role: user.role }).from(user).where(eq(user.id, ownerId));
  if (!owner) return "Owner not found";
  const roles = (owner.role ?? "").split(",").map((role) => role.trim());
  if (!roles.includes("staff") && !roles.includes("admin")) return "The owner must be a member";
  return null;
}

async function departmentsProblem(db: Database, ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: department.id })
    .from(department)
    .where(inArray(department.id, ids));
  return rows.length === ids.length ? null : "Department not found";
}

/** Same item, same version: nobody saved in between. For abortUnless. */
function itemIsAsRead(db: Database, itemId: string, version: number) {
  return exists(
    db
      .select({ id: calendarItem.id })
      .from(calendarItem)
      .where(and(eq(calendarItem.id, itemId), eq(calendarItem.version, version))),
  );
}

function insertDepartments(db: Database, itemId: string, ids: string[]) {
  return ids.length > 0
    ? [
        db
          .insert(calendarItemDepartment)
          .values(ids.map((departmentId) => ({ itemId, departmentId }))),
      ]
    : [];
}

type Change = Record<string, [unknown, unknown]>;

/** Stored values in the shape the change log and the API use. */
function comparable(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value === undefined) return null;
  return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Picks the one action that best describes a change, most significant first. */
function actionFor(changes: Change): CalendarChangeAction {
  if ("archivedAt" in changes) return changes.archivedAt[1] === null ? "unarchive" : "archive";
  if (changes.status?.[1] === "cancelled") return "cancel";
  if ("startAt" in changes || "endAt" in changes) return "reschedule";
  if ("visibility" in changes) return "publish";
  if ("status" in changes) return "status";
  if (Object.keys(changes).every((key) => key.startsWith("lastConfirmed"))) return "confirm";
  return "update";
}

function conflictResponse(error: unknown) {
  const kind = constraintError(error);
  if (kind === "stale") return { message: STALE_MESSAGE, status: 409 as const };
  if (kind === "foreign-key") {
    return { message: "The owner or a department no longer exists", status: 409 as const };
  }
  return null;
}

const editorOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  if (!canEditCalendar(c.var.user)) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});

export const createCalendarRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)

    .get("/items", validate("query", listQuery), async (c) => {
      const query = c.req.valid("query");
      const filters: (SQL | undefined)[] = [
        // Anything that overlaps the window, including items that span its edges.
        lt(calendarItem.startAt, new Date(query.to)),
        gt(calendarItem.endAt, new Date(query.from)),
      ];
      if (query.includeArchived !== "true") filters.push(isNull(calendarItem.archivedAt));
      if (query.mode?.length) filters.push(inArray(calendarItem.mode, query.mode));
      if (query.category?.length) filters.push(inArray(calendarItem.category, query.category));
      if (query.status?.length) filters.push(inArray(calendarItem.status, query.status));
      if (query.ownerId) filters.push(eq(calendarItem.ownerId, query.ownerId));
      if (query.game) filters.push(eq(calendarItem.game, query.game));
      if (query.venue) filters.push(containsAny([calendarItem.venue], query.venue));
      if (query.streamPlatform) {
        filters.push(containsAny([calendarItem.streamPlatform], query.streamPlatform));
      }
      if (query.environment) {
        filters.push(containsAny([calendarItem.environment], query.environment));
      }
      if (query.departmentId) {
        filters.push(
          exists(
            c.var.db
              .select({ id: calendarItemDepartment.id })
              .from(calendarItemDepartment)
              .where(
                and(
                  eq(calendarItemDepartment.itemId, calendarItem.id),
                  eq(calendarItemDepartment.departmentId, query.departmentId),
                ),
              ),
          ),
        );
      }
      if (query.q) {
        filters.push(
          containsAny(
            [
              calendarItem.title,
              calendarItem.matchId,
              calendarItem.teams,
              calendarItem.feature,
              user.name,
            ],
            query.q,
          ),
        );
      }
      const rows = await selectItems(c.var.db)
        .where(and(...filters))
        .orderBy(calendarItem.startAt, calendarItem.id)
        .limit(LIST_LIMIT + 1);
      return c.json(
        {
          items: rows.slice(0, LIST_LIMIT).map((row) => toItem(row, c.var.user)),
          truncated: rows.length > LIST_LIMIT,
          canCreate: canEditCalendar(c.var.user),
          canApprove: canApproveCalendar(c.var.user),
        },
        200,
      );
    })

    .get("/items/:id", validate("param", idParam), async (c) => {
      const { id: itemId } = c.req.valid("param");
      const db = c.var.db;
      const item = await findItem(db, itemId, c.var.user);
      if (!item) return c.json({ message: "Item not found" }, 404);
      const departments = await db
        .select({ id: department.id, name: department.name })
        .from(calendarItemDepartment)
        .innerJoin(department, eq(department.id, calendarItemDepartment.departmentId))
        .where(eq(calendarItemDepartment.itemId, itemId))
        .orderBy(department.createdAt, department.name);
      const changes = await db
        .select({
          id: calendarChange.id,
          action: calendarChange.action,
          changes: calendarChange.changes,
          reason: calendarChange.reason,
          actorUserId: calendarChange.actorUserId,
          actorName: user.name,
          createdAt: calendarChange.createdAt,
        })
        .from(calendarChange)
        .leftJoin(user, eq(user.id, calendarChange.actorUserId))
        .where(eq(calendarChange.itemId, itemId))
        // rowid breaks ties between changes saved in the same millisecond.
        .orderBy(desc(calendarChange.createdAt), sql`${calendarChange}.rowid desc`)
        .limit(CHANGE_LOG_LIMIT);
      return c.json(
        {
          ...item,
          departments,
          changes: changes.map((change) => ({
            ...change,
            createdAt: change.createdAt.getTime(),
          })),
          canApprove: canApproveCalendar(c.var.user),
        },
        200,
      );
    })

    // Owner picker. Never selects email.
    .get("/people", editorOnly, validate("query", peopleQuery), async (c) => {
      const { q } = c.req.valid("query");
      const filters: SQL[] = [
        sql`(',' || replace(${user.role}, ' ', '') || ',' like '%,staff,%' or ',' || replace(${user.role}, ' ', '') || ',' like '%,admin,%')`,
      ];
      if (q) filters.push(containsAny([user.name], q));
      const rows = await c.var.db
        .select({ id: user.id, name: user.name, departmentName: department.name })
        .from(user)
        .leftJoin(department, eq(department.id, user.departmentId))
        .where(and(...filters))
        .orderBy(user.name, user.id)
        .limit(PEOPLE_LIMIT);
      return c.json({ items: rows }, 200);
    })

    .post("/items", editorOnly, validate("json", createInput), async (c) => {
      const { departmentIds: ids, confirm, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const problem = itemProblem(fields);
      if (problem) return c.json({ message: problem }, 400);
      const approving = fields.visibility === "public";
      if (approving && !canApproveCalendar(actor)) {
        return c.json({ message: "Only approvers can publish items" }, 403);
      }
      const now = new Date();
      const confirmedAt = confirm ? now : null;
      if (approving && isTbd({ status: fields.status, lastConfirmedAt: confirmedAt })) {
        return c.json({ message: "Unconfirmed (TBD) items cannot be public" }, 400);
      }
      const invalid =
        (await ownerProblem(db, fields.ownerId)) ?? (await departmentsProblem(db, ids));
      if (invalid) return c.json({ message: invalid }, 400);

      const itemId = crypto.randomUUID();
      const values = {
        ...fields,
        startAt: new Date(fields.startAt),
        endAt: new Date(fields.endAt),
        lastConfirmedAt: confirmedAt,
        lastConfirmedById: confirm ? actor.id : null,
        approvedAt: approving ? now : null,
        approvedById: approving ? actor.id : null,
      };
      const logged: Change = {};
      for (const [key, value] of Object.entries({ ...values, departmentIds: ids })) {
        const after = comparable(value);
        if (after !== null) logged[key] = [null, after];
      }
      try {
        await db.batch([
          abortUnless(db, actor.id, approving ? stillCalendarApprover() : stillCalendarEditor()),
          db.insert(calendarItem).values({ id: itemId, ...values, createdById: actor.id }),
          ...insertDepartments(db, itemId, ids),
          db.insert(calendarChange).values({
            itemId,
            actorUserId: actor.id,
            impersonatedBy: actor.impersonatedBy,
            action: "create",
            changes: logged,
          }),
        ]);
      } catch (error) {
        const conflict = conflictResponse(error);
        if (conflict) return c.json({ message: conflict.message }, conflict.status);
        throw error;
      }
      const item = await findItem(db, itemId, actor);
      if (!item) throw new Error("Created item is missing");
      return c.json(item, 201);
    })

    .patch(
      "/items/:id",
      editorOnly,
      validate("param", idParam),
      validate("json", updateInput),
      async (c) => {
        const { id: itemId } = c.req.valid("param");
        const {
          version,
          reason,
          confirm,
          archived,
          departmentIds: ids,
          ...fields
        } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const [current] = await db.select().from(calendarItem).where(eq(calendarItem.id, itemId));
        if (!current) return c.json({ message: "Item not found" }, 404);
        if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);

        const next = {
          mode: fields.mode ?? current.mode,
          category: fields.category ?? current.category,
          status: fields.status ?? current.status,
          startAt: fields.startAt ?? current.startAt.getTime(),
          endAt: fields.endAt ?? current.endAt.getTime(),
        };
        const problem = itemProblem(next);
        if (problem) return c.json({ message: problem }, 400);

        const now = new Date();
        const set: Partial<typeof calendarItem.$inferInsert> = {};
        const changes: Change = {};
        const record = <K extends keyof typeof calendarItem.$inferInsert>(
          key: K,
          value: (typeof calendarItem.$inferInsert)[K],
        ) => {
          const before = comparable(current[key as keyof typeof current]);
          const after = comparable(value);
          if (same(before, after)) return;
          set[key] = value;
          changes[key] = [before, after];
        };
        for (const [key, value] of Object.entries(fields)) {
          if (value === undefined) continue;
          if (key === "startAt" || key === "endAt") {
            record(key, new Date(value as number));
          } else {
            record(key as keyof typeof calendarItem.$inferInsert, value as never);
          }
        }
        const rescheduled = "startAt" in changes || "endAt" in changes;
        if (confirm) {
          record("lastConfirmedAt", now);
          record("lastConfirmedById", actor.id);
        } else if (rescheduled && current.lastConfirmedAt) {
          // New times are unconfirmed until someone checks them against the source.
          record("lastConfirmedAt", null);
          record("lastConfirmedById", null);
        }
        if (archived !== undefined && archived !== (current.archivedAt !== null)) {
          record("archivedAt", archived ? now : null);
        }
        const currentIds = (
          await db
            .select({ departmentId: calendarItemDepartment.departmentId })
            .from(calendarItemDepartment)
            .where(eq(calendarItemDepartment.itemId, itemId))
        ).map((row) => row.departmentId);
        const departmentsChanged =
          ids !== undefined && !same([...currentIds].sort(), [...ids].sort());
        if (departmentsChanged) changes.departmentIds = [currentIds, ids];

        if (Object.keys(changes).length === 0) {
          const item = await findItem(db, itemId, actor);
          if (!item) return c.json({ message: "Item not found" }, 404);
          return c.json(item, 200);
        }

        const action = actionFor(changes);
        if ((action === "cancel" || rescheduled) && !reason) {
          return c.json({ message: "Say why the item is being rescheduled or cancelled" }, 400);
        }
        const visibility = set.visibility ?? current.visibility;
        const approving = "visibility" in changes;
        if (approving && !canApproveCalendar(actor)) {
          return c.json({ message: "Only approvers can change who sees an item" }, 403);
        }
        const lastConfirmedAt =
          "lastConfirmedAt" in set ? (set.lastConfirmedAt ?? null) : current.lastConfirmedAt;
        if (
          approving &&
          visibility === "public" &&
          isTbd({ status: next.status, lastConfirmedAt })
        ) {
          return c.json({ message: "Unconfirmed (TBD) items cannot be public" }, 400);
        }
        if (approving) {
          set.approvedAt = visibility === "public" ? now : null;
          set.approvedById = visibility === "public" ? actor.id : null;
        }
        const invalid =
          (set.ownerId ? await ownerProblem(db, set.ownerId) : null) ??
          (departmentsChanged && ids ? await departmentsProblem(db, ids) : null);
        if (invalid) return c.json({ message: invalid }, 400);

        let updated: { id: string }[];
        try {
          const results = await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                approving ? stillCalendarApprover() : stillCalendarEditor(),
                itemIsAsRead(db, itemId, version),
              ) ?? sql`1`,
            ),
            db
              .update(calendarItem)
              .set({ ...set, version: sql`${calendarItem.version} + 1`, updatedAt: now })
              .where(and(eq(calendarItem.id, itemId), eq(calendarItem.version, version)))
              .returning({ id: calendarItem.id }),
            ...(departmentsChanged && ids
              ? [
                  db
                    .delete(calendarItemDepartment)
                    .where(eq(calendarItemDepartment.itemId, itemId)),
                  ...insertDepartments(db, itemId, ids),
                ]
              : []),
            db.insert(calendarChange).values({
              itemId,
              actorUserId: actor.id,
              impersonatedBy: actor.impersonatedBy,
              action,
              changes,
              reason: reason ?? null,
            }),
          ]);
          updated = results[1] as { id: string }[];
        } catch (error) {
          const conflict = conflictResponse(error);
          if (conflict) return c.json({ message: conflict.message }, conflict.status);
          throw error;
        }
        if (updated.length === 0) return c.json({ message: STALE_MESSAGE }, 409);
        const item = await findItem(db, itemId, actor);
        if (!item) return c.json({ message: "Item not found" }, 404);
        return c.json(item, 200);
      },
    )

    // Copies an item as a fresh, unconfirmed, internal draft.
    .post(
      "/items/:id/duplicate",
      editorOnly,
      validate("param", idParam),
      validate("json", duplicateInput),
      async (c) => {
        const { id: sourceId } = c.req.valid("param");
        const db = c.var.db;
        const actor = c.var.user;
        const [source] = await db.select().from(calendarItem).where(eq(calendarItem.id, sourceId));
        if (!source) return c.json({ message: "Item not found" }, 404);
        const ids = (
          await db
            .select({ departmentId: calendarItemDepartment.departmentId })
            .from(calendarItemDepartment)
            .where(eq(calendarItemDepartment.itemId, sourceId))
        ).map((row) => row.departmentId);
        const {
          id: _id,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          version: _version,
          ...copied
        } = source;
        const itemId = crypto.randomUUID();
        const log = (target: string, key: string, value: string) =>
          db.insert(calendarChange).values({
            itemId: target,
            actorUserId: actor.id,
            impersonatedBy: actor.impersonatedBy,
            action: "duplicate",
            changes: { [key]: [null, value] },
          });
        try {
          await db.batch([
            abortUnless(
              db,
              actor.id,
              and(stillCalendarEditor(), itemIsAsRead(db, sourceId, source.version)) ?? sql`1`,
            ),
            db.insert(calendarItem).values({
              ...copied,
              id: itemId,
              status: source.mode === "delivery" ? "backlog" : "draft",
              visibility: "internal",
              lastConfirmedAt: null,
              lastConfirmedById: null,
              approvedAt: null,
              approvedById: null,
              archivedAt: null,
              createdById: actor.id,
            }),
            ...insertDepartments(db, itemId, ids),
            log(itemId, "duplicatedFrom", sourceId),
            log(sourceId, "duplicatedTo", itemId),
          ]);
        } catch (error) {
          const conflict = conflictResponse(error);
          if (conflict) return c.json({ message: conflict.message }, conflict.status);
          throw error;
        }
        const item = await findItem(db, itemId, actor);
        if (!item) throw new Error("Duplicated item is missing");
        return c.json(item, 201);
      },
    );

export type CalendarRoutes = ReturnType<typeof createCalendarRoutes>;
