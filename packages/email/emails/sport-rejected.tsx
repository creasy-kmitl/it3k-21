import { SportReviewedEmail } from "../src/templates/sport-reviewed";
import { sampleContext, sampleSportRejected } from "../src/fixtures";

export default function Preview() {
  return <SportReviewedEmail job={sampleSportRejected} ctx={sampleContext} />;
}
