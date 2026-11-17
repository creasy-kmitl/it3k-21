/** @jsxImportSource react */
import { render } from "@react-email/render";
import type { ReactElement } from "react";
import type { EmailContext } from "./components/layout";
import type { RenderableEmail } from "./jobs";
import { TICKET_QR_CID, qrPng, ticketQrText, toBase64 } from "./qr-png";
import { BRAND } from "./theme";
import { CustomEmailTemplate } from "./templates/custom";
import { ProfileSubmittedEmail, profileSubmittedSubject } from "./templates/profile-submitted";
import { SportRegisteredEmail, sportRegisteredSubject } from "./templates/sport-registered";
import { SportReviewedEmail, sportReviewedSubject } from "./templates/sport-reviewed";
import { TicketClaimedEmail, ticketClaimedSubject } from "./templates/ticket-claimed";

export type { EmailContext } from "./components/layout";

/** An image the HTML shows through `cid:<contentId>`, in the shape `send()` takes. */
export type InlineAttachment = {
  content: string;
  filename: string;
  type: string;
  disposition: "inline";
  contentId: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
  attachments?: InlineAttachment[];
};

function element(
  email: RenderableEmail,
  ctx: EmailContext,
): { subject: string; node: ReactElement; attachments?: InlineAttachment[] } {
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
    case "ticket-claimed": {
      const code = email.ticket.code;
      if (!code) {
        return {
          subject: ticketClaimedSubject(email),
          node: <TicketClaimedEmail job={email} ctx={ctx} />,
        };
      }
      // Gmail drops data: images and SVG, so the QR travels as an inline PNG.
      return {
        subject: ticketClaimedSubject(email),
        node: <TicketClaimedEmail job={email} ctx={ctx} qrSrc={`cid:${TICKET_QR_CID}`} />,
        attachments: [
          {
            content: toBase64(qrPng(ticketQrText(code))),
            filename: "ticket-qr.png",
            type: "image/png",
            disposition: "inline",
            contentId: TICKET_QR_CID,
          },
        ],
      };
    }
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
  const { subject, node, attachments } = element(email, ctx);
  const [html, text] = await Promise.all([render(node), render(node, { plainText: true })]);
  return {
    subject: email.kind === "custom" ? subject : `${subject} · ${BRAND}`,
    html,
    text,
    ...(attachments ? { attachments } : {}),
  };
}
