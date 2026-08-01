import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";

const tracked = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    "apps",
    "packages",
    "scripts",
    "supabase",
  ],
  { cwd: process.cwd(), encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .sort();
const testFiles = tracked.filter((file) =>
  /(?:test|spec)\.(?:[cm]?[jt]sx?|sql)$/.test(file),
);
const sources = new Map(
  await Promise.all(
    testFiles.map(async (file) => [file, await readFile(file, "utf8")]),
  ),
);

const focusedOrSkipped = [];
const declaration =
  /\b(?:describe|it|test)(?:\s*\.\s*(?:concurrent|sequential|each))*[^\n;]{0,100}?\.\s*(?:only|skip|skipIf|todo|fixme)\s*\(/g;
for (const [file, source] of sources) {
  for (const match of source.matchAll(declaration))
    focusedOrSkipped.push(`${file}:${match.index ?? 0}:${match[0]}`);
}
if (focusedOrSkipped.length > 0)
  throw new Error(
    `Release qualification forbids focused, skipped, todo, or fixme tests: ${focusedOrSkipped.join(", ")}`,
  );

const filesMatching = (predicate) =>
  testFiles.filter((file) => predicate(file, sources.get(file) ?? ""));
const classes = {
  unit: filesMatching(
    (file) =>
      !file.includes(".integration.test.") && !file.startsWith("apps/web/e2e/"),
  ),
  property: filesMatching((_file, source) =>
    /(?:from\s+["']fast-check["']|fc\.property\s*\()/.test(source),
  ),
  contract: filesMatching((file) => file.includes(".contract.test.")),
  integration: filesMatching((file) => file.includes(".integration.test.")),
  providerReplay: filesMatching((_file, source) =>
    /(?:replay_provider_event|provider[^\n]{0,80}replay|replay[^\n]{0,80}provider)/i.test(
      source,
    ),
  ),
  document: filesMatching((file) => file.startsWith("packages/documents/")),
  migration: filesMatching((file) => /\/migrations?\//.test(file)),
  telemetryRedaction: filesMatching((file, source) =>
    /(?:telemetry|redact)/i.test(`${file}\n${source}`),
  ),
  security: filesMatching((file, source) =>
    /(?:auth|authorization|csrf|permission|security|signature|webhook)/i.test(
      `${file}\n${source}`,
    ),
  ),
  storybookAxe: filesMatching((file) => file.includes(".a11y.test.")),
  visualBrowser: filesMatching(
    (file) => file === "apps/web/e2e/visual.spec.ts",
  ),
  productionBrowserProof: filesMatching(
    (file) => file === "apps/web/e2e/production-proof.spec.ts",
  ),
};

const pgTap = tracked.filter(
  (file) => file.startsWith("supabase/tests/") && file.endsWith(".sql"),
);
const migrations = tracked.filter(
  (file) => file.startsWith("supabase/migrations/") && file.endsWith(".sql"),
);
const requiredFiles = [
  "scripts/check-generated-dry-run.mjs",
  "scripts/qualify-populated-upgrade.mjs",
  "scripts/verify-demo-reset-safety.mjs",
];
const testOwners = [
  "apps/web",
  "packages/api",
  "packages/contracts",
  "packages/db",
  "packages/documents",
  "packages/domain",
  "packages/integrations",
  "packages/testing",
  "packages/ui",
  "packages/workflows",
];
const ownerCounts = Object.fromEntries(
  testOwners.map((owner) => [
    owner,
    testFiles.filter((file) => file.startsWith(`${owner}/`)).length,
  ]),
);
const missingOwners = Object.entries(ownerCounts)
  .filter(([, count]) => count === 0)
  .map(([owner]) => owner);
const missingClasses = Object.entries(classes)
  .filter(([, files]) => files.length === 0)
  .map(([name]) => name);
const missingFiles = requiredFiles.filter((file) => !tracked.includes(file));
if (
  missingClasses.length > 0 ||
  missingOwners.length > 0 ||
  pgTap.length === 0 ||
  migrations.length === 0
)
  throw new Error(
    `Release qualification class inventory is incomplete: ${[
      ...missingClasses,
      ...missingOwners.map((owner) => `tests:${owner}`),
      ...(pgTap.length === 0 ? ["pgTap"] : []),
      ...(migrations.length === 0 ? ["migrations"] : []),
    ].join(", ")}`,
  );
if (missingFiles.length > 0)
  throw new Error(
    `Release qualification control files are missing: ${missingFiles.join(", ")}`,
  );

const inventory = {
  trackedTestFiles: testFiles.length,
  classes: Object.fromEntries(
    Object.entries(classes).map(([name, files]) => [name, files.length]),
  ),
  owners: ownerCounts,
  pgTapFiles: pgTap.length,
  migrationFiles: migrations.length,
  focusedOrSkippedTests: 0,
  requiredFiles,
};
const fingerprint = createHash("sha256")
  .update(
    JSON.stringify({
      testFiles,
      classes,
      pgTap,
      migrations,
      requiredFiles,
      ownerCounts,
    }),
  )
  .digest("hex");
process.stdout.write(`${JSON.stringify({ ...inventory, fingerprint })}\n`);
