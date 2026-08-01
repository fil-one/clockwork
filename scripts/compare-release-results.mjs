import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  RELEASE_SUITE_NAMES,
  releaseSummaryIssues,
  sourceIdentityKey,
} from "./release-artifacts.mjs";

const [
  serialPath,
  parallelPath,
  outputPath = ".artifacts/release/comparison.json",
] = process.argv.slice(2);
if (!serialPath || !parallelPath)
  throw new Error(
    "Usage: compare-release-results.mjs <serial-summary> <parallel-summary> [output]",
  );

const read = async (file) =>
  JSON.parse(await readFile(path.resolve(file), "utf8"));
const [serial, parallel] = await Promise.all([
  read(serialPath),
  read(parallelPath),
]);
const serialIssues = releaseSummaryIssues(serial, {
  expectedMode: "serial",
  expectedDebug: true,
});
const parallelIssues = releaseSummaryIssues(parallel, {
  expectedMode: "parallel",
  expectedDebug: false,
});
const sameSourceIdentity =
  sourceIdentityKey(serial.sourceIdentity) !== null &&
  sourceIdentityKey(serial.sourceIdentity) ===
    sourceIdentityKey(parallel.sourceIdentity);
const bySuite = (summary) =>
  new Map(
    (Array.isArray(summary.results) ? summary.results : []).map((result) => [
      result?.suite,
      result,
    ]),
  );
const serialSuites = bySuite(serial);
const parallelSuites = bySuite(parallel);
const equivalence = RELEASE_SUITE_NAMES.map((name) => {
  const left = serialSuites.get(name);
  const right = parallelSuites.get(name);
  return {
    suite: name,
    presentInBoth: Boolean(left && right),
    bothPassed: left?.status === "passed" && right?.status === "passed",
    sourceIdentityIdentical:
      sourceIdentityKey(left?.sourceIdentity) !== null &&
      sourceIdentityKey(left?.sourceIdentity) ===
        sourceIdentityKey(right?.sourceIdentity),
    assertionsIdentical:
      left?.assertionFingerprint === right?.assertionFingerprint,
    artifactsIdentical:
      left?.artifactInventory?.fingerprint ===
      right?.artifactInventory?.fingerprint,
    coverageIdentical:
      left?.coverageInventory?.fingerprint ===
      right?.coverageInventory?.fingerprint,
    retrySemanticsIdentical:
      left?.retryPolicy === "none" && right?.retryPolicy === "none",
    zeroRetries:
      left?.steps?.every((step) => step.retries === 0) === true &&
      right?.steps?.every((step) => step.retries === 0) === true,
  };
});
const improvementMs = serial.durationMs - parallel.durationMs;
const improvementPercent = serial.durationMs
  ? (improvementMs / serial.durationMs) * 100
  : 0;
const materiallyFaster = improvementMs >= 30_000 || improvementPercent >= 15;
const equivalent = equivalence.every((item) =>
  Object.entries(item)
    .filter(([key]) => key !== "suite")
    .every(([, value]) => value === true),
);
const result = {
  sourceIdentity: serial.sourceIdentity,
  sameSourceIdentity,
  serialDurationMs: serial.durationMs,
  parallelDurationMs: parallel.durationMs,
  improvementMs,
  improvementPercent,
  materiallyFaster,
  serialIssues,
  parallelIssues,
  equivalent,
  accepted:
    serialIssues.length === 0 &&
    parallelIssues.length === 0 &&
    sameSourceIdentity &&
    equivalent &&
    materiallyFaster,
  equivalence,
};
const resolvedOutput = path.resolve(outputPath);
await mkdir(path.dirname(resolvedOutput), { recursive: true });
await writeFile(resolvedOutput, `${JSON.stringify(result, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.accepted) process.exitCode = 1;
