import { hasRole } from "@it3k/auth/permissions";
import type { Database } from "@it3k/db";
import { department, departmentAppearance } from "@it3k/db/schema/department";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import {
  type CurrentUserEnv,
  type RouteDeps,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { limitJsonBody } from "../../middleware/json-body-limit";
import { validate } from "../../middleware/validation";
import {
  type ViewAs,
  clearViewAs,
  readViewAs,
  toViewAs,
  viewAsInput,
  writeViewAs,
} from "../../middleware/view-as";

async function findDepartment(db: Database, id: string) {
  const [row] = await db
    .select({
      id: department.id,
      name: department.name,
      icon: department.icon,
      color: department.color,
    })
    .from(department)
    .where(eq(department.id, id));
  return row ? departmentAppearance(row) : null;
}

async function describe(db: Database, view: ViewAs) {
  return {
    active: true as const,
    kind: view.kind,
    department: view.departmentId ? await findDepartment(db, view.departmentId) : null,
    institution: view.institution,
  };
}

/** Only an admin acting as themselves; an impersonated session cannot view as anyone. */
const adminOnly = createMiddleware<CurrentUserEnv>(async (c, next) => {
  const actor = c.var.user;
  if (!hasRole(actor.role, "admin") || actor.impersonatedBy) {
    return c.json({ message: "เฉพาะผู้ดูแลระบบที่จำลองมุมมองได้" }, 403);
  }
  await next();
});

/**
 * Lets an admin preview the app as a role, department and institution. The
 * view is a signed cookie that requireUser applies, read-only, on every other
 * route; these routes ignore it so the admin can always see and end it.
 */
export const createViewAsRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps, { viewAs: "ignore" }))
    .use(adminOnly)
    .use(limitJsonBody)

    .get("/", async (c) => {
      const view = await readViewAs(c, deps.viewAsSecret);
      if (!view || view.by !== c.var.user.id) return c.json({ active: false as const }, 200);
      return c.json(await describe(c.var.db, view), 200);
    })

    .post("/", validate("json", viewAsInput), async (c) => {
      const input = c.req.valid("json");
      const actor = c.var.user;
      const view = toViewAs(actor.id, input);
      if (view.departmentId && !(await findDepartment(c.var.db, view.departmentId))) {
        return c.json({ message: "ไม่พบฝ่ายนี้" }, 400);
      }
      await writeViewAs(c, deps.viewAsSecret, view);
      c.get("log")?.audit({
        action: "admin.view_as.started",
        actor: { type: "user", id: actor.id },
        target: {
          type: "view",
          id: view.kind,
          departmentId: view.departmentId,
          institution: view.institution,
        },
        outcome: "success",
      });
      return c.json(await describe(c.var.db, view), 200);
    })

    .delete("/", async (c) => {
      clearViewAs(c);
      c.get("log")?.audit({
        action: "admin.view_as.stopped",
        actor: { type: "user", id: c.var.user.id },
        outcome: "success",
      });
      return c.json({ active: false as const }, 200);
    });

export type ViewAsRoutes = ReturnType<typeof createViewAsRoutes>;
