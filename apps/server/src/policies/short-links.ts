import { hasRole, isMember } from "@it3k/auth/permissions";
import { user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { type SQL, sql } from "drizzle-orm";

import type { CurrentUser } from "../middleware/current-user";
import { notBanned, roleIncludes } from "./actor-sql";

type Actor = Pick<CurrentUser, "id" | "role" | "banned" | "departmentCode">;

function activeMember(actor: Actor | null): actor is Actor {
  return !!actor && !actor.banned && isMember(actor.role);
}

/** Every member may make short links. */
export function canCreateLinks(actor: Actor | null): boolean {
  return activeMember(actor);
}

/** Admins and Tech/Live look after every link, e.g. when its owner is away. */
export function canManageAllLinks(actor: Actor | null): boolean {
  if (!activeMember(actor)) return false;
  return hasRole(actor.role, "admin") || actor.departmentCode === "tech-live";
}

/** A link's owner edits it; so do those who manage every link. */
export function canEditLink(actor: Actor | null, ownerId: string | null): boolean {
  if (!activeMember(actor)) return false;
  return canManageAllLinks(actor) || (ownerId !== null && ownerId === actor.id);
}

/** SQL twin of canCreateLinks, for abortUnless on the actor's row. */
export function stillLinkCreator(): SQL {
  return sql`(${notBanned()} and (${roleIncludes("admin")} or ${roleIncludes("staff")}))`;
}

/** SQL twin of canEditLink, for abortUnless on the actor's row. */
export function stillLinkEditor(ownerId: string | null): SQL {
  const inTechLive = sql`${user.departmentId} in (select ${department.id} from ${department} where ${department.code} = 'tech-live')`;
  const owns = ownerId === null ? sql`0` : sql`${user.id} = ${ownerId}`;
  return sql`(${notBanned()} and (${roleIncludes("admin")} or (${roleIncludes("staff")} and (${owns} or ${inTechLive}))))`;
}
