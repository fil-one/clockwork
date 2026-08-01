import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.argv[2] ?? ".artifacts/release-join");
const required = new Set([
  "static",
  "unit",
  "integration",
  "build",
  "ui",
  "proof",
]);
const summaries = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(resolved);
    else if (entry.name === "summary.json")
      summaries.push(JSON.parse(await readFile(resolved, "utf8")));
  }
}

await collect(root);
const results = summaries.flatMap((summary) => summary.results);
const names = new Set(results.map((result) => result.suite));
const missing = [...required].filter((name) => !names.has(name));
const failed = results.filter(
  (result) => result.status !== "passed" || !result.trackedWorkspaceClean,
);
const isolationFields = [
  "port",
  "databaseSchema",
  "queueNamespace",
  "fixtureNamespace",
  "storageRoot",
  "artifactDirectory",
];
const duplicateContracts = isolationFields.flatMap((field) => {
  const values = results.map((result) => result.isolation[field]);
  return values
    .filter((value, index) => values.indexOf(value) !== index)
    .map((value) => ({ field, value }));
});
const databaseProjects = results.map(
  (result) => result.isolation.databaseService?.projectId,
);
const duplicateDatabaseProjects = databaseProjects.filter(
  (value, index) => value && databaseProjects.indexOf(value) !== index,
);
const providerFakePorts = results
  .map((result) => result.isolation.providerFakePort)
  .filter((value) => value !== null && value !== undefined);
const duplicateProviderFakePorts = providerFakePorts.filter(
  (value, index) => providerFakePorts.indexOf(value) !== index,
);
const criticalPathMs = Math.max(
  0,
  ...summaries.map((summary) => summary.durationMs),
);
const report = {
  shardCount: names.size,
  missing,
  failed: failed.map(({ suite, status }) => ({ suite, status })),
  duplicateContracts,
  duplicateDatabaseProjects,
  duplicateProviderFakePorts,
  criticalPathMs,
  withinThirtyMinutes: criticalPathMs <= 30 * 60 * 1000,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (
  missing.length ||
  failed.length ||
  duplicateContracts.length ||
  duplicateDatabaseProjects.length ||
  duplicateProviderFakePorts.length ||
  !report.withinThirtyMinutes
)
  process.exitCode = 1;
