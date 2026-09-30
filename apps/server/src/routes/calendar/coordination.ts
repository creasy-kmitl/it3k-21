// Cross-team coordination on calendar items: what each involved department
// owes (request and answer), action items and the decision log.
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import {
  type RequestState,
  calendarActionItem,
  calendarDecision,
  calendarItem,
  calendarItemDepartment,
} from "@it3k/db/schema/calendar";
import { department } from "@it3k/db/schema/department";
import { alias } from "drizzle-orm/sqlite-core";
import { type SQL, and, asc, eq, exists, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type CurrentUser, type CurrentUserEnv, abortUnless } from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import {
  canAnswerRequest,
  canCompleteActionItem,
  canEditCalendar,
  stillCalendarEditor,
  stillInDepartment,
  stillMember,
} from "../../policies/calendar";
import { notify } from "./notifications";
import {
  type Change,
  STALE_MESSAGE,
  comparable,
  conflictResponse,
  departmentsProblem,
  editorOnly,
  epochMs,
  id,
  idParam,
  logChange,
  ms,
  optionalText,
  ownerProblem,
  same,
} from "./shared";

const MY_ACTION_ITEMS_LIMIT = 50;

const departmentParam = z.strictObject({ id: z.uuid(), departmentId: id });

const requestInput = z.strictObject({
  /** What Tech/Live needs; blank withdraws the request. */
  request: optionalText(1000),
  contactUserId: id.nullable().optional(),
  dueAt: epochMs.nullable().optional(),
});

const answerInput = z.strictObject({ response: z.string().trim().min(1).max(2000) });

const actionFields = {
  title: z.string().trim().min(1).max(300),
  ownerId: id.nullable().optional(),
  departmentId: id.nullable().optional(),
  dueAt: epochMs.nullable().optional(),
};

const createActionInput = z.strictObject(actionFields);

const updateActionInput = z
  .strictObject({
    ...actionFields,
    title: actionFields.title.optional(),
    done: z.boolean().optional(),
    version: z.number().int().min(1),
  })
  .refine((input) => Object.keys(input).some((key) => key !== "version"), "Nothing to update");

const decisionInput = z.strictObject({ text: z.string().trim().min(1).max(1000) });

const actionItemsQuery = z.strictObject({});

/** SQL: the item has a decision or an action item, as a closed meeting must. */
export function hasMeetingRecord(db: Database, itemId: string): SQL {
  return sql`(${exists(
    db
      .select({ id: calendarDecision.id })
      .from(calendarDecision)
      .where(eq(calendarDecision.itemId, itemId)),
  )} or ${exists(
    db
      .select({ id: calendarActionItem.id })
      .from(calendarActionItem)
      .where(eq(calendarActionItem.itemId, itemId)),
  )})`;
}

/** What a meeting or handoff still lacks before it may be marked completed. */
export async function closeOutProblems(
  db: Database,
  itemId: string,
  item: { agenda: string | null; ownerId: string | null; departmentCount: number },
): Promise<string[]> {
  const missing: string[] = [];
  if (!item.agenda?.trim()) missing.push("agenda");
  if (!item.ownerId) missing.push("owner");
  if (item.departmentCount === 0) missing.push("departments");
  const [decision] = await db
    .select({ id: calendarDecision.id })
    .from(calendarDecision)
    .where(eq(calendarDecision.itemId, itemId))
    .limit(1);
  const [action] = await db
    .select({ id: calendarActionItem.id })
    .from(calendarActionItem)
    .where(eq(calendarActionItem.itemId, itemId))
    .limit(1);
  if (!decision && !action) missing.push("decision or action item");
  return missing;
}

const contact = alias(user, "contact");
const assignee = alias(user, "assignee");

function selectActionItems(db: Database) {
  return db
    .select({
      action: calendarActionItem,
      ownerName: assignee.name,
      departmentName: department.name,
      itemTitle: calendarItem.title,
      itemStartAt: calendarItem.startAt,
    })
    .from(calendarActionItem)
    .innerJoin(calendarItem, eq(calendarItem.id, calendarActionItem.itemId))
    .leftJoin(assignee, eq(assignee.id, calendarActionItem.ownerId))
    .leftJoin(department, eq(department.id, calendarActionItem.departmentId));
}

type ActionRow = Awaited<ReturnType<ReturnType<typeof selectActionItems>["all"]>>[number];

function toActionItem(row: ActionRow, actor: CurrentUser) {
  const { action } = row;
  return {
    id: action.id,
    itemId: action.itemId,
    itemTitle: row.itemTitle,
    itemStartAt: row.itemStartAt.getTime(),
    title: action.title,
    owner: action.ownerId ? { id: action.ownerId, name: row.ownerName ?? "" } : null,
    department: action.departmentId
      ? { id: action.departmentId, name: row.departmentName ?? "" }
      : null,
    dueAt: ms(action.dueAt),
    status: action.status,
    doneAt: ms(action.doneAt),
    version: action.version,
    canEdit: canEditCalendar(actor),
    canComplete: canCompleteActionItem(actor, action),
  };
}

/**
 * The coordination half of an item's detail: each department's request and
 * answer, the action items, the decisions, and open action items carried over
 * from earlier items of the same series.
 */
export async function loadCoordination(
  db: Database,
  item: { id: string; seriesId: string | null; startAt: Date },
  actor: CurrentUser,
) {
  const departments = await db
    .select({
      link: calendarItemDepartment,
      name: department.name,
      contactName: contact.name,
    })
    .from(calendarItemDepartment)
    .innerJoin(department, eq(department.id, calendarItemDepartment.departmentId))
    .leftJoin(contact, eq(contact.id, calendarItemDepartment.contactUserId))
    .where(eq(calendarItemDepartment.itemId, item.id))
    .orderBy(department.createdAt, department.name);
  const actions = await selectActionItems(db)
    .where(eq(calendarActionItem.itemId, item.id))
    .orderBy(asc(calendarActionItem.createdAt), sql`${calendarActionItem}.rowid`);
  const decisions = await db
    .select({ decision: calendarDecision, authorName: user.name })
    .from(calendarDecision)
    .leftJoin(user, eq(user.id, calendarDecision.createdById))
    .where(eq(calendarDecision.itemId, item.id))
    .orderBy(asc(calendarDecision.createdAt), sql`${calendarDecision}.rowid`);
  const carriedOver = item.seriesId
    ? await selectActionItems(db)
        .where(
          and(
            eq(calendarItem.seriesId, item.seriesId),
            lt(calendarItem.startAt, item.startAt),
            eq(calendarActionItem.status, "open"),
          ),
        )
        .orderBy(calendarItem.startAt, calendarActionItem.createdAt)
    : [];
  return {
    departments: departments.map(({ link, name, contactName }) => ({
      id: link.departmentId,
      name,
      state: link.state,
      request: link.request,
      contact: link.contactUserId ? { id: link.contactUserId, name: contactName ?? "" } : null,
      dueAt: ms(link.dueAt),
      response: link.response,
      answeredAt: ms(link.answeredAt),
      canAnswer: link.state !== "involved" && canAnswerRequest(actor, link.departmentId),
    })),
    actionItems: actions.map((row) => toActionItem(row, actor)),
    decisions: decisions.map(({ decision, authorName }) => ({
      id: decision.id,
      text: decision.text,
      author: authorName,
      createdAt: decision.createdAt.getTime(),
    })),
    carriedOver: carriedOver.map((row) => toActionItem(row, actor)),
  };
}

async function findLink(db: Database, itemId: string, departmentId: string) {
  const [row] = await db
    .select({ link: calendarItemDepartment, name: department.name, itemTitle: calendarItem.title })
    .from(calendarItemDepartment)
    .innerJoin(department, eq(department.id, calendarItemDepartment.departmentId))
    .innerJoin(calendarItem, eq(calendarItem.id, calendarItemDepartment.itemId))
    .where(
      and(
        eq(calendarItemDepartment.itemId, itemId),
        eq(calendarItemDepartment.departmentId, departmentId),
      ),
    );
  return row ?? null;
}

async function itemTitle(db: Database, itemId: string) {
  const [row] = await db
    .select({ title: calendarItem.title })
    .from(calendarItem)
    .where(eq(calendarItem.id, itemId));
  return row?.title ?? null;
}

/** SQL: the department link still has the state and request the route read. */
function linkIsAsRead(db: Database, link: typeof calendarItemDepartment.$inferSelect): SQL {
  return exists(
    db
      .select({ id: calendarItemDepartment.id })
      .from(calendarItemDepartment)
      .where(
        and(
          eq(calendarItemDepartment.id, link.id),
          eq(calendarItemDepartment.state, link.state),
          link.request === null
            ? sql`${calendarItemDepartment.request} is null`
            : eq(calendarItemDepartment.request, link.request),
        ),
      ),
  );
}

async function runBatch(
  db: Database,
  statements: Parameters<Database["batch"]>[0],
): Promise<{ ok: true } | { ok: false; message: string; status: 409 }> {
  try {
    await db.batch(statements);
    return { ok: true };
  } catch (error) {
    const conflict = conflictResponse(error);
    if (conflict) return { ok: false, ...conflict };
    throw error;
  }
}

export const createCoordinationRoutes = () =>
  new Hono<CurrentUserEnv>()
    // Open action items for the caller or the caller's department, for the run sheet.
    .get("/action-items", validate("query", actionItemsQuery), async (c) => {
      const actor = c.var.user;
      const mine = actor.departmentId
        ? or(
            eq(calendarActionItem.ownerId, actor.id),
            eq(calendarActionItem.departmentId, actor.departmentId),
          )
        : eq(calendarActionItem.ownerId, actor.id);
      const rows = await selectActionItems(c.var.db)
        .where(
          and(eq(calendarActionItem.status, "open"), sql`${calendarItem.archivedAt} is null`, mine),
        )
        // Undated items last.
        .orderBy(
          sql`${calendarActionItem.dueAt} is null`,
          calendarActionItem.dueAt,
          calendarActionItem.createdAt,
        )
        .limit(MY_ACTION_ITEMS_LIMIT);
      return c.json({ items: rows.map((row) => toActionItem(row, actor)) }, 200);
    })

    .put(
      "/items/:id/departments/:departmentId/request",
      editorOnly,
      validate("param", departmentParam),
      validate("json", requestInput),
      async (c) => {
        const { id: itemId, departmentId } = c.req.valid("param");
        const input = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const found = await findLink(db, itemId, departmentId);
        if (!found) return c.json({ message: "That department is not involved" }, 404);
        const { link } = found;
        if (input.contactUserId) {
          const invalid = await ownerProblem(db, input.contactUserId);
          if (invalid) return c.json({ message: invalid }, 400);
        }
        const request = input.request === undefined ? link.request : input.request;
        // A new or changed request needs a new answer; a withdrawn one needs none.
        const state: RequestState = !request
          ? "involved"
          : request === link.request && link.state === "answered"
            ? "answered"
            : "requested";
        const set = {
          state,
          request,
          contactUserId:
            input.contactUserId === undefined ? link.contactUserId : input.contactUserId,
          dueAt:
            input.dueAt === undefined
              ? link.dueAt
              : input.dueAt === null
                ? null
                : new Date(input.dueAt),
          ...(state === "answered" ? {} : { response: null, answeredAt: null, answeredById: null }),
        };
        const changes: Change = {};
        for (const [key, value] of Object.entries(set)) {
          const before = comparable(link[key as keyof typeof link]);
          const after = comparable(value);
          if (!same(before, after))
            changes[key === "state" ? "requestState" : key] = [before, after];
        }
        if (Object.keys(changes).length === 0) return c.json({ ok: true }, 200);
        changes.department = [found.name, found.name];
        const result = await runBatch(db, [
          abortUnless(db, actor.id, and(stillCalendarEditor(), linkIsAsRead(db, link)) ?? sql`1`),
          db.update(calendarItemDepartment).set(set).where(eq(calendarItemDepartment.id, link.id)),
          logChange(db, actor, itemId, "request", changes),
          // The department's contact hears about a new or changed request.
          ...(state === "requested"
            ? notify(db, actor, [set.contactUserId], {
                kind: "request",
                itemId,
                itemTitle: found.itemTitle,
                data: { department: found.name, request, dueAt: set.dueAt?.getTime() ?? null },
              })
            : []),
        ]);
        if (!result.ok) return c.json({ message: result.message }, result.status);
        return c.json({ ok: true }, 200);
      },
    )

    .post(
      "/items/:id/departments/:departmentId/answer",
      validate("param", departmentParam),
      validate("json", answerInput),
      async (c) => {
        const { id: itemId, departmentId } = c.req.valid("param");
        const { response } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const found = await findLink(db, itemId, departmentId);
        if (!found) return c.json({ message: "That department is not involved" }, 404);
        if (!canAnswerRequest(actor, departmentId)) return c.json({ message: "Forbidden" }, 403);
        const { link } = found;
        if (link.state === "involved") {
          return c.json({ message: "Nothing was requested from this department" }, 400);
        }
        const guard = canEditCalendar(actor)
          ? stillCalendarEditor()
          : stillInDepartment(departmentId);
        const result = await runBatch(db, [
          abortUnless(db, actor.id, and(guard, linkIsAsRead(db, link)) ?? sql`1`),
          db
            .update(calendarItemDepartment)
            .set({ state: "answered", response, answeredAt: new Date(), answeredById: actor.id })
            .where(eq(calendarItemDepartment.id, link.id)),
          logChange(db, actor, itemId, "answer", {
            department: [found.name, found.name],
            response: [link.response, response],
          }),
        ]);
        if (!result.ok) return c.json({ message: result.message }, result.status);
        return c.json({ ok: true }, 200);
      },
    )

    .post(
      "/items/:id/action-items",
      editorOnly,
      validate("param", idParam),
      validate("json", createActionInput),
      async (c) => {
        const { id: itemId } = c.req.valid("param");
        const input = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const title = await itemTitle(db, itemId);
        if (title === null) return c.json({ message: "Item not found" }, 404);
        const invalid =
          (input.ownerId ? await ownerProblem(db, input.ownerId) : null) ??
          (input.departmentId ? await departmentsProblem(db, [input.departmentId]) : null);
        if (invalid) return c.json({ message: invalid }, 400);
        const actionId = crypto.randomUUID();
        const result = await runBatch(db, [
          abortUnless(db, actor.id, stillCalendarEditor()),
          db.insert(calendarActionItem).values({
            id: actionId,
            itemId,
            title: input.title,
            ownerId: input.ownerId ?? null,
            departmentId: input.departmentId ?? null,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            createdById: actor.id,
          }),
          logChange(db, actor, itemId, "action_item", { actionItem: [null, input.title] }),
          ...notify(db, actor, [input.ownerId], {
            kind: "action_item",
            itemId,
            itemTitle: title,
            data: { title: input.title, dueAt: input.dueAt ?? null },
          }),
        ]);
        if (!result.ok) return c.json({ message: result.message }, result.status);
        const [row] = await selectActionItems(db).where(eq(calendarActionItem.id, actionId));
        if (!row) throw new Error("Created action item is missing");
        return c.json(toActionItem(row, actor), 201);
      },
    )

    .patch(
      "/action-items/:id",
      validate("param", idParam),
      validate("json", updateActionInput),
      async (c) => {
        const { id: actionId } = c.req.valid("param");
        const { version, done, ...fields } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        const [current] = await db
          .select()
          .from(calendarActionItem)
          .where(eq(calendarActionItem.id, actionId));
        if (!current) return c.json({ message: "Action item not found" }, 404);
        const editor = canEditCalendar(actor);
        if (!canCompleteActionItem(actor, current)) return c.json({ message: "Forbidden" }, 403);
        if (!editor && Object.values(fields).some((value) => value !== undefined)) {
          return c.json({ message: "You can only mark this action item done or open" }, 403);
        }
        if (current.version !== version) return c.json({ message: STALE_MESSAGE }, 409);
        const invalid =
          (fields.ownerId ? await ownerProblem(db, fields.ownerId) : null) ??
          (fields.departmentId ? await departmentsProblem(db, [fields.departmentId]) : null);
        if (invalid) return c.json({ message: invalid }, 400);

        const now = new Date();
        const set: Partial<typeof calendarActionItem.$inferInsert> = {};
        const changes: Change = {};
        const record = <K extends keyof typeof calendarActionItem.$inferInsert>(
          key: K,
          value: (typeof calendarActionItem.$inferInsert)[K],
        ) => {
          const before = comparable(current[key as keyof typeof current]);
          const after = comparable(value);
          if (same(before, after)) return;
          set[key] = value;
          changes[key] = [before, after];
        };
        if (fields.title !== undefined) record("title", fields.title);
        if (fields.ownerId !== undefined) record("ownerId", fields.ownerId);
        if (fields.departmentId !== undefined) record("departmentId", fields.departmentId);
        if (fields.dueAt !== undefined) {
          record("dueAt", fields.dueAt === null ? null : new Date(fields.dueAt));
        }
        if (done !== undefined && done !== (current.status === "done")) {
          record("status", done ? "done" : "open");
          set.doneAt = done ? now : null;
          set.doneById = done ? actor.id : null;
        }
        if (Object.keys(changes).length === 0) return c.json({ ok: true }, 200);
        changes.actionItem = [current.title, set.title ?? current.title];

        // Rechecked in the batch: rights, and that the assignment is as read.
        const assigned = current.ownerId === actor.id ? stillMember() : undefined;
        const guard = editor
          ? stillCalendarEditor()
          : (assigned ?? (current.departmentId ? stillInDepartment(current.departmentId) : sql`0`));
        const asRead = exists(
          db
            .select({ id: calendarActionItem.id })
            .from(calendarActionItem)
            .where(
              and(eq(calendarActionItem.id, actionId), eq(calendarActionItem.version, version)),
            ),
        );
        const result = await runBatch(db, [
          abortUnless(db, actor.id, and(guard, asRead) ?? sql`1`),
          db
            .update(calendarActionItem)
            .set({ ...set, version: sql`${calendarActionItem.version} + 1` })
            .where(
              and(eq(calendarActionItem.id, actionId), eq(calendarActionItem.version, version)),
            ),
          logChange(db, actor, current.itemId, "action_item", changes),
          ...(set.ownerId
            ? notify(db, actor, [set.ownerId], {
                kind: "action_item",
                itemId: current.itemId,
                itemTitle: (await itemTitle(db, current.itemId)) ?? "",
                data: {
                  title: set.title ?? current.title,
                  dueAt: (set.dueAt ?? current.dueAt)?.getTime() ?? null,
                },
              })
            : []),
        ]);
        if (!result.ok) return c.json({ message: result.message }, result.status);
        return c.json({ ok: true }, 200);
      },
    )

    .delete("/action-items/:id", editorOnly, validate("param", idParam), async (c) => {
      const { id: actionId } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db
        .select()
        .from(calendarActionItem)
        .where(eq(calendarActionItem.id, actionId));
      if (!current) return c.json({ message: "Action item not found" }, 404);
      const result = await runBatch(db, [
        abortUnless(db, actor.id, stillCalendarEditor()),
        db.delete(calendarActionItem).where(eq(calendarActionItem.id, actionId)),
        logChange(db, actor, current.itemId, "action_item", {
          actionItem: [current.title, null],
        }),
      ]);
      if (!result.ok) return c.json({ message: result.message }, result.status);
      return c.body(null, 204);
    })

    .post(
      "/items/:id/decisions",
      editorOnly,
      validate("param", idParam),
      validate("json", decisionInput),
      async (c) => {
        const { id: itemId } = c.req.valid("param");
        const { text } = c.req.valid("json");
        const db = c.var.db;
        const actor = c.var.user;
        if ((await itemTitle(db, itemId)) === null) {
          return c.json({ message: "Item not found" }, 404);
        }
        const result = await runBatch(db, [
          abortUnless(db, actor.id, stillCalendarEditor()),
          db.insert(calendarDecision).values({ itemId, text, createdById: actor.id }),
          logChange(db, actor, itemId, "decision", { decision: [null, text] }),
        ]);
        if (!result.ok) return c.json({ message: result.message }, result.status);
        return c.json({ ok: true }, 201);
      },
    )

    .delete("/decisions/:id", editorOnly, validate("param", idParam), async (c) => {
      const { id: decisionId } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db
        .select()
        .from(calendarDecision)
        .where(eq(calendarDecision.id, decisionId));
      if (!current) return c.json({ message: "Decision not found" }, 404);
      const result = await runBatch(db, [
        abortUnless(db, actor.id, stillCalendarEditor()),
        db.delete(calendarDecision).where(eq(calendarDecision.id, decisionId)),
        logChange(db, actor, current.itemId, "decision", { decision: [current.text, null] }),
      ]);
      if (!result.ok) return c.json({ message: result.message }, result.status);
      return c.body(null, 204);
    });
