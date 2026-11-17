import { CustomEmailTemplate } from "../src/templates/custom";
import { sampleContext, sampleCustom } from "../src/fixtures";

export default function Preview() {
  return <CustomEmailTemplate email={sampleCustom} ctx={sampleContext} />;
}
