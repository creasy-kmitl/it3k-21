// Who an event expects and who has checked in. A sport event expects the
// approved athletes of its divisions from its institutions; any event expects
// its ticket holders. Each ticket checks in once.
import type { Database } from "@it3k/db";
import type { Institution } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import {
  event,
  eventCheckin,
  eventDivision,
  eventInstitution,
  eventTicket,
  eventTicketType,
} from "@it3k/db/schema/event";
import { userProfile } from "@it3k/db/schema/profile";
import { athlete, sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { type SQL, and, asc, count, eq, inArray, or, sql } from "drizzle-orm";

import { type SportScope, inScope } from "../../policies/sports";

/** The event whose id or slug is `ref`. Slugs never look like ids, so at most one matches. */

// Rows made in the same millisecond tie on created_at; SQLite's rowid keeps
// them in the order they were inserted (a random id would shuffle them).
const ticketRowid = sql`"event_ticket"."rowid"`;
const checkinRowid = sql`"event_checkin"."rowid"`;

export const byRef = (ref: string) => or(eq(event.id, ref), eq(event.slug, ref));

/** SQL: the ticket exists and has not been checked in. */
export function ticketUnused(ticketId: string): SQL {
  return sql`exists (select 1 from ${eventTicket} where ${eventTicket.id} = ${ticketId})
    and not exists (select 1 from ${eventCheckin} where ${eventCheckin.ticketId} = ${ticketId})`;
}

/** SQL: `userId` has an approved registration this event expects. */
export function expectedAt(eventId: string | SQL, userId: string | SQL): SQL {
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

export type Checkin = {
  id: string;
  at: string;
  method: "scan" | "manual";
  forced: boolean;
  ticketId: string | null;
};

export type ParticipantTicket = { id: string; typeName: string; checkin: Checkin | null };

export type Participant = Person & {
  /**
   * On the event's list, as opposed to checked in by force: an approved
   * athlete at a sport event, or anyone holding a ticket.
   */
  expected: boolean;
  hasTicket: boolean;
  /** Their tickets to this event, in claim order, each with its check-in. */
  tickets: ParticipantTicket[];
  /** Every check-in, earliest first; several when they hold several tickets. */
  checkins: Checkin[];
  /** The earliest check-in, or null for none. */
  checkin: Checkin | null;
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

/** Tickets handed out per ticket type. */
export async function ticketTypeCounts(db: Database, typeIds: string[]) {
  if (typeIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ typeId: eventTicket.ticketTypeId, n: count() })
    .from(eventTicket)
    .where(inArray(eventTicket.ticketTypeId, typeIds))
    .groupBy(eventTicket.ticketTypeId);
  return new Map(rows.flatMap((row) => (row.typeId ? [[row.typeId, row.n] as const] : [])));
}

/** Tickets handed out per event. */
export async function ticketCounts(db: Database, eventIds: string[]) {
  if (eventIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ eventId: eventTicket.eventId, n: count() })
    .from(eventTicket)
    .where(inArray(eventTicket.eventId, eventIds))
    .groupBy(eventTicket.eventId);
  return new Map(rows.map((row) => [row.eventId, row.n]));
}

/** `userId`'s tickets to the event in claim order, each with its type and check-in. */
export async function ticketsOf(db: Database, eventId: string, userId: string) {
  return db
    .select({
      id: eventTicket.id,
      typeName: sql<string>`coalesce(${eventTicketType.name}, '')`,
      checkinId: eventCheckin.id,
      checkedInAt: eventCheckin.createdAt,
    })
    .from(eventTicket)
    .leftJoin(eventTicketType, eq(eventTicketType.id, eventTicket.ticketTypeId))
    .leftJoin(eventCheckin, eq(eventCheckin.ticketId, eventTicket.id))
    .where(and(eq(eventTicket.eventId, eventId), eq(eventTicket.userId, userId)))
    .orderBy(asc(eventTicket.createdAt), ticketRowid);
}

/** `userId`'s check-ins at the event, earliest first. */
export async function checkinsOf(db: Database, eventId: string, userId: string) {
  return db
    .select()
    .from(eventCheckin)
    .where(and(eq(eventCheckin.eventId, eventId), eq(eventCheckin.userId, userId)))
    .orderBy(asc(eventCheckin.createdAt), checkinRowid);
}

/** Everyone the event expects plus everyone checked in, limited to `scope`. */
export async function listParticipants(
  db: Database,
  item: Pick<typeof event.$inferSelect, "id" | "type">,
  scope: SportScope,
): Promise<Participant[]> {
  const [registrations, tickets, checkins] = await Promise.all([
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
        ticketId: eventTicket.id,
        typeName: sql<string>`coalesce(${eventTicketType.name}, '')`,
      })
      .from(eventTicket)
      .leftJoin(eventTicketType, eq(eventTicketType.id, eventTicket.ticketTypeId))
      .innerJoin(user, eq(user.id, eventTicket.userId))
      .leftJoin(athlete, eq(athlete.userId, eventTicket.userId))
      .leftJoin(userProfile, eq(userProfile.userId, eventTicket.userId))
      .where(and(eq(eventTicket.eventId, item.id), inScope(scope, user.institution)))
      .orderBy(asc(user.name), asc(eventTicket.createdAt), ticketRowid),
    db
      .select({
        ...personSelect(),
        checkinId: eventCheckin.id,
        at: eventCheckin.createdAt,
        method: eventCheckin.method,
        forced: eventCheckin.forced,
        ticketId: eventCheckin.ticketId,
      })
      .from(eventCheckin)
      .innerJoin(user, eq(user.id, eventCheckin.userId))
      .leftJoin(athlete, eq(athlete.userId, eventCheckin.userId))
      .leftJoin(userProfile, eq(userProfile.userId, eventCheckin.userId))
      .where(and(eq(eventCheckin.eventId, item.id), inScope(scope, user.institution)))
      .orderBy(asc(eventCheckin.createdAt), checkinRowid),
  ]);

  const blank = { hasTicket: false, tickets: [], checkins: [], checkin: null };

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
      ...blank,
      tickets: [],
      checkins: [],
    });
  }
  const ticketById = new Map<string, ParticipantTicket>();
  for (const row of tickets) {
    let person = people.get(row.userId);
    if (!person) {
      person = { ...toPerson(row, []), expected: true, ...blank, tickets: [], checkins: [] };
      people.set(row.userId, person);
    }
    const ticket = { id: row.ticketId, typeName: row.typeName, checkin: null };
    person.hasTicket = true;
    person.tickets.push(ticket);
    ticketById.set(ticket.id, ticket);
  }
  for (const row of checkins) {
    const checkin: Checkin = {
      id: row.checkinId,
      at: row.at.toISOString(),
      method: row.method,
      forced: row.forced,
      ticketId: row.ticketId,
    };
    let person = people.get(row.userId);
    if (!person) {
      person = { ...toPerson(row, []), expected: false, ...blank, tickets: [], checkins: [] };
      people.set(row.userId, person);
    }
    person.checkins.push(checkin);
    person.checkin ??= checkin;
    if (row.ticketId) {
      const ticket = ticketById.get(row.ticketId);
      if (ticket) ticket.checkin = checkin;
    }
  }
  return [...people.values()];
}
