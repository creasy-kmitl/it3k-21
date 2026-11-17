import { TicketClaimedEmail } from "../src/templates/ticket-claimed";
import { sampleContext, sampleTicketClaimed } from "../src/fixtures";

export default function Preview() {
  return <TicketClaimedEmail job={sampleTicketClaimed} ctx={sampleContext} />;
}
