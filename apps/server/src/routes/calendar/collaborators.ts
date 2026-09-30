// Departments that work on an item alongside the one that owns it. They see
// the item on their calendar and their leaders hear about it; only the owning
// department edits it.
import type { Database } from "@it3k/db";
import {
  MAX_COLLABORATORS,
  calendarItem,
  calendarItemCollaborator,
} from "@it3k/db/schema/calendar";
import {
  type DepartmentAppearance,
  department,
  departmentAppearance,
} from "@it3k/db/schema/department";
import { leadership } from "@it3k/db/schema/leadership";
import { and, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import { id } from "./shared";

export const collaboratorIds = z
  .array(id)
  .max(MAX_COLLABORATORS)
  .refine((ids) => new Set(ids).size === ids.length, "Each department may only be listed once");

/** The item's collaborating department ids, comma-separated, for a select. */
export const collaboratorIdList = sql<
  string | null
>`(select group_concat(${calendarItemCollaborator.departmentId}) from ${calendarItemCollaborator} where ${calendarItemCollaborator.itemId} = ${calendarItem.id})`;

/** Items owned by, or worked on with, any of these departments. */
export function involvesAny(db: Database, departmentIds: string[]) {
  return sql`(${inArray(calendarItem.departmentId, departmentIds)} or ${exists(
    db
      .select({ id: calendarItemCollaborator.id })
      .from(calendarItemCollaborator)
      .where(
        and(
          eq(calendarItemCollaborator.itemId, calendarItem.id),
          inArray(calendarItemCollaborator.departmentId, departmentIds),
        ),
      ),
  )})`;
}

export type DepartmentLook = { id: string; name: string } & DepartmentAppearance;

/** Every department's name and look, in display order, to name collaborators. */
export async function loadDepartments(db: Database): Promise<Map<string, DepartmentLook>> {
  const rows = await db
    .select({
      id: department.id,
      name: department.name,
      icon: department.icon,
      color: department.color,
    })
    .from(department)
    .orderBy(department.createdAt, department.name);
  return new Map(rows.map((row) => [row.id, departmentAppearance(row)]));
}

/** Collaborators as the API returns them, in the departments' display order. */
export function describeCollaborators(
  list: string | null,
  departments: Map<string, DepartmentLook>,
): DepartmentLook[] {
  const ids = new Set(list ? list.split(",") : []);
  return [...departments.values()].filter((d) => ids.has(d.id));
}

export async function collaboratorsProblem(
  db: Database,
  ids: string[],
  ownerDepartmentId: string,
): Promise<string | null> {
  if (ids.includes(ownerDepartmentId)) {
    return "The owning department is not also a collaborator";
  }
  if (ids.length === 0) return null;
  const rows = await db
    .select({ id: department.id })
    .from(department)
    .where(inArray(department.id, ids));
  return rows.length === ids.length ? null : "Department not found";
}

export async function currentCollaborators(db: Database, itemId: string) {
  const rows = await db
    .select({ departmentId: calendarItemCollaborator.departmentId })
    .from(calendarItemCollaborator)
    .where(eq(calendarItemCollaborator.itemId, itemId));
  return rows.map((row) => row.departmentId).sort();
}

/** The accounts holding a head or vicehead seat in each of these departments. */
export async function leadersOf(db: Database, departmentIds: string[]) {
  const leaders = new Map<string, string[]>();
  if (departmentIds.length === 0) return leaders;
  const rows = await db
    .select({ departmentId: leadership.departmentId, userId: leadership.userId })
    .from(leadership)
    .where(and(inArray(leadership.departmentId, departmentIds), isNotNull(leadership.userId)));
  for (const row of rows) {
    if (!row.userId) continue;
    leaders.set(row.departmentId, [...(leaders.get(row.departmentId) ?? []), row.userId]);
  }
  return leaders;
}

/** Adds and removes collaborators, for the same batch as the item's write. */
export function collaboratorWrites(
  db: Database,
  itemId: string,
  added: string[],
  removed: string[],
) {
  return [
    ...(removed.length > 0
      ? [
          db
            .delete(calendarItemCollaborator)
            .where(
              and(
                eq(calendarItemCollaborator.itemId, itemId),
                inArray(calendarItemCollaborator.departmentId, removed),
              ),
            ),
        ]
      : []),
    ...(added.length > 0
      ? [
          db
            .insert(calendarItemCollaborator)
            .values(added.map((departmentId) => ({ itemId, departmentId }))),
        ]
      : []),
  ];
}
