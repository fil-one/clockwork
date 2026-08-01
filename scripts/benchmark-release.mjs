import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  RELEASE_SUITE_NAMES,
  releaseSummaryIssues,
  sourceIdentityKey,
} from "./release-artifacts.mjs";

const token = (process.argv[2] ?? `benchmark-${Date.now()}`).replace(
  /[^A-Za-z0-9_-]/g,
  "-",
);
const stressArgument = process.argv.find((value) =>
  value.startsWith("--stress="),
);
const stressRuns = Number.parseInt(
  stressArgument?.slice("--stress=".length) ??
    process.env.CLOCKWORK_RELEASE_STRESS_RUNS ??
    "3",
  10,
);
if (!Number.isInteger(stressRuns) || stressRuns < 2 || stressRuns > 10)
  throw new Error("--stress must request between 2 and 10 parallel runs.");
const root = path.resolve(`.artifacts/release-benchmark/${token}`);
try {
  if ((await readdir(root)).length > 0)
    throw new Error(`Release benchmark directory must be empty: ${root}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(root, { recursive: true });
const startedAt = Date.now();
const budgetMs = 45 * 60 * 1_000;
const deadlineAt = startedAt + budgetMs;
const failures = [];
const releaseEnvironmentOverrides = [
  "CLOCKWORK_RELEASE_ARTIFACT_ROOT",
  "CLOCKWORK_RELEASE_CACHE_ROOT",
  "CLOCKWORK_RELEASE_DATABASE_PORT_BASE",
  "CLOCKWORK_RELEASE_INFRA_RETRY_CATEGORY",
  "CLOCKWORK_RELEASE_PORT_BASE",
  "CLOCKWORK_RELEASE_PROVIDER_FAKE_PORT_BASE",
  "CLOCKWORK_RELEASE_RUN_ID",
  "CLOCKWORK_RELEASE_SHARD",
  "CLOCKWORK_RELEASE_SHARED_WORKSPACE",
  "CLOCKWORK_POPULATED_UPGRADE_PROJECT_ID",
  "CLOCKWORK_POPULATED_UPGRADE_WORKDIR",
];

function run(args, label) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) {
    failures.push(`${label}: benchmark hard deadline expired`);
    return false;
  }
  const environment = { ...process.env };
  for (const name of releaseEnvironmentOverrides) delete environment[name];
  Object.assign(environment, {
    CLOCKWORK_RELEASE_BUDGET_MS: String(remainingMs),
    CLOCKWORK_RELEASE_STARTED_AT: String(Date.now()),
  });
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    timeout: remainingMs,
  });
  if (result.status !== 0) {
    failures.push(
      `${label}: ${result.error?.message ?? `exit ${result.status ?? 1}`}`,
    );
    return false;
  }
  return true;
}

const serialPath = path.join(root, "serial", "summary.json");
const parallelPath = path.join(root, "parallel", "summary.json");
const serialPassed = run(
  [
    "scripts/release-suites.mjs",
    "--mode=serial",
    "--debug",
    `--run-id=${token}-serial`,
    `--artifacts=${path.join(root, "serial")}`,
  ],
  "serial/debug candidate",
);
const parallelPassed = run(
  [
    "scripts/release-suites.mjs",
    "--mode=parallel",
    `--run-id=${token}-parallel`,
    `--artifacts=${path.join(root, "parallel")}`,
  ],
  "parallel candidate",
);
let comparisonPassed = false;
if (serialPassed && parallelPassed)
  comparisonPassed = run(
    [
      "scripts/compare-release-results.mjs",
      serialPath,
      parallelPath,
      path.join(root, "comparison.json"),
    ],
    "serial/parallel comparison",
  );

const stressPaths = [];
for (let index = 1; index <= stressRuns; index += 1) {
  const directory = path.join(root, `stress-${index}`);
  const passed = run(
    [
      "scripts/release-suites.mjs",
      "--mode=parallel",
      `--run-id=${token}-stress-${index}`,
      `--artifacts=${directory}`,
    ],
    `parallel stress ${index}`,
  );
  if (passed) stressPaths.push(path.join(directory, "summary.json"));
}

let stressAccepted = parallelPassed && stressPaths.length === stressRuns;
const stressEvidence = [];
if (parallelPassed) {
  const baseline = JSON.parse(await readFile(parallelPath, "utf8"));
  const baselineBySuite = new Map(
    baseline.results.map((result) => [result.suite, result]),
  );
  for (const summaryPath of stressPaths) {
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    const issues = releaseSummaryIssues(summary, {
      expectedMode: "parallel",
      expectedDebug: false,
    });
    const sameSourceIdentity =
      sourceIdentityKey(summary.sourceIdentity) ===
      sourceIdentityKey(baseline.sourceIdentity);
    const equivalent = RELEASE_SUITE_NAMES.every((suite) => {
      const left = baselineBySuite.get(suite);
      const right = summary.results.find((result) => result.suite === suite);
      return (
        left?.assertionFingerprint === right?.assertionFingerprint &&
        left?.artifactInventory?.fingerprint ===
          right?.artifactInventory?.fingerprint &&
        left?.coverageInventory?.fingerprint ===
          right?.coverageInventory?.fingerprint
      );
    });
    const accepted = issues.length === 0 && sameSourceIdentity && equivalent;
    stressEvidence.push({
      summaryPath: path.relative(root, summaryPath),
      durationMs: summary.durationMs,
      issues,
      sameSourceIdentity,
      equivalent,
      accepted,
    });
    if (!accepted) stressAccepted = false;
  }
}
const durationMs = Date.now() - startedAt;
const evidenceFiles = [];
for (const relativePath of [
  "serial/summary.json",
  "parallel/summary.json",
  "comparison.json",
  ...Array.from(
    { length: stressRuns },
    (_, index) => `stress-${index + 1}/summary.json`,
  ),
]) {
  try {
    const contents = await readFile(path.join(root, relativePath));
    evidenceFiles.push({
      path: relativePath,
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const report = {
  token,
  sourceIdentity:
    parallelPassed && stressPaths.length > 0
      ? JSON.parse(await readFile(parallelPath, "utf8")).sourceIdentity
      : null,
  stressRuns,
  serialAccepted: serialPassed,
  parallelAccepted: parallelPassed,
  comparisonAccepted: comparisonPassed,
  stressAccepted,
  durationMs,
  budgetMs,
  withinBudget: durationMs <= budgetMs,
  failures,
  stressEvidence,
  evidenceFiles,
};
report.accepted =
  serialPassed &&
  parallelPassed &&
  comparisonPassed &&
  stressAccepted &&
  report.withinBudget &&
  failures.length === 0;
await writeFile(
  path.join(root, "stress-summary.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.accepted) process.exitCode = 1;
