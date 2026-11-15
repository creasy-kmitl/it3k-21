import { createMiddleware } from "hono/factory";

import { type SportPermission, canSport } from "../policies/sports";
import type { CurrentUserEnv } from "./current-user";

/** 403 unless the signed-in account holds this sport permission. */
export function allowSport(permission: SportPermission) {
  return createMiddleware<CurrentUserEnv>(async (c, next) => {
    if (!canSport(c.var.user, permission)) return c.json({ message: "Forbidden" }, 403);
    await next();
  });
}
