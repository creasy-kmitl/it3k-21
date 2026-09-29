import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { department, departmentAppearance } from "@it3k/db/schema/department";
import {
  LEADERSHIP_ROLES,
  type LeadershipRole,
  SOCIAL_PLATFORMS,
  leadership,
  leadershipContactReveal,
  leadershipSocial,
} from "@it3k/db/schema/leadership";
import { type SQL, type SQLWrapper, and, eq, exists, inArray, isNull, sql } from "drizzle-orm";
import type { AuditableLogger } from "evlog";
import { type Context, Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  constraintMessage,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { allowed, isManager } from "../../policies/leadership";
import { validate } from "../../middleware/validation";

export const PAGE_SIZE = 20;
const MAX_QUERY_CODE_POINTS = 64;

/** Who looked up whose contact details. Deliberately carries no contact data. */
export type ContactRevealAudit = {
  actorUserId: string;
  actorDepartmentCode: CurrentUser["departmentCode"];
  /** The admin acting as `actorUserId`, if the session is impersonated. */
  impersonatedBy: string | null;
  targetLeadershipId: string;
  targetDepartmentId: string;
};

// `log` is set by the evlog middleware that index.ts mounts in front of every
// route; it is absent when the routes run on their own in tests.
type LeadershipEnv = {
  Variables: CurrentUserEnv["Variables"] & { log?: AuditableLogger };
};

export type LeadershipDeps = RouteDeps & {
  /**
   * Mirrors a reveal to the observability pipeline (Axiom). The durable record
   * is the D1 row the route writes first, so a failure here does not block.
   */
  audit: (c: Context<LeadershipEnv>, event: ContactRevealAudit) => Promise<void>;
};

/**
 * Records a reveal as an evlog audit on the request's wide event. Audits are
 * force-kept past sampling and shipped by the Axiom drain when the request
 * ends -- delivery is asynchronous, so this confirms the event was recorded,
 * not that Axiom has ingested it.
 */
export function recordContactReveal(
  log: Pick<AuditableLogger, "audit" | "set"> | undefined,
  event: ContactRevealAudit,
) {
  if (!log) {
    throw new Error("Request logger is not available");
  }
  log.set({
    leadership: {
      actorDepartmentCode: event.actorDepartmentCode,
      impersonatedBy: event.impersonatedBy,
    },
  });
  log.audit({
    action: "leadership.contact.revealed",
    actor: { type: "user", id: event.actorUserId },
    target: {
      type: "leadership",
      id: event.targetLeadershipId,
      departmentId: event.targetDepartmentId,
    },
    outcome: "success",
  });
}

/** Public view of a seat. Contact details are only returned by `/:id/reveal`. */
export type LeadershipSummary = {
  id: string;
  departmentId: string;
  departmentName: string;
  role: LeadershipRole;
  userId: string | null;
  name: string;
  nickname: string | null;
  displayName: string;
  canEdit: boolean;
  canDelete: boolean;
};

// Seeded department ids are hex and Better Auth user ids are random strings,
// so neither is validated as a UUID; seat ids are.
const departmentId = z.string().min(1).max(64);
const userId = z.string().min(1).max(64);

const searchText = z
  .string()
  .trim()
  // Count code points, not UTF-16 units, so Thai and emoji are treated alike.
  .refine((q) => [...q].length <= MAX_QUERY_CODE_POINTS, {
    message: `Search is limited to ${MAX_QUERY_CODE_POINTS} characters`,
  });
const page = z.coerce.number().int().min(1).max(1000).default(1);

const listQuery = z.strictObject({
  q: searchText.optional(),
  departmentId: departmentId.optional(),
  page,
});

export const userQuery = z.strictObject({
  q: searchText.optional(),
  departmentId: departmentId.optional(),
  page,
});

const idParam = z.strictObject({ id: z.uuid() });

/** Trimmed optional text where blank means "none". */
const optionalText = (max: number, pattern?: RegExp) => {
  let text = z.string().trim().max(max);
  if (pattern) text = text.regex(pattern);
  return text
    .transform((value) => value || null)
    .nullable()
    .optional();
};

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const socialValue = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char === "\x7f"),
    "Control characters are not allowed",
  )
  // Handles are plain text; anything with a scheme must be an https link so
  // the directory never renders javascript:, data: or plain-http links.
  .refine((value) => {
    if (!URL_SCHEME.test(value)) return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Links must use https");

const socials = z
  .array(z.strictObject({ platform: z.enum(SOCIAL_PLATFORMS), value: socialValue }))
  .max(SOCIAL_PLATFORMS.length)
  .refine(
    (items) => new Set(items.map((item) => item.platform)).size === items.length,
    "Each platform may only be listed once",
  );

const seatFields = {
  departmentId,
  role: z.enum(LEADERSHIP_ROLES),
  name: z.string().trim().min(1).max(100),
  nickname: optionalText(40),
  phone: optionalText(30, /^[0-9+\-() ]*$/),
  userId: userId.nullable().optional(),
};

const createInput = z.strictObject({ ...seatFields, socials: socials.default([]) });

const updateInput = z
  .strictObject({
    departmentId: seatFields.departmentId.optional(),
    role: seatFields.role.optional(),
    name: seatFields.name.optional(),
    nickname: seatFields.nickname,
    phone: seatFields.phone,
    userId: seatFields.userId,
    socials: socials.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, "Nothing to update");

// The client shows a warning dialog first; this only proves the caller
// accepted it. Authentication and the audit are what actually gate access.
const revealInput = z.strictObject({ confirmed: z.literal(true) });

/** What a leader who is not a manager may change on their own seat. */
const SELF_EDITABLE = new Set(["nickname", "phone", "socials"]);

/** Escapes LIKE wildcards so user input only ever matches literally. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function contains(column: SQLWrapper, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
}

export function containsAny(columns: SQLWrapper[], text: string): SQL {
  const pattern = `%${escapeLike(text)}%`;
  return sql`(${sql.join(
    columns.map((column) => contains(column, pattern)),
    sql` OR `,
  )})`;
}

function selectSummaries(db: Database) {
  return db
    .select({
      id: leadership.id,
      departmentId: leadership.departmentId,
      departmentName: department.name,
      role: leadership.role,
      userId: leadership.userId,
      storedName: leadership.name,
      accountName: user.name,
      nickname: leadership.nickname,
    })
    .from(leadership)
    .innerJoin(department, eq(department.id, leadership.departmentId))
    .leftJoin(user, eq(user.id, leadership.userId));
}

type SummaryRow = Awaited<ReturnType<ReturnType<typeof selectSummaries>["all"]>>[number];

function toSummary(row: SummaryRow, actor: CurrentUser): LeadershipSummary {
  // Attached seats follow the account's name; the stored name is the fallback.
  const name = row.accountName ?? row.storedName;
  const target = { userId: row.userId };
  return {
    id: row.id,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    role: row.role,
    userId: row.userId,
    name,
    nickname: row.nickname,
    displayName: row.nickname ? `${row.nickname} ${name}` : name,
    canEdit: allowed(actor, "update", target),
    canDelete: allowed(actor, "delete", target),
  };
}

async function findSummary(db: Database, id: string, actor: CurrentUser) {
  const [row] = await selectSummaries(db).where(eq(leadership.id, id));
  return row ? toSummary(row, actor) : null;
}

type Problem = { message: string; status: 400 | 404 };

/**
 * A seat's department and attached account must exist. Only managers can attach
 * accounts, and they manage every department, so the account may come from any;
 * attaching moves it into the seat's department (see syncAccountDepartment).
 */
async function checkPlacement(
  db: Database,
  departmentId: string,
  userId: string | null,
): Promise<Problem | null> {
  const [target] = await db
    .select({ id: department.id })
    .from(department)
    .where(eq(department.id, departmentId));
  if (!target) {
    return { message: "Department not found", status: 404 };
  }
  if (userId === null) return null;
  const [account] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId));
  if (!account) {
    return { message: "Account not found", status: 404 };
  }
  return null;
}

function conflictMessage(error: unknown) {
  const message = constraintMessage(error);
  if (!message?.includes("UNIQUE")) return null;
  if (message.includes("leadership.user_id")) return "This account already holds a seat";
  return "This department already has someone in that role";
}

/**
 * Moves a seat's account into the seat's department, so the account keeps
 * belonging to the department it leads, and makes a guest or athlete staff. Reads the
 * seat inside the statement, so it follows whatever the same batch just wrote.
 */
export function syncAccountDepartment(db: Database, leadershipId: string) {
  const seat = eq(leadership.id, leadershipId);
  return db
    .update(user)
    .set({
      departmentId: sql`(select ${leadership.departmentId} from ${leadership} where ${seat})`,
      role: sql`case when ${user.role} in ('guest', 'athlete') then 'staff' else ${user.role} end`,
    })
    .where(inArray(user.id, db.select({ id: leadership.userId }).from(leadership).where(seat)));
}

function insertSocials(db: Database, leadershipId: string, items: z.infer<typeof socials>) {
  return items.length > 0
    ? [db.insert(leadershipSocial).values(items.map((item) => ({ leadershipId, ...item })))]
    : [];
}

const managerOnly = createMiddleware<LeadershipEnv>(async (c, next) => {
  if (!isManager(c.var.user)) {
    return c.json({ message: "Forbidden" }, 403);
  }
  await next();
});

export const createLeadershipRoutes = (deps: LeadershipDeps) =>
  new Hono<LeadershipEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)

    .get("/", validate("query", listQuery), async (c) => {
      const { q, departmentId, page } = c.req.valid("query");
      const filters: SQL[] = [];
      if (departmentId) {
        filters.push(eq(leadership.departmentId, departmentId));
      }
      if (q) {
        filters.push(
          containsAny([leadership.name, leadership.nickname, user.name, department.name], q),
        );
      }
      const rows = await selectSummaries(c.var.db)
        .where(and(...filters))
        // 'head' sorts before 'vicehead'; id keeps ties stable across pages.
        .orderBy(department.createdAt, department.name, leadership.role, leadership.id)
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE);
      return c.json(
        {
          items: rows.slice(0, PAGE_SIZE).map((row) => toSummary(row, c.var.user)),
          page,
          hasMore: rows.length > PAGE_SIZE,
          canCreate: isManager(c.var.user),
        },
        200,
      );
    })

    .get("/departments", async (c) => {
      const rows = await c.var.db
        .select({
          id: department.id,
          name: department.name,
          icon: department.icon,
          color: department.color,
        })
        .from(department)
        .orderBy(department.createdAt, department.name);
      return c.json(rows.map(departmentAppearance), 200);
    })

    .get("/users", managerOnly, validate("query", userQuery), async (c) => {
      const { q, departmentId, page } = c.req.valid("query");
      // Accounts that do not hold a seat yet; never selects email.
      const filters: SQL[] = [isNull(leadership.id)];
      if (departmentId) filters.push(eq(user.departmentId, departmentId));
      if (q) filters.push(containsAny([user.name], q));
      const rows = await c.var.db
        .select({ id: user.id, name: user.name })
        .from(user)
        .leftJoin(leadership, eq(leadership.userId, user.id))
        .where(and(...filters))
        .orderBy(user.name, user.id)
        .limit(PAGE_SIZE + 1)
        .offset((page - 1) * PAGE_SIZE);
      return c.json({ items: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }, 200);
    })

    .get("/:id", validate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const summary = await findSummary(c.var.db, id, c.var.user);
      if (!summary) {
        return c.json({ message: "Leader not found" }, 404);
      }
      return c.json(summary, 200);
    })

    .post("/", managerOnly, validate("json", createInput), async (c) => {
      const { socials: items, ...fields } = c.req.valid("json");
      const db = c.var.db;
      const problem = await checkPlacement(db, fields.departmentId, fields.userId ?? null);
      if (problem) {
        return c.json({ message: problem.message }, problem.status);
      }
      const id = crypto.randomUUID();
      try {
        await db.batch([
          db.insert(leadership).values({ id, ...fields }),
          ...(fields.userId ? [syncAccountDepartment(db, id)] : []),
          ...insertSocials(db, id, items),
        ]);
      } catch (error) {
        const conflict = conflictMessage(error);
        if (conflict) return c.json({ message: conflict }, 409);
        throw error;
      }
      const summary = await findSummary(db, id, c.var.user);
      if (!summary) throw new Error("Created seat is missing");
      return c.json(summary, 201);
    })

    .patch("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const { id } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db
        .select({ departmentId: leadership.departmentId, userId: leadership.userId })
        .from(leadership)
        .where(eq(leadership.id, id));
      if (!current) {
        return c.json({ message: "Leader not found" }, 404);
      }
      if (!allowed(actor, "update", current)) {
        return c.json({ message: "Forbidden" }, 403);
      }
      if (!isManager(actor) && Object.keys(input).some((key) => !SELF_EDITABLE.has(key))) {
        return c.json({ message: "You can only change your nickname, phone and socials" }, 403);
      }
      if (input.departmentId !== undefined || input.userId !== undefined) {
        const problem = await checkPlacement(
          db,
          input.departmentId ?? current.departmentId,
          input.userId === undefined ? current.userId : input.userId,
        );
        if (problem) {
          return c.json({ message: problem.message }, problem.status);
        }
      }
      const { socials: items, ...fields } = input;
      // Re-checked inside the batch: a seat reattached after the ownership check
      // above must not be written by the account that used to hold it.
      const stillAllowed = isManager(actor)
        ? eq(leadership.id, id)
        : and(eq(leadership.id, id), eq(leadership.userId, actor.id));
      let updated: { id: string }[];
      try {
        // One batch: D1 applies the update and the social replacement together or not at all.
        [updated] = await db.batch([
          db
            .update(leadership)
            .set({ ...fields, updatedAt: new Date() })
            .where(stillAllowed)
            .returning({ id: leadership.id }),
          ...(fields.departmentId !== undefined || fields.userId
            ? [syncAccountDepartment(db, id)]
            : []),
          ...(items
            ? [
                db
                  .delete(leadershipSocial)
                  .where(
                    and(
                      eq(leadershipSocial.leadershipId, id),
                      exists(db.select({ id: leadership.id }).from(leadership).where(stillAllowed)),
                    ),
                  ),
                ...items.map((item) =>
                  db.insert(leadershipSocial).select(
                    db
                      .select({
                        id: sql<string>`${crypto.randomUUID()}`.as("id"),
                        leadershipId: leadership.id,
                        platform: sql<string>`${item.platform}`.as("platform"),
                        value: sql<string>`${item.value}`.as("value"),
                      })
                      .from(leadership)
                      .where(stillAllowed),
                  ),
                ),
              ]
            : []),
        ]);
      } catch (error) {
        const conflict = conflictMessage(error);
        if (conflict) return c.json({ message: conflict }, 409);
        throw error;
      }
      if (updated.length === 0) {
        return isManager(actor)
          ? c.json({ message: "Leader not found" }, 404)
          : c.json(
              { message: "This seat changed while you were editing; reload and try again" },
              409,
            );
      }
      const summary = await findSummary(db, id, actor);
      if (!summary) {
        return c.json({ message: "Leader not found" }, 404);
      }
      return c.json(summary, 200);
    })

    .post("/:id/reveal", validate("param", idParam), validate("json", revealInput), async (c) => {
      const { id } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [seat] = await db
        .select({ departmentId: leadership.departmentId, phone: leadership.phone })
        .from(leadership)
        .where(eq(leadership.id, id));
      if (!seat) {
        return c.json({ message: "Leader not found" }, 404);
      }
      if (!allowed(actor, "reveal", { userId: null })) {
        return c.json({ message: "Forbidden" }, 403);
      }
      const event: ContactRevealAudit = {
        actorUserId: actor.id,
        actorDepartmentCode: actor.departmentCode,
        impersonatedBy: actor.impersonatedBy,
        targetLeadershipId: id,
        targetDepartmentId: seat.departmentId,
      };
      try {
        // The record of who asked is committed before any detail leaves.
        await db.insert(leadershipContactReveal).values({
          actorUserId: event.actorUserId,
          actorDepartmentCode: event.actorDepartmentCode,
          impersonatedBy: event.impersonatedBy,
          leadershipId: event.targetLeadershipId,
          departmentId: event.targetDepartmentId,
        });
      } catch {
        c.var.log?.set({ leadership: { revealAuditFailed: true } });
        return c.json({ message: "Contact details are unavailable right now" }, 503);
      }
      try {
        await deps.audit(c, event);
      } catch {
        c.var.log?.set({ leadership: { revealMirrorFailed: true } });
      }
      const socials = await db
        .select({ platform: leadershipSocial.platform, value: leadershipSocial.value })
        .from(leadershipSocial)
        .where(eq(leadershipSocial.leadershipId, id))
        .orderBy(leadershipSocial.platform);
      c.header("Cache-Control", "private, no-store");
      return c.json({ phone: seat.phone, socials }, 200);
    })

    .delete("/:id", managerOnly, validate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const deleted = await c.var.db
        .delete(leadership)
        .where(eq(leadership.id, id))
        .returning({ id: leadership.id });
      if (deleted.length === 0) {
        return c.json({ message: "Leader not found" }, 404);
      }
      return c.body(null, 204);
    });

export type LeadershipRoutes = ReturnType<typeof createLeadershipRoutes>;
