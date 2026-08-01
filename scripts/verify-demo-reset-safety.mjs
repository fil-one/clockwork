import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

const productionMarkers = [
  "NODE_ENV",
  "VERCEL_ENV",
  "CLOCKWORK_ENV",
  "DEPLOYMENT_ENVIRONMENT",
  "ENVIRONMENT",
];

for (const marker of productionMarkers) {
  const environment = { ...process.env };
  for (const key of productionMarkers) delete environment[key];
  environment.NODE_ENV = marker === "NODE_ENV" ? "production" : "test";
  environment[marker] = "production";

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
  assert.equal(result.status, 1, `${marker} must make demo reset fail closed`);
  assert.equal(result.stdout, "", `${marker} refusal must not report a reset`);
  assert.equal(
    result.stderr.trim(),
    `Demo reset refused: ${marker} identifies a production environment`,
  );
}

process.stdout.write(
  `Demo reset production refusal passed for ${productionMarkers.length} environment markers.\n`,
);
