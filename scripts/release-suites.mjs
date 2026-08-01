import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const FIXED_CLOCK = "2026-07-31T16:00:00.000Z";
const DEFAULT_BUDGET_MS = 45 * 60 * 1000;
const CI_BUDGET_MS = 30 * 60 * 1000;

const suites = {
  static: [
    ["pnpm", "turbo", "run", "typecheck"],
    ["pnpm", "format:check"],
    ["pnpm", "lint"],
    ["pnpm", "boundaries"],
    ["pnpm", "scan:secrets"],
    ["pnpm", "audit:dependencies"],
    ["node", "scripts/check-generated-dry-run.mjs"],
    ["pnpm", "check:traceability"],
  ],
  unit: [["pnpm", "test:unit"]],
  integration: [
    ["pnpm", "--filter", "@clockwork/db", "check"],
    ["pnpm", "db:test"],
    ["pnpm", "test:integration"],
  ],
  build: [["pnpm", "verify:build"]],
  ui: [
    ["pnpm", "test:storybook"],
    ["pnpm", "test:e2e"],
  ],
  proof: [
    ["pnpm", "--filter", "@clockwork/web", "build"],
    ["pnpm", "--filter", "@clockwork/web", "test:e2e:proof"],
  ],
};

const DATABASE_SUITES = new Set(["integration", "proof"]);
const ORCHESTRATION_ARTIFACTS = new Set([
  "contract.json",
  "result.json",
  "summary.json",
]);

function option(name, fallback) {
  const prefix = `--${name}=`;
  return (
    process.argv
      .find((value) => value.startsWith(prefix))
      ?.slice(prefix.length) ?? fallback
  );
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function safeToken(value, label) {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(value))
    throw new Error(
      `${label} must contain only letters, numbers, underscores, and hyphens.`,
    );
  return value;
}

function sourceManifestFingerprint() {
  const manifest = execFileSync(
    "git",
    [
      "ls-files",
      "-s",
      "--",
      "apps",
      "packages",
      "scripts",
      "supabase",
      ".github",
      "package.json",
      "pnpm-lock.yaml",
      "turbo.json",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  return createHash("sha256").update(manifest).digest("hex");
}

function fingerprint(suite, commands, sourceFingerprint) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        suite,
        commands,
        fixedClock: FIXED_CLOCK,
        assertionSemantics: "release-v1",
        coverageSemantics: "unchanged",
        failureSemantics: "first-non-infrastructure-failure",
        sourceFingerprint,
      }),
    )
    .digest("hex");
}

function diagnosedInfrastructureFailure(output, category) {
  const signatures = {
    "port-allocation": /EADDRINUSE/i,
    "browser-install": /browser (?:download|executable).*(?:failed|missing)/i,
    "container-runtime": /docker daemon (?:is )?unavailable/i,
    "runner-network": /temporary name resolution failure/i,
  };
  return signatures[category]?.test(output) ?? false;
}

async function listFiles(directory, base = directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const resolved = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await listFiles(resolved, base)));
      else if (entry.isFile()) files.push(path.relative(base, resolved));
    }
    return files.sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function digestFiles(directory, files) {
  const entries = [];
  for (const relative of files) {
    const resolved = path.join(directory, relative);
    const contents = await readFile(resolved);
    entries.push({
      path: relative.replaceAll(path.sep, "/"),
      bytes: (await stat(resolved)).size,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  }
  return {
    files: entries,
    fingerprint: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
  };
}

async function collectCoverageInventory(workspace) {
  const roots = ["apps", "packages"];
  const coverageFiles = [];
  for (const root of roots) {
    const firstLevel = path.join(workspace, root);
    for (const owner of await readdir(firstLevel, { withFileTypes: true })) {
      if (!owner.isDirectory()) continue;
      const coverage = path.join(firstLevel, owner.name, "coverage");
      for (const file of await listFiles(coverage)) {
        coverageFiles.push(
          path
            .join(root, owner.name, "coverage", file)
            .replaceAll(path.sep, "/"),
        );
      }
    }
  }
  return digestFiles(workspace, coverageFiles.sort());
}

const VOLATILE_REPORT_KEYS = new Set([
  "duration",
  "startTime",
  "endTime",
  "workerIndex",
  "parallelIndex",
]);

function normalizeReportValue(value, roots, key = "") {
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
  let normalized = value;
  for (const [root, token] of roots)
    normalized = normalized.replaceAll(root, token);
  return normalized.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g,
    "<runtime-timestamp>",
  );
}

async function artifactEntry(resolved, label, roots, normalizeJson = false) {
  const contents = await readFile(resolved);
  let semanticContents = contents;
  const textArtifact = /\.(?:css|html|js|json|md|mjs|svg|txt|xml)$/i.test(
    label,
  );
  if (normalizeJson) {
    const parsed = JSON.parse(contents.toString("utf8"));
    semanticContents = Buffer.from(
      JSON.stringify(normalizeReportValue(parsed, roots)),
      "utf8",
    );
  } else if (textArtifact) {
    let text = contents.toString("utf8");
    for (const [root, token] of roots) text = text.replaceAll(root, token);
    semanticContents = Buffer.from(text, "utf8");
  }
  return {
    path: label,
    bytes: contents.byteLength,
    semanticSha256: createHash("sha256").update(semanticContents).digest("hex"),
    normalization: normalizeJson
      ? "report timing, worker indexes, timestamps, and absolute roots"
      : textArtifact
        ? "absolute roots only"
        : "none; exact binary content",
  };
}

async function collectArtifactInventory(
  suiteDirectory,
  workspace,
  nextDistDirectory,
) {
  const files = (await listFiles(suiteDirectory)).filter((file) => {
    const basename = path.basename(file);
    return (
      !ORCHESTRATION_ARTIFACTS.has(basename) &&
      !/^step-\d+(?:-retry)?\.log$/.test(basename) &&
      !file.startsWith(`storage${path.sep}`) &&
      !file.startsWith("storage/")
    );
  });
  const roots = [
    [suiteDirectory, "<artifact-root>"],
    [workspace, "<workspace>"],
  ];
  const entries = [];
  for (const file of files) {
    entries.push(
      await artifactEntry(
        path.join(suiteDirectory, file),
        `runtime/${file.replaceAll(path.sep, "/")}`,
        roots,
        path.basename(file) === "playwright.json",
      ),
    );
  }
  const buildCandidates = [
    path.join("apps", "web", nextDistDirectory, "build-manifest.json"),
    path.join("apps", "web", nextDistDirectory, "routes-manifest.json"),
    path.join(
      "apps",
      "web",
      nextDistDirectory,
      "server",
      "app-paths-manifest.json",
    ),
    path.join("apps", "web", "storybook-static", "index.html"),
  ];
  for (const relative of buildCandidates) {
    const resolved = path.join(workspace, relative);
    try {
      if (!(await stat(resolved)).isFile()) continue;
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    entries.push(
      await artifactEntry(
        resolved,
        `build/${relative
          .replace(nextDistDirectory, "<next-dist>")
          .replaceAll(path.sep, "/")}`,
        [...roots, [nextDistDirectory, "<next-dist>"]],
      ),
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: entries,
    allowedNondeterminism: [
      "Playwright report wall-clock timings and worker indexes",
      "absolute disposable workspace and artifact roots",
      "runtime ISO timestamps in Playwright JSON reports",
    ],
    fingerprint: createHash("sha256")
      .update(JSON.stringify(entries))
      .digest("hex"),
  };
}

function isolatedSupabaseConfig(source, { appPort, portBase, projectId }) {
  return source
    .replace(/^project_id = .*$/m, `project_id = "${projectId}"`)
    .replace(/(\[api\][\s\S]*?\nport = )\d+/, `$1${portBase + 1}`)
    .replace(/(\[db\][\s\S]*?\nport = )\d+/, `$1${portBase + 2}`)
    .replace(/(\[db\][\s\S]*?\nshadow_port = )\d+/, `$1${portBase}`)
    .replace(/(\[db\.pooler\][\s\S]*?\nport = )\d+/, `$1${portBase + 9}`)
    .replace(/(\[studio\][\s\S]*?\nport = )\d+/, `$1${portBase + 3}`)
    .replace(/(\[local_smtp\][\s\S]*?\nport = )\d+/, `$1${portBase + 4}`)
    .replace(
      /(\[auth\][\s\S]*?\nsite_url = ).*$/m,
      `$1"http://localhost:${appPort}"`,
    )
    .replace(
      /(\[auth\][\s\S]*?\nadditional_redirect_urls = ).*$/m,
      `$1["http://localhost:${appPort}/auth/callback"]`,
    );
}

async function prepareDatabaseProject(name, index, context, environment) {
  if (!context.manageDatabases || !DATABASE_SUITES.has(name)) return undefined;
  const workspace = context.workspaces.get(name);
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), `clockwork-${context.runId}-${name}-database-`),
  );
  await cp(
    path.join(workspace, "supabase"),
    path.join(projectRoot, "supabase"),
    {
      recursive: true,
    },
  );
  await mkdir(path.join(projectRoot, "supabase", ".temp"), {
    recursive: true,
  });
  // Supabase mounts this path as a file. Docker turns a missing bind source
  // into a directory, which makes pgsodium fail before PostgreSQL can become
  // healthy. Create the per-shard secret before `supabase start` so the mount
  // type and credential are both deterministic for the lifetime of the shard.
  await writeFile(
    path.join(projectRoot, "supabase", ".temp", "pgsodium_root.key"),
    randomBytes(32).toString("hex"),
    { encoding: "utf8", mode: 0o600 },
  );
  const projectId = `clockwork-${context.runId}-${name}`;
  const databasePortBase = context.databasePortBase + index * 20;
  const configPath = path.join(projectRoot, "supabase", "config.toml");
  await writeFile(
    configPath,
    isolatedSupabaseConfig(await readFile(configPath, "utf8"), {
      appPort: Number(environment.PORT),
      portBase: databasePortBase,
      projectId,
    }),
    "utf8",
  );
  const databaseUrl = `postgresql://postgres:postgres@127.0.0.1:${databasePortBase + 2}/postgres`;
  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    CLOCKWORK_SERVICE_DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: databaseUrl,
  });
  return { databasePortBase, databaseUrl, projectId, projectRoot };
}

function commandForDatabaseProject(command, databaseProject) {
  if (
    databaseProject &&
    command.length === 2 &&
    command[0] === "pnpm" &&
    command[1] === "db:test"
  ) {
    return [
      "pnpm",
      "exec",
      "supabase",
      "test",
      "db",
      "--workdir",
      databaseProject.projectRoot,
    ];
  }
  return command;
}

async function runCommand(command, args, environment, logPath, prefix, cwd) {
  let output = "";
  const startedAt = Date.now();
  const child = spawn(command, args, {
    cwd,
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const consume = (chunk, stream) => {
    const text = chunk.toString();
    output += text;
    for (const line of text.split(/\r?\n/)) {
      if (line) stream.write(`[${prefix}] ${line}\n`);
    }
  };
  child.stdout.on("data", (chunk) => consume(chunk, process.stdout));
  child.stderr.on("data", (chunk) => consume(chunk, process.stderr));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  await writeFile(logPath, output, "utf8");
  return { exitCode, durationMs: Date.now() - startedAt, output };
}

async function runSuite(name, index, context) {
  const suiteStartedAt = Date.now();
  const suiteDirectory = path.join(context.artifactRoot, name);
  const storageRoot = path.join(suiteDirectory, "storage");
  await mkdir(storageRoot, { recursive: true });
  const port = context.portBase + index;
  const providerFakePort = context.providerFakePortBase + index;
  const namespace = `${context.runId}_${name}`.replaceAll("-", "_");
  const environment = {
    ...process.env,
    PORT: String(port),
    CLOCKWORK_TEST_PORT: String(port),
    DATABASE_SCHEMA: `release_${namespace}`,
    CLOCKWORK_QUEUE_NAMESPACE: `${namespace}_queue`,
    CLOCKWORK_FIXTURE_NAMESPACE: `${namespace}_fixture`,
    CLOCKWORK_TEST_CLOCK: FIXED_CLOCK,
    CLOCKWORK_STORAGE_ROOT: storageRoot,
    CLOCKWORK_ARTIFACT_DIR: suiteDirectory,
    PLAYWRIGHT_OUTPUT_DIR: path.join(suiteDirectory, "playwright"),
    // Next's typed-route project is anchored to .next. Static runs in its own
    // disposable workspace (or its own CI runner), so keep that canonical
    // location while build/UI/proof retain explicit per-shard output roots.
    CLOCKWORK_NEXT_DIST_DIR:
      name === "static" ? ".next" : `.next-release-${namespace}`,
    CLOCKWORK_RELEASE_MODE: context.mode,
    CLOCKWORK_RELEASE_SHARD: name,
    CLOCKWORK_RELEASE_RUN_ID: context.runId,
    ...(name === "ui"
      ? {
          CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
          NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "test",
        }
      : {}),
    ...(name === "proof"
      ? {
          NODE_ENV: "production",
          CLOCKWORK_ENV: "production",
          NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV: "production",
          CLOCKWORK_RELEASE_PROOF: "1",
          CLOCKWORK_PROOF_AUTH_SECRET: context.proofSecret,
          APP_ORIGIN: `http://localhost:${port}`,
          NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
          CLOCKWORK_CANONICAL_ORIGIN: `http://localhost:${port}`,
          CLOCKWORK_EXPERIENCE_ADAPTER: "database",
          CLOCKWORK_PROVIDER_FAKE_PORT: String(providerFakePort),
        }
      : {}),
    ...(context.debug
      ? {
          DEBUG: "clockwork:*",
          PWDEBUG: "0",
          CLOCKWORK_RELEASE_SERIAL: "1",
        }
      : {}),
  };
  const databaseProject = await prepareDatabaseProject(
    name,
    index,
    context,
    environment,
  );
  const contract = {
    suite: name,
    runId: context.runId,
    mode: context.mode,
    isolation: {
      port,
      providerFakePort: name === "proof" ? providerFakePort : null,
      databaseSchema: environment.DATABASE_SCHEMA,
      queueNamespace: environment.CLOCKWORK_QUEUE_NAMESPACE,
      fixtureNamespace: environment.CLOCKWORK_FIXTURE_NAMESPACE,
      clock: FIXED_CLOCK,
      storageRoot,
      artifactDirectory: suiteDirectory,
      databaseService: databaseProject
        ? {
            kind: "isolated-local-supabase",
            projectId: databaseProject.projectId,
            postgresPort: databaseProject.databasePortBase + 2,
          }
        : {
            kind: context.planOnly
              ? "planned-isolated-supabase"
              : "isolated-ci-runner",
            projectId: `${context.runId}-${name}`,
          },
    },
    commands: suites[name],
    assertionFingerprint: fingerprint(
      name,
      suites[name],
      context.sourceFingerprint,
    ),
    sourceManifestFingerprint: context.sourceFingerprint,
    retryPolicy:
      "one retry only when CLOCKWORK_RELEASE_INFRA_RETRY_CATEGORY names a diagnosed category and output matches its narrow precondition",
  };
  await writeFile(
    path.join(suiteDirectory, "contract.json"),
    `${JSON.stringify(contract, null, 2)}\n`,
    "utf8",
  );

  if (context.planOnly)
    return { ...contract, status: "planned", durationMs: 0, steps: [] };

  const steps = [];
  let status = "passed";
  let stepNumber = 0;
  const execute = async (rawCommand, phase, allowRetry = true) => {
    stepNumber += 1;
    const [command, ...args] = rawCommand;
    const logPath = path.join(suiteDirectory, `step-${stepNumber}.log`);
    let result = await runCommand(
      command,
      args,
      environment,
      logPath,
      `${name}:${phase}`,
      context.workspaces.get(name),
    );
    let retries = 0;
    const retryCategory = process.env.CLOCKWORK_RELEASE_INFRA_RETRY_CATEGORY;
    if (
      allowRetry &&
      result.exitCode !== 0 &&
      retryCategory &&
      diagnosedInfrastructureFailure(result.output, retryCategory)
    ) {
      retries = 1;
      result = await runCommand(
        command,
        args,
        environment,
        path.join(suiteDirectory, `step-${stepNumber}-retry.log`),
        `${name}:${phase}:infra-retry`,
        context.workspaces.get(name),
      );
    }
    const printableCommand = [command, ...args].map((part) =>
      databaseProject
        ? part.replace(
            databaseProject.projectRoot,
            "<isolated-database-project>",
          )
        : part,
    );
    steps.push({
      phase,
      command: printableCommand,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      retries,
      log: path.relative(process.cwd(), logPath),
    });
    if (result.exitCode !== 0) status = "failed";
    return result.exitCode === 0;
  };

  try {
    if (databaseProject) {
      const started = await execute(
        [
          "pnpm",
          "exec",
          "supabase",
          "start",
          "--workdir",
          databaseProject.projectRoot,
          "--exclude",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        ],
        "database-start",
      );
      if (started) {
        await execute(
          [
            "pnpm",
            "exec",
            "supabase",
            "db",
            "reset",
            "--local",
            "--workdir",
            databaseProject.projectRoot,
          ],
          "database-reset",
        );
      }
    }

    if (status === "passed") {
      for (const rawCommand of suites[name]) {
        const passed = await execute(
          commandForDatabaseProject(rawCommand, databaseProject),
          "assertion",
        );
        if (!passed) break;
      }
    }
  } finally {
    if (databaseProject) {
      await execute(
        [
          "pnpm",
          "exec",
          "supabase",
          "stop",
          "--workdir",
          databaseProject.projectRoot,
          "--no-backup",
        ],
        "database-stop",
        false,
      );
      await rm(databaseProject.projectRoot, { recursive: true, force: true });
    }
  }
  const [artifactInventory, coverageInventory] = await Promise.all([
    collectArtifactInventory(
      suiteDirectory,
      context.workspaces.get(name),
      environment.CLOCKWORK_NEXT_DIST_DIR,
    ),
    collectCoverageInventory(context.workspaces.get(name)),
  ]);
  const result = {
    ...contract,
    status,
    durationMs: Date.now() - suiteStartedAt,
    steps,
    artifactInventory,
    coverageInventory,
    trackedWorkspaceClean:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: context.workspaces.get(name),
        encoding: "utf8",
      }).trim() === "",
  };
  if (!result.trackedWorkspaceClean) result.status = "failed";
  await writeFile(
    path.join(suiteDirectory, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  return result;
}

async function main() {
  const inheritedStartedAt = Number.parseInt(
    process.env.CLOCKWORK_RELEASE_STARTED_AT ?? "",
    10,
  );
  const overallStartedAt =
    Number.isSafeInteger(inheritedStartedAt) &&
    inheritedStartedAt > 0 &&
    inheritedStartedAt <= Date.now()
      ? inheritedStartedAt
      : Date.now();
  const mode = option("mode", "parallel");
  if (mode !== "parallel" && mode !== "serial")
    throw new Error("--mode must be parallel or serial.");
  const runId = safeToken(
    option(
      "run-id",
      process.env.CLOCKWORK_RELEASE_RUN_ID ?? `local-${Date.now()}`,
    ),
    "run id",
  );
  const selected = option("shard", "all");
  const names = selected === "all" ? Object.keys(suites) : [selected];
  for (const name of names) {
    if (!suites[name]) throw new Error(`Unknown release shard: ${name}`);
  }
  const portBase = Number.parseInt(
    option("port-base", process.env.CLOCKWORK_RELEASE_PORT_BASE ?? "32000"),
    10,
  );
  if (
    !Number.isInteger(portBase) ||
    portBase < 1024 ||
    portBase > 65000 - names.length
  )
    throw new Error(
      "Release port base is outside the safe unprivileged range.",
    );
  const databasePortBase = Number.parseInt(
    option(
      "database-port-base",
      process.env.CLOCKWORK_RELEASE_DATABASE_PORT_BASE ?? "56000",
    ),
    10,
  );
  if (
    !Number.isInteger(databasePortBase) ||
    databasePortBase < 1024 ||
    databasePortBase + names.length * 20 + 10 > 65_535
  )
    throw new Error(
      "Release database port base is outside the safe unprivileged range.",
    );
  const providerFakePortBase = Number.parseInt(
    option(
      "provider-fake-port-base",
      process.env.CLOCKWORK_RELEASE_PROVIDER_FAKE_PORT_BASE ?? "34000",
    ),
    10,
  );
  if (
    !Number.isInteger(providerFakePortBase) ||
    providerFakePortBase < 1024 ||
    providerFakePortBase + names.length > 65_535 ||
    names.some((_, index) => providerFakePortBase + index === portBase + index)
  )
    throw new Error(
      "Release provider-fake port base is outside the safe range or overlaps an application port.",
    );
  const artifactRoot = path.resolve(
    option(
      "artifacts",
      process.env.CLOCKWORK_RELEASE_ARTIFACT_ROOT ??
        `.artifacts/release/${runId}/${mode}`,
    ),
  );
  await mkdir(artifactRoot, { recursive: true });
  const useSharedWorkspace =
    process.env.CLOCKWORK_RELEASE_SHARED_WORKSPACE === "1";
  const workspaces = new Map();
  const cleanupFailures = [];
  let executionError;
  try {
    if (hasFlag("plan") || useSharedWorkspace) {
      for (const name of names) workspaces.set(name, process.cwd());
    } else {
      const dirty = execFileSync("git", ["status", "--porcelain"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim();
      if (dirty)
        throw new Error(
          "Local release execution requires a clean committed tree so isolated worktrees test the exact release candidate.",
        );
      for (const name of names) {
        const temporaryRoot = await mkdtemp(
          path.join(os.tmpdir(), `clockwork-${runId}-${name}-`),
        );
        const workspace = path.join(temporaryRoot, "workspace");
        workspaces.set(name, workspace);
        execFileSync(
          "git",
          ["worktree", "add", "--detach", workspace, "HEAD"],
          {
            cwd: process.cwd(),
            stdio: "inherit",
          },
        );
      }
      const setupDirectory = path.join(artifactRoot, "setup");
      await mkdir(setupDirectory, { recursive: true });
      const installations = await Promise.all(
        [...workspaces].map(([name, workspace]) =>
          runCommand(
            "pnpm",
            ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
            process.env,
            path.join(setupDirectory, `${name}-install.log`),
            `setup:${name}`,
            workspace,
          ),
        ),
      );
      if (installations.some(({ exitCode }) => exitCode !== 0))
        throw new Error("At least one isolated workspace installation failed.");
    }
    const context = {
      artifactRoot,
      databasePortBase,
      debug: hasFlag("debug"),
      manageDatabases: !hasFlag("plan") && !useSharedWorkspace,
      mode,
      planOnly: hasFlag("plan"),
      portBase,
      runId,
      proofSecret: randomBytes(32).toString("base64url"),
      providerFakePortBase,
      sourceFingerprint: sourceManifestFingerprint(),
      workspaces,
    };
    const results = [];
    if (mode === "serial") {
      for (const [index, name] of names.entries())
        results.push(await runSuite(name, index, context));
    } else {
      results.push(
        ...(await Promise.all(
          names.map((name, index) => runSuite(name, index, context)),
        )),
      );
    }
    const durationMs = Date.now() - overallStartedAt;
    const budgetMs = Number.parseInt(
      process.env.CLOCKWORK_RELEASE_BUDGET_MS ??
        String(process.env.CI === "true" ? CI_BUDGET_MS : DEFAULT_BUDGET_MS),
      10,
    );
    const summary = {
      runId,
      mode,
      status: results.every(
        (result) => result.status === "passed" || result.status === "planned",
      )
        ? "passed"
        : "failed",
      durationMs,
      budgetMs,
      withinBudget: durationMs <= budgetMs,
      results,
    };
    const summaryPath = path.join(artifactRoot, "summary.json");
    await writeFile(
      summaryPath,
      `${JSON.stringify(summary, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`Release ${mode} summary: ${summaryPath}\n`);
    process.stdout.write(
      `Duration ${(durationMs / 1000).toFixed(1)}s / budget ${(budgetMs / 60000).toFixed(0)}m\n`,
    );
    if (summary.status !== "passed" || !summary.withinBudget)
      process.exitCode = 1;
  } catch (error) {
    executionError = error;
  } finally {
    if (!useSharedWorkspace && !hasFlag("plan")) {
      for (const workspace of workspaces.values()) {
        try {
          execFileSync("git", ["worktree", "remove", "--force", workspace], {
            cwd: process.cwd(),
            stdio: "inherit",
          });
        } catch (error) {
          cleanupFailures.push(error);
        } finally {
          await rm(path.dirname(workspace), { recursive: true, force: true });
        }
      }
      execFileSync("git", ["worktree", "prune"], {
        cwd: process.cwd(),
        stdio: "ignore",
      });
    }
  }
  if (executionError && cleanupFailures.length)
    throw new AggregateError(
      [executionError, ...cleanupFailures],
      "Release execution and disposable-worktree cleanup both failed.",
    );
  if (executionError) throw executionError;
  if (cleanupFailures.length)
    throw new AggregateError(
      cleanupFailures,
      "One or more disposable worktrees could not be deregistered.",
    );
}

await main();
