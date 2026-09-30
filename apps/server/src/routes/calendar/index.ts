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
  MAX_REPEAT_COUNT,
  REPEAT_UNITS,
  RISK_LEVELS,
  calendarChange,
  calendarItem,
  calendarItemDepartment,
  QA_RESULTS,
  READY_STATUSES,
  RELEASE_ENVIRONMENTS,
  canBePublic,
  canClash,
  calendarChecklistItem,
  isTbd,
  needsCloseOut,
  needsLiveChecklist,
  statusesFor,
} from "@it3k/db/schema/calendar";
import { department } from "@it3k/db/schema/department";
import { type SQL, and, desc, eq, exists, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
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
import { createNotificationRoutes, downstreamOwners, notify, peopleOn } from "./notifications";
import {
  createDeliveryRoutes,
  dependenciesSatisfied,
  loadDependencies,
  monitoringWrites,
  releaseProblems,
  waitingOn,
} from "./delivery";
import {
  CONFLICT_MESSAGE,
  type Conflict,
  type Slot,
  canCheck,
  checklistComplete,
  createLiveRoutes,
  findConflicts,
  loadChecklist,
  readinessProblems,
  uncheckTimes,
} from "./live";
import {
  closeOutProblems,
  createCoordinationRoutes,
  hasMeetingRecord,
  loadCoordination,
} from "./coordination";
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
/** A comma-separated query value, e.g. `?mode=operations,delivery`. */
const csvOf = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));

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
  source: optionalText(200),
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
  onCallOwnerId: id.nullable().optional(),
  scoreboardOperatorId: id.nullable().optional(),
  meetingLink: optionalLink,
  agenda: optionalText(4000),
  feature: optionalText(200),
  environment: optionalText(64),
  specUrl: optionalLink,
  designUrl: optionalLink,
  pullRequestUrl: optionalLink,
  qaUrl: optionalLink,
  incidentUrl: optionalLink,
  qaResult: z.enum(QA_RESULTS).nullable().optional(),
  rolloutPlan: optionalText(2000),
  rollbackPlan: optionalText(2000),
  monitoringOwnerId: id.nullable().optional(),
};

const departmentIds = z
  .array(id)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, "Each department may only be listed once");

const createInput = z.strictObject({
  ...itemFields,
  visibility: itemFields.visibility.default("internal"),
  departmentIds: departmentIds.default([]),
  /**
   * Records that the details were checked just now. Any status but draft
   * confirms on its own, so this is only needed to re-confirm new times.
   */
  confirm: z.boolean().default(false),
  /** Saves despite clashes with other items; needs a `mitigation`. */
  acceptConflicts: z.literal(true).optional(),
  mitigation: optionalText(500),
  /** Creates a series: this item plus `count - 1` copies, one per day or week. */
  repeat: z
    .strictObject({
      every: z.enum(REPEAT_UNITS),
      count: z.number().int().min(2).max(MAX_REPEAT_COUNT),
    })
    .optional(),
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
    onCallOwnerId: itemFields.onCallOwnerId,
    scoreboardOperatorId: itemFields.scoreboardOperatorId,
    meetingLink: itemFields.meetingLink,
    agenda: itemFields.agenda,
    feature: itemFields.feature,
    environment: itemFields.environment,
    specUrl: itemFields.specUrl,
    designUrl: itemFields.designUrl,
    pullRequestUrl: itemFields.pullRequestUrl,
    qaUrl: itemFields.qaUrl,
    incidentUrl: itemFields.incidentUrl,
    qaResult: itemFields.qaResult,
    rolloutPlan: itemFields.rolloutPlan,
    rollbackPlan: itemFields.rollbackPlan,
    monitoringOwnerId: itemFields.monitoringOwnerId,
    /** Approvers approve (true) or withdraw (false) a release's plan. */
    releaseApproved: z.boolean().optional(),
    departmentIds: departmentIds.optional(),
    confirm: z.literal(true).optional(),
    acceptConflicts: z.literal(true).optional(),
    mitigation: optionalText(500),
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
  environment?: string | null;
};

const PUBLIC_MODE_MESSAGE = "Only live operations (matches, broadcasts…) can be public";
const READINESS_MESSAGE = "Finish the live checklist and name who is on call first";
const RELEASE_MESSAGE =
  "A release needs QA, approval, a rollback plan and a monitoring owner first";

/** Changing any of these after approval sends a release back for approval. */
const RELEASE_PLAN_FIELDS = [
  "startAt",
  "endAt",
  "environment",
  "feature",
  "rolloutPlan",
  "rollbackPlan",
] as const;

/** Changing any of these can create a clash with another item. */
const SLOT_FIELDS = [
  "startAt",
  "endAt",
  "mode",
  "category",
  "ownerId",
  "onCallOwnerId",
  "scoreboardOperatorId",
  "venue",
  "streamPlatform",
  "archivedAt",
] as const;

/** Clashes of every occurrence of a new item or series, each listed once. */
async function seriesConflicts(
  db: Database,
  count: number,
  stepMs: number,
  slot: Slot,
): Promise<Conflict[]> {
  const found = new Map<string, Conflict>();
  for (let index = 0; index < count; index++) {
    const shifted = {
      ...slot,
      startAt: slot.startAt + index * stepMs,
      endAt: slot.endAt + index * stepMs,
    };
    for (const conflict of await findConflicts(db, shifted)) found.set(conflict.id, conflict);
  }
  return [...found.values()];
}

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
  if (
    item.category === "release" &&
    item.environment &&
    !(RELEASE_ENVIRONMENTS as readonly string[]).includes(item.environment)
  ) {
    return `A release goes to ${RELEASE_ENVIRONMENTS.join(", ")}`;
  }
  return null;
}

const departmentIdList = sql<
  string | null
>`(select group_concat(${calendarItemDepartment.departmentId}) from ${calendarItemDepartment} where ${calendarItemDepartment.itemId} = ${calendarItem.id})`;

const pendingRequests = sql<number>`(select count(*) from ${calendarItemDepartment} where ${calendarItemDepartment.itemId} = ${calendarItem.id} and ${calendarItemDepartment.state} = 'requested')`;

const onCall = alias(user, "on_call");
const monitoringOwner = alias(user, "monitoring_owner");
const scoreboardOperator = alias(user, "scoreboard_operator");

const checklistDone = sql<number>`(select count(*) from ${calendarChecklistItem} where ${calendarChecklistItem.itemId} = ${calendarItem.id} and ${calendarChecklistItem.checked} = 1)`;

function selectItems(db: Database) {
  return db
    .select({
      item: calendarItem,
      ownerName: user.name,
      onCallName: onCall.name,
      scoreboardOperatorName: scoreboardOperator.name,
      checklistDone,
      monitoringOwnerName: monitoringOwner.name,
      waitingOn,
      departmentIds: departmentIdList,
      pendingRequests,
    })
    .from(calendarItem)
    .leftJoin(user, eq(user.id, calendarItem.ownerId))
    .leftJoin(onCall, eq(onCall.id, calendarItem.onCallOwnerId))
    .leftJoin(scoreboardOperator, eq(scoreboardOperator.id, calendarItem.scoreboardOperatorId))
    .leftJoin(monitoringOwner, eq(monitoringOwner.id, calendarItem.monitoringOwnerId));
}

type ItemRow = Awaited<ReturnType<ReturnType<typeof selectItems>["all"]>>[number];

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
    onCallOwner: item.onCallOwnerId ? { id: item.onCallOwnerId, name: row.onCallName ?? "" } : null,
    scoreboardOperator: item.scoreboardOperatorId
      ? { id: item.scoreboardOperatorId, name: row.scoreboardOperatorName ?? "" }
      : null,
    mitigation: item.mitigation,
    specUrl: item.specUrl,
    designUrl: item.designUrl,
    pullRequestUrl: item.pullRequestUrl,
    qaUrl: item.qaUrl,
    incidentUrl: item.incidentUrl,
    qaResult: item.qaResult,
    rolloutPlan: item.rolloutPlan,
    rollbackPlan: item.rollbackPlan,
    monitoringOwner: item.monitoringOwnerId
      ? { id: item.monitoringOwnerId, name: row.monitoringOwnerName ?? "" }
      : null,
    releaseApprovedAt: ms(item.releaseApprovedAt),
    /** Dependencies not completed or released yet. */
    waitingOn: Number(row.waitingOn),
    /** Checked entries out of LIVE_CHECKLIST; null when the item has no checklist. */
    checklistDone: needsLiveChecklist(item) ? Number(row.checklistDone) : null,
    meetingLink: item.meetingLink,
    agenda: item.agenda,
    feature: item.feature,
    environment: item.environment,
    archivedAt: ms(item.archivedAt),
    version: item.version,
    updatedAt: item.updatedAt.getTime(),
    departmentIds: row.departmentIds ? row.departmentIds.split(",") : [],
    seriesId: item.seriesId,
    /** Departments that still owe Tech/Live an answer. */
    pendingRequests: Number(row.pendingRequests),
    tbd: isTbd(item),
    canEdit: canEditCalendar(actor),
  };
}

export type CalendarItem = ReturnType<typeof toItem>;

async function findItem(db: Database, itemId: string, actor: CurrentUser) {
  const [row] = await selectItems(db).where(eq(calendarItem.id, itemId));
  return row ? toItem(row, actor) : null;
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

/** Picks the one action that best describes a change, most significant first. */
function actionFor(changes: Change): CalendarChangeAction {
  if ("archivedAt" in changes) return changes.archivedAt[1] === null ? "unarchive" : "archive";
  if (changes.status?.[1] === "cancelled") return "cancel";
  if ("startAt" in changes || "endAt" in changes) return "reschedule";
  if ("visibility" in changes) return "publish";
  if (Object.keys(changes).every((key) => key.startsWith("releaseApproved"))) {
    return "release_approval";
  }
  if ("status" in changes) return "status";
  if (Object.keys(changes).every((key) => key.startsWith("lastConfirmed"))) return "confirm";
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
      const checklist = await loadChecklist(db, item);
      const dependencies = await loadDependencies(db, itemId);
      const coordination = await loadCoordination(
        db,
        { id: item.id, seriesId: item.seriesId, startAt: new Date(item.startAt) },
        c.var.user,
      );
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
          ...coordination,
          checklist,
          ...dependencies,
          canCheck: canCheck(c.var.user, { onCallOwnerId: item.onCallOwner?.id ?? null }),
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
      const {
        departmentIds: ids,
        confirm,
        repeat,
        acceptConflicts,
        mitigation,
        ...fields
      } = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const problem = itemProblem(fields);
      if (problem) return c.json({ message: problem }, 400);
      const approving = fields.visibility === "public";
      if (approving && !canApproveCalendar(actor)) {
        return c.json({ message: "Only approvers can publish items" }, 403);
      }
      const now = new Date();
      // Choosing any status but draft is what confirms an item.
      const confirming = confirm || fields.status !== "draft";
      const confirmedAt = confirming ? now : null;
      if (
        approving &&
        isTbd({ mode: fields.mode, status: fields.status, lastConfirmedAt: confirmedAt })
      ) {
        return c.json({ message: "Unconfirmed (TBD) items cannot be public" }, 400);
      }
      if (approving && !canBePublic(fields)) {
        return c.json({ message: PUBLIC_MODE_MESSAGE }, 400);
      }
      const invalid =
        (await ownerProblem(db, fields.ownerId)) ??
        (fields.onCallOwnerId ? await ownerProblem(db, fields.onCallOwnerId) : null) ??
        (fields.scoreboardOperatorId
          ? await ownerProblem(db, fields.scoreboardOperatorId)
          : null) ??
        (fields.monitoringOwnerId ? await ownerProblem(db, fields.monitoringOwnerId) : null) ??
        (await departmentsProblem(db, ids));
      if (invalid) return c.json({ message: invalid }, 400);
      // A new item has no checklist ticked yet, so it cannot start out ready.
      if (READY_STATUSES.includes(fields.status) && needsLiveChecklist(fields)) {
        const missing = await readinessProblems(db, null, fields.onCallOwnerId ?? null);
        return c.json({ message: READINESS_MESSAGE, missing }, 400);
      }

      // A new release has not been approved, so it cannot start out released.
      if (fields.status === "released" && fields.category === "release") {
        const missing = await releaseProblems(db, null, {
          environment: fields.environment ?? null,
          qaResult: fields.qaResult ?? null,
          releaseApprovedAt: null,
          rollbackPlan: fields.rollbackPlan ?? null,
          monitoringOwnerId: fields.monitoringOwnerId ?? null,
        });
        return c.json({ message: RELEASE_MESSAGE, missing }, 400);
      }

      // Bangkok has no daylight saving, so a day is always 24 hours.
      const stepMs = repeat?.every === "week" ? 7 * DAY_MS : DAY_MS;
      const conflicts =
        canClash(fields) && fields.status !== "cancelled"
          ? await seriesConflicts(db, repeat?.count ?? 1, stepMs, {
              mode: fields.mode,
              category: fields.category,
              startAt: fields.startAt,
              endAt: fields.endAt,
              ownerId: fields.ownerId,
              onCallOwnerId: fields.onCallOwnerId ?? null,
              scoreboardOperatorId: fields.scoreboardOperatorId ?? null,
              venue: fields.venue ?? null,
              streamPlatform: fields.streamPlatform ?? null,
            })
          : [];
      if (conflicts.length > 0 && !acceptConflicts) {
        return c.json({ message: CONFLICT_MESSAGE, conflicts }, 422);
      }
      if (conflicts.length > 0 && !mitigation) {
        return c.json({ message: "Say how the clash will be handled" }, 400);
      }
      const seriesId = repeat ? crypto.randomUUID() : null;
      const itemIds = Array.from({ length: repeat?.count ?? 1 }, () => crypto.randomUUID());
      const writes = itemIds.flatMap((itemId, index) => {
        const values = {
          ...fields,
          startAt: new Date(fields.startAt + index * stepMs),
          endAt: new Date(fields.endAt + index * stepMs),
          lastConfirmedAt: confirmedAt,
          lastConfirmedById: confirming ? actor.id : null,
          approvedAt: approving ? now : null,
          approvedById: approving ? actor.id : null,
          seriesId,
          mitigation: mitigation ?? null,
          // A release that overlaps a live block is high risk.
          ...(conflicts.length > 0 && fields.category === "release"
            ? { riskLevel: "high" as const }
            : {}),
        };
        const logged: Change = {};
        for (const [key, value] of Object.entries({ ...values, departmentIds: ids })) {
          const after = comparable(value);
          if (after !== null) logged[key] = [null, after];
        }
        if (conflicts.length > 0) logged.conflicts = [null, conflicts.map((c) => c.title)];
        return [
          db.insert(calendarItem).values({ id: itemId, ...values, createdById: actor.id }),
          ...insertDepartments(db, itemId, ids),
          logChange(db, actor, itemId, "create", logged),
          // One notice for a whole series, on its first item.
          ...(index === 0
            ? notify(db, actor, peopleOn({ ...values, ownerId: fields.ownerId }), {
                kind: "assignment",
                itemId,
                itemTitle: fields.title,
                data: { startAt: fields.startAt, series: repeat?.count ?? null },
              })
            : []),
        ];
      });
      try {
        await db.batch([
          abortUnless(db, actor.id, approving ? stillCalendarApprover() : stillCalendarEditor()),
          ...writes,
        ]);
      } catch (error) {
        const conflict = conflictResponse(error);
        if (conflict) return c.json({ message: conflict.message }, conflict.status);
        throw error;
      }
      const item = await findItem(db, itemIds[0] ?? "", actor);
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
          acceptConflicts,
          mitigation,
          releaseApproved,
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
          environment: fields.environment === undefined ? current.environment : fields.environment,
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
        // Leaving draft confirms the item, as does an explicit re-confirm.
        const leavingDraft = current.status === "draft" && next.status !== "draft";
        if (confirm || leavingDraft) {
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
        // An approval covers the plan as approved; changing the plan withdraws it.
        const planChanged = RELEASE_PLAN_FIELDS.some((key) => key in changes);
        const approvingRelease = releaseApproved !== undefined;
        if (approvingRelease && !canApproveCalendar(actor)) {
          return c.json({ message: "Only approvers can approve a release" }, 403);
        }
        if (releaseApproved && next.category !== "release") {
          return c.json({ message: "Only releases are approved" }, 400);
        }
        if (releaseApproved && (planChanged || !current.releaseApprovedAt)) {
          record("releaseApprovedAt", now);
          record("releaseApprovedById", actor.id);
        } else if (releaseApproved === false || (!approvingRelease && planChanged)) {
          record("releaseApprovedAt", null);
          record("releaseApprovedById", null);
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
          isTbd({ mode: next.mode, status: next.status, lastConfirmedAt })
        ) {
          return c.json({ message: "Unconfirmed (TBD) items cannot be public" }, 400);
        }
        if (visibility === "public" && !canBePublic(next)) {
          return c.json({ message: PUBLIC_MODE_MESSAGE }, 400);
        }
        if (approving) {
          set.approvedAt = visibility === "public" ? now : null;
          set.approvedById = visibility === "public" ? actor.id : null;
        }
        const invalid =
          (set.ownerId ? await ownerProblem(db, set.ownerId) : null) ??
          (set.onCallOwnerId ? await ownerProblem(db, set.onCallOwnerId) : null) ??
          (set.scoreboardOperatorId ? await ownerProblem(db, set.scoreboardOperatorId) : null) ??
          (set.monitoringOwnerId ? await ownerProblem(db, set.monitoringOwnerId) : null) ??
          (departmentsChanged && ids ? await departmentsProblem(db, ids) : null);
        if (invalid) return c.json({ message: invalid }, 400);

        const after = { ...current, ...set };
        const becomingReady =
          READY_STATUSES.includes(next.status) &&
          !READY_STATUSES.includes(current.status) &&
          needsLiveChecklist(next);
        if (becomingReady) {
          const missing = await readinessProblems(db, itemId, after.onCallOwnerId);
          // New times need confirming again, so the times entry does not count.
          if (rescheduled && !missing.includes("times")) missing.push("times");
          if (missing.length > 0) {
            return c.json({ message: READINESS_MESSAGE, missing }, 400);
          }
        }

        const becomingReleased =
          next.status === "released" &&
          current.status !== "released" &&
          next.category === "release";
        if (becomingReleased) {
          const missing = await releaseProblems(db, itemId, {
            environment: after.environment,
            qaResult: after.qaResult,
            releaseApprovedAt: after.releaseApprovedAt ?? null,
            rollbackPlan: after.rollbackPlan,
            monitoringOwnerId: after.monitoringOwnerId,
          });
          if (missing.length > 0) {
            return c.json({ message: RELEASE_MESSAGE, missing }, 400);
          }
        }

        // Only what decides the slot is rechecked, so an accepted clash is not
        // raised again by every later edit.
        const slotChanged = SLOT_FIELDS.some((key) => key in changes);
        const conflicts =
          slotChanged && canClash(next) && next.status !== "cancelled" && after.archivedAt === null
            ? await findConflicts(db, {
                excludeId: itemId,
                mode: next.mode,
                category: next.category,
                startAt: next.startAt,
                endAt: next.endAt,
                ownerId: after.ownerId ?? null,
                onCallOwnerId: after.onCallOwnerId ?? null,
                scoreboardOperatorId: after.scoreboardOperatorId ?? null,
                venue: after.venue ?? null,
                streamPlatform: after.streamPlatform ?? null,
              })
            : [];
        if (conflicts.length > 0 && !acceptConflicts) {
          return c.json({ message: CONFLICT_MESSAGE, conflicts }, 422);
        }
        if (conflicts.length > 0 && !mitigation) {
          return c.json({ message: "Say how the clash will be handled" }, 400);
        }
        if (mitigation !== undefined) record("mitigation", mitigation);
        if (conflicts.length > 0) changes.conflicts = [null, conflicts.map((c) => c.title)];
        // A release that overlaps a live block is high risk.
        if (conflicts.length > 0 && next.category === "release") record("riskLevel", "high");

        // Who to tell, in the same batch as the change.
        const people = {
          ownerId: after.ownerId ?? null,
          onCallOwnerId: after.onCallOwnerId ?? null,
          scoreboardOperatorId: after.scoreboardOperatorId ?? null,
          monitoringOwnerId: after.monitoringOwnerId ?? null,
        };
        const itemTitle = after.title;
        const notices = [];
        for (const role of Object.keys(people) as (keyof typeof people)[]) {
          if (role in changes && people[role]) {
            notices.push(
              ...notify(db, actor, [people[role]], {
                kind: "assignment",
                itemId,
                itemTitle,
                data: { role, startAt: next.startAt },
              }),
            );
          }
        }
        if (action === "reschedule" || action === "cancel") {
          const data = {
            startAt: next.startAt,
            endAt: next.endAt,
            previousStartAt: current.startAt.getTime(),
            reason: reason ?? null,
          };
          notices.push(
            ...notify(db, actor, [...peopleOn(current), ...peopleOn(people)], {
              kind: action,
              itemId,
              itemTitle,
              data,
            }),
            ...notify(db, actor, await downstreamOwners(db, itemId), {
              kind: "dependency",
              itemId,
              itemTitle,
              data: { ...data, change: action },
            }),
          );
        }
        const approvalWithdrawn =
          !approvingRelease && planChanged && current.releaseApprovedAt !== null;
        if (next.category === "release" && (conflicts.length > 0 || approvalWithdrawn)) {
          notices.push(
            ...notify(db, actor, [people.ownerId, people.monitoringOwnerId], {
              kind: "release_risk",
              itemId,
              itemTitle,
              data: {
                conflicts: conflicts.map((conflict) => conflict.title),
                approvalWithdrawn,
              },
            }),
          );
        }

        const closing =
          next.status === "completed" && current.status !== "completed" && needsCloseOut(next);
        if (closing) {
          const missing = await closeOutProblems(db, itemId, {
            agenda: "agenda" in set ? (set.agenda ?? null) : current.agenda,
            ownerId: "ownerId" in set ? (set.ownerId ?? null) : current.ownerId,
            departmentCount: departmentsChanged && ids ? ids.length : currentIds.length,
          });
          if (missing.length > 0) {
            return c.json({ message: `Before closing, add ${missing.join(", ")}`, missing }, 400);
          }
        }
        const added = departmentsChanged && ids ? ids.filter((d) => !currentIds.includes(d)) : [];
        const removed = departmentsChanged && ids ? currentIds.filter((d) => !ids.includes(d)) : [];

        let updated: { id: string }[];
        try {
          const results = await db.batch([
            abortUnless(
              db,
              actor.id,
              and(
                approving || approvingRelease ? stillCalendarApprover() : stillCalendarEditor(),
                itemIsAsRead(db, itemId, version),
                // Decisions, action items and the checklist live outside the item's version.
                closing ? hasMeetingRecord(db, itemId) : undefined,
                becomingReady ? checklistComplete(itemId) : undefined,
                becomingReleased ? dependenciesSatisfied(db, itemId) : undefined,
              ) ?? sql`1`,
            ),
            db
              .update(calendarItem)
              .set({ ...set, version: sql`${calendarItem.version} + 1`, updatedAt: now })
              .where(and(eq(calendarItem.id, itemId), eq(calendarItem.version, version)))
              .returning({ id: calendarItem.id }),
            // Departments that stay keep their request and answer.
            ...(removed.length > 0
              ? [
                  db
                    .delete(calendarItemDepartment)
                    .where(
                      and(
                        eq(calendarItemDepartment.itemId, itemId),
                        inArray(calendarItemDepartment.departmentId, removed),
                      ),
                    ),
                ]
              : []),
            ...insertDepartments(db, itemId, added),
            ...(rescheduled ? [uncheckTimes(db, itemId)] : []),
            ...(becomingReleased
              ? monitoringWrites(
                  db,
                  actor,
                  {
                    id: itemId,
                    title: after.title,
                    endAt: new Date(next.endAt),
                    feature: after.feature,
                    environment: after.environment,
                    monitoringOwnerId: after.monitoringOwnerId,
                  },
                  now,
                )
              : []),
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
          logChange(db, actor, target, "duplicate", { [key]: [null, value] });
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
              // A copy is a new plan: it needs its own QA and approval.
              qaResult: null,
              releaseApprovedAt: null,
              releaseApprovedById: null,
              // A copy stands alone, outside the source's series.
              seriesId: null,
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
    )

    .route("/", createCoordinationRoutes())
    .route("/", createLiveRoutes())
    .route("/", createDeliveryRoutes())
    .route("/", createNotificationRoutes());

export type CalendarRoutes = ReturnType<typeof createCalendarRoutes>;
