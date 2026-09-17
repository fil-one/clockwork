// Writes `deploy/app/schedule-manifest.json`, the list of scheduled tasks
// EventBridge Scheduler creates one rule per entry from. Terraform cannot read
// the TypeScript task registry, so the registry is exported here and the result
// is committed; `pnpm check:generated` fails the build when the committed file
// no longer matches the code.
//
// Run with tsx (it imports the TypeScript registry): `pnpm generate:schedules`.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { format } from "prettier";

import { buildScheduleManifest } from "../packages/workflows/src/tasks/schedule-manifest.ts";

const root = resolve(import.meta.dirname, "..");
const output = join(root, "deploy", "app", "schedule-manifest.json");

const manifest = await buildScheduleManifest();

// Written through Prettier so the generated file is also the formatted file and
// `format:check` and `check:generated` cannot disagree about it.
writeFileSync(
  output,
  await format(JSON.stringify(manifest, undefined, 2), { filepath: output }),
  "utf8",
);

process.stdout.write(
  `${output}: ${String(manifest.schedules.length)} schedules\n`,
);
