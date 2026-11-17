/** @jsxImportSource react */
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import type { EmailContext } from "./components/layout";
import type { RenderableEmail } from "./jobs";
import { BRAND } from "./theme";
import { CustomEmailTemplate } from "./templates/custom";
import { ProfileSubmittedEmail, profileSubmittedSubject } from "./templates/profile-submitted";
import { SportRegisteredEmail, sportRegisteredSubject } from "./templates/sport-registered";
import { SportReviewedEmail, sportReviewedSubject } from "./templates/sport-reviewed";
import { TicketClaimedEmail, ticketClaimedSubject } from "./templates/ticket-claimed";

export type { EmailContext } from "./components/layout";

export type RenderedEmail = { subject: string; html: string; text: string };

function element(
  email: RenderableEmail,
  ctx: EmailContext,
): { subject: string; node: ReactElement } {
  switch (email.kind) {
    case "profile-submitted":
      return {
        subject: profileSubmittedSubject(),
        node: <ProfileSubmittedEmail job={email} ctx={ctx} />,
      };
    case "sport-registered":
      return {
        subject: sportRegisteredSubject(email),
        node: <SportRegisteredEmail job={email} ctx={ctx} />,
      };
    case "sport-reviewed":
      return {
        subject: sportReviewedSubject(email),
        node: <SportReviewedEmail job={email} ctx={ctx} />,
      };
    case "ticket-claimed":
      return {
        subject: ticketClaimedSubject(email),
        node: <TicketClaimedEmail job={email} ctx={ctx} />,
      };
    case "custom":
      // Staff write the whole subject themselves, so it goes out unchanged.
      return { subject: email.subject, node: <CustomEmailTemplate email={email} ctx={ctx} /> };
  }
}

/** Renders one email to the subject, HTML and plain-text bodies `send()` takes. */
export async function renderEmail(
  email: RenderableEmail,
  ctx: EmailContext,
): Promise<RenderedEmail> {
  const { subject, node } = element(email, ctx);
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return { subject: email.kind === "custom" ? subject : `${subject} · ${BRAND}`, html, text };
}
