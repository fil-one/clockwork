import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const productionMarkers = [
  "NODE_ENV",
  "VERCEL_ENV",
  "CLOCKWORK_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "ENVIRONMENT",
];
const deployOptInKey = "CLOCKWORK_DEMO_DEPLOY";

function baseEnvironment() {
  const environment = { ...process.env };
  for (const key of productionMarkers) delete environment[key];
  // The opt-in is scrubbed from the inherited environment so a set flag in the
  // caller's shell cannot quietly drain the refusal assertions below.
  delete environment[deployOptInKey];
  return environment;
}

function runReset(environment) {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  return result;
}

function assertRefused(environment, marker, context) {
  const result = runReset(environment);
  assert.equal(result.status, 1, `${context} must make demo reset fail closed`);
  assert.equal(result.stdout, "", `${context} refusal must not report a reset`);
  assert.equal(
    result.stderr.trim(),
    `Demo reset refused: ${marker} identifies a production environment`,
    `${context} must refuse through the ${marker} marker`,
  );
}

for (const marker of productionMarkers) {
  const environment = baseEnvironment();
  environment.NODE_ENV = marker === "NODE_ENV" ? "production" : "test";
  environment[marker] = "production";
  assertRefused(environment, marker, marker);
}

// The opt-in suppresses the NODE_ENV signal alone. Every platform marker keeps
// its unconditional veto, so a real production environment stays unreachable.
const vetoMarkers = productionMarkers.filter((marker) => marker !== "NODE_ENV");
for (const marker of vetoMarkers) {
  const environment = baseEnvironment();
  environment.NODE_ENV = "production";
  environment[deployOptInKey] = "1";
  environment[marker] = "production";
  assertRefused(environment, marker, `${marker} with the deploy opt-in`);
}

for (const value of ["true", "yes", " 1 ", "01", "0", ""]) {
  const environment = baseEnvironment();
  environment.NODE_ENV = "production";
  environment[deployOptInKey] = value;
  assertRefused(
    environment,
    "NODE_ENV",
    `a deploy opt-in value of ${JSON.stringify(value)}`,
  );
}

const stateDirectory = mkdtempSync(join(tmpdir(), "clockwork-demo-deploy-"));
try {
  const statePath = join(stateDirectory, "state.json");
  const environment = baseEnvironment();
  environment.NODE_ENV = "production";
  environment[deployOptInKey] = "1";
  environment.CLOCKWORK_DEMO_STATE_PATH = statePath;

  const result = runReset(environment);
  assert.equal(
    result.status,
    0,
    "the deploy opt-in must permit a production NODE_ENV",
  );
  assert.equal(
    result.stderr,
    "",
    "a permitted reset must not report a refusal",
  );
  const reported = JSON.parse(result.stdout);
  assert.equal(reported.target, "demo");
  assert.equal(
    reported.statePath,
    statePath,
    "the permitted reset must write the requested demo state",
  );
} finally {
  rmSync(stateDirectory, { recursive: true, force: true });
}

process.stdout.write(
  `Demo reset production refusal passed for ${productionMarkers.length} environment markers, ` +
    `${vetoMarkers.length} markers that outrank the deploy opt-in, and 6 rejected opt-in values; ` +
    "the exact opt-in permits a production NODE_ENV.\n",
);
