import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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
const bySuite = (summary) =>
  new Map(summary.results.map((result) => [result.suite, result]));
const serialSuites = bySuite(serial);
const parallelSuites = bySuite(parallel);
const names = [
  ...new Set([...serialSuites.keys(), ...parallelSuites.keys()]),
].sort();
const equivalence = names.map((name) => {
  const left = serialSuites.get(name);
  const right = parallelSuites.get(name);
  return {
    suite: name,
    presentInBoth: Boolean(left && right),
    assertionsIdentical:
      left?.assertionFingerprint === right?.assertionFingerprint,
    artifactsIdentical:
      left?.artifactInventory?.fingerprint ===
      right?.artifactInventory?.fingerprint,
    coverageIdentical:
      left?.coverageInventory?.fingerprint ===
      right?.coverageInventory?.fingerprint,
    statusIdentical: left?.status === right?.status,
    retrySemanticsIdentical: left?.retryPolicy === right?.retryPolicy,
  };
});
const improvementMs = serial.durationMs - parallel.durationMs;
const result = {
  serialDurationMs: serial.durationMs,
  parallelDurationMs: parallel.durationMs,
  improvementMs,
  improvementPercent: serial.durationMs
    ? (improvementMs / serial.durationMs) * 100
    : 0,
  materiallyFaster:
    improvementMs >= 30_000 || improvementMs / serial.durationMs >= 0.15,
  equivalent: equivalence.every(
    (item) =>
      item.presentInBoth &&
      item.assertionsIdentical &&
      item.artifactsIdentical &&
      item.coverageIdentical &&
      item.statusIdentical &&
      item.retrySemanticsIdentical,
  ),
  equivalence,
};
await writeFile(
  path.resolve(outputPath),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.equivalent || !result.materiallyFaster) process.exitCode = 1;
