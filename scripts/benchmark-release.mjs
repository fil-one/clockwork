import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const token = (process.argv[2] ?? `benchmark-${Date.now()}`).replace(
  /[^A-Za-z0-9_-]/g,
  "-",
);
const root = path.resolve(`.artifacts/release-benchmark/${token}`);

function run(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run([
  "scripts/release-suites.mjs",
  "--mode=serial",
  `--run-id=${token}-serial`,
  `--artifacts=${path.join(root, "serial")}`,
]);
run([
  "scripts/release-suites.mjs",
  "--mode=parallel",
  `--run-id=${token}-parallel`,
  `--artifacts=${path.join(root, "parallel")}`,
]);
run([
  "scripts/compare-release-results.mjs",
  path.join(root, "serial", "summary.json"),
  path.join(root, "parallel", "summary.json"),
  path.join(root, "comparison.json"),
]);
