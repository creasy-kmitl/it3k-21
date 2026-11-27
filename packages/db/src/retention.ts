/**
 * When personal data is purged, per the retention policy
 * (apps/docs/content/docs/privacy.mdx). Health data and other non-public
 * personal data from an event's season is deleted one year after the event
 * ends; public results are kept.
 *
 * A row belongs to the season of the first event that ended on or after its
 * last update. Rows touched after an event's end belong to the next one, so a
 * returning participant's new data is not purged with last year's.
 */

/**
 * The last day of each IT3Kings event, as a Bangkok date (YYYY-MM-DD), oldest
 * first. Add each year's date once it is announced and never remove one: the
 * purge only ever runs for dates listed here.
 */
export const EVENT_END_DATES: readonly string[] = [];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: string) {
  const match = DATE.exec(date);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const [, year, month, day] = match;
  // Feb 29 has no anniversary, and Date would roll an invalid day over.
  const probe = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCDate() !== Number(day) ||
    date.endsWith("-02-29")
  )
    throw new Error(`Not a usable event end date: ${date}`);
  return { year: Number(year), rest: `${month}-${day}` };
}

/** The last moment of the event's final day in Bangkok: rows updated by then belong to it. */
export function seasonEnd(date: string): Date {
  const { year, rest } = parse(date);
  return new Date(`${year}-${rest}T23:59:59.999+07:00`);
}

/** Midnight in Bangkok on the same date one year later, when that season's data is purged. */
export function purgeDueAt(date: string): Date {
  const { year, rest } = parse(date);
  return new Date(`${year + 1}-${rest}T00:00:00.000+07:00`);
}

/**
 * The season end to purge up to: that of the latest event whose purge date has
 * passed, or null when none has. Purging up to it also covers every earlier season.
 */
export function purgeCutoff(now: Date, dates: readonly string[] = EVENT_END_DATES): Date | null {
  let cutoff: Date | null = null;
  for (const date of dates) {
    if (purgeDueAt(date) > now) continue;
    const end = seasonEnd(date);
    if (!cutoff || end > cutoff) cutoff = end;
  }
  return cutoff;
}
