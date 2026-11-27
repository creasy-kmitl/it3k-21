// Who may issue and revoke the tokens the Discord bots use for /api/bot/*.
// A token reads which Discord member is staff or on which team, so only
// admins hand them out.
import { hasRole } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { type SQL, and, eq, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
import { notBanned, roleIncludes } from "./actor-sql";

export type BotTokenActor = Pick<CurrentUser, "role" | "banned">;

export function canManageBotTokens(actor: BotTokenActor | null): boolean {
  return !!actor && !actor.banned && hasRole(actor.role, "admin");
}

/** SQL on the actor's own `user` row: still an admin and not banned. */
export function botTokenManagerIsAsRead(actor: CurrentUser): SQL {
  return and(notBanned(), eq(user.role, actor.role ?? ""), roleIncludes("admin")) ?? sql`0`;
}
