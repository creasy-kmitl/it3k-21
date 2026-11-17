import { TicketClaimedEmail } from "../src/templates/ticket-claimed";
import { sampleContext, sampleTicketClaimed } from "../src/fixtures";
import { qrPng, ticketQrText, toBase64 } from "../src/qr-png";

// The sent email shows the QR as an inline attachment (cid:); the preview has
// no attachments, so it shows the same PNG as a data URL.
const qr = `data:image/png;base64,${toBase64(qrPng(ticketQrText(sampleTicketClaimed.ticket.code ?? "")))}`;

export default function Preview() {
  return <TicketClaimedEmail job={sampleTicketClaimed} ctx={sampleContext} qrSrc={qr} />;
}
