import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  RELEASE_SUITE_NAMES,
  releaseSummaryIssues,
  sourceIdentityKey,
} from "./release-artifacts.mjs";

const root = path.resolve(process.argv[2] ?? ".artifacts/release-join");
const summaries = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(resolved);
    else if (entry.name === "summary.json")
      summaries.push(JSON.parse(await readFile(resolved, "utf8")));
  }
}

function duplicates(values) {
  return [
    ...new Set(
      values.filter((value, index) => values.indexOf(value) !== index),
    ),
  ];
}

await collect(root);
const summaryIssues = summaries.flatMap((summary, index) =>
  releaseSummaryIssues(summary, {
    expectedMode: "parallel",
    expectedDebug: false,
    requireEverySuite: false,
  }).map((issue) => `summary ${index + 1}: ${issue}`),
);
const results = summaries.flatMap((summary) => summary.results ?? []);
const names = results.map((result) => result.suite);
const missing = RELEASE_SUITE_NAMES.filter((name) => !names.includes(name));
const unexpected = names.filter((name) => !RELEASE_SUITE_NAMES.includes(name));
const duplicateSuites = duplicates(names);
const sourceIdentities = summaries.map((summary) =>
  sourceIdentityKey(summary.sourceIdentity),
);
const commonSourceIdentity =
  sourceIdentities.length === RELEASE_SUITE_NAMES.length &&
  sourceIdentities.every(
    (identity) => identity !== null && identity === sourceIdentities[0],
  );
const isolationFields = [
  "port",
  "databaseSchema",
  "queueNamespace",
  "fixtureNamespace",
  "storageRoot",
  "artifactDirectory",
];
const duplicateContracts = isolationFields.flatMap((field) =>
  duplicates(results.map((result) => result.isolation?.[field])).map(
    (value) => ({ field, value }),
  ),
);
const duplicateDatabaseProjects = duplicates(
  results
    .map((result) => result.isolation?.databaseService?.projectId)
    .filter(Boolean),
);
const duplicateProviderFakePorts = duplicates(
  results
    .map((result) => result.isolation?.providerFakePort)
    .filter((value) => value !== null && value !== undefined),
);
const criticalPathMs = Math.max(
  0,
  ...summaries.map((summary) => summary.durationMs),
);
const report = {
  summaryCount: summaries.length,
  shardCount: results.length,
  suites: names.sort(),
  missing,
  unexpected,
  duplicateSuites,
  commonSourceIdentity,
  sourceIdentity: commonSourceIdentity ? summaries[0]?.sourceIdentity : null,
  summaryIssues,
  duplicateContracts,
  duplicateDatabaseProjects,
  duplicateProviderFakePorts,
  criticalPathMs,
  withinThirtyMinutes: criticalPathMs <= 30 * 60 * 1000,
};
report.accepted =
  summaries.length === RELEASE_SUITE_NAMES.length &&
  results.length === RELEASE_SUITE_NAMES.length &&
  missing.length === 0 &&
  unexpected.length === 0 &&
  duplicateSuites.length === 0 &&
  commonSourceIdentity &&
  summaryIssues.length === 0 &&
  duplicateContracts.length === 0 &&
  duplicateDatabaseProjects.length === 0 &&
  duplicateProviderFakePorts.length === 0 &&
  report.withinThirtyMinutes;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.accepted) process.exitCode = 1;
