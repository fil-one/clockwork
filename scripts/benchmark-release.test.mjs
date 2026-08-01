import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { releaseStressSummaryIssues } from "./release-artifacts.mjs";

const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const benchmarkScript = "scripts/benchmark-release.mjs";
// Ceilings for a wrapper that misbehaves, not waits on the passing path: every
// step here settles in well under a second. No path waits out the wrapper's own
// escalation window, because a second signal forces the kill immediately.
const pollIntervalMs = 25;
const markerTimeoutMs = 15_000;
const exitTimeoutMs = 15_000;

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(description, predicate, timeoutMs = markerTimeoutMs) {
  const deadlineAt = Date.now() + timeoutMs;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() >= deadlineAt)
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}`,
      );
    await delay(pollIntervalMs);
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

// Stands in for scripts/release-suites.mjs: leaves residue on disk, then removes
// it asynchronously once it is asked to terminate.
function interruptibleStubSource(scratch) {
  return `import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const scratch = ${JSON.stringify(scratch)};
const residue = path.join(scratch, "cache");
let terminating = false;
const cleanup = async (signal) => {
  await new Promise((resolve) => setTimeout(resolve, 250));
  await rm(residue, { recursive: true, force: true });
  await writeFile(path.join(scratch, "cleanup-complete"), signal, "utf8");
  process.exit(130);
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (terminating) return;
    terminating = true;
    void cleanup(signal);
  });
await mkdir(residue, { recursive: true });
await writeFile(path.join(residue, "cache.bin"), "x".repeat(4096), "utf8");
setTimeout(() => process.exit(1), 30_000);
await writeFile(path.join(scratch, "child-started"), String(process.pid), "utf8");
`;
}

// Stands in for a release child that swallows termination requests and never
// finishes its cleanup.
function unresponsiveStubSource(scratch) {
  return `import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const scratch = ${JSON.stringify(scratch)};
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void writeFile(path.join(scratch, "signal-received"), signal, "utf8");
  });
setTimeout(() => process.exit(1), 30_000);
await writeFile(path.join(scratch, "child-started"), String(process.pid), "utf8");
`;
}

// Stands in for a suite run that succeeds immediately, so the wrapper's report
// shape can be checked without the real 45-minute qualification.
const passingStubSource = `import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const read = (flag) =>
  process.argv.find((value) => value.startsWith(flag))?.slice(flag.length);
const artifacts = read("--artifacts=");
await mkdir(artifacts, { recursive: true });
await writeFile(
  path.join(artifacts, "summary.json"),
  JSON.stringify({
    runId: read("--run-id="),
    mode: read("--mode=") ?? "parallel",
    debug: process.argv.includes("--debug"),
    status: "passed",
    durationMs: 1,
    budgetMs: 1_000,
    withinBudget: true,
    sourceIdentity: null,
    results: [],
  }),
  "utf8",
);
`;

async function withScratch(body) {
  const scratch = await mkdtemp(path.join(tmpdir(), "clockwork-benchmark-"));
  const token = `benchmark-test-${process.pid}-${Date.now()}`;
  const benchmarkRoot = path.join(
    workspaceRoot,
    ".artifacts/release-benchmark",
    token,
  );
  try {
    return await body({ scratch, token, benchmarkRoot });
  } finally {
    await rm(scratch, { recursive: true, force: true });
    await rm(benchmarkRoot, { recursive: true, force: true });
  }
}

function startBenchmark(token, stubPath, stressRuns) {
  const wrapper = spawn(
    process.execPath,
    [benchmarkScript, token, `--stress=${stressRuns}`],
    {
      cwd: workspaceRoot,
      env: { ...process.env, CLOCKWORK_RELEASE_SUITES_SCRIPT: stubPath },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  wrapper.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  wrapper.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const exited = new Promise((resolve) => {
    wrapper.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const closed = new Promise((resolve) => {
    wrapper.once("close", () => resolve(output));
  });
  return {
    wrapper,
    output: () => closed,
    exit: async () => {
      const outcome = await Promise.race([
        exited,
        delay(exitTimeoutMs, "timeout", { ref: false }),
      ]);
      if (outcome === "timeout") {
        try {
          process.kill(-wrapper.pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        throw new Error(
          `Benchmark wrapper did not exit within ${exitTimeoutMs}ms: ${output}`,
        );
      }
      return outcome;
    },
  };
}

async function interruptScenario({ signal, toProcessGroup, expectedExitCode }) {
  await withScratch(async ({ scratch, token, benchmarkRoot }) => {
    const stubPath = path.join(scratch, "release-suites-stub.mjs");
    await writeFile(stubPath, interruptibleStubSource(scratch), "utf8");
    const started = startBenchmark(token, stubPath, 2);
    let childPid = null;
    try {
      childPid = Number.parseInt(
        await waitFor("the stub child to start", async () => {
          if (!(await exists(path.join(scratch, "child-started")))) return null;
          return readFile(path.join(scratch, "child-started"), "utf8");
        }),
        10,
      );
      assert.ok(Number.isInteger(childPid) && childPid > 0);
      assert.ok(await exists(path.join(scratch, "cache")));
      process.kill(
        toProcessGroup ? -started.wrapper.pid : started.wrapper.pid,
        signal,
      );
      const exit = await started.exit();
      assert.equal(
        exit.signal,
        null,
        `wrapper was killed by ${String(exit.signal)} instead of handling ${signal}`,
      );
      assert.equal(exit.code, expectedExitCode);
    } finally {
      if (
        started.wrapper.exitCode === null &&
        started.wrapper.signalCode === null
      )
        started.wrapper.kill("SIGKILL");
      if (childPid && alive(childPid)) process.kill(childPid, "SIGKILL");
    }

    assert.ok(
      ["SIGINT", "SIGTERM"].includes(
        await readFile(path.join(scratch, "cleanup-complete"), "utf8"),
      ),
      "the child did not record which signal started its cleanup",
    );
    assert.equal(
      await exists(path.join(scratch, "cache")),
      false,
      "the child's cache residue survived the interrupted run",
    );
    await waitFor("the stub child to exit", () => !alive(childPid), 5_000);

    const report = JSON.parse(
      await readFile(path.join(benchmarkRoot, "stress-summary.json"), "utf8"),
    );
    assert.equal(report.token, token);
    assert.equal(report.interrupted, true);
    assert.equal(report.terminationSignal, signal);
    assert.equal(
      report.forceKilled,
      false,
      "a child that cleaned up within the window was recorded as force-killed",
    );
    assert.equal(report.suitesScript, stubPath);
    assert.equal(report.accepted, false);
    assert.equal(report.serialAccepted, false);
    assert.equal(report.parallelAccepted, false);
    assert.equal(report.comparisonAccepted, false);
    assert.equal(report.stressAccepted, false);
    assert.deepEqual(
      report.phases.map((phase) => [phase.label, phase.status]),
      [
        ["serial/debug candidate", "interrupted"],
        ["parallel candidate", "skipped"],
        ["serial/parallel comparison", "skipped"],
        ["parallel stress 1", "skipped"],
        ["parallel stress 2", "skipped"],
      ],
    );
    for (const phase of report.phases.slice(1))
      assert.ok(
        phase.reason.includes(signal),
        `skipped phase ${phase.label} does not explain the interruption`,
      );
    assert.deepEqual(report.failures, [
      `serial/debug candidate: ${signal} interrupted the benchmark`,
    ]);
    assert.deepEqual(report.evidenceFiles, []);
    assert.deepEqual(report.stressEvidence, []);
    const issues = releaseStressSummaryIssues(report);
    assert.ok(
      issues.some((issue) => issue.includes("interrupted")),
      `stress summary validation missed the interruption: ${issues.join("; ")}`,
    );
    assert.ok(
      issues.some((issue) =>
        issue.includes("substituted release suite script"),
      ),
      `stress summary validation missed the substituted suite script: ${issues.join("; ")}`,
    );
  });
}

test("lets an interrupted release child finish cleanup and reports the truth", async () => {
  await interruptScenario({
    signal: "SIGTERM",
    toProcessGroup: false,
    expectedExitCode: 143,
  });
});

test("survives a terminal interrupt delivered to the whole process group", async () => {
  await interruptScenario({
    signal: "SIGINT",
    toProcessGroup: true,
    expectedExitCode: 130,
  });
});

test("forces a second interrupt through to a child that ignores cleanup", async () => {
  await withScratch(async ({ scratch, token, benchmarkRoot }) => {
    const stubPath = path.join(scratch, "release-suites-unresponsive.mjs");
    await writeFile(stubPath, unresponsiveStubSource(scratch), "utf8");
    const started = startBenchmark(token, stubPath, 2);
    let childPid = null;
    try {
      childPid = Number.parseInt(
        await waitFor("the stub child to start", async () => {
          if (!(await exists(path.join(scratch, "child-started")))) return null;
          return readFile(path.join(scratch, "child-started"), "utf8");
        }),
        10,
      );
      process.kill(started.wrapper.pid, "SIGTERM");
      await waitFor("the child to swallow the forwarded signal", () =>
        exists(path.join(scratch, "signal-received")),
      );
      assert.equal(started.wrapper.exitCode, null);
      process.kill(started.wrapper.pid, "SIGTERM");
      const exit = await started.exit();
      assert.equal(exit.signal, null);
      assert.equal(exit.code, 143);
    } finally {
      if (
        started.wrapper.exitCode === null &&
        started.wrapper.signalCode === null
      )
        started.wrapper.kill("SIGKILL");
      if (childPid && alive(childPid)) process.kill(childPid, "SIGKILL");
    }
    await waitFor(
      "the unresponsive child to be killed",
      () => !alive(childPid),
    );
    const report = JSON.parse(
      await readFile(path.join(benchmarkRoot, "stress-summary.json"), "utf8"),
    );
    assert.equal(report.interrupted, true);
    assert.equal(report.terminationSignal, "SIGTERM");
    assert.equal(
      report.forceKilled,
      true,
      "the report hid that the child had to be force-killed",
    );
    assert.equal(report.accepted, false);
    assert.equal(report.phases[0].status, "interrupted");
    const issues = releaseStressSummaryIssues(report);
    assert.ok(
      issues.some((issue) => issue.includes("force-killed a release child")),
      `stress summary validation missed the forced kill: ${issues.join("; ")}`,
    );
  });
});

test("keeps the uninterrupted report shape when a phase fails", async () => {
  await withScratch(async ({ scratch, token, benchmarkRoot }) => {
    const stubPath = path.join(scratch, "release-suites-pass.mjs");
    await writeFile(stubPath, passingStubSource, "utf8");
    const started = startBenchmark(token, stubPath, 2);
    const exit = await started.exit();
    assert.equal(exit.code, 1);
    const report = JSON.parse(
      await readFile(path.join(benchmarkRoot, "stress-summary.json"), "utf8"),
    );
    assert.equal(report.stressRuns, 2);
    assert.equal(report.serialAccepted, true);
    assert.equal(report.parallelAccepted, true);
    assert.equal(report.comparisonAccepted, false);
    assert.equal(report.stressAccepted, false);
    assert.equal(report.accepted, false);
    assert.equal(report.interrupted, false);
    assert.equal(report.terminationSignal, null);
    assert.equal(report.forceKilled, false);
    assert.equal(report.withinBudget, true);
    assert.equal(report.sourceIdentity, null);
    assert.equal(
      report.suitesScript,
      stubPath,
      "the report did not record which script produced the evidence",
    );
    assert.ok(
      releaseStressSummaryIssues(report).some((issue) =>
        issue.includes("substituted release suite script"),
      ),
      "a stub-driven summary could pass as qualification evidence",
    );
    assert.deepEqual(
      report.phases.map((phase) => [phase.label, phase.status]),
      [
        ["serial/debug candidate", "passed"],
        ["parallel candidate", "passed"],
        ["serial/parallel comparison", "failed"],
        ["parallel stress 1", "skipped"],
        ["parallel stress 2", "skipped"],
      ],
    );
    assert.equal(report.failures.length, 1);
    assert.match(report.failures[0], /^serial\/parallel comparison: /);
    assert.deepEqual(
      report.evidenceFiles.map((file) => file.path),
      ["serial/summary.json", "parallel/summary.json", "comparison.json"],
    );
    for (const file of report.evidenceFiles) {
      assert.ok(Number.isInteger(file.bytes) && file.bytes > 0);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
    const output = await started.output();
    assert.ok(
      output.trimEnd().endsWith(JSON.stringify(report, null, 2)),
      "the wrapper did not print its report as the final stdout JSON",
    );
  });
});
