import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  CALENDAR_STATUSES,
  CALENDAR_VISIBILITIES,
  type CalendarChangeAction,
  calendarChange,
  calendarItem,
  canBePublic,
} from "@it3k/db/schema/calendar";
import { department, departmentAppearance } from "@it3k/db/schema/department";
import { hasRole } from "@it3k/auth/permissions";
import { type SQL, and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  abortUnless,
  requireJsonPosts,
  requireMember,
  requireUser,
  type RouteDeps,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import {
  canCreateItems,
  canEditDepartment,
  canPublishDepartment,
  stillAdmin,
  stillDepartmentEditor,
  stillDepartmentPublisher,
} from "../../policies/calendar";
import { containsAny } from "../leadership";
import { createNotificationRoutes, notify } from "./notifications";
import {
  type Change,
  STALE_MESSAGE,
  comparable,
  conflictResponse,
  epochMs,
  id,
  idParam,
  itemIsAsRead,
  logChange,
  ms,
  optionalText,
  ownerProblem,
  same,
  searchText,
} from "./shared";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Widest window one list request may cover: a month view plus its edges. */
export const MAX_RANGE_MS = 62 * DAY_MS;
/** Longest single item; anything longer is a planning mistake. */
const MAX_ITEM_MS = 31 * DAY_MS;
export const LIST_LIMIT = 500;
const PEOPLE_LIMIT = 20;
const CHANGE_LOG_LIMIT = 50;

/** A comma-separated query value, e.g. `?status=draft,confirmed`. */
const csvOf = <T extends z.ZodType<string, string>>(value: T, max: number) =>
  z
    .string()
    .transform((list) => list.split(",").filter(Boolean))
    .pipe(z.array(value).max(max));

const listQuery = z
  .strictObject({
    from: z.coerce.number().pipe(epochMs),
    to: z.coerce.number().pipe(epochMs),
    /** Omitted means every department. */
    departmentIds: csvOf(id, 50).optional(),
    status: csvOf(z.enum(CALENDAR_STATUSES), CALENDAR_STATUSES.length).optional(),
    ownerId: id.optional(),
    q: searchText.optional(),
  })
  .refine((query) => query.to > query.from, { message: "`to` must be after `from`" })
  .refine((query) => query.to - query.from <= MAX_RANGE_MS, {
    message: "The range is limited to 62 days",
  });

const peopleQuery = z.strictObject({ q: searchText.optional() });

const itemFields = {
  title: z.string().trim().min(1).max(200),
  departmentId: id,
  status: z.enum(CALENDAR_STATUSES),
  startAt: epochMs,
  endAt: epochMs,
  venue: optionalText(120),
  notes: optionalText(4000),
  ownerId: id.nullable().optional(),
  visibility: z.enum(CALENDAR_VISIBILITIES),
};

const createInput = z.strictObject({
  ...itemFields,
  /** Defaults to the creator's own department. */
  departmentId: itemFields.departmentId.optional(),
  status: itemFields.status.default("confirmed"),
  visibility: itemFields.visibility.default("internal"),
});

const updateInput = z
  .strictObject({
    title: itemFields.title.optional(),
    departmentId: itemFields.departmentId.optional(),
    status: itemFields.status.optional(),
    startAt: itemFields.startAt.optional(),
    endAt: itemFields.endAt.optional(),
    venue: itemFields.venue,
    notes: itemFields.notes,
    ownerId: itemFields.ownerId,
    visibility: itemFields.visibility.optional(),
    reason: optionalText(500),
    /** The version the client read; a newer one means someone else saved first. */
    version: z.number().int().min(1),
  })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "version" && key !== "reason"),
    "Nothing to update",
  );

const deleteQuery = z.strictObject({ version: z.coerce.number().int().min(1) });

function timeProblem(item: { startAt: number; endAt: number }): string | null {
  if (item.endAt <= item.startAt) return "The end must be after the start";
  if (item.endAt - item.startAt > MAX_ITEM_MS) return "An item may last at most 31 days";
  return null;
}

async function departmentExists(db: Database, departmentId: string) {
  const [row] = await db
    .select({ id: department.id })
    .from(department)
    .where(eq(department.id, departmentId));
  return !!row;
}

function selectItems(db: Database) {
  return db
    .select({
      item: calendarItem,
      ownerName: user.name,
      departmentName: department.name,
      departmentIcon: department.icon,
      departmentColor: department.color,
    })
    .from(calendarItem)
    .innerJoin(department, eq(department.id, calendarItem.departmentId))
    .leftJoin(user, eq(user.id, calendarItem.ownerId));
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof selectItems>["all"]>>[number];

/** An item as the API returns it. Times are epoch milliseconds (UTC). */
function toItem(row: ItemRow, actor: CurrentUser) {
  const { item } = row;
  return {
    id: item.id,
    department: departmentAppearance({
      id: item.departmentId,
      name: row.departmentName,
      icon: row.departmentIcon,
      color: row.departmentColor,
    }),
    title: item.title,
    status: item.status,
    startAt: item.startAt.getTime(),
    endAt: item.endAt.getTime(),
    timezone: item.timezone,
    venue: item.venue,
    notes: item.notes,
    owner: item.ownerId ? { id: item.ownerId, name: row.ownerName ?? "" } : null,
    visibility: item.visibility,
    approvedAt: ms(item.approvedAt),
    version: item.version,
    updatedAt: item.updatedAt.getTime(),
    canEdit: canEditDepartment(actor, item.departmentId),
    canPublish: canPublishDepartment(actor, item.departmentId),
  };
}

export type CalendarItem = ReturnType<typeof toItem>;

async function findItem(db: Database, itemId: string, actor: CurrentUser) {
  const [row] = await selectItems(db).where(eq(calendarItem.id, itemId));
  return row ? toItem(row, actor) : null;
}

/** Picks the one action that best describes a change, most significant first. */
function actionFor(changes: Change, explicitlyPublished: boolean): CalendarChangeAction {
  if (changes.status?.[1] === "cancelled") return "cancel";
  if ("startAt" in changes || "endAt" in changes) return "reschedule";
  if (explicitlyPublished) return "publish";
  if ("status" in changes) return "status";
  return "update";
}

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
      if (query.departmentIds?.length) {
        filters.push(inArray(calendarItem.departmentId, query.departmentIds));
      }
      if (query.status?.length) filters.push(inArray(calendarItem.status, query.status));
      if (query.ownerId) filters.push(eq(calendarItem.ownerId, query.ownerId));
      if (query.q) {
        filters.push(containsAny([calendarItem.title, calendarItem.venue, user.name], query.q));
      }
      const rows = await selectItems(c.var.db)
        .where(and(...filters))
        .orderBy(calendarItem.startAt, calendarItem.id)
        .limit(LIST_LIMIT + 1);
      return c.json(
        {
          items: rows.slice(0, LIST_LIMIT).map((row) => toItem(row, c.var.user)),
          truncated: rows.length > LIST_LIMIT,
          canCreate: canCreateItems(c.var.user),
          /** The viewer's own department, which the calendar opens on. */
          myDepartmentId: c.var.user.departmentId,
          isAdmin: hasRole(c.var.user.role, "admin"),
          /** Whether the viewer may publish their own department's items. */
          canPublishOwn:
            c.var.user.departmentId !== null &&
            canPublishDepartment(c.var.user, c.var.user.departmentId),
        },
        200,
      );
    })

    .get("/items/:id", validate("param", idParam), async (c) => {
      const { id: itemId } = c.req.valid("param");
      const db = c.var.db;
      const item = await findItem(db, itemId, c.var.user);
      if (!item) return c.json({ message: "Item not found" }, 404);
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
          changes: changes.map((change) => ({
            ...change,
            createdAt: change.createdAt.getTime(),
          })),
        },
        200,
      );
    })

    // Owner picker. Never selects email.
    .get("/people", validate("query", peopleQuery), async (c) => {
      if (!canCreateItems(c.var.user)) return c.json({ message: "Forbidden" }, 403);
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

    .post("/items", validate("json", createInput), async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const departmentId = input.departmentId ?? actor.departmentId;
      if (!departmentId) return c.json({ message: "Choose a department" }, 400);
      if (!canEditDepartment(actor, departmentId)) {
        return c.json({ message: "You can only add items to your own department" }, 403);
      }
      const problem = timeProblem(input);
      if (problem) return c.json({ message: problem }, 400);
      const publishing = input.visibility === "public";
      if (publishing && !canPublishDepartment(actor, departmentId)) {
        return c.json({ message: "Only the department's head or vicehead can publish" }, 403);
      }
      if (publishing && !canBePublic(input)) {
        return c.json({ message: "Only confirmed items can be public" }, 400);
      }
      if (!(await departmentExists(db, departmentId))) {
        return c.json({ message: "Department not found" }, 400);
      }
      const invalid = input.ownerId ? await ownerProblem(db, input.ownerId) : null;
      if (invalid) return c.json({ message: invalid }, 400);

      const now = new Date();
      const itemId = crypto.randomUUID();
      const values = {
        departmentId,
        title: input.title,
        status: input.status,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        venue: input.venue ?? null,
        notes: input.notes ?? null,
        ownerId: input.ownerId ?? null,
        visibility: input.visibility,
        approvedAt: publishing ? now : null,
        approvedById: publishing ? actor.id : null,
      };
      const logged: Change = {};
      for (const [key, value] of Object.entries(values)) {
        const after = comparable(value);
        if (after !== null) logged[key] = [null, after];
      }
      try {
        await db.batch([
          abortUnless(
            db,
            actor.id,
            publishing
              ? stillDepartmentPublisher(departmentId)
              : stillDepartmentEditor(departmentId),
          ),
          db.insert(calendarItem).values({ id: itemId, ...values, createdById: actor.id }),
          logChange(db, actor, itemId, "create", logged),
          ...notify(db, actor, [values.ownerId], {
            kind: "assignment",
            itemId,
            itemTitle: values.title,
            data: { startAt: input.startAt },
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

    .patch("/items/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const { id: itemId } = c.req.valid("param");
      const { version, reason, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db.select().from(calendarItem).where(eq(calendarItem.id, itemId));
      if (!current) return c.json({ message: "Item not found" }, 404);
      if (!canEditDepartment(actor, current.departmentId)) {
        return c.json({ message: "Forbidden" }, 403);
      }
      if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);

      const next = {
        departmentId: fields.departmentId ?? current.departmentId,
        status: fields.status ?? current.status,
        startAt: fields.startAt ?? current.startAt.getTime(),
        endAt: fields.endAt ?? current.endAt.getTime(),
      };
      const problem = timeProblem(next);
      if (problem) return c.json({ message: problem }, 400);

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

      const moving = "departmentId" in changes;
      if (moving && !hasRole(actor.role, "admin")) {
        return c.json({ message: "Only admins can move an item to another department" }, 403);
      }
      if (moving && !(await departmentExists(db, next.departmentId))) {
        return c.json({ message: "Department not found" }, 400);
      }

      const now = new Date();
      const publishing = "visibility" in changes;
      const visibility = set.visibility ?? current.visibility;
      if (publishing && !canPublishDepartment(actor, next.departmentId)) {
        return c.json({ message: "Only the department's head or vicehead can publish" }, 403);
      }
      if (visibility === "public" && !canBePublic(next)) {
        if (publishing) {
          return c.json({ message: "Only confirmed items can be public" }, 400);
        }
        // Leaving confirmed takes the item off the public calendar.
        record("visibility", "internal");
      }
      if ("visibility" in changes) {
        const nowPublic = set.visibility === "public";
        record("approvedAt", nowPublic ? now : null);
        record("approvedById", nowPublic ? actor.id : null);
      }

      if (Object.keys(changes).length === 0) {
        const item = await findItem(db, itemId, actor);
        if (!item) return c.json({ message: "Item not found" }, 404);
        return c.json(item, 200);
      }

      const action = actionFor(changes, publishing);
      const moved = action === "reschedule" || action === "cancel";
      // A confirmed plan that moves or is called off needs a reason for the people on it.
      if (moved && current.status === "confirmed" && !reason) {
        return c.json({ message: "Say why the item is being rescheduled or cancelled" }, 400);
      }
      if (set.ownerId) {
        const invalid = await ownerProblem(db, set.ownerId);
        if (invalid) return c.json({ message: invalid }, 400);
      }

      const ownerId = "ownerId" in set ? (set.ownerId ?? null) : current.ownerId;
      const itemTitle = set.title ?? current.title;
      const notices = [];
      if ("ownerId" in changes && ownerId) {
        notices.push(
          ...notify(db, actor, [ownerId], {
            kind: "assignment",
            itemId,
            itemTitle,
            data: { startAt: next.startAt },
          }),
        );
      }
      if (moved) {
        notices.push(
          ...notify(db, actor, [current.ownerId, ownerId], {
            kind: action,
            itemId,
            itemTitle,
            data: {
              startAt: next.startAt,
              endAt: next.endAt,
              previousStartAt: current.startAt.getTime(),
              reason: reason ?? null,
            },
          }),
        );
      }

      let updated: { id: string }[];
      try {
        const results = await db.batch([
          abortUnless(
            db,
            actor.id,
            and(
              publishing
                ? stillDepartmentPublisher(current.departmentId)
                : stillDepartmentEditor(current.departmentId),
              moving ? stillAdmin() : undefined,
              itemIsAsRead(db, itemId, version),
            ) ?? sql`1`,
          ),
          db
            .update(calendarItem)
            .set({ ...set, version: sql`${calendarItem.version} + 1`, updatedAt: now })
            .where(and(eq(calendarItem.id, itemId), eq(calendarItem.version, version)))
            .returning({ id: calendarItem.id }),
          logChange(db, actor, itemId, action, changes, reason ?? null),
          ...notices,
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
    })

    // Removes the item; its change log stays, ending with the deletion.
    .delete("/items/:id", validate("param", idParam), validate("query", deleteQuery), async (c) => {
      const { id: itemId } = c.req.valid("param");
      const { version } = c.req.valid("query");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db.select().from(calendarItem).where(eq(calendarItem.id, itemId));
      if (!current) return c.json({ message: "Item not found" }, 404);
      if (!canEditDepartment(actor, current.departmentId)) {
        return c.json({ message: "Forbidden" }, 403);
      }
      if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);
      try {
        await db.batch([
          abortUnless(
            db,
            actor.id,
            and(stillDepartmentEditor(current.departmentId), itemIsAsRead(db, itemId, version)) ??
              sql`1`,
          ),
          logChange(db, actor, itemId, "delete", {
            title: [current.title, null],
            startAt: [current.startAt.getTime(), null],
          }),
          db.delete(calendarItem).where(eq(calendarItem.id, itemId)),
        ]);
      } catch (error) {
        const conflict = conflictResponse(error);
        if (conflict) return c.json({ message: conflict.message }, conflict.status);
        throw error;
      }
      return c.json({ ok: true }, 200);
    })

    .route("/", createNotificationRoutes());

export type CalendarRoutes = ReturnType<typeof createCalendarRoutes>;
