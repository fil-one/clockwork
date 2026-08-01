import { resetDemoExperience } from "./reset";
import { FileDemoAdapterStateStore } from "./state";

/**
 * Single-command reset for the durable state read by the explicit web demo
 * adapter:
 * `pnpm exec tsx packages/testing/src/demo/reset-command.ts`
 *
 * There is deliberately no commerce reset HTTP request here. Demo reset is a
 * local/demo-only operator boundary, never a production application route.
 */
const store = new FileDemoAdapterStateStore();

try {
  const result = await resetDemoExperience(store, {
    environment: process.env,
    target: "demo",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
