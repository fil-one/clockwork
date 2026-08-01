import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  expectedReleaseCommands,
  isolatedReleaseEnvironment,
  isolatedReleaseGitEnvironment,
  normalizeArtifactText,
  normalizeReportValue,
  releaseDatabaseProjectId,
  releaseAssertionFingerprint,
  releaseCacheRootIssues,
  releaseLocalDatabaseEnvironmentIssues,
  releasePortAllocationIssues,
  releaseStressSummaryIssues,
  releaseSummaryIssues,
  RELEASE_FILE_CREDENTIAL_ENVIRONMENT,
  semanticArtifactInventoryFingerprint,
  sourceIdentityKey,
} from "./release-artifacts.mjs";

const checkedInDotenvExample = await readFile(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
const checkedInRuntimeVariables = [
  ...checkedInDotenvExample.matchAll(/^([A-Z][A-Z0-9_]*)=/gm),
]
  .map((match) => match[1])
  .sort();
const checkedInRuntimeVariablesSha256 = createHash("sha256")
  .update(JSON.stringify(checkedInRuntimeVariables))
  .digest("hex");

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

test("scrubs every documented runtime setting and inherited credential", () => {
  const isolated = isolatedReleaseEnvironment(
    {
      PATH: "/exact/toolchain",
      CLOCKWORK_ENABLE_SIMULATORS: "true",
      ACCOUNTING_PROVIDER_BASE_URL: "https://live.example",
      ACCOUNTING_PROVIDER_TOKEN: "live-token",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://telemetry.example",
      AWS_SESSION_TOKEN: "session-token",
      LOCAL_DB_PASSWORD: "postgres",
      CLOCKWORK_RELEASE_CACHE_ROOT: "/unsafe/cache",
      DOCKER_CONFIG: "/host/docker",
      GOOGLE_APPLICATION_CREDENTIALS: "/host/google.json",
      KUBECONFIG: "/host/kubeconfig",
      "npm_config_//registry.npmjs.org/:_authToken": "registry-token",
    },
    "CLOCKWORK_ENABLE_SIMULATORS=false\nACCOUNTING_PROVIDER_BASE_URL=\nACCOUNTING_PROVIDER_TOKEN=\n",
  );
  assert.deepEqual(isolated.environment, { PATH: "/exact/toolchain" });
  assert.equal(isolated.documentedVariableCount, 3);
  assert.deepEqual(isolated.scrubbedVariables, [
    "ACCOUNTING_PROVIDER_BASE_URL",
    "ACCOUNTING_PROVIDER_TOKEN",
    "AWS_SESSION_TOKEN",
    "CLOCKWORK_ENABLE_SIMULATORS",
    "CLOCKWORK_RELEASE_CACHE_ROOT",
    "DOCKER_CONFIG",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "KUBECONFIG",
    "LOCAL_DB_PASSWORD",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "npm_config_//registry.npmjs.org/:_authToken",
  ]);
});

test("scrubs the complete checked-in runtime environment contract", async () => {
  const isolated = isolatedReleaseEnvironment(
    Object.fromEntries([
      ["PATH", "/exact/toolchain"],
      ...checkedInRuntimeVariables.map((variable) => [variable, "live-value"]),
    ]),
    checkedInDotenvExample,
  );
  assert.equal(
    isolated.documentedVariableCount,
    new Set(checkedInRuntimeVariables).size,
  );
  assert.deepEqual(isolated.environment, { PATH: "/exact/toolchain" });
  assert.ok(
    checkedInRuntimeVariables.every((variable) =>
      isolated.scrubbedVariables.includes(variable),
    ),
  );
});

test("isolates git config, hooks, and repository routing from the caller", () => {
  const isolated = isolatedReleaseGitEnvironment({
    PATH: "/exact/toolchain",
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/tmp/evil-hooks'",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/tmp/other-hooks",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "evil-helper",
    GIT_DIR: "/redirected/repository",
    GIT_WORK_TREE: "/redirected/worktree",
    GIT_INDEX_FILE: "/redirected/index",
    GIT_OBJECT_DIRECTORY: "/redirected/objects",
    GIT_ALTERNATE_OBJECT_DIRECTORIES: "/redirected/alternates",
  });
  assert.deepEqual(isolated, {
    PATH: "/exact/toolchain",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
  });
  const effective = isolatedReleaseGitEnvironment({
    ...process.env,
    GIT_CONFIG_PARAMETERS: "'core.hooksPath=/tmp/evil-hooks'",
  });
  assert.equal(
    execFileSync("git", ["config", "--get", "core.hooksPath"], {
      encoding: "utf8",
      env: effective,
    }).trim(),
    "/dev/null",
  );
});

test("allows only complete loopback database configuration in shared shards", () => {
  const local = {
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    CLOCKWORK_SERVICE_DATABASE_URL:
      "postgresql://postgres:postgres@localhost:54329/postgres",
    DIRECT_DATABASE_URL: "postgres://postgres:postgres@[::1]:54322/postgres",
  };
  assert.deepEqual(releaseLocalDatabaseEnvironmentIssues(local), []);
  assert.ok(
    releaseLocalDatabaseEnvironmentIssues({
      ...local,
      DATABASE_URL: "postgresql://production.example:5432/postgres",
    }).some((issue) => issue.includes("loopback-only")),
  );
});

test("rejects cross-index application, provider, and database port overlaps", () => {
  assert.deepEqual(
    releasePortAllocationIssues({
      suiteNames: ["static", "unit", "integration", "build", "ui", "proof"],
      portBase: 32_000,
      providerFakePortBase: 34_000,
      databasePortBase: 56_000,
    }),
    [],
  );
  assert.ok(
    releasePortAllocationIssues({
      suiteNames: ["static", "unit"],
      portBase: 32_000,
      providerFakePortBase: 31_999,
      databasePortBase: 56_000,
    }).some((issue) => issue.includes("overlaps")),
  );
  assert.ok(
    releasePortAllocationIssues({
      suiteNames: ["integration"],
      portBase: 32_000,
      providerFakePortBase: 34_000,
      databasePortBase: 32_000,
    }).some((issue) => issue.includes("overlaps")),
  );
});

const sourceIdentity = {
  revision: "1".repeat(40),
  tree: "2".repeat(40),
  trackedSourceFingerprint: "3".repeat(64),
};
const releaseRunId = "quality-123456789abc-test";

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
  const artifactFiles = [
    {
      path: `runtime/${suite}.json`,
      bytes: 1,
      sha256: "4".repeat(64),
      semanticSha256: "5".repeat(64),
      normalization: "none; exact binary content",
    },
  ];
  const coverageFiles = [
    {
      path: `packages/${suite}/coverage/coverage.json`,
      bytes: 1,
      sha256: "6".repeat(64),
    },
  ];
  const releaseResult = {
    suite,
    runId: releaseRunId,
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
    artifactInventory: {
      files: artifactFiles,
      allowedNondeterminism: [],
      fingerprint: semanticArtifactInventoryFingerprint(artifactFiles),
    },
    coverageInventory: {
      files: coverageFiles,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(coverageFiles))
        .digest("hex"),
    },
    isolation: {
      artifactDirectory: `/workspace/.artifacts/release/${suite}`,
    },
    environmentIsolation: {
      policy: "documented-runtime-and-credential-files-v1",
      documentedRuntimeVariableCount: checkedInRuntimeVariables.length,
      documentedRuntimeVariables: checkedInRuntimeVariables,
      documentedRuntimeVariablesSha256: checkedInRuntimeVariablesSha256,
      scrubbedInheritedVariables: [],
      fileCredentialVariables: [...RELEASE_FILE_CREDENTIAL_ENVIRONMENT],
      packageManagerConfiguration: "empty-disposable-user-and-global-npmrc",
      localDatabaseInherited: false,
      providers: "scrubbed; proof uses only the loopback replay and OTLP fake",
      simulatorsEnabled: false,
    },
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
        runId: releaseRunId,
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
        runId: releaseRunId,
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
      runId: releaseRunId,
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
    runId: releaseRunId,
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
      runId: releaseRunId,
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
      runId: releaseRunId,
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
      runId: releaseRunId,
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

test("recomputes inventories and binds every result to its summary run", () => {
  const tampered = result("static");
  tampered.runId = "stale-run";
  tampered.artifactInventory.files[0].semanticSha256 = "a".repeat(64);
  tampered.environmentIsolation.simulatorsEnabled = true;
  tampered.environmentIsolation.packageManagerConfiguration = "host-config";
  tampered.coverageInventory.files.push({
    ...tampered.coverageInventory.files[0],
    path: "../escaped/coverage.json",
  });
  const issues = releaseSummaryIssues(
    {
      runId: releaseRunId,
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
      results: [tampered],
    },
    { expectedMode: "parallel", requireEverySuite: false },
  );
  assert.ok(issues.some((issue) => issue.includes("run ID differs")));
  assert.ok(
    issues.some((issue) => issue.includes("simulator isolation declaration")),
  );
  assert.ok(
    issues.some((issue) => issue.includes("package manager configuration")),
  );
  assert.ok(
    issues.some((issue) =>
      issue.includes("artifact fingerprint does not match its files"),
    ),
  );
  assert.ok(
    issues.some((issue) =>
      issue.includes("coverage fingerprint does not match its files"),
    ),
  );
  assert.ok(
    issues.some((issue) =>
      issue.includes("coverage file inventory is invalid"),
    ),
  );
});

test("accepts only a complete internally consistent stress summary", () => {
  const stressRuns = 3;
  const stressSummary = {
    token: releaseRunId,
    sourceIdentity,
    stressRuns,
    serialAccepted: true,
    parallelAccepted: true,
    comparisonAccepted: true,
    stressAccepted: true,
    durationMs: 100_000,
    budgetMs: 2_700_000,
    withinBudget: true,
    failures: [],
    stressEvidence: Array.from({ length: stressRuns }, (_, index) => ({
      summaryPath: `stress-${index + 1}/summary.json`,
      durationMs: 10_000,
      issues: [],
      sameSourceIdentity: true,
      equivalent: true,
      accepted: true,
    })),
    evidenceFiles: [
      "serial/summary.json",
      "parallel/summary.json",
      "comparison.json",
      ...Array.from(
        { length: stressRuns },
        (_, index) => `stress-${index + 1}/summary.json`,
      ),
    ].map((path) => ({ path, bytes: 1, sha256: "a".repeat(64) })),
    accepted: true,
  };
  assert.deepEqual(releaseStressSummaryIssues(stressSummary), []);
  const tampered = {
    ...stressSummary,
    withinBudget: false,
    failures: ["masked failure"],
    evidenceFiles: stressSummary.evidenceFiles.slice(1),
  };
  const issues = releaseStressSummaryIssues(tampered);
  assert.ok(issues.some((issue) => issue.includes("exceeded")));
  assert.ok(issues.some((issue) => issue.includes("contains failures")));
  assert.ok(issues.some((issue) => issue.includes("inventory is incomplete")));
});

test("requires exactly one complete result in a CI shard summary", () => {
  const summary = {
    runId: releaseRunId,
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
    runId: releaseRunId,
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
    runId: releaseRunId,
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
    runId: releaseRunId,
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
    allowedRoots: [
      "/workspace/.artifacts/release/run/parallel/.isolated-cache",
      "/workspace/.artifacts/release-cache/static",
    ],
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
  assert.ok(
    releaseCacheRootIssues({
      ...common,
      cacheRoot: "/workspace/.artifacts/release-benchmark/older-retained-run",
    }).some((issue) => issue.includes("current run or shard")),
  );
});
