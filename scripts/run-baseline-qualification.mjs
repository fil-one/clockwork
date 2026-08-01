import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const [outputArgument, expectedRevision] = process.argv.slice(2);
if (!outputArgument) throw new Error("QUALIFICATION_OUTPUT_DIRECTORY_REQUIRED");
if (!/^[0-9a-f]{40}$/.test(expectedRevision ?? ""))
  throw new Error("QUALIFICATION_EXPECTED_REVISION_REQUIRED");

const root = process.cwd();
const outputDirectory = resolve(outputArgument);
const outputRelative = relative(root, outputDirectory);
if (
  outputRelative === "" ||
  (outputRelative !== ".." && !outputRelative.startsWith("../"))
)
  throw new Error("QUALIFICATION_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY");
if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0)
  throw new Error("QUALIFICATION_OUTPUT_DIRECTORY_NOT_EMPTY");
const cacheDirectory = join(outputDirectory, "isolated-cache");
const logDirectory = join(outputDirectory, "logs");
mkdirSync(cacheDirectory, { recursive: true });
mkdirSync(logDirectory, { recursive: true });
const npmUserConfig = join(cacheDirectory, "empty-npmrc");
writeFileSync(npmUserConfig, "");

const exactPath = [
  "/opt/homebrew/Cellar/node@24/24.18.1/bin",
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
].join(":");
const pooledDatabaseUrl = new URL("postgresql://127.0.0.1:54329/postgres");
pooledDatabaseUrl.username = "postgres.pooler-dev";
pooledDatabaseUrl.password = "postgres";
const directDatabaseUrl = new URL("postgresql://127.0.0.1:54322/postgres");
directDatabaseUrl.username = "postgres";
directDatabaseUrl.password = "postgres";
const databaseEnvironment = {
  LOCAL_DB_HOST: "127.0.0.1",
  LOCAL_DB_PASSWORD: "postgres",
  DATABASE_URL: pooledDatabaseUrl.toString(),
  CLOCKWORK_SERVICE_DATABASE_URL: pooledDatabaseUrl.toString(),
  DIRECT_DATABASE_URL: directDatabaseUrl.toString(),
};
const inheritedEnvironment = Object.fromEntries(
  ["HOME", "LANG", "LC_ALL", "LOGNAME", "SHELL", "TERM", "TMPDIR", "USER"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
const baseEnvironment = {
  ...inheritedEnvironment,
  PATH: exactPath,
  CI: "true",
  APP_ORIGIN: "http://127.0.0.1:3000",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3000",
  AUTHORIZATION_CONTEXT_SECRET: "clockwork-local-auth-context-secret-change-me",
  AUTHORIZATION_CONTEXT_SECRET_ID: "local",
  TURBO_TELEMETRY_DISABLED: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  XDG_CACHE_HOME: join(cacheDirectory, "xdg"),
  PLAYWRIGHT_BROWSERS_PATH: join(cacheDirectory, "playwright-browsers"),
  COREPACK_HOME: join(cacheDirectory, "corepack"),
  npm_config_userconfig: npmUserConfig,
  npm_config_update_notifier: "false",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const timeoutMilliseconds = 30 * 60 * 1_000;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function checked(program, arguments_, environment = {}) {
  const result = spawnSync(program, arguments_, {
    cwd: root,
    encoding: "utf8",
    env: { ...baseEnvironment, ...environment },
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMilliseconds,
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `QUALIFICATION_PREFLIGHT_FAILED:${program}:${arguments_.join(",")}:${result.error?.message ?? result.stderr ?? ""}`,
    );
  return result.stdout.trim();
}

function gitPathList(arguments_) {
  const output = checked("git", [...arguments_, "-z"]);
  return output === "" ? [] : output.split("\0").filter(Boolean).sort();
}

const initialRevision = checked("git", ["rev-parse", "HEAD"]);
const initialTree = checked("git", ["rev-parse", "HEAD^{tree}"]);
const initialStatus = checked("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
const initialIgnoredArtifacts = gitPathList([
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
]);
const visibleFiles = gitPathList([
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
]);
const prohibitedEnvironmentFiles = [...visibleFiles, ...initialIgnoredArtifacts]
  .filter((path) => {
    const name = basename(path);
    return name.startsWith(".env") && name !== ".env.example";
  })
  .sort();
const gitCommonDirectory = resolve(
  root,
  checked("git", ["rev-parse", "--git-common-dir"]),
);
const supabaseConfig = readFileSync(
  join(root, "supabase", "config.toml"),
  "utf8",
);
if (initialRevision !== expectedRevision)
  throw new Error(
    `QUALIFICATION_REVISION_MISMATCH:${initialRevision}:${expectedRevision}`,
  );
if (initialStatus !== "")
  throw new Error(`QUALIFICATION_WORKTREE_NOT_CLEAN:${initialStatus}`);
if (gitCommonDirectory !== join(root, ".git"))
  throw new Error(
    `QUALIFICATION_REQUIRES_STANDALONE_CLONE:${gitCommonDirectory}`,
  );
if (prohibitedEnvironmentFiles.length > 0)
  throw new Error(
    `QUALIFICATION_ENV_FILES_PRESENT:${prohibitedEnvironmentFiles.join(",")}`,
  );
if (initialIgnoredArtifacts.length > 0)
  throw new Error(
    `QUALIFICATION_PREEXISTING_IGNORED_ARTIFACTS:${initialIgnoredArtifacts.join(",")}`,
  );
if (!/^project_id\s*=\s*"clockwork-commerce"\s*$/m.test(supabaseConfig))
  throw new Error("QUALIFICATION_SUPABASE_PROJECT_UNEXPECTED");
if (checked("node", ["--version"]) !== "v24.18.1")
  throw new Error("QUALIFICATION_NODE_VERSION_MISMATCH");
if (checked("pnpm", ["--version"]) !== "10.34.5")
  throw new Error("QUALIFICATION_PNPM_VERSION_MISMATCH");

const turbo = ["exec", "turbo", "run"];
const noTurboCache = ["--cache=local:,remote:", "--continue=always"];
const installed = ["frozen-install"];
const databaseReady = ["db-start", "db-reset"];
const steps = [
  { id: "runtime-node", program: "node", arguments: ["--version"] },
  { id: "runtime-pnpm", program: "pnpm", arguments: ["--version"] },
  {
    id: "frozen-install",
    program: "pnpm",
    arguments: [
      "install",
      "--frozen-lockfile",
      "--force",
      "--store-dir",
      join(cacheDirectory, "pnpm-store"),
    ],
    fatalOnFailure: true,
  },
  {
    id: "runtime-turbo",
    program: "pnpm",
    arguments: ["exec", "turbo", "--version"],
    dependsOn: installed,
  },
  {
    id: "runtime-vitest",
    program: "pnpm",
    arguments: ["--filter", "@clockwork/web", "exec", "vitest", "--version"],
    dependsOn: installed,
  },
  {
    id: "runtime-playwright",
    program: "pnpm",
    arguments: [
      "--filter",
      "@clockwork/web",
      "exec",
      "playwright",
      "--version",
    ],
    dependsOn: installed,
  },
  {
    id: "runtime-supabase",
    program: "pnpm",
    arguments: ["exec", "supabase", "--version"],
    dependsOn: installed,
  },
  {
    id: "runtime-docker",
    program: "docker",
    arguments: ["--version"],
    dependsOn: installed,
  },
  {
    id: "format",
    program: "pnpm",
    arguments: ["format:check"],
    dependsOn: installed,
  },
  { id: "lint", program: "pnpm", arguments: ["lint"], dependsOn: installed },
  {
    id: "boundaries",
    program: "pnpm",
    arguments: ["boundaries"],
    dependsOn: installed,
  },
  {
    id: "secret-scan",
    program: "pnpm",
    arguments: ["scan:secrets"],
    dependsOn: installed,
  },
  {
    id: "dependency-audit",
    program: "pnpm",
    arguments: ["audit:dependencies"],
    dependsOn: installed,
  },
  {
    id: "traceability",
    program: "pnpm",
    arguments: ["check:traceability"],
    dependsOn: installed,
  },
  {
    id: "generated-drift",
    program: "pnpm",
    arguments: ["check:generated"],
    dependsOn: installed,
    fatalOnFailure: true,
  },
  {
    id: "repository-clean-after-generated",
    program: "git",
    arguments: ["status", "--porcelain=v1", "--untracked-files=all"],
    dependsOn: installed,
    validateOutput: (output) => output === "",
    alwaysRun: true,
    fatalOnFailure: true,
  },
  {
    id: "revision-unchanged-after-generated",
    program: "git",
    arguments: ["rev-parse", "HEAD"],
    dependsOn: installed,
    validateOutput: (output) => output.trim() === initialRevision,
    alwaysRun: true,
    fatalOnFailure: true,
  },
  {
    id: "tree-unchanged-after-generated",
    program: "git",
    arguments: ["rev-parse", "HEAD^{tree}"],
    dependsOn: installed,
    validateOutput: (output) => output.trim() === initialTree,
    alwaysRun: true,
    fatalOnFailure: true,
  },
  {
    id: "typecheck",
    program: "pnpm",
    arguments: [...turbo, "typecheck", ...noTurboCache],
    dependsOn: installed,
  },
  {
    id: "unit-parallel",
    program: "pnpm",
    arguments: [...turbo, "test:unit", ...noTurboCache, "--", "--no-cache"],
    dependsOn: installed,
  },
  {
    id: "unit-serial-confirmation",
    program: "pnpm",
    arguments: [
      ...turbo,
      "test:unit",
      ...noTurboCache,
      "--concurrency=1",
      "--",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
    ],
    dependsOn: installed,
  },
  {
    id: "db-stop-before",
    program: "pnpm",
    arguments: ["exec", "supabase", "stop", "--no-backup"],
    dependsOn: installed,
  },
  {
    id: "db-start",
    program: "pnpm",
    arguments: ["db:start"],
    dependsOn: ["db-stop-before"],
  },
  {
    id: "db-reset",
    program: "pnpm",
    arguments: ["db:reset"],
    environment: databaseEnvironment,
    dependsOn: ["db-start"],
  },
  {
    id: "db-drizzle-check",
    program: "pnpm",
    arguments: ["--filter", "@clockwork/db", "check"],
    environment: databaseEnvironment,
    dependsOn: databaseReady,
  },
  {
    id: "db-pgtap",
    program: "pnpm",
    arguments: ["db:test"],
    environment: databaseEnvironment,
    dependsOn: databaseReady,
  },
  {
    id: "integration-parallel",
    program: "pnpm",
    arguments: [
      ...turbo,
      "test:integration",
      ...noTurboCache,
      "--",
      "--no-cache",
    ],
    environment: {
      ...databaseEnvironment,
      APP_ORIGIN: "http://localhost:3000",
    },
    dependsOn: databaseReady,
  },
  {
    id: "db-reset-before-serial",
    program: "pnpm",
    arguments: ["db:reset"],
    environment: databaseEnvironment,
    dependsOn: databaseReady,
  },
  {
    id: "integration-serial-confirmation",
    program: "pnpm",
    arguments: [
      ...turbo,
      "test:integration",
      ...noTurboCache,
      "--concurrency=1",
      "--",
      "--no-cache",
      "--maxWorkers=1",
      "--no-file-parallelism",
    ],
    environment: {
      ...databaseEnvironment,
      APP_ORIGIN: "http://localhost:3000",
    },
    dependsOn: ["db-reset-before-serial"],
  },
  {
    id: "migration-state-check",
    program: "pnpm",
    arguments: ["exec", "supabase", "migration", "up", "--local"],
    environment: databaseEnvironment,
    dependsOn: databaseReady,
    expectedOutput: "Local database is up to date.",
  },
  {
    id: "application-build",
    program: "pnpm",
    arguments: [...turbo, "build", ...noTurboCache],
    dependsOn: installed,
  },
  {
    id: "storybook-build",
    program: "pnpm",
    arguments: [...turbo, "build:storybook", ...noTurboCache],
    dependsOn: installed,
  },
  {
    id: "playwright-install",
    program: "pnpm",
    arguments: ["playwright:install"],
    dependsOn: installed,
  },
  {
    id: "storybook-axe",
    program: "pnpm",
    arguments: [
      "--filter",
      "@clockwork/web",
      "exec",
      "vitest",
      "run",
      "--no-cache",
      "--config",
      "vitest.storybook.config.ts",
    ],
    dependsOn: installed,
  },
  {
    id: "playwright-full",
    program: "pnpm",
    arguments: [
      "--filter",
      "@clockwork/web",
      "exec",
      "playwright",
      "test",
      "--retries=0",
      "--workers=100%",
      "--update-snapshots=none",
      `--output=${join(outputDirectory, "playwright-results")}`,
    ],
    dependsOn: ["playwright-install"],
  },
  {
    id: "demo-reset",
    program: "pnpm",
    arguments: ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
    environment: { CLOCKWORK_ENV: "demo", NODE_ENV: "test" },
    dependsOn: installed,
    validateOutput: (output) => {
      try {
        const value = JSON.parse(output.trim().split("\n").at(-1));
        return (
          value.target === "demo" &&
          value.seedVersion === "experience-2026-07-31.1" &&
          value.resetAt === "2026-07-31T16:00:00Z" &&
          [
            "accounts",
            "agreements",
            "quotes",
            "orders",
            "pocs",
            "invoices",
            "queueItems",
          ].every(
            (key) =>
              Number.isInteger(value.counts?.[key]) && value.counts[key] > 0,
          )
        );
      } catch {
        return false;
      }
    },
  },
  {
    id: "demo-production-refusal",
    program: "pnpm",
    arguments: ["exec", "tsx", "packages/testing/src/demo/reset-command.ts"],
    environment: { CLOCKWORK_ENV: "production", NODE_ENV: "production" },
    expected: "nonzero",
    expectedExitCode: 1,
    expectedOutput:
      "Demo reset refused: NODE_ENV identifies a production environment",
    validateOutput: (output) =>
      output.trim() ===
      "Demo reset refused: NODE_ENV identifies a production environment",
    dependsOn: installed,
  },
];

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=,@+-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function extracts(output) {
  const patterns = [
    /^.*Test Files\s+[^\n]+$/gm,
    /^.*Tests\s+[^\n]+$/gm,
    /^.*Files=\d+, Tests=\d+[^\n]*$/gm,
    /^.*\b\d+ passed(?: \([^\n]+\))?.*$/gm,
    /^.*\b\d+ failed(?: \([^\n]+\))?.*$/gm,
    /^.*\b\d+ skipped(?: \([^\n]+\))?.*$/gm,
    /^.*Tasks:\s+[^\n]+$/gm,
    /^.*Time:\s+[^\n]+$/gm,
    /^.*no caches are enabled.*$/gim,
  ];
  return patterns.flatMap((pattern) =>
    [...output.matchAll(pattern)].map((item) => item[0]),
  );
}

const revision = initialRevision;
const tree = initialTree;
const startedAt = new Date().toISOString();
const results = [];
const resultsById = new Map();
let fatalFailure = null;

function blockedResult(step, blockedBy) {
  return {
    id: step.id,
    command: [step.program, ...step.arguments].map(shellQuote).join(" "),
    environmentOverrides: step.environment ?? {},
    expected: step.expected ?? "zero",
    exitCode: null,
    signal: null,
    spawnError: null,
    timedOut: false,
    passedExpectation: false,
    blockedBy,
    durationSeconds: 0,
    log: null,
    logBytes: 0,
    logSha256: null,
    extractedCounts: [],
    tail: [],
  };
}

function runStep(step) {
  const command = [step.program, ...step.arguments].map(shellQuote).join(" ");
  const start = process.hrtime.bigint();
  const result = spawnSync(step.program, step.arguments, {
    cwd: root,
    encoding: "utf8",
    env: { ...baseEnvironment, ...step.environment },
    maxBuffer: 128 * 1024 * 1024,
    timeout: timeoutMilliseconds,
  });
  const durationSeconds =
    Number(process.hrtime.bigint() - start) / 1_000_000_000;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const logPath = join(logDirectory, `${step.id}.log`);
  writeFileSync(logPath, output);
  const exitCode = result.status ?? 128;
  const passedExpectation =
    !result.error &&
    (step.expectedExitCode !== undefined
      ? exitCode === step.expectedExitCode
      : step.expected === "nonzero"
        ? exitCode !== 0
        : exitCode === 0) &&
    result.signal === null &&
    (!step.expectedOutput || output.includes(step.expectedOutput)) &&
    (!step.validateOutput || step.validateOutput(output));
  return {
    id: step.id,
    command,
    environmentOverrides: step.environment ?? {},
    expected: step.expected ?? "zero",
    exitCode,
    signal: result.signal,
    spawnError: result.error?.message ?? null,
    timedOut: result.error?.code === "ETIMEDOUT",
    passedExpectation,
    blockedBy: [],
    durationSeconds: Number(durationSeconds.toFixed(3)),
    log: relative(outputDirectory, logPath),
    logBytes: Buffer.byteLength(output),
    logSha256: sha256(output),
    extractedCounts: extracts(output),
    tail: output.trim().split("\n").slice(-12),
  };
}

const cleanupStep = {
  id: "db-stop-after",
  program: "pnpm",
  arguments: ["exec", "supabase", "stop", "--no-backup"],
};
let databaseOwned = false;
let cleanupCompleted = false;

function stopOwnedDatabaseOnSignal(signal) {
  if (databaseOwned && !cleanupCompleted) {
    const result = spawnSync(cleanupStep.program, cleanupStep.arguments, {
      cwd: root,
      encoding: "utf8",
      env: baseEnvironment,
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMilliseconds,
    });
    writeFileSync(
      join(logDirectory, `emergency-cleanup-${signal}.log`),
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
    cleanupCompleted = true;
  }
  process.exit(128 + (signal === "SIGINT" ? 2 : 15));
}

process.once("SIGINT", () => stopOwnedDatabaseOnSignal("SIGINT"));
process.once("SIGTERM", () => stopOwnedDatabaseOnSignal("SIGTERM"));

let cleanupResult;
try {
  for (const step of steps) {
    const failedDependencies = (step.dependsOn ?? []).filter(
      (dependency) => !resultsById.get(dependency)?.passedExpectation,
    );
    let result;
    if ((fatalFailure || failedDependencies.length > 0) && !step.alwaysRun) {
      result = blockedResult(step, [
        ...(fatalFailure ? [`fatal:${fatalFailure}`] : []),
        ...failedDependencies,
      ]);
    } else {
      if (
        step.id === "db-start" &&
        resultsById.get("db-stop-before")?.passedExpectation
      )
        databaseOwned = true;
      result = runStep(step);
    }
    results.push(result);
    resultsById.set(step.id, result);
    if (!result.passedExpectation && step.fatalOnFailure)
      fatalFailure = step.id;
    console.log(
      `${result.passedExpectation ? "PASS" : result.exitCode === null ? "BLOCKED" : "FAIL"} ${step.id} ${result.durationSeconds.toFixed(3)}s`,
    );
  }
} finally {
  cleanupResult = databaseOwned
    ? runStep(cleanupStep)
    : blockedResult(cleanupStep, ["database-not-started-by-runner"]);
  cleanupCompleted = true;
  results.push(cleanupResult);
  resultsById.set(cleanupResult.id, cleanupResult);
  console.log(
    `${cleanupResult.passedExpectation ? "PASS" : cleanupResult.exitCode === null ? "BLOCKED" : "FAIL"} db-stop-after ${cleanupResult.durationSeconds.toFixed(3)}s`,
  );
}

const finalRevision = checked("git", ["rev-parse", "HEAD"]);
const finalTree = checked("git", ["rev-parse", "HEAD^{tree}"]);
const finalStatus = checked("git", [
  "status",
  "--porcelain=v1",
  "--untracked-files=all",
]);
const finalIgnoredArtifacts = gitPathList([
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
]);
const ignoredEvidencePath = join(outputDirectory, "ignored-artifacts.txt");
writeFileSync(
  ignoredEvidencePath,
  finalIgnoredArtifacts.length > 0
    ? `${finalIgnoredArtifacts.join("\n")}\n`
    : "",
);
const repositoryUnchanged =
  finalRevision === initialRevision &&
  finalTree === initialTree &&
  finalStatus === "";
const unchangedResult = {
  id: "repository-unchanged",
  command:
    "git rev-parse HEAD && git rev-parse HEAD^{tree} && git status --porcelain=v1 --untracked-files=all",
  environmentOverrides: {},
  expected: "same-clean-revision-and-tree",
  exitCode: repositoryUnchanged ? 0 : 1,
  signal: null,
  spawnError: null,
  timedOut: false,
  passedExpectation: repositoryUnchanged,
  blockedBy: [],
  durationSeconds: 0,
  log: null,
  logBytes: Buffer.byteLength(finalStatus),
  logSha256: sha256(finalStatus),
  extractedCounts: [],
  tail: finalStatus ? finalStatus.split("\n").slice(-12) : [],
};
results.push(unchangedResult);

function listArtifactFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listArtifactFiles(path) : [path];
    })
    .sort();
}

const artifactFiles = [
  ...listArtifactFiles(logDirectory),
  ...listArtifactFiles(join(outputDirectory, "playwright-results")),
  ignoredEvidencePath,
];
const artifactManifest = artifactFiles.map((path) => {
  const value = readFileSync(path);
  return {
    path: relative(outputDirectory, path),
    bytes: statSync(path).size,
    sha256: sha256(value),
  };
});
const artifactManifestPath = join(outputDirectory, "artifact-manifest.json");
writeFileSync(
  artifactManifestPath,
  `${JSON.stringify(artifactManifest, null, 2)}\n`,
);

const finishedAt = new Date().toISOString();
const safeBaseEnvironment = Object.fromEntries(
  Object.entries(baseEnvironment)
    .filter(([key]) => !(key in inheritedEnvironment))
    .map(([key, value]) => [
      key,
      key === "AUTHORIZATION_CONTEXT_SECRET"
        ? `<redacted:sha256:${sha256(value)}>`
        : value,
    ]),
);
const summary = {
  schemaVersion: 1,
  revision,
  tree,
  startedAt,
  finishedAt,
  timeoutMilliseconds,
  executablePaths: {
    node: checked("which", ["node"]),
    pnpm: checked("which", ["pnpm"]),
    git: checked("which", ["git"]),
  },
  runtimePath: exactPath,
  cachePolicy: {
    pnpmStore: join(cacheDirectory, "pnpm-store"),
    xdgCache: join(cacheDirectory, "xdg"),
    playwrightBrowsers: join(cacheDirectory, "playwright-browsers"),
    turbo: "--cache=local:,remote: (no local or remote cache)",
  },
  baseEnvironment: safeBaseEnvironment,
  preflight: {
    expectedRevision,
    initialStatus: "clean",
    initialIgnoredArtifacts: [],
    prohibitedEnvironmentFiles: [],
    gitCommonDirectory,
    supabaseProjectId: "clockwork-commerce",
  },
  finalIgnoredArtifacts: {
    count: finalIgnoredArtifacts.length,
    sha256: sha256(readFileSync(ignoredEvidencePath)),
    path: relative(outputDirectory, ignoredEvidencePath),
  },
  artifactManifest: {
    count: artifactManifest.length,
    path: relative(outputDirectory, artifactManifestPath),
    sha256: sha256(readFileSync(artifactManifestPath)),
  },
  results,
  totals: {
    plannedSteps: results.length,
    attemptedCommands: results.filter(({ exitCode }) => exitCode !== null)
      .length,
    passedExpectations: results.filter(
      ({ passedExpectation }) => passedExpectation,
    ).length,
    failedExpectations: results.filter(
      ({ passedExpectation }) => !passedExpectation,
    ).length,
    blocked: results.filter(({ exitCode }) => exitCode === null).length,
    durationSeconds: Number(
      results
        .reduce((total, result) => total + result.durationSeconds, 0)
        .toFixed(3),
    ),
  },
};
const summaryPath = join(outputDirectory, "qualification-summary.json");
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
const summaryArtifact = readFileSync(summaryPath);
console.log(
  JSON.stringify({
    summary: summaryPath,
    sha256: sha256(summaryArtifact),
    ...summary.totals,
  }),
);
if (summary.totals.failedExpectations > 0) process.exitCode = 1;
