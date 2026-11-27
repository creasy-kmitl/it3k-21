// Which of the roles /init made a member should hold, from what it3k says
// about them. Only these roles are managed: verify adds and removes them and
// never touches any other role.
import type { Institution } from "@it3k/db/profile";

import type { MemberInfo } from "./api";
import { gameOf } from "./games";
import { type RoleKey, buildLayout } from "./layout";

/** Every role key verify manages. */
export const MANAGED_ROLES: readonly RoleKey[] = buildLayout().roles.map((role) => role.key);

export function rolesFor(member: MemberInfo): Set<RoleKey> {
  const keys = new Set<RoleKey>();
  if (!member.linked || member.banned) return keys;
  if (member.staff) keys.add("staff");
  for (const entry of member.esports) {
    const game = gameOf(entry);
    if (!game) continue;
    keys.add(`game:${game.key}`);
    keys.add(`team:${game.key}:${entry.institution as Institution}`);
  }
  return keys;
}

export type RoleChange = { add: string[]; remove: string[]; keep: RoleKey[] };

/**
 * The Discord role ids to add and remove so the member holds exactly the
 * managed roles in `wanted`. `idOf` resolves a key to the guild's role id
 * (undefined when /init has not made it); `held` is the member's role ids.
 */
export function planRoleChange(
  wanted: Set<RoleKey>,
  held: ReadonlySet<string>,
  idOf: (key: RoleKey) => string | undefined,
): RoleChange {
  const add: string[] = [];
  const remove: string[] = [];
  const keep: RoleKey[] = [];
  for (const key of MANAGED_ROLES) {
    const id = idOf(key);
    if (!id) continue;
    if (wanted.has(key)) {
      keep.push(key);
      if (!held.has(id)) add.push(id);
    } else if (held.has(id)) {
      remove.push(id);
    }
  }
  return { add, remove, keep };
}
