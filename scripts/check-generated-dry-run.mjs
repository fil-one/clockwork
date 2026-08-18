import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const generatedFiles = [
  "packages/api/src/generated/openapi.json",
  "packages/api/src/generated/schema.d.ts",
];
const generatedDirectories = ["packages/db/drizzle"];

async function listFiles(root, relative) {
  const entries = await readdir(path.join(root, relative), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const child = path.posix.join(relative, entry.name);
      return entry.isDirectory() ? listFiles(root, child) : [child];
    }),
  );
  return files.flat().sort();
}

async function digest(root, relative) {
  return createHash("sha256")
    .update(await readFile(path.join(root, relative)))
    .digest("hex");
}

const sourceRoot = process.cwd();
const temporaryRoot = await mkdtemp(
  path.join(os.tmpdir(), "clockwork-generated-dry-run-"),
);
const workspace = path.join(temporaryRoot, "workspace");

try {
  execFileSync("git", ["worktree", "add", "--detach", workspace, "HEAD"], {
    cwd: sourceRoot,
    stdio: "inherit",
  });
  execFileSync(
    "pnpm",
    ["install", "--offline", "--frozen-lockfile", "--ignore-scripts"],
    { cwd: workspace, env: process.env, stdio: "inherit" },
  );
  execFileSync("pnpm", ["--filter", "@clockwork/api", "generate"], {
    cwd: workspace,
    env: process.env,
    stdio: "inherit",
  });

  const drizzleEnvironment = {
    ...process.env,
    DIRECT_DATABASE_URL:
      process.env.DIRECT_DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  };
  const drizzleGeneration = spawnSync(
    "pnpm",
    ["--filter", "@clockwork/db", "generate"],
    {
      cwd: workspace,
      env: drizzleEnvironment,
      encoding: "utf8",
    },
  );
  process.stdout.write(drizzleGeneration.stdout ?? "");
  process.stderr.write(drizzleGeneration.stderr ?? "");
  if (
    drizzleGeneration.status !== 0 ||
    drizzleGeneration.signal !== null ||
    /(?:^|\n)Error:/u.test(
      `${drizzleGeneration.stdout ?? ""}\n${drizzleGeneration.stderr ?? ""}`,
    )
  ) {
    throw new Error(
      `Drizzle generation failed${drizzleGeneration.signal ? ` with signal ${drizzleGeneration.signal}` : ` with status ${drizzleGeneration.status ?? "unknown"}`}`,
    );
  }

  const committedDirectoryFiles = (
    await Promise.all(
      generatedDirectories.map((relative) => listFiles(sourceRoot, relative)),
    )
  ).flat();
  const generatedDirectoryFiles = (
    await Promise.all(
      generatedDirectories.map((relative) => listFiles(workspace, relative)),
    )
  ).flat();
  if (
    JSON.stringify(committedDirectoryFiles) !==
    JSON.stringify(generatedDirectoryFiles)
  )
    throw new Error(
      `Generated Drizzle inventory is stale. Committed: ${committedDirectoryFiles.join(", ")}; regenerated: ${generatedDirectoryFiles.join(", ")}.`,
    );

  const comparisons = await Promise.all(
    [...generatedFiles, ...committedDirectoryFiles].map(async (relative) => ({
      relative,
      committed: await digest(sourceRoot, relative),
      generated: await digest(workspace, relative),
    })),
  );
  const changed = comparisons.filter(
    ({ committed, generated }) => committed !== generated,
  );
  if (changed.length) {
    throw new Error(
      `Generated outputs are stale: ${changed.map(({ relative }) => relative).join(", ")}. Regenerate the shared API and Drizzle artifacts.`,
    );
  }
  process.stdout.write(
    `Disposable generation dry-run matched ${comparisons.length} committed API and Drizzle outputs.\n`,
  );
} finally {
  try {
    execFileSync("git", ["worktree", "remove", "--force", workspace], {
      cwd: sourceRoot,
      stdio: "ignore",
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    execFileSync("git", ["worktree", "prune"], {
      cwd: sourceRoot,
      stdio: "ignore",
    });
  }
}
