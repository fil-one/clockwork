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

export const RELEASE_REQUIRED_RUNTIME_ENVIRONMENT = Object.freeze([
  "ACCOUNTING_PROVIDER_BASE_URL",
  "ACCOUNTING_PROVIDER_TOKEN",
  "AUTHORIZATION_CONTEXT_SECRET",
  "CLOCKWORK_ENABLE_SIMULATORS",
  "CLOCKWORK_EVIDENCE_ADAPTER",
  "CLOCKWORK_EXPERIENCE_ADAPTER",
  "CLOCKWORK_SERVICE_DATABASE_URL",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "DOCUMENT_RENDERER_PROVIDER_BASE_URL",
  "DOCUMENT_RENDERER_PROVIDER_TOKEN",
  "EVIDENCE_PROVIDER_BASE_URL",
  "EVIDENCE_PROVIDER_TOKEN",
  "EVIDENCE_STORAGE_INTERNAL_TOKEN",
  "EVIDENCE_STORAGE_INTERNAL_URL",
  "NOTIFICATION_PROVIDER_BASE_URL",
  "NOTIFICATION_PROVIDER_TOKEN",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_HEADERS",
  "PROVISIONING_PROVIDER_BASE_URL",
  "PROVISIONING_PROVIDER_TOKEN",
  "SCREENING_PROVIDER_BASE_URL",
  "SCREENING_PROVIDER_TOKEN",
  "SIGNATURE_PROVIDER_BASE_URL",
  "SIGNATURE_PROVIDER_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "USAGE_PROVIDER_BASE_URL",
  "USAGE_PROVIDER_TOKEN",
  "WORKFLOW_PROVIDER_CONTROL_BASE_URL",
  "WORKFLOW_PROVIDER_CONTROL_TOKEN",
  "WORKOS_API_KEY",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_MFA_PROVIDER_BASE_URL",
  "WORKOS_MFA_PROVIDER_TOKEN",
]);

export const RELEASE_FILE_CREDENTIAL_ENVIRONMENT = Object.freeze([
  "DOCKER_CONFIG",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "KUBECONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_USERCONFIG",
]);

export const RELEASE_DOCUMENTED_RUNTIME_ENVIRONMENT_COUNT = 90;
export const RELEASE_DOCUMENTED_RUNTIME_ENVIRONMENT_SHA256 =
  "f9f7339c674cfc97d5056c06a70324b77ba23c2bc8a48afc869134d9fbc0d7e2";

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

export function releaseDatabaseProjectId({ revision, runId, suite, portBase }) {
  if (!/^(integration|proof)$/.test(String(suite)))
    throw new Error(`Unsupported database release suite: ${String(suite)}`);
  if (typeof revision !== "string" || revision.length === 0)
    throw new Error("Database release project identity requires a revision.");
  if (typeof runId !== "string" || runId.length === 0)
    throw new Error("Database release project identity requires a run ID.");
  if (!Number.isInteger(portBase))
    throw new Error(
      "Database release project identity requires an integer port base.",
    );

  const suffix = createHash("sha256")
    .update([revision, runId, suite, String(portBase)].join("\0"))
    .digest("hex")
    .slice(0, 24);
  const projectId = `cw-${suite}-${suffix}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(projectId))
    throw new Error(
      "Database release project ID violates Supabase constraints.",
    );
  return projectId;
}

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
        assertionSemantics: "release-v5-environment-isolated-evidence",
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
  allowedRoots = [],
}) {
  const issues = [];
  if (pathContains(cacheRoot, artifactRoot))
    issues.push("release cache root contains the retained artifact root");
  if (pathContains(cacheRoot, workspaceRoot))
    issues.push("release cache root contains the source workspace");
  if (
    !allowedRoots.some(
      (allowedRoot) => path.resolve(allowedRoot) === path.resolve(cacheRoot),
    )
  )
    issues.push(
      "release cache root is not the current run or shard disposable namespace",
    );
  return issues;
}

const SENSITIVE_RELEASE_ENVIRONMENT =
  /(?:^AWS_|^OTEL_|^CLOCKWORK_(?:RELEASE|TEST|PROOF|PROVIDER|POPULATED_UPGRADE)_|^(?:DOCKER_CONFIG|GOOGLE_APPLICATION_CREDENTIALS|KUBECONFIG)$|^NPM_CONFIG_(?:USERCONFIG|GLOBALCONFIG|REGISTRY)$|AUTH|TOKEN|SECRET|PASSWORD|CREDENTIAL|API.?KEY|ACCESS.?KEY|PRIVATE.?KEY)/i;

export function isolatedReleaseEnvironment(inherited, dotenvExample) {
  const documentedVariables = new Set(
    [...String(dotenvExample).matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
      (match) => match[1],
    ),
  );
  const environment = { ...inherited };
  const scrubbedVariables = [];
  for (const variable of Object.keys(environment)) {
    if (
      documentedVariables.has(variable) ||
      SENSITIVE_RELEASE_ENVIRONMENT.test(variable)
    ) {
      delete environment[variable];
      scrubbedVariables.push(variable);
    }
  }
  return {
    documentedVariableCount: documentedVariables.size,
    documentedVariables: [...documentedVariables].sort(),
    documentedVariablesSha256: createHash("sha256")
      .update(JSON.stringify([...documentedVariables].sort()))
      .digest("hex"),
    environment,
    fileCredentialVariables: [...RELEASE_FILE_CREDENTIAL_ENVIRONMENT],
    scrubbedVariables: scrubbedVariables.sort(),
  };
}

const RELEASE_GIT_ROUTING_ENVIRONMENT = new Set([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_ASKPASS",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_QUARANTINE_PATH",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_WORK_TREE",
]);

export function isolatedReleaseGitEnvironment(inherited) {
  const environment = { ...inherited };
  for (const variable of Object.keys(environment))
    if (
      variable === "GIT_CONFIG" ||
      variable.startsWith("GIT_CONFIG_") ||
      RELEASE_GIT_ROUTING_ENVIRONMENT.has(variable)
    )
      delete environment[variable];
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
  };
}

export function releaseLocalDatabaseEnvironmentIssues(environment) {
  const issues = [];
  for (const variable of [
    "DATABASE_URL",
    "CLOCKWORK_SERVICE_DATABASE_URL",
    "DIRECT_DATABASE_URL",
  ]) {
    const value = environment?.[variable];
    if (typeof value !== "string" || value.length === 0) {
      issues.push(`${variable} is required for a shared database shard`);
      continue;
    }
    try {
      const url = new URL(value);
      if (!new Set(["postgres:", "postgresql:"]).has(url.protocol))
        issues.push(`${variable} is not a PostgreSQL URL`);
      if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname))
        issues.push(`${variable} is not loopback-only`);
      if (!url.port) issues.push(`${variable} does not declare a local port`);
    } catch {
      issues.push(`${variable} is not a valid URL`);
    }
  }
  return issues;
}

export function releasePortAllocationIssues({
  suiteNames,
  portBase,
  databasePortBase,
  providerFakePortBase,
}) {
  const assignments = [];
  for (const [index, suite] of suiteNames.entries()) {
    assignments.push({ label: `${suite}:application`, port: portBase + index });
    assignments.push({
      label: `${suite}:provider-fake`,
      port: providerFakePortBase + index,
    });
    if (suite === "integration" || suite === "proof")
      for (const offset of [0, 1, 2, 3, 4, 9])
        assignments.push({
          label: `${suite}:database:${offset}`,
          port: databasePortBase + index * 20 + offset,
        });
  }
  const issues = [];
  const assignmentsByPort = new Map();
  for (const assignment of assignments) {
    if (
      !Number.isInteger(assignment.port) ||
      assignment.port < 1024 ||
      assignment.port > 65_535
    )
      issues.push(`${assignment.label} port is outside the safe range`);
    const labels = assignmentsByPort.get(assignment.port) ?? [];
    labels.push(assignment.label);
    assignmentsByPort.set(assignment.port, labels);
  }
  for (const [port, labels] of assignmentsByPort)
    if (labels.length > 1)
      issues.push(`port ${port} overlaps: ${labels.join(", ")}`);
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

function inventoryPathIsSafe(value, prefixes) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.split("/").includes("..") &&
    prefixes.some((prefix) => value.startsWith(prefix))
  );
}

function artifactInventoryIssues(suite, inventory) {
  const issues = [];
  const files = Array.isArray(inventory?.files) ? inventory.files : [];
  if (!Array.isArray(inventory?.files))
    issues.push(`${suite} artifact file inventory is invalid`);
  if (!validHex(inventory?.fingerprint, 64))
    issues.push(`${suite} artifact fingerprint is invalid`);
  else if (
    inventory.fingerprint !== semanticArtifactInventoryFingerprint(files)
  )
    issues.push(`${suite} artifact fingerprint does not match its files`);
  const paths = files.map((file) => file?.path);
  if (new Set(paths).size !== paths.length)
    issues.push(`${suite} artifact file inventory contains duplicates`);
  for (const file of files) {
    if (
      !inventoryPathIsSafe(file?.path, ["runtime/", "build/"]) ||
      !Number.isInteger(file?.bytes) ||
      file.bytes < 0 ||
      !validHex(file?.sha256, 64) ||
      !validHex(file?.semanticSha256, 64) ||
      typeof file?.normalization !== "string" ||
      file.normalization.length === 0
    )
      issues.push(`${suite} artifact file inventory is invalid`);
  }
  const allowedNondeterminism = inventory?.allowedNondeterminism;
  if (
    !Array.isArray(allowedNondeterminism) ||
    allowedNondeterminism.some(
      (entry) => typeof entry !== "string" || entry.length === 0,
    ) ||
    new Set(allowedNondeterminism).size !== allowedNondeterminism.length
  )
    issues.push(`${suite} artifact nondeterminism inventory is invalid`);
  return issues;
}

function coverageInventoryIssues(suite, inventory) {
  const issues = [];
  const files = Array.isArray(inventory?.files) ? inventory.files : [];
  if (!Array.isArray(inventory?.files))
    issues.push(`${suite} coverage file inventory is invalid`);
  if (!validHex(inventory?.fingerprint, 64))
    issues.push(`${suite} coverage fingerprint is invalid`);
  else if (
    inventory.fingerprint !==
    createHash("sha256").update(JSON.stringify(files)).digest("hex")
  )
    issues.push(`${suite} coverage fingerprint does not match its files`);
  const paths = files.map((file) => file?.path);
  if (new Set(paths).size !== paths.length)
    issues.push(`${suite} coverage file inventory contains duplicates`);
  for (const file of files) {
    if (
      !inventoryPathIsSafe(file?.path, ["apps/", "packages/"]) ||
      !file.path.includes("/coverage/") ||
      !Number.isInteger(file?.bytes) ||
      file.bytes < 0 ||
      !validHex(file?.sha256, 64)
    )
      issues.push(`${suite} coverage file inventory is invalid`);
  }
  return issues;
}

function environmentIsolationIssues(result, installationMode) {
  const suite = String(result?.suite);
  const isolation = result?.environmentIsolation;
  const issues = [];
  if (isolation?.policy !== "documented-runtime-and-credential-files-v1")
    issues.push(`${suite} environment isolation policy is invalid`);
  const documented = Array.isArray(isolation?.documentedRuntimeVariables)
    ? isolation.documentedRuntimeVariables
    : [];
  if (
    !Number.isInteger(isolation?.documentedRuntimeVariableCount) ||
    isolation.documentedRuntimeVariableCount !== documented.length ||
    documented.length === 0 ||
    documented.some(
      (variable) =>
        typeof variable !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(variable),
    ) ||
    new Set(documented).size !== documented.length
  )
    issues.push(`${suite} documented runtime environment inventory is invalid`);
  const documentedFingerprint = createHash("sha256")
    .update(JSON.stringify(documented))
    .digest("hex");
  if (
    isolation?.documentedRuntimeVariableCount !==
      RELEASE_DOCUMENTED_RUNTIME_ENVIRONMENT_COUNT ||
    isolation?.documentedRuntimeVariablesSha256 !== documentedFingerprint ||
    documentedFingerprint !== RELEASE_DOCUMENTED_RUNTIME_ENVIRONMENT_SHA256
  )
    issues.push(
      `${suite} documented runtime environment differs from the canonical contract`,
    );
  const missingRequired = RELEASE_REQUIRED_RUNTIME_ENVIRONMENT.filter(
    (variable) => !documented.includes(variable),
  );
  if (missingRequired.length > 0)
    issues.push(
      `${suite} environment isolation omits required variables: ${missingRequired.join(", ")}`,
    );
  const scrubbed = isolation?.scrubbedInheritedVariables;
  if (
    !Array.isArray(scrubbed) ||
    scrubbed.some(
      (variable) =>
        typeof variable !== "string" ||
        variable.length === 0 ||
        variable.length > 512 ||
        /[\0\r\n]/.test(variable),
    ) ||
    new Set(scrubbed).size !== scrubbed.length
  )
    issues.push(`${suite} scrubbed inherited environment inventory is invalid`);
  if (
    JSON.stringify(isolation?.fileCredentialVariables) !==
    JSON.stringify(RELEASE_FILE_CREDENTIAL_ENVIRONMENT)
  )
    issues.push(`${suite} file credential environment policy is invalid`);
  if (
    isolation?.packageManagerConfiguration !==
    "empty-disposable-user-and-global-npmrc"
  )
    issues.push(`${suite} package manager configuration is not isolated`);
  if (
    isolation?.providers !==
    "scrubbed; proof uses only the loopback replay and OTLP fake"
  )
    issues.push(`${suite} provider isolation declaration is invalid`);
  if (isolation?.simulatorsEnabled !== false)
    issues.push(`${suite} simulator isolation declaration is invalid`);
  const shouldInheritLocalDatabase =
    installationMode === "fresh-ci-checkout" &&
    (suite === "integration" || suite === "proof");
  if (isolation?.localDatabaseInherited !== shouldInheritLocalDatabase)
    issues.push(`${suite} local database inheritance declaration is invalid`);
  return issues;
}

export function releaseResultIssues(result, expectedIdentity) {
  const issues = [];
  if (!result || typeof result !== "object") return ["result is missing"];
  if (!RELEASE_SUITE_NAMES.includes(result.suite))
    issues.push(`unknown suite ${String(result.suite)}`);
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(String(result.runId ?? "")))
    issues.push(`${String(result.suite)} run ID is invalid`);
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
  issues.push(
    ...artifactInventoryIssues(String(result.suite), result.artifactInventory),
    ...coverageInventoryIssues(String(result.suite), result.coverageInventory),
  );
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
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(String(summary.runId ?? "")))
    issues.push("summary run ID is invalid");
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
  const artifactDirectories = results.map(
    (result) => result?.isolation?.artifactDirectory,
  );
  if (
    artifactDirectories.some(
      (directory) => typeof directory !== "string" || directory.length === 0,
    )
  )
    issues.push("suite artifact directories are invalid");
  if (new Set(artifactDirectories).size !== artifactDirectories.length)
    issues.push("suite artifact directories are not unique");
  for (const result of results) {
    if (result?.runId !== summary.runId)
      issues.push(`${String(result?.suite)} run ID differs from summary`);
    if (result?.debug !== summary.debug)
      issues.push(`${String(result?.suite)} debug marker differs from summary`);
    if (result?.mode !== summary.mode)
      issues.push(`${String(result?.suite)} mode differs from summary`);
    if (result?.serial !== (summary.mode === "serial"))
      issues.push(
        `${String(result?.suite)} serial marker differs from summary mode`,
      );
    issues.push(
      ...environmentIsolationIssues(result, summary.installationPolicy?.mode),
    );
    issues.push(...releaseResultIssues(result, identity));
  }
  return issues;
}

export function releaseStressSummaryIssues(summary) {
  const issues = [];
  if (!summary || typeof summary !== "object")
    return ["stress summary is missing"];
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(String(summary.token ?? "")))
    issues.push("stress summary token is invalid");
  if (!sourceIdentityKey(summary.sourceIdentity))
    issues.push("stress summary source identity is invalid");
  if (
    !Number.isInteger(summary.stressRuns) ||
    summary.stressRuns < 2 ||
    summary.stressRuns > 10
  )
    issues.push("stress run count is invalid");
  if (summary.serialAccepted !== true)
    issues.push("serial qualification was not accepted");
  if (summary.parallelAccepted !== true)
    issues.push("parallel qualification was not accepted");
  if (summary.comparisonAccepted !== true)
    issues.push("serial/parallel comparison was not accepted");
  if (summary.stressAccepted !== true)
    issues.push("stress qualification was not accepted");
  if (summary.accepted !== true) issues.push("stress summary was not accepted");
  if (summary.withinBudget !== true)
    issues.push("stress summary exceeded its budget");
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0)
    issues.push("stress summary duration is invalid");
  if (!Number.isFinite(summary.budgetMs) || summary.budgetMs <= 0)
    issues.push("stress summary budget is invalid");
  if (
    Number.isFinite(summary.durationMs) &&
    Number.isFinite(summary.budgetMs) &&
    summary.durationMs > summary.budgetMs
  )
    issues.push("stress summary duration exceeds its recorded budget");
  if (!Array.isArray(summary.failures) || summary.failures.length !== 0)
    issues.push("stress summary contains failures");
  const stressEvidence = Array.isArray(summary.stressEvidence)
    ? summary.stressEvidence
    : [];
  if (stressEvidence.length !== summary.stressRuns)
    issues.push("stress evidence count differs from the requested runs");
  const stressSummaryPaths = stressEvidence.map((item) => item?.summaryPath);
  if (new Set(stressSummaryPaths).size !== stressSummaryPaths.length)
    issues.push("stress evidence paths contain duplicates");
  for (const [index, evidence] of stressEvidence.entries()) {
    if (evidence?.summaryPath !== `stress-${index + 1}/summary.json`)
      issues.push(`stress evidence ${index + 1} path is invalid`);
    if (!Number.isFinite(evidence?.durationMs) || evidence.durationMs < 0)
      issues.push(`stress evidence ${index + 1} duration is invalid`);
    if (!Array.isArray(evidence?.issues) || evidence.issues.length !== 0)
      issues.push(`stress evidence ${index + 1} contains issues`);
    if (evidence?.sameSourceIdentity !== true)
      issues.push(`stress evidence ${index + 1} source identity differs`);
    if (evidence?.equivalent !== true)
      issues.push(`stress evidence ${index + 1} is not equivalent`);
    if (evidence?.accepted !== true)
      issues.push(`stress evidence ${index + 1} was not accepted`);
  }
  const evidenceFiles = Array.isArray(summary.evidenceFiles)
    ? summary.evidenceFiles
    : [];
  const expectedEvidencePaths = [
    "serial/summary.json",
    "parallel/summary.json",
    "comparison.json",
    ...Array.from(
      { length: Number.isInteger(summary.stressRuns) ? summary.stressRuns : 0 },
      (_, index) => `stress-${index + 1}/summary.json`,
    ),
  ];
  const evidencePaths = evidenceFiles.map((file) => file?.path);
  if (
    evidenceFiles.length !== expectedEvidencePaths.length ||
    JSON.stringify([...evidencePaths].sort()) !==
      JSON.stringify([...expectedEvidencePaths].sort())
  )
    issues.push("stress evidence file inventory is incomplete");
  if (new Set(evidencePaths).size !== evidencePaths.length)
    issues.push("stress evidence file inventory contains duplicates");
  for (const file of evidenceFiles)
    if (
      typeof file?.path !== "string" ||
      !expectedEvidencePaths.includes(file.path) ||
      !Number.isInteger(file?.bytes) ||
      file.bytes <= 0 ||
      !validHex(file?.sha256, 64)
    )
      issues.push("stress evidence file inventory is invalid");
  return issues;
}
