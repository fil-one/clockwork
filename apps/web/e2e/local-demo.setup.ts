import { resetDemoExperience } from "@clockwork/testing/demo-reset";
import { FileDemoAdapterStateStore } from "@clockwork/testing/demo-state";

async function reset() {
  if (
    process.env.CLOCKWORK_EXPERIENCE_ADAPTER !== "demo" ||
    process.env.CLOCKWORK_EVIDENCE_ADAPTER !== "demo"
  )
    throw new Error(
      "Local browser tests require both explicit non-production demo adapters.",
    );
  await resetDemoExperience(new FileDemoAdapterStateStore(), {
    environment: process.env,
    target: "demo",
  });
}

export default async function setup() {
  await reset();
  return reset;
}
