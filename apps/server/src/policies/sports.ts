// Who may do what in the sport system: sports and divisions, athlete
// registrations, events, venues, the check-in kiosk and competitions (teams,
// matches, scores and match check-in). Every sport route asks this file, never
// a department code, seat or institution directly.
//
//   admin                                              everything, every institution
//   runSports or registerAthletes, head/vice (KMITL)   everything, every institution
//   runSports, staff                                   kiosk, sport rules, reading athletes and
//                                                      running competitions, every institution
//   registerAthletes, KMITL staff                      kiosk, sport rules and reading athletes, every
//                                                      institution; set accounts' institutions;
//                                                      keep score and check athletes in to matches
//   registerAthletes, any other institution            read and export its own athletes
//   registerAthletes without an institution            nothing
//   assistSports, head/vice (KMITL)                    run competitions and edit sport rules
//   assistSports, KMITL staff                          read competitions and keep score
//   assistSports, any other institution                nothing
//
// Seats are KMITL's (mayHoldSeat): a seat holder of another institution, left
// from before that rule, counts as staff of their institution.
import { hasRole, isMember } from "@it3k/auth/permissions";
import { HOST_INSTITUTION, type Institution, mayHoldSeat } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { leadership } from "@it3k/db/schema/leadership";
import { type SQL, and, eq, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { CurrentUser } from "../middleware/current-user";
import { notBanned } from "./actor-sql";
import { hasCapability } from "./department-capabilities";

export const SPORT_PERMISSIONS = [
  // Create, edit and delete sports, divisions, venues and events.
  "catalog.manage",
  "athletes.read",
  // Approve, reject or reopen a registration.
  "athletes.review",
  // Change an athlete's registration details, student id and institution.
  "athletes.edit",
  "athletes.export",
  "kiosk.operate",
  // Write the Markdown rules of sports and divisions. Everyone signed in reads them.
  "rules.edit",
  // Read competition teams, matches and check-ins.
  "competition.read",
  // Create and change teams, their members, officials and match lineups.
  "teams.manage",
  // Create and change matches, groups, schedules and final placements.
  "matches.manage",
  // Keep a match's score, referees and images.
  "matches.score",
  // Check athletes in to matches (the venue kiosk) and forfeit no-shows.
  "matches.checkin",
  "users.setInstitution",
] as const;
export type SportPermission = (typeof SPORT_PERMISSIONS)[number];

export type SportScope =
  | { kind: "all" }
  | { kind: "institution"; institution: Institution }
  | { kind: "none" };

export type SportActor = Pick<
  CurrentUser,
  "role" | "leadershipRole" | "departmentCode" | "institution" | "banned"
>;

export type SportAccess = { can: ReadonlySet<SportPermission>; scope: SportScope };

const NONE: SportAccess = { can: new Set(), scope: { kind: "none" } };
const FULL: SportAccess = { can: new Set(SPORT_PERMISSIONS), scope: { kind: "all" } };
const RUN_COMPETITIONS = [
  "competition.read",
  "teams.manage",
  "matches.manage",
  "matches.score",
  "matches.checkin",
] as const satisfies readonly SportPermission[];
const STAFF: SportAccess = {
  can: new Set(["kiosk.operate", "athletes.read", "rules.edit", ...RUN_COMPETITIONS]),
  scope: { kind: "all" },
};
// Account holders cannot change their own institution once it is set
// (routes/profile); KMITL's ทะเบียน staff can, along with full rights.
const REG_KMITL_STAFF: SportAccess = {
  can: new Set([
    "kiosk.operate",
    "athletes.read",
    "rules.edit",
    "competition.read",
    "matches.score",
    "matches.checkin",
    "users.setInstitution",
  ]),
  scope: { kind: "all" },
};
// The sports department's leaders run competitions but not registrations or
// the event kiosk; its staff stand by the courts and keep score.
const SPORTS_LEADER: SportAccess = {
  can: new Set(["rules.edit", ...RUN_COMPETITIONS]),
  scope: { kind: "all" },
};
const SPORTS_STAFF: SportAccess = {
  can: new Set(["competition.read", "matches.score"]),
  scope: { kind: "all" },
};

export function sportAccess(actor: SportActor | null): SportAccess {
  if (!actor || actor.banned) return NONE;
  if (hasRole(actor.role, "admin")) return FULL;
  if (!isMember(actor.role)) return NONE;
  const runs = hasCapability(actor.departmentCode, "runSports");
  const registers = hasCapability(actor.departmentCode, "registerAthletes");
  if (hasCapability(actor.departmentCode, "assistSports")) {
    if (actor.leadershipRole && mayHoldSeat(actor.institution)) return SPORTS_LEADER;
    return actor.institution === HOST_INSTITUTION ? SPORTS_STAFF : NONE;
  }
  if (!runs && !registers) return NONE;
  // A seat always belongs to the account's own department.
  if (actor.leadershipRole && mayHoldSeat(actor.institution)) return FULL;
  if (runs) return STAFF;
  // Without an institution nobody can tell whose athletes they may see.
  if (!actor.institution) return NONE;
  if (actor.institution === HOST_INSTITUTION) return REG_KMITL_STAFF;
  return {
    can: new Set(["athletes.read", "athletes.export"]),
    scope: { kind: "institution", institution: actor.institution },
  };
}

export function canSport(actor: SportActor | null, permission: SportPermission): boolean {
  return sportAccess(actor).can.has(permission);
}

/** What the web app gets to decide which pages and buttons to show. */
export function sportAccessJson(actor: SportActor | null) {
  const access = sportAccess(actor);
  return {
    permissions: SPORT_PERMISSIONS.filter((permission) => access.can.has(permission)),
    scope: access.scope,
  };
}

/**
 * SQL on the actor's own `user` row: everything sportAccess read is unchanged
 * (role, department, institution, seat and ban). Pass to abortUnless so a
 * batch rolls back if the actor lost a right after the route checked it.
 */
export function sportAccessIsAsRead(actor: CurrentUser): SQL {
  const seatAsRead = actor.leadershipRole
    ? sql`exists (select 1 from ${leadership} where ${leadership.userId} = ${user.id} and ${leadership.role} = ${actor.leadershipRole})`
    : sql`not exists (select 1 from ${leadership} where ${leadership.userId} = ${user.id})`;
  return (
    and(
      notBanned(),
      eq(user.role, actor.role ?? ""),
      actor.departmentId
        ? eq(user.departmentId, actor.departmentId)
        : sql`${user.departmentId} is null`,
      actor.institution
        ? eq(user.institution, actor.institution)
        : sql`${user.institution} is null`,
      seatAsRead,
    ) ?? sql`0`
  );
}

/** SQL limiting rows to what `scope` may see, by their institution column. */
export function inScope(scope: SportScope, institution: SQLiteColumn): SQL {
  if (scope.kind === "all") return sql`1`;
  if (scope.kind === "institution") return eq(institution, scope.institution) ?? sql`0`;
  return sql`0`;
}
