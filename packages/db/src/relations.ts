import { defineRelations } from "drizzle-orm";

import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  user: {
    sessions: r.many.session(),
    accounts: r.many.account(),
    department: r.one.department({
      from: r.user.departmentId,
      to: r.department.id,
    }),
  },
  department: {
    members: r.many.user(),
    leaders: r.many.leadership(),
  },
  leadership: {
    department: r.one.department({
      from: r.leadership.departmentId,
      to: r.department.id,
      optional: false,
    }),
    user: r.one.user({
      from: r.leadership.userId,
      to: r.user.id,
    }),
    socials: r.many.leadershipSocial(),
  },
  leadershipSocial: {
    leadership: r.one.leadership({
      from: r.leadershipSocial.leadershipId,
      to: r.leadership.id,
      optional: false,
    }),
  },
  calendarItem: {
    owner: r.one.user({
      from: r.calendarItem.ownerId,
      to: r.user.id,
    }),
    departments: r.many.calendarItemDepartment(),
  },
  calendarItemDepartment: {
    item: r.one.calendarItem({
      from: r.calendarItemDepartment.itemId,
      to: r.calendarItem.id,
      optional: false,
    }),
    department: r.one.department({
      from: r.calendarItemDepartment.departmentId,
      to: r.department.id,
      optional: false,
    }),
  },
  session: {
    user: r.one.user({
      from: r.session.userId,
      to: r.user.id,
      optional: false,
    }),
  },
  account: {
    user: r.one.user({
      from: r.account.userId,
      to: r.user.id,
      optional: false,
    }),
  },
}));
