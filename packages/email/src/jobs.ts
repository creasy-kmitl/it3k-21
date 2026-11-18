import type { AssignKind } from "@it3k/db/invitation-rules";
import type { Institution } from "@it3k/db/profile";
import type { DivisionFormat, DivisionGender, RegistrationStatus } from "@it3k/db/sport-rules";
import type { RichTextDoc } from "./rich-text";

/**
 * What a route puts on the email queue. Transactional jobs carry a snapshot of
 * the data at the moment of the change, so the email describes what the
 * person actually did even if it changes again before the queue drains.
 *
 * A staff email carries only the campaign id: its content can be large, so
 * the consumer loads it from `email_campaign`.
 */

export type Recipient = { email: string; name?: string | null };

export type ProfileSubmittedJob = {
  kind: "profile-submitted";
  to: Recipient;
  profile: {
    prefix: string;
    firstName: string;
    lastName: string;
    nickname: string;
    phone: string;
    institution: Institution | "";
    medicalConditions: string;
    drugAllergies: string;
    foodAllergies: string;
    dietaryRestrictions: string;
  };
};

export type SportRegisteredJob = {
  kind: "sport-registered";
  to: Recipient;
  registration: {
    sport: string;
    division: string;
    gender: DivisionGender;
    format: DivisionFormat;
    institution: Institution;
    status: RegistrationStatus;
    shirtNumber: number | null;
    badmintonRank: number | null;
    ign: string | null;
  };
};

export type SportReviewedJob = {
  kind: "sport-reviewed";
  to: Recipient;
  registration: {
    sport: string;
    division: string;
    institution: Institution;
    status: "approved" | "rejected";
    note: string | null;
  };
};

export type TicketClaimedJob = {
  kind: "ticket-claimed";
  to: Recipient;
  ticket: {
    /** The `/tickets/<ref>` path segment: the event's slug, or its id. */
    ref: string;
    eventName: string;
    startAt: number;
    endAt: number | null;
    venue: string | null;
    /** The ticket's secret code, drawn as its QR. Absent on jobs queued before the QR was added. */
    code?: string;
  };
};

export type InvitationJob = {
  kind: "invitation";
  to: Recipient;
  invite: {
    kind: AssignKind;
    /** The department's name, for staff and seats. */
    department: string | null;
    /** Set on the new account; absent on jobs queued before it was added. */
    institution?: Institution | null;
    /** Who sent it, by display name. */
    invitedBy: string | null;
    expiresAt: number;
  };
};

export type CustomJob = {
  kind: "custom";
  campaignId: string;
  /** At most {@link CUSTOM_CHUNK} people. Each still gets an email of their own. */
  to: Recipient[];
  /**
   * A chunk that hits a temporary error part way through is put back with
   * only the people still waiting, so nobody gets the email twice; this
   * counts those returns.
   */
  attempt?: number;
};

export type EmailJob =
  | ProfileSubmittedJob
  | SportRegisteredJob
  | SportReviewedJob
  | TicketClaimedJob
  | InvitationJob
  | CustomJob;

/** A staff email with its content loaded, ready to render for one person. */
export type CustomEmail = {
  kind: "custom";
  to: Recipient;
  subject: string;
  content: RichTextDoc;
  sender: string | null;
};

export type RenderableEmail = Exclude<EmailJob, CustomJob> | CustomEmail;

/** Recipients per queued staff-email message. */
export const CUSTOM_CHUNK = 50;
