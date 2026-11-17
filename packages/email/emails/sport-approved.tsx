import { SportReviewedEmail } from "../src/templates/sport-reviewed";
import { sampleContext, sampleSportApproved } from "../src/fixtures";

export default function Preview() {
  return <SportReviewedEmail job={sampleSportApproved} ctx={sampleContext} />;
}
