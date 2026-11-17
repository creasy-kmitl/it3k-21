import { SportRegisteredEmail } from "../src/templates/sport-registered";
import { sampleContext, sampleSportRegistered } from "../src/fixtures";

export default function Preview() {
  return <SportRegisteredEmail job={sampleSportRegistered} ctx={sampleContext} />;
}
