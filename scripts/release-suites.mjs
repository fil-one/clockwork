import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  lstat,
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
import { clearTimeout, setTimeout } from "node:timers";

import {
  expectedReleaseCommands as commandsForSuite,
  isolatedReleaseGitEnvironment,
  normalizeArtifactText,
  normalizeReportValue,
  releaseDatabaseProjectId,
  releaseCacheRootIssues,
  releaseAssertionFingerprint,
  releaseLocalDatabaseEnvironmentIssues,
  releasePortAllocationIssues,
  RELEASE_FIXED_CLOCK as FIXED_CLOCK,
  RELEASE_SUITE_ASSERTIONS as suiteAssertions,
  semanticArtifactInventoryFingerprint,
  isolatedReleaseEnvironment,
} from "./release-artifacts.mjs";

const DEFAULT_BUDGET_MS = 45 * 60 * 1000;
const CI_BUDGET_MS = 30 * 60 * 1000;
const CLEANUP_TIMEOUT_MS = 2 * 60 * 1000;
const EXACT_NODE_VERSION = "v24.18.1";
const EXACT_PNPM_VERSION = "10.34.5";

const DATABASE_SUITES = new Set(["integration", "proof"]);
const ORCHESTRATION_ARTIFACTS = new Set([
  "contract.json",
  "result.json",
  "summary.json",
]);

const ACTIVE_CHILDREN = new Set();
let terminationSignal = null;

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

async function assertNoSymlinkComponents(target, protectedRoot) {
  let cursor = path.resolve(target);
  const root = path.resolve(protectedRoot);
  while (true) {
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error(
          `Release cache cleanup path contains a symbolic link: ${cursor}`,
        );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (cursor === root) return;
    const parent = path.dirname(cursor);
    if (parent === cursor)
      throw new Error("Release cache cleanup path escaped the workspace.");
    cursor = parent;
  }
}

function safeToken(value, label) {
  if (!/^[A-Za-z0-9_-]{1,48}$/.test(value))
    throw new Error(
      `${label} must contain only letters, numbers, underscores, and hyphens.`,
    );
  return value;
}

function sourceIdentity(cwd = process.cwd(), environment = process.env) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
    env: environment,
  }).trim();
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
    cwd,
    encoding: "utf8",
    env: environment,
  }).trim();
  const manifest = execFileSync("git", ["ls-files", "-s", "-z"], {
    cwd,
    env: environment,
  });
  return {
    revision,
    tree,
    trackedSourceFingerprint: createHash("sha256")
      .update(manifest)
      .digest("hex"),
  };
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

async function databaseInputInventory(workspace) {
  const collect = async (directory) => {
    const files = (await listFiles(path.join(workspace, directory)))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => path.join(directory, file));
    const inventory = await digestFiles(workspace, files);
    return {
      count: inventory.files.length,
      files: inventory.files,
      fingerprint: inventory.fingerprint,
    };
  };
  const [migrations, pgTapTests] = await Promise.all([
    collect(path.join("supabase", "migrations")),
    collect(path.join("supabase", "tests")),
  ]);
  if (
    migrations.count === 0 ||
    pgTapTests.count === 0 ||
    migrations.count !== migrations.files.length ||
    pgTapTests.count !== pgTapTests.files.length
  )
    throw new Error(
      "Release database qualification requires migration and pgTAP inputs.",
    );
  return { migrations, pgTapTests };
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
    semanticContents = Buffer.from(
      normalizeArtifactText(contents.toString("utf8"), roots),
      "utf8",
    );
  }
  return {
    path: label,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
    semanticSha256: createHash("sha256").update(semanticContents).digest("hex"),
    normalization: normalizeJson
      ? "JSON timing, worker indexes, timestamps, isolated origins, Next build IDs, and absolute roots"
      : textArtifact
        ? "absolute roots, isolated origins, and Next build IDs"
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
        path.extname(file) === ".json",
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
        path.extname(relative) === ".json",
      ),
    );
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files: entries,
    allowedNondeterminism: [
      "Playwright report wall-clock timings and worker indexes",
      "absolute disposable workspace and artifact roots",
      "runtime ISO timestamps in JSON reports",
      "isolated localhost origins",
      "Next production build IDs in low-priority manifest filenames",
    ],
    fingerprint: semanticArtifactInventoryFingerprint(entries),
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
  const databaseScratchRoot = path.join(context.artifactRoot, ".database");
  await mkdir(databaseScratchRoot, { recursive: true });
  const projectRoot = await mkdtemp(path.join(databaseScratchRoot, `${name}-`));
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
  const databasePortBase = context.databasePortBase + index * 20;
  const projectId = releaseDatabaseProjectId({
    revision: context.sourceIdentity.revision,
    runId: context.runId,
    suite: name,
    portBase: databasePortBase,
  });
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
    command[0] === "pnpm" &&
    command[1] === "exec" &&
    command[2] === "supabase" &&
    command[3] === "db" &&
    command[4] === "lint"
  )
    return [...command, "--workdir", databaseProject.projectRoot];
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

function signalChild(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid)
      process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    terminationSignal ??= signal;
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    for (const child of ACTIVE_CHILDREN) signalChild(child, "SIGTERM");
  });

async function runCommand(
  command,
  args,
  environment,
  logPath,
  prefix,
  cwd,
  deadlineAt,
  allowDuringTermination = false,
) {
  let output = "";
  const startedAt = Date.now();
  const remainingMs = deadlineAt - startedAt;
  if (remainingMs <= 0 || (terminationSignal && !allowDuringTermination)) {
    output =
      terminationSignal === null
        ? "Release command was not started because the hard deadline expired.\n"
        : `Release command was not started because ${terminationSignal} requested cleanup.\n`;
    await writeFile(logPath, output, "utf8");
    return { exitCode: 124, durationMs: 0, output, timedOut: true };
  }
  const child = spawn(command, args, {
    cwd,
    env: environment,
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ACTIVE_CHILDREN.add(child);
  const consume = (chunk, stream) => {
    const text = chunk.toString();
    output += text;
    for (const line of text.split(/\r?\n/)) {
      if (line) stream.write(`[${prefix}] ${line}\n`);
    }
  };
  child.stdout.on("data", (chunk) => consume(chunk, process.stdout));
  child.stderr.on("data", (chunk) => consume(chunk, process.stderr));
  let timedOut = false;
  let forceTimer;
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    output += `\nRelease command exceeded its hard deadline after ${remainingMs}ms.\n`;
    signalChild(child, "SIGTERM");
    forceTimer = setTimeout(() => signalChild(child, "SIGKILL"), 5_000);
  }, remainingMs);
  let startFailed = false;
  const exitCode = await new Promise((resolve) => {
    child.once("error", (error) => {
      startFailed = true;
      output += `\nFailed to start command: ${error.message}\n`;
    });
    child.once("close", (code) =>
      resolve(timedOut ? 124 : startFailed ? 127 : (code ?? 1)),
    );
  });
  ACTIVE_CHILDREN.delete(child);
  clearTimeout(deadlineTimer);
  clearTimeout(forceTimer);
  await writeFile(logPath, output, "utf8");
  return {
    exitCode,
    durationMs: Date.now() - startedAt,
    output,
    timedOut,
  };
}

async function runSuite(name, index, context) {
  const suiteStartedAt = Date.now();
  const suiteDirectory = path.join(context.artifactRoot, name);
  const storageRoot = path.join(suiteDirectory, "storage");
  await mkdir(storageRoot, { recursive: true });
  const port = context.portBase + index;
  const providerFakePort = context.providerFakePortBase + index;
  const namespace = `${context.runId}_${name}`.replaceAll("-", "_");
  const commands = commandsForSuite(name, context.serial);
  const workspaceIdentity = sourceIdentity(
    context.workspaces.get(name),
    context.gitEnvironment,
  );
  if (
    JSON.stringify(workspaceIdentity) !== JSON.stringify(context.sourceIdentity)
  )
    throw new Error(`${name} workspace does not match the release candidate.`);
  const databaseInputs = DATABASE_SUITES.has(name)
    ? await databaseInputInventory(context.workspaces.get(name))
    : null;
  const environment = {
    ...context.baseEnvironment,
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
    CLOCKWORK_ENABLE_SIMULATORS: "false",
    AUTHORIZATION_CONTEXT_SECRET: context.authorizationContextSecret,
    AUTHORIZATION_CONTEXT_SECRET_ID: "release-qualification",
    NEXT_PUBLIC_CLOCKWORK_RELEASE_SHA: context.sourceIdentity.revision,
    ...(DATABASE_SUITES.has(name) && !context.manageDatabases
      ? context.localDatabaseEnvironment
      : {}),
    ...(name === "ui"
      ? {
          CLOCKWORK_EXPERIENCE_ADAPTER: "demo",
          CLOCKWORK_EVIDENCE_ADAPTER: "demo",
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
          AUTHORIZATION_CONTEXT_SECRET: context.authorizationContextSecret,
          APP_ORIGIN: `http://localhost:${port}`,
          NEXT_PUBLIC_APP_URL: `http://localhost:${port}`,
          CLOCKWORK_CANONICAL_ORIGIN: `http://localhost:${port}`,
          CLOCKWORK_EXPERIENCE_ADAPTER: "database",
          CLOCKWORK_EVIDENCE_ADAPTER: "production",
          CLOCKWORK_PROVIDER_FAKE_PORT: String(providerFakePort),
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${providerFakePort}`,
          OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
          OTEL_SERVICE_NAME: "clockwork-release-proof",
        }
      : {}),
    ...(context.serial
      ? {
          CLOCKWORK_RELEASE_SERIAL: "1",
        }
      : {}),
    ...(context.debug ? { DEBUG: "clockwork:*", PWDEBUG: "0" } : {}),
  };
  const databaseProject = await prepareDatabaseProject(
    name,
    index,
    context,
    environment,
  );
  if (name === "integration") {
    environment.CLOCKWORK_POPULATED_UPGRADE_PROJECT_ID =
      databaseProject?.projectId ?? "clockwork-commerce";
    if (databaseProject)
      environment.CLOCKWORK_POPULATED_UPGRADE_WORKDIR =
        databaseProject.projectRoot;
  }
  const contract = {
    suite: name,
    runId: context.runId,
    mode: context.mode,
    serial: context.serial,
    debug: context.debug,
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
    environmentIsolation: {
      policy: "documented-runtime-and-credential-files-v1",
      documentedRuntimeVariableCount:
        context.environmentIsolation.documentedVariableCount,
      documentedRuntimeVariables:
        context.environmentIsolation.documentedVariables,
      documentedRuntimeVariablesSha256:
        context.environmentIsolation.documentedVariablesSha256,
      scrubbedInheritedVariables:
        context.environmentIsolation.scrubbedVariables,
      fileCredentialVariables:
        context.environmentIsolation.fileCredentialVariables,
      packageManagerConfiguration: "empty-disposable-user-and-global-npmrc",
      localDatabaseInherited:
        context.useSharedWorkspace && DATABASE_SUITES.has(name),
      providers: "scrubbed; proof uses only the loopback replay and OTLP fake",
      simulatorsEnabled: false,
    },
    commands,
    databaseInputs,
    assertionFingerprint: releaseAssertionFingerprint(name, workspaceIdentity),
    sourceIdentity: workspaceIdentity,
    retryPolicy: "none",
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
  const execute = async (
    rawCommand,
    phase,
    cleanup = false,
    assertion = undefined,
  ) => {
    stepNumber += 1;
    const [command, ...args] = rawCommand;
    const logPath = path.join(suiteDirectory, `step-${stepNumber}.log`);
    const result = await runCommand(
      command,
      args,
      environment,
      logPath,
      `${name}:${phase}`,
      context.workspaces.get(name),
      cleanup ? Date.now() + CLEANUP_TIMEOUT_MS : context.deadlineAt,
      cleanup,
    );
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
      ...(assertion ?? {}),
      command: printableCommand,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      retries: 0,
      timedOut: result.timedOut,
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
      for (const [assertionIndex, rawCommand] of commands.entries())
        await execute(
          commandForDatabaseProject(rawCommand, databaseProject),
          "assertion",
          false,
          { assertionIndex, declaredCommand: rawCommand },
        );
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
        true,
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
  const finalWorkspaceIdentity = sourceIdentity(
    context.workspaces.get(name),
    context.gitEnvironment,
  );
  const result = {
    ...contract,
    status,
    durationMs: Date.now() - suiteStartedAt,
    steps,
    artifactInventory,
    coverageInventory,
    finalSourceIdentity: finalWorkspaceIdentity,
    candidateIdentityPreserved:
      JSON.stringify(finalWorkspaceIdentity) ===
      JSON.stringify(workspaceIdentity),
    trackedWorkspaceClean:
      execFileSync("git", ["status", "--porcelain"], {
        cwd: context.workspaces.get(name),
        encoding: "utf8",
        env: context.gitEnvironment,
      }).trim() === "",
  };
  if (!result.trackedWorkspaceClean || !result.candidateIdentityPreserved)
    result.status = "failed";
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
  const budgetMs = Number.parseInt(
    process.env.CLOCKWORK_RELEASE_BUDGET_MS ??
      String(process.env.CI === "true" ? CI_BUDGET_MS : DEFAULT_BUDGET_MS),
    10,
  );
  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0)
    throw new Error("CLOCKWORK_RELEASE_BUDGET_MS must be a positive integer.");
  const deadlineAt = overallStartedAt + budgetMs;
  if (process.version !== EXACT_NODE_VERSION)
    throw new Error(
      `Release qualification requires Node ${EXACT_NODE_VERSION}; received ${process.version}.`,
    );
  const toolchainPath = [
    path.dirname(process.execPath),
    ...(process.env.PATH ?? "").split(path.delimiter),
  ]
    .filter(
      (entry, index, entries) => entry && entries.indexOf(entry) === index,
    )
    .join(path.delimiter);
  const toolchainEnvironment = { ...process.env, PATH: toolchainPath };
  const pnpmVersion = execFileSync("pnpm", ["--version"], {
    encoding: "utf8",
    env: toolchainEnvironment,
  }).trim();
  if (pnpmVersion !== EXACT_PNPM_VERSION)
    throw new Error(
      `Release qualification requires pnpm ${EXACT_PNPM_VERSION}; received ${pnpmVersion}.`,
    );
  const pnpmNodeVersion = execFileSync("pnpm", ["exec", "node", "--version"], {
    encoding: "utf8",
    env: toolchainEnvironment,
  }).trim();
  if (pnpmNodeVersion !== EXACT_NODE_VERSION)
    throw new Error(
      `Release pnpm subprocesses require Node ${EXACT_NODE_VERSION}; received ${pnpmNodeVersion}.`,
    );
  if (process.env.CLOCKWORK_RELEASE_INFRA_RETRY_CATEGORY)
    throw new Error(
      "Release qualification forbids retry categories; diagnose and rerun from a fresh candidate instead.",
    );
  const mode = option("mode", "parallel");
  if (mode !== "parallel" && mode !== "serial")
    throw new Error("--mode must be parallel or serial.");
  if (hasFlag("debug") && mode !== "serial")
    throw new Error("--debug requires --mode=serial.");
  const runId = safeToken(
    option(
      "run-id",
      process.env.CLOCKWORK_RELEASE_RUN_ID ?? `local-${Date.now()}`,
    ),
    "run id",
  );
  const selected = option("shard", "all");
  const names = selected === "all" ? Object.keys(suiteAssertions) : [selected];
  for (const name of names) {
    if (!suiteAssertions[name])
      throw new Error(`Unknown release shard: ${name}`);
  }
  const useSharedWorkspace =
    process.env.CLOCKWORK_RELEASE_SHARED_WORKSPACE === "1";
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
    providerFakePortBase + names.length > 65_535
  )
    throw new Error(
      "Release provider-fake port base is outside the safe range.",
    );
  const portAllocationIssues = releasePortAllocationIssues({
    suiteNames: names,
    portBase,
    databasePortBase,
    providerFakePortBase,
  });
  if (portAllocationIssues.length > 0)
    throw new Error(
      `Release port allocation is not isolated: ${portAllocationIssues.join("; ")}`,
    );
  const artifactRoot = path.resolve(
    option(
      "artifacts",
      process.env.CLOCKWORK_RELEASE_ARTIFACT_ROOT ??
        `.artifacts/release/${runId}/${mode}`,
    ),
  );
  try {
    if ((await readdir(artifactRoot)).length > 0)
      throw new Error(
        `Release artifact directory must be empty: ${artifactRoot}`,
      );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(artifactRoot, { recursive: true });
  const cacheRoot = path.resolve(
    process.env.CLOCKWORK_RELEASE_CACHE_ROOT ??
      path.join(artifactRoot, ".isolated-cache"),
  );
  const allowedCacheRoots = [
    path.join(artifactRoot, ".isolated-cache"),
    path.resolve(
      ".artifacts",
      "release-cache",
      selected === "all" ? runId : selected,
    ),
  ];
  const cacheRelativeToArtifacts = path.relative(
    path.resolve(".artifacts"),
    cacheRoot,
  );
  if (
    cacheRelativeToArtifacts === "" ||
    cacheRelativeToArtifacts.startsWith("..") ||
    path.isAbsolute(cacheRelativeToArtifacts)
  )
    throw new Error(
      "Release cache root must be a dedicated child of the repository .artifacts directory.",
    );
  const cacheRootIssues = releaseCacheRootIssues({
    cacheRoot,
    artifactRoot,
    workspaceRoot: process.cwd(),
    allowedRoots: allowedCacheRoots,
  });
  if (cacheRootIssues.length > 0)
    throw new Error(
      `Release cache root is not safe for recursive cleanup: ${cacheRootIssues.join("; ")}`,
    );
  await assertNoSymlinkComponents(cacheRoot, process.cwd());
  const pnpmStore = path.join(cacheRoot, "pnpm-store");
  const npmUserConfig = path.join(cacheRoot, "empty-user.npmrc");
  const npmGlobalConfig = path.join(cacheRoot, "empty-global.npmrc");
  const localDatabaseEnvironment = Object.fromEntries(
    [
      "DATABASE_URL",
      "CLOCKWORK_SERVICE_DATABASE_URL",
      "DIRECT_DATABASE_URL",
    ].flatMap((variable) =>
      typeof toolchainEnvironment[variable] === "string"
        ? [[variable, toolchainEnvironment[variable]]]
        : [],
    ),
  );
  if (useSharedWorkspace && names.some((name) => DATABASE_SUITES.has(name))) {
    const databaseEnvironmentIssues = releaseLocalDatabaseEnvironmentIssues(
      localDatabaseEnvironment,
    );
    if (databaseEnvironmentIssues.length > 0)
      throw new Error(
        `Shared release database configuration is unsafe: ${databaseEnvironmentIssues.join("; ")}`,
      );
  }
  const environmentIsolation = isolatedReleaseEnvironment(
    toolchainEnvironment,
    await readFile(path.join(process.cwd(), ".env.example"), "utf8"),
  );
  const baseEnvironment = environmentIsolation.environment;
  delete baseEnvironment.FORCE_COLOR;
  delete baseEnvironment.NO_COLOR;
  Object.assign(baseEnvironment, {
    // Every qualification subprocess is non-interactive, including local
    // benchmarks. This makes pnpm's module-store replacement behavior explicit
    // instead of depending on whether the caller happens to own a TTY.
    CI: "true",
    COREPACK_HOME: path.join(cacheRoot, "corepack"),
    NEXT_TELEMETRY_DISABLED: "1",
    PLAYWRIGHT_BROWSERS_PATH: path.join(cacheRoot, "playwright-browsers"),
    STORYBOOK_DISABLE_TELEMETRY: "1",
    TURBO_CACHE_DIR: path.join(cacheRoot, "turbo"),
    TURBO_TELEMETRY_DISABLED: "1",
    XDG_CACHE_HOME: path.join(cacheRoot, "xdg"),
    XDG_CONFIG_HOME: path.join(cacheRoot, "xdg-config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
    NPM_CONFIG_USERCONFIG: npmUserConfig,
    npm_config_globalconfig: npmGlobalConfig,
    npm_config_store_dir: pnpmStore,
    npm_config_userconfig: npmUserConfig,
    npm_config_update_notifier: "false",
  });
  const gitEnvironment = isolatedReleaseGitEnvironment(baseEnvironment);
  const identity = sourceIdentity(process.cwd(), gitEnvironment);
  const sourceStatus = execFileSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: process.cwd(), encoding: "utf8", env: gitEnvironment },
  ).trim();
  if (sourceStatus)
    throw new Error(
      "Release execution requires a clean committed candidate before any shard starts.",
    );
  await mkdir(cacheRoot, { recursive: true });
  await Promise.all([
    writeFile(npmUserConfig, "", { encoding: "utf8", mode: 0o600 }),
    writeFile(npmGlobalConfig, "", { encoding: "utf8", mode: 0o600 }),
  ]);
  const workspaces = new Map();
  const cleanupFailures = [];
  let frozenInstallVerified = false;
  let installationMode = "plan";
  let fetchWorkspaceIsolation = "plan";
  let executionError;
  let completedSummary;
  let completedSummaryPath;
  try {
    if (hasFlag("plan")) {
      for (const name of names) workspaces.set(name, process.cwd());
    } else if (useSharedWorkspace) {
      if (process.env.CI !== "true")
        throw new Error(
          "A shared release workspace is allowed only in the fresh-checkout CI qualification job.",
        );
      if (process.env.CLOCKWORK_RELEASE_FROZEN_INSTALL_VERIFIED !== "1")
        throw new Error(
          "A shared release workspace requires an attested frozen install from the fresh-checkout CI setup step.",
        );
      for (const name of names) workspaces.set(name, process.cwd());
      frozenInstallVerified = true;
      installationMode = "fresh-ci-checkout";
      fetchWorkspaceIsolation = "fresh-ci-checkout";
    } else {
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
            env: gitEnvironment,
            stdio: "inherit",
            timeout: Math.max(1, deadlineAt - Date.now()),
          },
        );
      }
      const setupDirectory = path.join(artifactRoot, "setup");
      await mkdir(setupDirectory, { recursive: true });
      const storePopulationWorkspace = workspaces.values().next().value;
      if (
        !storePopulationWorkspace ||
        path.resolve(storePopulationWorkspace) === path.resolve(process.cwd())
      )
        throw new Error("No isolated workspace is available for setup.");
      const fetched = await runCommand(
        "pnpm",
        ["fetch", "--store-dir", pnpmStore],
        baseEnvironment,
        path.join(setupDirectory, "frozen-fetch.log"),
        "setup:fetch",
        // Populate from a clean detached checkout. Running with a different
        // store in the source checkout would make pnpm replace its node_modules.
        storePopulationWorkspace,
        deadlineAt,
      );
      if (fetched.exitCode !== 0)
        throw new Error("Fresh isolated pnpm store population failed.");
      const installations = await Promise.all(
        [...workspaces].map(([name, workspace]) =>
          runCommand(
            "pnpm",
            [
              "install",
              "--offline",
              "--frozen-lockfile",
              "--ignore-scripts",
              "--store-dir",
              pnpmStore,
            ],
            baseEnvironment,
            path.join(setupDirectory, `${name}-install.log`),
            `setup:${name}`,
            workspace,
            deadlineAt,
          ),
        ),
      );
      if (installations.some(({ exitCode }) => exitCode !== 0))
        throw new Error("At least one isolated workspace installation failed.");
      const rebuilds = await Promise.all(
        [...workspaces].map(([name, workspace]) =>
          runCommand(
            "pnpm",
            ["rebuild", "--pending", "--store-dir", pnpmStore],
            baseEnvironment,
            path.join(setupDirectory, `${name}-rebuild.log`),
            `setup:${name}:rebuild`,
            workspace,
            deadlineAt,
          ),
        ),
      );
      if (rebuilds.some(({ exitCode }) => exitCode !== 0))
        throw new Error("At least one isolated dependency rebuild failed.");
      frozenInstallVerified = true;
      installationMode = "detached-clean-worktrees";
      fetchWorkspaceIsolation = "detached-clean-worktree";
      if (names.some((name) => name === "ui" || name === "proof")) {
        const browserWorkspace = workspaces.values().next().value;
        const browserInstall = await runCommand(
          "pnpm",
          [
            "--filter",
            "@clockwork/web",
            "exec",
            "playwright",
            "install",
            "chromium",
          ],
          baseEnvironment,
          path.join(setupDirectory, "playwright-install.log"),
          "setup:playwright",
          browserWorkspace,
          deadlineAt,
        );
        if (browserInstall.exitCode !== 0)
          throw new Error("Isolated Chromium installation failed.");
      }
    }
    const context = {
      artifactRoot,
      authorizationContextSecret: randomBytes(32).toString("base64url"),
      baseEnvironment,
      databasePortBase,
      deadlineAt,
      debug: hasFlag("debug"),
      environmentIsolation,
      gitEnvironment,
      localDatabaseEnvironment,
      manageDatabases: !hasFlag("plan") && !useSharedWorkspace,
      mode,
      planOnly: hasFlag("plan"),
      portBase,
      runId,
      serial: mode === "serial" || hasFlag("debug"),
      proofSecret: randomBytes(32).toString("base64url"),
      providerFakePortBase,
      sourceIdentity: identity,
      useSharedWorkspace,
      workspaces,
    };
    const results = [];
    const suiteErrors = [];
    if (mode === "serial") {
      for (const [index, name] of names.entries()) {
        try {
          results.push(await runSuite(name, index, context));
        } catch (error) {
          suiteErrors.push(error);
        }
      }
    } else {
      const settled = await Promise.allSettled(
        names.map((name, index) => runSuite(name, index, context)),
      );
      for (const outcome of settled) {
        if (outcome.status === "fulfilled") results.push(outcome.value);
        else suiteErrors.push(outcome.reason);
      }
    }
    if (suiteErrors.length > 0)
      throw new AggregateError(
        suiteErrors,
        "One or more release shards could not produce a result.",
      );
    const durationMs = Date.now() - overallStartedAt;
    const summary = {
      runId,
      mode,
      debug: context.debug,
      toolchain: {
        node: process.version,
        pnpm: pnpmVersion,
        pnpmNode: pnpmNodeVersion,
      },
      sourceIdentity: identity,
      cachePolicy: {
        cacheRoot,
        pnpmStore,
        playwrightBrowsers: baseEnvironment.PLAYWRIGHT_BROWSERS_PATH,
        turbo: "local and remote reads/writes disabled",
        retainedAfterExecution: false,
        cleanupVerified: false,
      },
      installationPolicy: {
        frozenInstallVerified,
        frozenLockfile: true,
        isolatedStore: pnpmStore,
        mode: installationMode,
        fetchWorkspaceIsolation,
      },
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
    completedSummary = summary;
    completedSummaryPath = summaryPath;
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
            env: gitEnvironment,
            stdio: "inherit",
            timeout: CLEANUP_TIMEOUT_MS,
          });
        } catch (error) {
          cleanupFailures.push(error);
        } finally {
          try {
            await rm(path.dirname(workspace), {
              recursive: true,
              force: true,
            });
          } catch (error) {
            cleanupFailures.push(error);
          }
        }
      }
      try {
        execFileSync("git", ["worktree", "prune"], {
          cwd: process.cwd(),
          env: gitEnvironment,
          stdio: "ignore",
          timeout: CLEANUP_TIMEOUT_MS,
        });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await rm(cacheRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (completedSummary && completedSummaryPath) {
    completedSummary.cachePolicy.cleanupVerified = cleanupFailures.length === 0;
    completedSummary.durationMs = Date.now() - overallStartedAt;
    completedSummary.withinBudget = completedSummary.durationMs <= budgetMs;
    if (terminationSignal) completedSummary.status = "failed";
    await writeFile(
      completedSummaryPath,
      `${JSON.stringify(completedSummary, null, 2)}\n`,
      "utf8",
    );
  }
  if (terminationSignal && !executionError)
    executionError = new Error(
      `Release execution received ${terminationSignal}; owned resources were cleaned before exit.`,
    );
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
  if (completedSummary && completedSummaryPath) {
    process.stdout.write(`Release ${mode} summary: ${completedSummaryPath}\n`);
    process.stdout.write(
      `Duration ${(completedSummary.durationMs / 1000).toFixed(1)}s / budget ${(budgetMs / 60000).toFixed(0)}m\n`,
    );
    if (completedSummary.status !== "passed" || !completedSummary.withinBudget)
      process.exitCode = 1;
  }
}

await main();
