import { createMemoryDemoStore, resetDemoExperience } from "./reset";

/**
 * Single-command reset for the deterministic fixture store:
 * `pnpm exec tsx packages/testing/src/demo/reset-command.ts`
 *
 * There is deliberately no commerce reset HTTP request here. The generated
 * OpenAPI contract currently has no reset operation, and inventing one in MSW
 * would hide that integration gap from Agent 5.
 */
const store = createMemoryDemoStore();

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
