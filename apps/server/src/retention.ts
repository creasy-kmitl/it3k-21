// Purges personal data one year after the event it was collected for, as the
// retention policy promises (apps/docs/content/docs/privacy.mdx, sections 4, 5
// and 7). Run from the hourly cron; each run is one batch, so it either purges
// a season completely or not at all, and later runs find nothing left to do.
import type { Database } from "@it3k/db";
import { session } from "@it3k/db/schema/auth";
import { calendarChange } from "@it3k/db/schema/calendar";
import { competitionChange, competitionMatchCheckin } from "@it3k/db/schema/competition";
import { emailCampaign } from "@it3k/db/schema/email";
import { event, eventCheckin, eventTicket } from "@it3k/db/schema/event";
import { invitation } from "@it3k/db/schema/invitation";
import { leadership, leadershipContactReveal, leadershipSocial } from "@it3k/db/schema/leadership";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import { shortLinkChange } from "@it3k/db/schema/short-link";
import { athlete, sportRegistration, sportRegistrationChange } from "@it3k/db/schema/sport";
import { EVENT_END_DATES, purgeCutoff } from "@it3k/db/retention";
import { and, isNotNull, lt, lte, or, sql } from "drizzle-orm";

/**
 * SQL on `athlete`: the row is last season's. A registration saved since the
 * cutoff means the athlete is competing again, so their student id, card and
 * check-in code stay.
 */
function athleteIsPast(cutoff: Date) {
  return sql`${athlete.updatedAt} <= ${cutoff.getTime()} and not exists (select 1 from ${sportRegistration} where ${sportRegistration.userId} = ${athlete.userId} and ${sportRegistration.updatedAt} > ${cutoff.getTime()})`;
}

/**
 * SQL: the ids of the profile photos and student cards that rows on one side of
 * the cutoff name. `past` picks the rows being purged, otherwise the ones kept.
 */
function fileReferences(cutoff: Date, past: boolean) {
  const at = cutoff.getTime();
  const profiles = past
    ? sql`${userProfile.updatedAt} <= ${at}`
    : sql`${userProfile.updatedAt} > ${at}`;
  const athletes = past ? athleteIsPast(cutoff) : sql`not (${athleteIsPast(cutoff)})`;
  const registrations = past
    ? sql`${sportRegistration.updatedAt} <= ${at}`
    : sql`${sportRegistration.updatedAt} > ${at}`;
  // Nulls are left out: `id not in (…, null)` would match nothing.
  return sql`select ref from (
    select json_extract(${userProfile.values}, '$.photoFileId') as ref from ${userProfile} where ${profiles}
    union select json_extract(${userProfile.draft}, '$.photoFileId') from ${userProfile} where ${profiles}
    union select ${athlete.studentCardFileId} from ${athlete} where ${athletes}
    union select ${sportRegistration.studentCardFileId} from ${sportRegistration} where ${registrations}
  ) where ref is not null and ref <> ''`;
}

/**
 * Deletes or blanks every season's personal data whose purge date has passed.
 * Public results (team rosters' display names, shirt numbers, scores,
 * placements) are kept. Returns the cutoff it purged up to, or null.
 */
export async function purgeExpiredPersonalData(
  db: Database,
  now = new Date(),
  dates: readonly string[] = EVENT_END_DATES,
) {
  const cutoff = purgeCutoff(now, dates);
  if (!cutoff) return null;
  const at = cutoff.getTime();
  const byCutoff = (column: Parameters<typeof lte>[0]) => lte(column, cutoff);

  await db.batch([
    // Files first, while the rows below still name them. A card reused on a
    // registration that is kept stays; cleanupFiles deletes the rest from R2.
    db
      .update(uploadedFile)
      .set({ state: "deleting" })
      .where(
        sql`${uploadedFile.state} = 'ready' and ${uploadedFile.id} in (${fileReferences(cutoff, true)}) and ${uploadedFile.id} not in (${fileReferences(cutoff, false)})`,
      ),

    // Health data, names, phone and photo: the whole profile goes. Registering
    // again asks for a submitted profile, so a returning athlete fills it in anew.
    db.delete(userProfile).where(byCutoff(userProfile.updatedAt)),

    // updated_at is kept as it was: blanking is not the holder's activity, and
    // moving it past the cutoff would make the row look like next season's.
    db
      .update(athlete)
      .set({
        studentId: "",
        studentCardFileId: null,
        checkinCode: null,
        updatedAt: sql`${athlete.updatedAt}`,
      })
      .where(
        sql`${athleteIsPast(cutoff)} and (${athlete.studentId} <> '' or ${athlete.studentCardFileId} is not null or ${athlete.checkinCode} is not null)`,
      ),
    db
      .update(sportRegistration)
      .set({
        ign: "",
        ignReading: "",
        facebookUrl: "",
        discordUserId: null,
        discordUsername: null,
        studentCardFileId: null,
        reviewNote: null,
        // An edit based on a read from before the purge is refused.
        version: sql`${sportRegistration.version} + 1`,
        updatedAt: sql`${sportRegistration.updatedAt}`,
      })
      .where(
        and(
          byCutoff(sportRegistration.updatedAt),
          or(
            sql`${sportRegistration.ign} <> ''`,
            sql`${sportRegistration.ignReading} <> ''`,
            sql`${sportRegistration.facebookUrl} <> ''`,
            isNotNull(sportRegistration.discordUserId),
            isNotNull(sportRegistration.discordUsername),
            isNotNull(sportRegistration.studentCardFileId),
            isNotNull(sportRegistration.reviewNote),
          ),
        ),
      ),

    // Leaders' contacts not touched since the season ended. The seat and its
    // name stay; the leader enters fresh contacts for the new season.
    db
      .delete(leadershipSocial)
      .where(
        sql`${leadershipSocial.leadershipId} in (select ${leadership.id} from ${leadership} where ${leadership.updatedAt} <= ${at})`,
      ),
    db
      .update(leadership)
      .set({ nickname: null, phone: null, updatedAt: sql`${leadership.updatedAt}` })
      .where(
        and(
          byCutoff(leadership.updatedAt),
          or(isNotNull(leadership.nickname), isNotNull(leadership.phone)),
        ),
      ),

    // Change history and other records of who did what.
    db.delete(sportRegistrationChange).where(byCutoff(sportRegistrationChange.createdAt)),
    db.delete(calendarChange).where(byCutoff(calendarChange.createdAt)),
    db.delete(shortLinkChange).where(byCutoff(shortLinkChange.createdAt)),
    db.delete(competitionChange).where(byCutoff(competitionChange.createdAt)),
    db.delete(leadershipContactReveal).where(byCutoff(leadershipContactReveal.createdAt)),
    db.delete(emailCampaign).where(byCutoff(emailCampaign.createdAt)),
    db.delete(invitation).where(byCutoff(invitation.createdAt)),

    // Tickets and check-ins of events that ended by the cutoff, and match check-ins.
    db
      .delete(eventCheckin)
      .where(
        sql`${eventCheckin.eventId} in (select ${event.id} from ${event} where ${event.endAt} <= ${at})`,
      ),
    db
      .delete(eventTicket)
      .where(
        sql`${eventTicket.eventId} in (select ${event.id} from ${event} where ${event.endAt} <= ${at})`,
      ),
    db.delete(competitionMatchCheckin).where(byCutoff(competitionMatchCheckin.createdAt)),
  ]);
  return cutoff;
}

/** Deletes expired sessions, with the IP address and browser they recorded. */
export async function cleanupExpiredSessions(db: Database, now = new Date()) {
  await db.delete(session).where(lt(session.expiresAt, now));
}
