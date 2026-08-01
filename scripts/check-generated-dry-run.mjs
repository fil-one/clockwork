import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const generatedFiles = [
  "packages/api/src/generated/openapi.json",
  "packages/api/src/generated/schema.d.ts",
];

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

  const comparisons = await Promise.all(
    generatedFiles.map(async (relative) => ({
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
      `Generated API outputs are stale: ${changed.map(({ relative }) => relative).join(", ")}. Instance 5 must perform the shared generation.`,
    );
  }
  process.stdout.write(
    `Disposable OpenAPI dry-run matched ${generatedFiles.length} committed outputs.\n`,
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
