import { createHash } from "node:crypto";
import path from "node:path";

export const RELEASE_FIXED_CLOCK = "2026-07-31T16:00:00.000Z";

export const RELEASE_SUITE_NAMES = Object.freeze([
  "static",
  "unit",
  "integration",
  "build",
  "ui",
  "proof",
]);

export const RELEASE_SUITE_ASSERTIONS = Object.freeze({
  static: Object.freeze([
    "typecheck",
    "format",
    "lint",
    "boundaries",
    "secret-scan",
    "dependency-audit",
    "generated-dry-run",
    "qualification-inventory",
    "traceability",
  ]),
  unit: Object.freeze([
    "workspace-unit",
    "release-artifact-unit",
    "demo-reset",
    "demo-reset-production-refusal",
  ]),
  integration: Object.freeze([
    "drizzle-check",
    "database-lint",
    "populated-upgrade-and-pgtap",
    "workspace-integration",
  ]),
  build: Object.freeze(["production-build", "storybook-build"]),
  ui: Object.freeze(["storybook-axe", "playwright-browser"]),
  proof: Object.freeze(["production-proof-build", "production-browser-proof"]),
});

const noTurboCache = ["--cache=local:,remote:", "--continue=always"];

function serialVitestArguments(serial) {
  return serial ? ["--maxWorkers=1", "--no-file-parallelism"] : [];
}

function turboCommand(task, serial, testArguments = []) {
  return [
    "pnpm",
    "exec",
    "turbo",
    "run",
    task,
    ...noTurboCache,
    ...(serial ? ["--concurrency=1"] : []),
    ...(testArguments.length > 0 ? ["--", ...testArguments] : []),
  ];
}

export function expectedReleaseCommands(name, serial) {
  const suites = {
    static: [
      turboCommand("typecheck", serial),
      ["pnpm", "format:check"],
      ["pnpm", "lint"],
      ["pnpm", "boundaries"],
      ["pnpm", "scan:secrets"],
      ["pnpm", "audit", "--audit-level=low"],
      ["node", "scripts/check-generated-dry-run.mjs"],
      ["node", "scripts/validate-release-test-inventory.mjs"],
      ["pnpm", "check:traceability"],
    ],
    unit: [
      turboCommand("test:unit", serial, [
        "--allowOnly=false",
        "--no-cache",
        "--retry=0",
        ...serialVitestArguments(serial),
      ]),
      ["node", "--test", "scripts/release-artifacts.test.mjs"],
      ["pnpm", "exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
      ["node", "scripts/verify-demo-reset-safety.mjs"],
    ],
    integration: [
      ["pnpm", "--filter", "@clockwork/db", "check"],
      [
        "pnpm",
        "exec",
        "supabase",
        "db",
        "lint",
        "--local",
        "--schema",
        "public",
        "--level",
        "warning",
        "--fail-on",
        "warning",
      ],
      ["pnpm", "test:db:populated-upgrade"],
      turboCommand("test:integration", serial, [
        "--allowOnly=false",
        "--no-cache",
        "--retry=0",
        ...serialVitestArguments(serial),
      ]),
    ],
    build: [
      turboCommand("build", serial),
      [
        "pnpm",
        "--filter",
        "@clockwork/web",
        "exec",
        "storybook",
        "build",
        "--disable-telemetry",
        "--loglevel",
        "error",
      ],
    ],
    ui: [
      [
        "pnpm",
        "--filter",
        "@clockwork/web",
        "exec",
        "vitest",
        "run",
        "--allowOnly=false",
        "--no-cache",
        "--retry=0",
        "--config",
        "vitest.storybook.config.ts",
        ...serialVitestArguments(serial),
      ],
      [
        "pnpm",
        "--filter",
        "@clockwork/web",
        "exec",
        "playwright",
        "test",
        "--retries=0",
        "--update-snapshots=none",
      ],
    ],
    proof: [
      ["pnpm", "--filter", "@clockwork/web", "build"],
      [
        "pnpm",
        "--filter",
        "@clockwork/web",
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.proof.config.ts",
        "--retries=0",
      ],
    ],
  };
  const commands = suites[name];
  if (!commands) throw new Error(`Unknown release suite ${String(name)}`);
  return commands;
}

export function releaseAssertionFingerprint(suite, identity) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        suite,
        assertions: RELEASE_SUITE_ASSERTIONS[suite],
        commands: expectedReleaseCommands(suite, false),
        fixedClock: RELEASE_FIXED_CLOCK,
        assertionSemantics: "release-v4-qualification-inventory",
        coverageSemantics: "unchanged",
        failureSemantics: "zero-retry-complete-suite",
        sourceIdentity: identity,
      }),
    )
    .digest("hex");
}

function expectedExecutedCommand(command, result) {
  if (
    result.suite === "integration" &&
    result.isolation?.databaseService?.kind === "isolated-local-supabase" &&
    command[0] === "pnpm" &&
    command[1] === "exec" &&
    command[2] === "supabase" &&
    command[3] === "db" &&
    command[4] === "lint"
  )
    return [...command, "--workdir", "<isolated-database-project>"];
  return command;
}

const VOLATILE_REPORT_KEYS = new Set([
  "duration",
  "startTime",
  "endTime",
  "workerIndex",
  "parallelIndex",
]);

const RUNTIME_TIMESTAMP_PATTERN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const ISOLATED_ORIGIN_PATTERN = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g;
const NEXT_BUILD_ID_PATH_PATTERN =
  /static\/[A-Za-z0-9_-]{16,32}\/(_(?:buildManifest|ssgManifest|clientMiddlewareManifest)\.js)/g;

export function normalizeArtifactText(value, roots) {
  let normalized = value;
  for (const [root, token] of roots)
    normalized = normalized.replaceAll(root, token);
  return normalized
    .replace(ISOLATED_ORIGIN_PATTERN, "<isolated-runtime-origin>")
    .replace(NEXT_BUILD_ID_PATH_PATTERN, "static/<next-build-id>/$1");
}

export function normalizeReportValue(value, roots, key = "") {
  if (VOLATILE_REPORT_KEYS.has(key)) return "<runtime-value>";
  if (Array.isArray(value))
    return value.map((item) => normalizeReportValue(item, roots));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        normalizeReportValue(child, roots, childKey),
      ]),
    );
  if (typeof value !== "string") return value;
  return normalizeArtifactText(value, roots).replace(
    RUNTIME_TIMESTAMP_PATTERN,
    "<runtime-timestamp>",
  );
}

export function semanticArtifactInventoryFingerprint(entries) {
  const semanticEntries = entries.map(
    ({ path, semanticSha256, normalization }) => ({
      path,
      semanticSha256,
      normalization,
    }),
  );
  return createHash("sha256")
    .update(JSON.stringify(semanticEntries))
    .digest("hex");
}

function validHex(value, length) {
  return (
    typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  );
}

export function sourceIdentityKey(identity) {
  if (
    !identity ||
    !validHex(identity.revision, 40) ||
    !validHex(identity.tree, 40) ||
    !validHex(identity.trackedSourceFingerprint, 64)
  )
    return null;
  return [
    identity.revision,
    identity.tree,
    identity.trackedSourceFingerprint,
  ].join(":");
}

function pathContains(container, target) {
  const relative = path.relative(path.resolve(container), path.resolve(target));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function releaseCacheRootIssues({
  cacheRoot,
  artifactRoot,
  workspaceRoot,
}) {
  const issues = [];
  if (pathContains(cacheRoot, artifactRoot))
    issues.push("release cache root contains the retained artifact root");
  if (pathContains(cacheRoot, workspaceRoot))
    issues.push("release cache root contains the source workspace");
  return issues;
}

function databaseInventoryIssues(suite, databaseInputs) {
  const issues = [];
  for (const [name, prefix] of [
    ["migrations", "supabase/migrations/"],
    ["pgTapTests", "supabase/tests/"],
  ]) {
    const inventory = databaseInputs?.[name];
    const files = Array.isArray(inventory?.files) ? inventory.files : [];
    if (!Number.isInteger(inventory?.count) || inventory.count <= 0)
      issues.push(`${suite} ${name} count is invalid`);
    if (inventory?.count !== files.length)
      issues.push(`${suite} ${name} count does not match its file inventory`);
    if (!validHex(inventory?.fingerprint, 64))
      issues.push(`${suite} ${name} fingerprint is invalid`);
    else if (
      inventory.fingerprint !==
      createHash("sha256").update(JSON.stringify(files)).digest("hex")
    )
      issues.push(`${suite} ${name} fingerprint does not match its files`);
    const paths = files.map((file) => file?.path);
    if (new Set(paths).size !== paths.length)
      issues.push(`${suite} ${name} file inventory contains duplicates`);
    for (const file of files) {
      if (
        typeof file?.path !== "string" ||
        !file.path.startsWith(prefix) ||
        !file.path.endsWith(".sql") ||
        !Number.isInteger(file.bytes) ||
        file.bytes <= 0 ||
        !validHex(file.sha256, 64)
      )
        issues.push(`${suite} ${name} file inventory is invalid`);
    }
  }
  return issues;
}

export function releaseResultIssues(result, expectedIdentity) {
  const issues = [];
  if (!result || typeof result !== "object") return ["result is missing"];
  if (!RELEASE_SUITE_NAMES.includes(result.suite))
    issues.push(`unknown suite ${String(result.suite)}`);
  if (result.mode !== "parallel" && result.mode !== "serial")
    issues.push(`${String(result.suite)} mode is invalid`);
  if (typeof result.serial !== "boolean")
    issues.push(`${String(result.suite)} serial execution marker is invalid`);
  if (typeof result.debug !== "boolean")
    issues.push(`${String(result.suite)} debug marker is invalid`);
  if (result.debug === true && result.serial !== true)
    issues.push(`${String(result.suite)} debug execution was not serial`);
  if (result.status !== "passed")
    issues.push(`${String(result.suite)} status is not passed`);
  if (result.trackedWorkspaceClean !== true)
    issues.push(`${String(result.suite)} workspace is not clean`);
  if (result.candidateIdentityPreserved !== true)
    issues.push(`${String(result.suite)} candidate identity was not preserved`);
  if (!Number.isFinite(result.durationMs) || result.durationMs < 0)
    issues.push(`${String(result.suite)} duration is invalid`);
  if (!validHex(result.assertionFingerprint, 64))
    issues.push(`${String(result.suite)} assertion fingerprint is invalid`);
  if (!validHex(result.artifactInventory?.fingerprint, 64))
    issues.push(`${String(result.suite)} artifact fingerprint is invalid`);
  if (!validHex(result.coverageInventory?.fingerprint, 64))
    issues.push(`${String(result.suite)} coverage fingerprint is invalid`);
  if (result.retryPolicy !== "none")
    issues.push(`${String(result.suite)} retry policy is not none`);
  const identity = sourceIdentityKey(result.sourceIdentity);
  const finalIdentity = sourceIdentityKey(result.finalSourceIdentity);
  if (!identity)
    issues.push(`${String(result.suite)} source identity is invalid`);
  if (!finalIdentity)
    issues.push(`${String(result.suite)} final source identity is invalid`);
  if (identity && finalIdentity !== identity)
    issues.push(`${String(result.suite)} final source identity differs`);
  if (expectedIdentity && identity !== expectedIdentity)
    issues.push(`${String(result.suite)} source identity differs`);
  if (RELEASE_SUITE_NAMES.includes(result.suite)) {
    const expectedCommands = expectedReleaseCommands(
      result.suite,
      result.serial === true,
    );
    if (JSON.stringify(result.commands) !== JSON.stringify(expectedCommands))
      issues.push(`${String(result.suite)} command manifest differs`);
    if (
      identity &&
      result.assertionFingerprint !==
        releaseAssertionFingerprint(result.suite, result.sourceIdentity)
    )
      issues.push(`${String(result.suite)} assertion fingerprint differs`);
  }
  if (result.suite === "integration" || result.suite === "proof")
    issues.push(
      ...databaseInventoryIssues(String(result.suite), result.databaseInputs),
    );
  if (!Array.isArray(result.steps) || result.steps.length === 0) {
    issues.push(`${String(result.suite)} has no executed steps`);
  } else {
    for (const [index, step] of result.steps.entries()) {
      if (step.exitCode !== 0)
        issues.push(`${String(result.suite)} step ${index + 1} did not exit 0`);
      if (step.retries !== 0)
        issues.push(`${String(result.suite)} step ${index + 1} used a retry`);
      if (step.timedOut !== false)
        issues.push(
          `${String(result.suite)} step ${index + 1} did not record a non-timeout`,
        );
    }
    if (RELEASE_SUITE_NAMES.includes(result.suite)) {
      const expectedCommands = expectedReleaseCommands(
        result.suite,
        result.serial === true,
      );
      const assertionSteps = result.steps.filter(
        (step) => step.phase === "assertion",
      );
      if (assertionSteps.length !== expectedCommands.length)
        issues.push(
          `${String(result.suite)} executed ${assertionSteps.length} of ${expectedCommands.length} assertions`,
        );
      for (const [index, expectedCommand] of expectedCommands.entries()) {
        const step = assertionSteps[index];
        if (
          step?.assertionIndex !== index ||
          JSON.stringify(step?.declaredCommand) !==
            JSON.stringify(expectedCommand) ||
          JSON.stringify(step?.command) !==
            JSON.stringify(expectedExecutedCommand(expectedCommand, result))
        )
          issues.push(
            `${String(result.suite)} assertion step ${index + 1} differs from its command manifest`,
          );
      }
    }
  }
  return issues;
}

export function releaseSummaryIssues(
  summary,
  { expectedMode, expectedDebug, requireEverySuite = true } = {},
) {
  const issues = [];
  if (!summary || typeof summary !== "object") return ["summary is missing"];
  if (expectedMode && summary.mode !== expectedMode)
    issues.push(
      `summary mode is ${String(summary.mode)}, expected ${expectedMode}`,
    );
  if (typeof summary.debug !== "boolean")
    issues.push("summary debug marker is invalid");
  if (summary.debug === true && summary.mode !== "serial")
    issues.push("summary debug execution was not serial mode");
  if (expectedDebug !== undefined && summary.debug !== expectedDebug)
    issues.push(
      `summary debug marker is ${String(summary.debug)}, expected ${String(expectedDebug)}`,
    );
  if (summary.status !== "passed") issues.push("summary status is not passed");
  if (summary.cachePolicy?.retainedAfterExecution !== false)
    issues.push("summary cache policy does not require post-run removal");
  if (summary.cachePolicy?.cleanupVerified !== true)
    issues.push("summary cache cleanup was not verified");
  if (
    typeof summary.cachePolicy?.cacheRoot !== "string" ||
    typeof summary.cachePolicy?.pnpmStore !== "string" ||
    typeof summary.cachePolicy?.playwrightBrowsers !== "string"
  )
    issues.push("summary cache paths are invalid");
  else if (
    path.resolve(summary.cachePolicy.pnpmStore) !==
      path.join(path.resolve(summary.cachePolicy.cacheRoot), "pnpm-store") ||
    path.resolve(summary.cachePolicy.playwrightBrowsers) !==
      path.join(
        path.resolve(summary.cachePolicy.cacheRoot),
        "playwright-browsers",
      )
  )
    issues.push("summary cache paths do not share the declared cache root");
  if (summary.cachePolicy?.turbo !== "local and remote reads/writes disabled")
    issues.push("summary Turbo cache policy is invalid");
  if (
    summary.installationPolicy?.frozenInstallVerified !== true ||
    summary.installationPolicy?.frozenLockfile !== true
  )
    issues.push("summary frozen install was not verified");
  if (
    summary.installationPolicy?.mode !== "fresh-ci-checkout" &&
    summary.installationPolicy?.mode !== "detached-clean-worktrees"
  )
    issues.push("summary installation mode is invalid");
  if (
    !["fresh-ci-checkout", "detached-clean-worktree"].includes(
      summary.installationPolicy?.fetchWorkspaceIsolation,
    ) ||
    (summary.installationPolicy?.mode === "fresh-ci-checkout" &&
      summary.installationPolicy?.fetchWorkspaceIsolation !==
        "fresh-ci-checkout") ||
    (summary.installationPolicy?.mode === "detached-clean-worktrees" &&
      summary.installationPolicy?.fetchWorkspaceIsolation !==
        "detached-clean-worktree")
  )
    issues.push("summary fetch workspace isolation is invalid");
  if (
    typeof summary.installationPolicy?.isolatedStore !== "string" ||
    typeof summary.cachePolicy?.pnpmStore !== "string" ||
    path.resolve(summary.installationPolicy.isolatedStore) !==
      path.resolve(summary.cachePolicy.pnpmStore)
  )
    issues.push("summary frozen install store differs from its cache policy");
  if (
    summary.toolchain?.node !== "v24.18.1" ||
    summary.toolchain?.pnpm !== "10.34.5" ||
    summary.toolchain?.pnpmNode !== "v24.18.1"
  )
    issues.push(
      "summary toolchain is not Node v24.18.1 / pnpm 10.34.5 with Node v24.18.1 subprocesses",
    );
  if (summary.withinBudget !== true) issues.push("summary exceeded its budget");
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0)
    issues.push("summary duration is invalid");
  if (!Number.isFinite(summary.budgetMs) || summary.budgetMs <= 0)
    issues.push("summary budget is invalid");
  if (
    Number.isFinite(summary.durationMs) &&
    Number.isFinite(summary.budgetMs) &&
    summary.durationMs > summary.budgetMs
  )
    issues.push("summary duration exceeds its recorded budget");
  const identity = sourceIdentityKey(summary.sourceIdentity);
  if (!identity) issues.push("summary source identity is invalid");
  const results = Array.isArray(summary.results) ? summary.results : [];
  const names = results.map((result) => result?.suite);
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index,
  );
  if (duplicates.length > 0)
    issues.push(`duplicate suites: ${[...new Set(duplicates)].join(", ")}`);
  if (requireEverySuite) {
    const missing = RELEASE_SUITE_NAMES.filter((name) => !names.includes(name));
    const unexpected = names.filter(
      (name) => !RELEASE_SUITE_NAMES.includes(name),
    );
    if (missing.length > 0)
      issues.push(`missing suites: ${missing.join(", ")}`);
    if (unexpected.length > 0)
      issues.push(`unexpected suites: ${unexpected.join(", ")}`);
    if (results.length !== RELEASE_SUITE_NAMES.length)
      issues.push(`expected ${RELEASE_SUITE_NAMES.length} suite results`);
  } else if (results.length !== 1) {
    issues.push("a sharded summary must contain exactly one result");
  }
  for (const result of results) {
    if (result?.debug !== summary.debug)
      issues.push(`${String(result?.suite)} debug marker differs from summary`);
    if (result?.mode !== summary.mode)
      issues.push(`${String(result?.suite)} mode differs from summary`);
    if (result?.serial !== (summary.mode === "serial"))
      issues.push(
        `${String(result?.suite)} serial marker differs from summary mode`,
      );
    issues.push(...releaseResultIssues(result, identity));
  }
  return issues;
}
