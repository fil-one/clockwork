import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function assertDatabaseTestResults(output) {
  const files = /Files=(\d+)/.exec(output)?.[1];
  const tests = /Tests=(\d+)/.exec(output)?.[1];
  if (
    output.includes("Result: NOTESTS") ||
    files === undefined ||
    tests === undefined ||
    files === "0" ||
    tests === "0"
  )
    throw new Error("Database test gate executed zero pgTAP tests");
}

export function runDatabaseTests() {
  const result = spawnSync(
    "pnpm",
    ["exec", "supabase", "test", "db", "supabase/tests"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) throw result.error;
  if (result.signal)
    throw new Error(`Database test process terminated by ${result.signal}`);
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }
  assertDatabaseTestResults(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  runDatabaseTests();
