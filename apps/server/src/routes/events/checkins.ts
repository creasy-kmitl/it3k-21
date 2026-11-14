// Who an event expects and who has checked in. A sport event expects the
// approved athletes of its divisions from its institutions; a general event
// expects nobody in particular, so its list is whoever checked in.
import type { Database } from "@it3k/db";
import type { Institution } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import { type event, eventCheckin, eventDivision, eventInstitution } from "@it3k/db/schema/event";
import { userProfile } from "@it3k/db/schema/profile";
import { athlete, sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { type SQL, and, asc, eq, sql } from "drizzle-orm";

import { type SportScope, inScope } from "../../policies/sports";

/** SQL: `userId` has an approved registration this event expects. */
export function expectedAt(eventId: string, userId: string | SQL): SQL {
  return sql`exists (
    select 1 from ${sportRegistration}
    join ${eventDivision} on ${eventDivision.divisionId} = ${sportRegistration.divisionId}
      and ${eventDivision.eventId} = ${eventId}
    join ${eventInstitution} on ${eventInstitution.institution} = ${sportRegistration.institution}
      and ${eventInstitution.eventId} = ${eventId}
    where ${sportRegistration.userId} = ${userId} and ${sportRegistration.status} = 'approved'
  )`;
}

/** What the kiosk and the participant list show about a person. */
export type Person = {
  userId: string;
  name: string;
  image: string | null;
  institution: Institution | null;
  studentId: string | null;
  prefix: string;
  firstName: string;
  lastName: string;
  nickname: string;
  divisions: { id: string; name: string }[];
};

export type Participant = Person & {
  /** On the event's list, as opposed to checked in by force. */
  expected: boolean;
  checkin: { at: string; method: "scan" | "manual"; forced: boolean } | null;
};

function personSelect() {
  return {
    userId: user.id,
    name: user.name,
    image: user.image,
    institution: user.institution,
    studentId: athlete.studentId,
    profile: userProfile.values,
  };
}

type PersonRow = {
  userId: string;
  name: string;
  image: string | null;
  institution: Institution | null;
  studentId: string | null;
  profile: {
    prefix?: string;
    firstName?: string;
    lastName?: string;
    nickname?: string;
    institution?: string;
  } | null;
};

function toPerson(row: PersonRow, divisions: Person["divisions"]): Person {
  return {
    userId: row.userId,
    name: row.name,
    image: row.image,
    institution: row.institution ?? ((row.profile?.institution || null) as Institution | null),
    studentId: row.studentId,
    prefix: row.profile?.prefix ?? "",
    firstName: row.profile?.firstName ?? "",
    lastName: row.profile?.lastName ?? "",
    nickname: row.profile?.nickname ?? "",
    divisions,
  };
}

/** The divisions of this event `userId` is approved for. */
async function divisionsAt(db: Database, eventId: string, userId: string) {
  return db
    .select({ id: sportDivision.id, name: sportDivision.name })
    .from(sportRegistration)
    .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
    .where(and(eq(sportRegistration.userId, userId), expectedAtDivision(eventId)))
    .orderBy(asc(sportDivision.sortOrder));
}

/** SQL on a sport_registration row: approved, in this event's divisions and institutions. */
function expectedAtDivision(eventId: string): SQL {
  return sql`${sportRegistration.status} = 'approved'
    and exists (select 1 from ${eventDivision} where ${eventDivision.eventId} = ${eventId} and ${eventDivision.divisionId} = ${sportRegistration.divisionId})
    and exists (select 1 from ${eventInstitution} where ${eventInstitution.eventId} = ${eventId} and ${eventInstitution.institution} = ${sportRegistration.institution})`;
}

/** One person as the kiosk shows them, or null when the account does not exist. */
export async function findPerson(db: Database, eventId: string, userId: string) {
  const [row] = await db
    .select(personSelect())
    .from(user)
    .leftJoin(athlete, eq(athlete.userId, user.id))
    .leftJoin(userProfile, eq(userProfile.userId, user.id))
    .where(eq(user.id, userId));
  if (!row) return null;
  return toPerson(row, await divisionsAt(db, eventId, userId));
}

export async function findCheckin(db: Database, eventId: string, userId: string) {
  const [row] = await db
    .select()
    .from(eventCheckin)
    .where(and(eq(eventCheckin.eventId, eventId), eq(eventCheckin.userId, userId)));
  return row ?? null;
}

/** Everyone the event expects plus everyone checked in, limited to `scope`. */
export async function listParticipants(
  db: Database,
  item: Pick<typeof event.$inferSelect, "id" | "type">,
  scope: SportScope,
): Promise<Participant[]> {
  const [registrations, checkins] = await Promise.all([
    item.type === "sport"
      ? db
          .select({
            ...personSelect(),
            registrationInstitution: sportRegistration.institution,
            divisionId: sportDivision.id,
            divisionName: sportDivision.name,
          })
          .from(sportRegistration)
          .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
          .innerJoin(user, eq(user.id, sportRegistration.userId))
          .leftJoin(athlete, eq(athlete.userId, sportRegistration.userId))
          .leftJoin(userProfile, eq(userProfile.userId, sportRegistration.userId))
          .where(and(expectedAtDivision(item.id), inScope(scope, sportRegistration.institution)))
          .orderBy(asc(sportRegistration.institution), asc(user.name), asc(sportDivision.sortOrder))
      : Promise.resolve([]),
    db
      .select({
        ...personSelect(),
        at: eventCheckin.createdAt,
        method: eventCheckin.method,
        forced: eventCheckin.forced,
      })
      .from(eventCheckin)
      .innerJoin(user, eq(user.id, eventCheckin.userId))
      .leftJoin(athlete, eq(athlete.userId, eventCheckin.userId))
      .leftJoin(userProfile, eq(userProfile.userId, eventCheckin.userId))
      .where(and(eq(eventCheckin.eventId, item.id), inScope(scope, user.institution)))
      .orderBy(asc(eventCheckin.createdAt)),
  ]);

  const people = new Map<string, Participant>();
  for (const row of registrations) {
    const existing = people.get(row.userId);
    const division = { id: row.divisionId, name: row.divisionName };
    if (existing) {
      existing.divisions.push(division);
      continue;
    }
    people.set(row.userId, {
      ...toPerson({ ...row, institution: row.registrationInstitution }, [division]),
      expected: true,
      checkin: null,
    });
  }
  for (const row of checkins) {
    const checkin = { at: row.at.toISOString(), method: row.method, forced: row.forced };
    const existing = people.get(row.userId);
    if (existing) existing.checkin = checkin;
    else
      people.set(row.userId, { ...toPerson(row, []), expected: item.type === "general", checkin });
  }
  return [...people.values()];
}
