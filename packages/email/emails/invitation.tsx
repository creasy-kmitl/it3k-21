import { InvitationEmail } from "../src/templates/invitation";
import { sampleContext, sampleInvitation } from "../src/fixtures";

export default function Preview() {
  return <InvitationEmail job={sampleInvitation} ctx={sampleContext} />;
}
