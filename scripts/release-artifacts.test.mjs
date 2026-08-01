import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  expectedReleaseCommands,
  normalizeArtifactText,
  normalizeReportValue,
  releaseDatabaseProjectId,
  releaseAssertionFingerprint,
  releaseCacheRootIssues,
  releaseSummaryIssues,
  semanticArtifactInventoryFingerprint,
  sourceIdentityKey,
} from "./release-artifacts.mjs";

test("creates stable warning-free isolated Supabase project IDs", () => {
  const input = {
    revision: "a".repeat(40),
    runId: "quality-123456789abc-qualified-run-with-a-long-name",
    suite: "integration",
    portBase: 56_040,
  };
  const projectId = releaseDatabaseProjectId(input);
  assert.equal(projectId, releaseDatabaseProjectId(input));
  assert.match(projectId, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/);
  assert.equal(projectId.length, 39);
  assert.notEqual(
    projectId,
    releaseDatabaseProjectId({ ...input, portBase: input.portBase + 20 }),
  );
  assert.notEqual(
    projectId,
    releaseDatabaseProjectId({ ...input, suite: "proof" }),
  );
});

test("passes isolated database URLs through the integration task", async () => {
  const turbo = JSON.parse(
    await readFile(new URL("../turbo.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(turbo.tasks["test:integration"].passThroughEnv, [
    "CLOCKWORK_SERVICE_DATABASE_URL",
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
  ]);
});

const roots = [
  ["/tmp/clockwork-parallel/workspace", "<workspace>"],
  ["/tmp/clockwork-parallel/artifacts", "<artifact-root>"],
];

test("normalizes disposable roots and isolated localhost origins", () => {
  assert.equal(
    normalizeArtifactText(
      "open http://127.0.0.1:32404 from /tmp/clockwork-parallel/workspace",
      roots,
    ),
    "open <isolated-runtime-origin> from <workspace>",
  );
});

test("normalizes only Next low-priority build-ID paths", () => {
  assert.equal(
    normalizeArtifactText(
      "static/kwzwUHgphOyBXRdo9eTwU/_buildManifest.js",
      roots,
    ),
    "static/<next-build-id>/_buildManifest.js",
  );
  assert.equal(
    normalizeArtifactText("static/chunks/1nbe9y12kfre8.js", roots),
    "static/chunks/1nbe9y12kfre8.js",
  );
});

test("normalizes report timing without hiding assertion content", () => {
  assert.deepEqual(
    normalizeReportValue(
      {
        duration: 921,
        command: "pnpm dev --port 32404 at http://localhost:32404",
        timestamp: "2026-08-01T06:29:50.561Z",
        assertion: "cross-account access is denied",
      },
      roots,
    ),
    {
      duration: "<runtime-value>",
      command: "pnpm dev --port 32404 at <isolated-runtime-origin>",
      timestamp: "<runtime-timestamp>",
      assertion: "cross-account access is denied",
    },
  );
});

test("semantic inventory ignores raw byte variance but detects content variance", () => {
  const entry = {
    path: "runtime/playwright.json",
    bytes: 80000,
    semanticSha256: "same-semantic-content",
    normalization: "runtime normalization",
  };
  assert.equal(
    semanticArtifactInventoryFingerprint([entry]),
    semanticArtifactInventoryFingerprint([{ ...entry, bytes: 80123 }]),
  );
  assert.notEqual(
    semanticArtifactInventoryFingerprint([entry]),
    semanticArtifactInventoryFingerprint([
      { ...entry, semanticSha256: "different-semantic-content" },
    ]),
  );
});

const sourceIdentity = {
  revision: "1".repeat(40),
  tree: "2".repeat(40),
  trackedSourceFingerprint: "3".repeat(64),
};

const cachePolicy = {
  cacheRoot: "/workspace/.artifacts/release-cache/static",
  pnpmStore: "/workspace/.artifacts/release-cache/static/pnpm-store",
  playwrightBrowsers:
    "/workspace/.artifacts/release-cache/static/playwright-browsers",
  turbo: "local and remote reads/writes disabled",
  retainedAfterExecution: false,
  cleanupVerified: true,
};
const installationPolicy = {
  frozenInstallVerified: true,
  frozenLockfile: true,
  isolatedStore: cachePolicy.pnpmStore,
  mode: "detached-clean-worktrees",
  fetchWorkspaceIsolation: "detached-clean-worktree",
};

function result(suite) {
  const commands = expectedReleaseCommands(suite, false);
  const releaseResult = {
    suite,
    mode: "parallel",
    serial: false,
    debug: false,
    status: "passed",
    durationMs: 100,
    candidateIdentityPreserved: true,
    trackedWorkspaceClean: true,
    sourceIdentity,
    finalSourceIdentity: sourceIdentity,
    assertionFingerprint: releaseAssertionFingerprint(suite, sourceIdentity),
    artifactInventory: { fingerprint: "5".repeat(64) },
    coverageInventory: { fingerprint: "6".repeat(64) },
    retryPolicy: "none",
    commands,
    steps: commands.map((command, assertionIndex) => ({
      phase: "assertion",
      assertionIndex,
      declaredCommand: command,
      command,
      exitCode: 0,
      retries: 0,
      timedOut: false,
    })),
  };
  if (suite === "integration" || suite === "proof") {
    const migrations = [
      {
        path: "supabase/migrations/000001_test.sql",
        bytes: 1,
        sha256: "7".repeat(64),
      },
    ];
    const pgTapTests = [
      {
        path: "supabase/tests/000_test.sql",
        bytes: 1,
        sha256: "9".repeat(64),
      },
    ];
    releaseResult.databaseInputs = {
      migrations: {
        count: migrations.length,
        files: migrations,
        fingerprint: createHash("sha256")
          .update(JSON.stringify(migrations))
          .digest("hex"),
      },
      pgTapTests: {
        count: pgTapTests.length,
        files: pgTapTests,
        fingerprint: createHash("sha256")
          .update(JSON.stringify(pgTapTests))
          .digest("hex"),
      },
    };
  }
  return releaseResult;
}

test("accepts a complete passing release summary with one source identity", () => {
  assert.equal(
    sourceIdentityKey(sourceIdentity),
    `${"1".repeat(40)}:${"2".repeat(40)}:${"3".repeat(64)}`,
  );
  assert.deepEqual(
    releaseSummaryIssues(
      {
        mode: "parallel",
        debug: false,
        status: "passed",
        toolchain: {
          node: "v24.18.1",
          pnpm: "10.34.5",
          pnpmNode: "v24.18.1",
        },
        durationMs: 1_000,
        budgetMs: 60_000,
        withinBudget: true,
        sourceIdentity,
        cachePolicy,
        installationPolicy,
        results: ["static", "unit", "integration", "build", "ui", "proof"].map(
          result,
        ),
      },
      { expectedMode: "parallel" },
    ),
    [],
  );
});

test("rejects an omitted, reordered, or relabeled canonical command", () => {
  const omitted = result("static");
  omitted.commands.pop();
  omitted.steps.pop();
  const reordered = result("unit");
  [reordered.steps[0], reordered.steps[1]] = [
    reordered.steps[1],
    reordered.steps[0],
  ];
  const relabeled = result("build");
  relabeled.assertionFingerprint = "4".repeat(64);
  const issues = [omitted, reordered, relabeled].flatMap((candidate) =>
    releaseSummaryIssues(
      {
        mode: "parallel",
        debug: false,
        status: "passed",
        toolchain: {
          node: "v24.18.1",
          pnpm: "10.34.5",
          pnpmNode: "v24.18.1",
        },
        durationMs: 1_000,
        budgetMs: 60_000,
        withinBudget: true,
        sourceIdentity,
        cachePolicy,
        installationPolicy,
        results: [candidate],
      },
      { expectedMode: "parallel", requireEverySuite: false },
    ),
  );
  assert.ok(issues.some((issue) => issue.includes("command manifest differs")));
  assert.ok(issues.some((issue) => issue.includes("executed 8 of 9")));
  assert.ok(issues.some((issue) => issue.includes("assertion step 1 differs")));
  assert.ok(issues.some((issue) => issue.includes("fingerprint differs")));
});

test("rejects retries, duplicate shards, source drift, and failed budgets", () => {
  const retried = result("static");
  retried.steps[0].retries = 1;
  const drifted = result("unit");
  drifted.sourceIdentity = { ...sourceIdentity, tree: "4".repeat(40) };
  const issues = releaseSummaryIssues(
    {
      mode: "parallel",
      debug: false,
      status: "passed",
      toolchain: {
        node: "v24.18.1",
        pnpm: "10.34.5",
        pnpmNode: "v24.18.1",
      },
      durationMs: 61_000,
      budgetMs: 60_000,
      withinBudget: false,
      sourceIdentity,
      cachePolicy,
      installationPolicy,
      results: [retried, drifted, result("unit")],
    },
    { expectedMode: "parallel" },
  );
  assert.ok(issues.some((issue) => issue.includes("exceeded")));
  assert.ok(issues.some((issue) => issue.includes("used a retry")));
  assert.ok(issues.some((issue) => issue.includes("source identity differs")));
  assert.ok(issues.some((issue) => issue.includes("duplicate suites")));
  assert.ok(issues.some((issue) => issue.includes("missing suites")));
});

test("rejects a duration over budget even when the summary flag is stale", () => {
  const issues = releaseSummaryIssues({
    mode: "parallel",
    debug: false,
    status: "passed",
    toolchain: {
      node: "v24.18.1",
      pnpm: "10.34.5",
      pnpmNode: "v24.18.1",
    },
    durationMs: 60_001,
    budgetMs: 60_000,
    withinBudget: true,
    sourceIdentity,
    cachePolicy,
    installationPolicy,
    results: ["static", "unit", "integration", "build", "ui", "proof"].map(
      result,
    ),
  });
  assert.ok(
    issues.some(
      (issue) => issue === "summary duration exceeds its recorded budget",
    ),
  );
});

test("requires the recorded debug marker for serial/debug confirmation", () => {
  const serial = result("static");
  serial.mode = "serial";
  serial.serial = true;
  serial.commands = expectedReleaseCommands("static", true);
  serial.steps = serial.commands.map((command, assertionIndex) => ({
    phase: "assertion",
    assertionIndex,
    declaredCommand: command,
    command,
    exitCode: 0,
    retries: 0,
    timedOut: false,
  }));
  const issues = releaseSummaryIssues(
    {
      mode: "serial",
      debug: false,
      status: "passed",
      toolchain: {
        node: "v24.18.1",
        pnpm: "10.34.5",
        pnpmNode: "v24.18.1",
      },
      durationMs: 1_000,
      budgetMs: 60_000,
      withinBudget: true,
      sourceIdentity,
      cachePolicy,
      installationPolicy,
      results: [serial],
    },
    {
      expectedMode: "serial",
      expectedDebug: true,
      requireEverySuite: false,
    },
  );
  assert.ok(issues.some((issue) => issue.includes("expected true")));
});

test("binds every result mode and serial marker to the summary", () => {
  const mismatched = result("static");
  mismatched.mode = "serial";
  mismatched.serial = true;
  const issues = releaseSummaryIssues(
    {
      mode: "parallel",
      debug: false,
      status: "passed",
      toolchain: {
        node: "v24.18.1",
        pnpm: "10.34.5",
        pnpmNode: "v24.18.1",
      },
      durationMs: 1_000,
      budgetMs: 60_000,
      withinBudget: true,
      sourceIdentity,
      cachePolicy,
      installationPolicy,
      results: [mismatched],
    },
    { expectedMode: "parallel", requireEverySuite: false },
  );
  assert.ok(issues.some((issue) => issue.includes("mode differs")));
  assert.ok(issues.some((issue) => issue.includes("serial marker differs")));
});

test("rejects changed candidates and stale database input fingerprints", () => {
  const changed = result("integration");
  changed.finalSourceIdentity = {
    ...sourceIdentity,
    revision: "b".repeat(40),
  };
  changed.databaseInputs.pgTapTests.fingerprint = "c".repeat(64);
  const issues = releaseSummaryIssues(
    {
      mode: "parallel",
      debug: false,
      status: "passed",
      toolchain: {
        node: "v24.18.1",
        pnpm: "10.34.5",
        pnpmNode: "v24.18.1",
      },
      durationMs: 1_000,
      budgetMs: 60_000,
      withinBudget: true,
      sourceIdentity,
      cachePolicy,
      installationPolicy,
      results: [changed],
    },
    { expectedMode: "parallel", requireEverySuite: false },
  );
  assert.ok(
    issues.some(
      (issue) => issue === "integration final source identity differs",
    ),
  );
  assert.ok(
    issues.some(
      (issue) =>
        issue === "integration pgTapTests fingerprint does not match its files",
    ),
  );
});

test("requires exactly one complete result in a CI shard summary", () => {
  const summary = {
    mode: "parallel",
    debug: false,
    status: "passed",
    toolchain: {
      node: "v24.18.1",
      pnpm: "10.34.5",
      pnpmNode: "v24.18.1",
    },
    durationMs: 1_000,
    budgetMs: 60_000,
    withinBudget: true,
    sourceIdentity,
    cachePolicy,
    installationPolicy,
    results: [result("static")],
  };
  assert.deepEqual(
    releaseSummaryIssues(summary, {
      expectedMode: "parallel",
      requireEverySuite: false,
    }),
    [],
  );
  summary.results.push(result("unit"));
  assert.ok(
    releaseSummaryIssues(summary, {
      expectedMode: "parallel",
      requireEverySuite: false,
    }).some((issue) => issue.includes("exactly one result")),
  );
});

test("requires disposable release caches and paths bound to the declared cache root", () => {
  const summary = {
    mode: "parallel",
    debug: false,
    status: "passed",
    toolchain: {
      node: "v24.18.1",
      pnpm: "10.34.5",
      pnpmNode: "v24.18.1",
    },
    durationMs: 1_000,
    budgetMs: 60_000,
    withinBudget: true,
    sourceIdentity,
    cachePolicy: {
      ...cachePolicy,
      pnpmStore: "/unrelated/pnpm-store",
      retainedAfterExecution: true,
      cleanupVerified: false,
    },
    installationPolicy,
    results: [result("static")],
  };
  const issues = releaseSummaryIssues(summary, {
    expectedMode: "parallel",
    requireEverySuite: false,
  });
  assert.ok(issues.some((issue) => issue.includes("post-run removal")));
  assert.ok(issues.some((issue) => issue.includes("cleanup was not verified")));
  assert.ok(issues.some((issue) => issue.includes("declared cache root")));
});

test("requires an attested frozen install in the isolated release store", () => {
  const summary = {
    mode: "parallel",
    debug: false,
    status: "passed",
    toolchain: {
      node: "v24.18.1",
      pnpm: "10.34.5",
      pnpmNode: "v24.18.1",
    },
    durationMs: 1_000,
    budgetMs: 60_000,
    withinBudget: true,
    sourceIdentity,
    cachePolicy,
    installationPolicy: {
      frozenInstallVerified: false,
      frozenLockfile: false,
      isolatedStore: "/unrelated/pnpm-store",
      mode: "unverified-shared-workspace",
      fetchWorkspaceIsolation: "source-workspace",
    },
    results: [result("static")],
  };
  const issues = releaseSummaryIssues(summary, {
    expectedMode: "parallel",
    requireEverySuite: false,
  });
  assert.ok(issues.some((issue) => issue.includes("frozen install")));
  assert.ok(issues.some((issue) => issue.includes("installation mode")));
  assert.ok(
    issues.some((issue) => issue.includes("fetch workspace isolation")),
  );
  assert.ok(issues.some((issue) => issue.includes("differs")));
});

test("rejects a detached install that populates its store from the source workspace", () => {
  const summary = {
    mode: "parallel",
    debug: false,
    status: "passed",
    toolchain: {
      node: "v24.18.1",
      pnpm: "10.34.5",
      pnpmNode: "v24.18.1",
    },
    durationMs: 1_000,
    budgetMs: 60_000,
    withinBudget: true,
    sourceIdentity,
    cachePolicy,
    installationPolicy: {
      ...installationPolicy,
      fetchWorkspaceIsolation: "source-workspace",
    },
    results: [result("static")],
  };
  const issues = releaseSummaryIssues(summary, {
    expectedMode: "parallel",
    requireEverySuite: false,
  });
  assert.ok(
    issues.some((issue) => issue.includes("fetch workspace isolation")),
  );
});

test("rejects cleanup roots that could delete retained artifacts or the source workspace", () => {
  const common = {
    artifactRoot: "/workspace/.artifacts/release/run/parallel",
    workspaceRoot: "/workspace",
  };
  assert.deepEqual(
    releaseCacheRootIssues({
      ...common,
      cacheRoot: "/workspace/.artifacts/release/run/parallel/.isolated-cache",
    }),
    [],
  );
  assert.ok(
    releaseCacheRootIssues({
      ...common,
      cacheRoot: common.artifactRoot,
    }).some((issue) => issue.includes("artifact root")),
  );
  assert.ok(
    releaseCacheRootIssues({
      ...common,
      cacheRoot: "/workspace/.artifacts",
    }).some((issue) => issue.includes("artifact root")),
  );
  assert.ok(
    releaseCacheRootIssues({
      ...common,
      cacheRoot: common.workspaceRoot,
    }).some((issue) => issue.includes("source workspace")),
  );
});
