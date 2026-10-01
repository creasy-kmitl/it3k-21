// SQL conditions on the actor's own `user` row, the row abortUnless updates,
// so a batch is rolled back if the actor lost a right after the route checked it.
import { user } from "@it3k/db/schema/auth";
import { type SQL, sql } from "drizzle-orm";

/** SQL: the (comma-separated) role list includes `role`. */
export const roleIncludes = (role: string): SQL =>
  sql`(',' || replace(${user.role}, ' ', '') || ',' like ${`%,${role},%`})`;

/** SQL: the account is not banned, or its ban has run out. */
export const notBanned = (): SQL =>
  sql`(coalesce(${user.banned}, 0) = 0 or (${user.banExpires} is not null and ${user.banExpires} <= cast(unixepoch('subsecond') * 1000 as integer)))`;
