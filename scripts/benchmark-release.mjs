import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";

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
const canonicalSuitesScript = "scripts/release-suites.mjs";
const releaseSuitesScript =
  process.env.CLOCKWORK_RELEASE_SUITES_SCRIPT ?? canonicalSuitesScript;
const resolvedSuitesScript = path.resolve(releaseSuitesScript);
const suitesScript = path
  .relative(process.cwd(), resolvedSuitesScript)
  .startsWith("..")
  ? resolvedSuitesScript
  : path.relative(process.cwd(), resolvedSuitesScript);
// release-suites.mjs allows itself CLEANUP_TIMEOUT_MS (2 minutes) per cleanup
// step and runs several on interrupt: draining its own signalled children, then
// removing each disposable worktree, pruning, and clearing the cache. The
// escalation window has to outlast that, or the SIGKILL lands mid-cleanup and
// leaves exactly the residue this wrapper exists to prevent.
const cleanupWindowMs = 3 * 60 * 1_000;
const failures = [];
const phases = [];
let terminationSignal = null;
let activeChild = null;
let escalationTimer;
let haltReason = null;
let forceKilled = false;
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
  "CLOCKWORK_RELEASE_SUITES_SCRIPT",
  "CLOCKWORK_POPULATED_UPGRADE_PROJECT_ID",
  "CLOCKWORK_POPULATED_UPGRADE_WORKDIR",
];

function signalActiveChild(signal) {
  const child = activeChild;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill(signal);
    if (signal === "SIGKILL") forceKilled = true;
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (terminationSignal !== null) {
      signalActiveChild("SIGKILL");
      return;
    }
    terminationSignal = signal;
    signalActiveChild("SIGTERM");
    escalationTimer = setTimeout(
      () => signalActiveChild("SIGKILL"),
      cleanupWindowMs,
    );
    escalationTimer.unref();
  });

function halt(reason) {
  haltReason = reason;
  failures.push(reason);
}

async function run(args, label) {
  if (haltReason === null && terminationSignal !== null)
    halt(
      `${label}: not started because ${terminationSignal} requested cleanup`,
    );
  if (haltReason !== null) {
    phases.push({
      label,
      status: "skipped",
      reason: haltReason,
      durationMs: 0,
    });
    return false;
  }
  const phaseStartedAt = Date.now();
  const remainingMs = deadlineAt - phaseStartedAt;
  if (remainingMs <= 0) {
    halt(`${label}: benchmark hard deadline expired`);
    phases.push({ label, status: "failed", reason: haltReason, durationMs: 0 });
    return false;
  }
  const environment = { ...process.env };
  for (const name of releaseEnvironmentOverrides) delete environment[name];
  Object.assign(environment, {
    CLOCKWORK_RELEASE_BUDGET_MS: String(remainingMs),
    CLOCKWORK_RELEASE_STARTED_AT: String(phaseStartedAt),
  });
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  activeChild = child;
  if (terminationSignal !== null) signalActiveChild("SIGTERM");
  let startError = null;
  let timedOut = false;
  let forceTimer;
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    signalActiveChild("SIGTERM");
    forceTimer = setTimeout(
      () => signalActiveChild("SIGKILL"),
      cleanupWindowMs,
    );
  }, remainingMs);
  const exit = await new Promise((resolve) => {
    child.once("error", (error) => {
      startError = error;
    });
    child.once("close", (code, closeSignal) => resolve({ code, closeSignal }));
  });
  activeChild = null;
  clearTimeout(deadlineTimer);
  clearTimeout(forceTimer);
  const durationMs = Date.now() - phaseStartedAt;
  if (terminationSignal !== null) {
    halt(`${label}: ${terminationSignal} interrupted the benchmark`);
    phases.push({
      label,
      status: "interrupted",
      reason: haltReason,
      durationMs,
    });
    return false;
  }
  if (exit.code !== 0) {
    halt(
      `${label}: ${
        startError?.message ??
        (timedOut
          ? "phase exceeded the benchmark hard deadline"
          : exit.closeSignal
            ? `terminated by ${exit.closeSignal}`
            : `exit ${exit.code ?? 1}`)
      }`,
    );
    phases.push({ label, status: "failed", reason: haltReason, durationMs });
    return false;
  }
  phases.push({ label, status: "passed", reason: null, durationMs });
  return true;
}

const serialPath = path.join(root, "serial", "summary.json");
const parallelPath = path.join(root, "parallel", "summary.json");
const serialPassed = await run(
  [
    releaseSuitesScript,
    "--mode=serial",
    "--debug",
    `--run-id=${token}-serial`,
    `--artifacts=${path.join(root, "serial")}`,
  ],
  "serial/debug candidate",
);
const parallelPassed = await run(
  [
    releaseSuitesScript,
    "--mode=parallel",
    `--run-id=${token}-parallel`,
    `--artifacts=${path.join(root, "parallel")}`,
  ],
  "parallel candidate",
);
const comparisonPassed = await run(
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
  const passed = await run(
    [
      releaseSuitesScript,
      "--mode=parallel",
      `--run-id=${token}-stress-${index}`,
      `--artifacts=${directory}`,
    ],
    `parallel stress ${index}`,
  );
  if (passed) stressPaths.push(path.join(directory, "summary.json"));
}
clearTimeout(escalationTimer);

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
const interrupted = terminationSignal !== null;
const report = {
  token,
  suitesScript,
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
  interrupted,
  terminationSignal,
  forceKilled,
  phases,
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
  !interrupted &&
  !forceKilled &&
  suitesScript === canonicalSuitesScript &&
  failures.length === 0;
await writeFile(
  path.join(root, "stress-summary.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (interrupted) process.exitCode = terminationSignal === "SIGINT" ? 130 : 143;
else if (!report.accepted) process.exitCode = 1;
