// Staff email rules shared by the API and the web app. Kept free of Drizzle so
// the browser bundle can import it.
import { z } from "zod";
import { INSTITUTION_IDS } from "./profile";
import { REGISTRATION_STATUSES } from "./sport-rules";

/** One staff email may reach at most this many people. */
export const MAX_EMAIL_RECIPIENTS = 2000;
export const MAX_EMAIL_SUBJECT = 200;
/** Hand-picked recipients ("ระบุเอง"), accounts and typed addresses combined. */
export const MAX_MANUAL_RECIPIENTS = 200;

const institutions = z.array(z.enum(INSTITUTION_IDS)).max(INSTITUTION_IDS.length).default([]);

/**
 * Who a staff email goes to. An empty `institutions` list means every
 * institution the sender may reach; an empty `divisionIds` list means every
 * division (of `sportId`, when one is given).
 */
export const emailAudienceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("participants"), institutions }),
  z.strictObject({
    kind: z.literal("athletes"),
    sportId: z.string().min(1).max(100).nullish(),
    divisionIds: z.array(z.string().min(1).max(100)).max(100).default([]),
    statuses: z.array(z.enum(REGISTRATION_STATUSES)).min(1).max(REGISTRATION_STATUSES.length),
    institutions,
  }),
  z.strictObject({
    kind: z.literal("ticket-holders"),
    eventId: z.string().min(1).max(100),
    institutions,
  }),
  z.strictObject({
    kind: z.literal("manual"),
    userIds: z.array(z.string().min(1).max(100)).max(MAX_MANUAL_RECIPIENTS).default([]),
    emails: z.array(z.email().max(254)).max(MAX_MANUAL_RECIPIENTS).default([]),
  }),
]);

export type EmailAudience = z.infer<typeof emailAudienceSchema>;
export type EmailAudienceKind = EmailAudience["kind"];

export const AUDIENCE_LABELS: Record<EmailAudienceKind, string> = {
  participants: "ผู้เข้าร่วม",
  athletes: "นักกีฬา",
  "ticket-holders": "ผู้ถือตั๋ว",
  manual: "ระบุเอง",
};
