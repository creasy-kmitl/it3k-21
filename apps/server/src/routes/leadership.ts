import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { type LeadershipRole, leadership } from "@it3k/db/schema/leadership";
import { type SQL, type SQLWrapper, and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { type CurrentUser, type CurrentUserEnv, type RouteDeps, requireUser } from "./current-user";
import { allowed, isManager } from "./leadership-policy";
import { validate } from "./validation";

export const PAGE_SIZE = 20;
const MAX_QUERY_CODE_POINTS = 64;

export type LeadershipAuditEvent = Record<string, unknown>;
export type LeadershipDeps = RouteDeps & {
  audit: (event: LeadershipAuditEvent) => Promise<void>;
};

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

const departmentId = z.string().min(1).max(64);

const listQuery = z.strictObject({
  q: z
    .string()
    .trim()
    // Count code points, not UTF-16 units, so Thai and emoji are treated alike.
    .refine((q) => [...q].length <= MAX_QUERY_CODE_POINTS, {
      message: `Search is limited to ${MAX_QUERY_CODE_POINTS} characters`,
    })
    .optional(),
  departmentId: departmentId.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

const idParam = z.strictObject({ id: z.uuid() });

/** Escapes LIKE wildcards so user input only ever matches literally. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function contains(column: SQLWrapper, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`;
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

export const createLeadershipRoutes = (deps: LeadershipDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireUser(deps))

    .get("/", validate("query", listQuery), async (c) => {
      const { q, departmentId, page } = c.req.valid("query");
      const filters: SQL[] = [];
      if (departmentId) {
        filters.push(eq(leadership.departmentId, departmentId));
      }
      if (q) {
        const pattern = `%${escapeLike(q)}%`;
        const columns = [leadership.name, leadership.nickname, user.name, department.name];
        filters.push(
          sql`(${sql.join(
            columns.map((column) => contains(column, pattern)),
            sql` OR `,
          )})`,
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
        .select({ id: department.id, name: department.name })
        .from(department)
        .orderBy(department.createdAt, department.name);
      return c.json(rows, 200);
    })

    .get("/:id", validate("param", idParam), async (c) => {
      const { id } = c.req.valid("param");
      const [row] = await selectSummaries(c.var.db).where(eq(leadership.id, id));
      if (!row) {
        return c.json({ message: "Leader not found" }, 404);
      }
      return c.json(toSummary(row, c.var.user), 200);
    });

export type LeadershipRoutes = ReturnType<typeof createLeadershipRoutes>;
