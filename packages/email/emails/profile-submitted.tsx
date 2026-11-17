import { ProfileSubmittedEmail } from "../src/templates/profile-submitted";
import { sampleContext, sampleProfileSubmitted } from "../src/fixtures";

export default function Preview() {
  return <ProfileSubmittedEmail job={sampleProfileSubmitted} ctx={sampleContext} />;
}
