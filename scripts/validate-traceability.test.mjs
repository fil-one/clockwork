import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  CITATION_COLUMNS,
  CITATION_COVERAGE,
  CITATION_GRANDFATHERING,
  CITATION_PATH_ROOTS,
  CITATION_POLICY_NOTE,
  checkCitationGrammar,
  classifyCitation,
  expandCitationBraces,
  symbolIsDeclared,
} from "./validate-traceability.mjs";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "scripts/validate-traceability.mjs");
const ledger = JSON.parse(
  readFileSync(
    resolve(root, "docs/traceability/launch-requirements.json"),
    "utf8",
  ),
);

const realFilesystem = {
  entryKind: (relativePath) => {
    const absolute = resolve(root, relativePath);
    if (!existsSync(absolute)) return null;
    return statSync(absolute).isDirectory() ? "directory" : "file";
  },
  readSource: (relativePath) =>
    readFileSync(resolve(root, relativePath), "utf8"),
};

// ---------------------------------------------------------------------------
// The one-error-per-run conversion.
// ---------------------------------------------------------------------------

test("no check throws its identifier in place", () => {
  // 65 checks used to `throw new Error("TRACEABILITY_...")`, so a run reported
  // exactly one finding. Remapping a batch of rows against that costs one full
  // run per error. This is the tripwire on the conversion: a new check added
  // with a throw would silently restore the old behaviour for itself.
  const source = readFileSync(script, "utf8");
  const throwSites = source.match(/throw new Error\(\s*[`"']TRACEABILITY_/g);
  assert.equal(
    throwSites,
    null,
    "a TRACEABILITY_ identifier is thrown rather than collected; use fail() or fatal()",
  );
  assert.ok(
    /const fail = \(id\) => \{/.test(source),
    "the collecting fail() helper is gone; the tripwire above is now vacuous",
  );
});

test("the script reports every collected identifier and exits non-zero", () => {
  // Runs against the working tree, so it asserts the shape of the report rather
  // than a fixed failure set: the ledger and the backlog are edited constantly
  // and pinning a count here would make this test a merge hazard.
  let status = 0;
  let stdout = "";
  let stderr = "";
  try {
    stdout = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    status = error.status;
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
  }
  assert.ok([0, 1].includes(status), `unexpected exit status ${status}`);
  if (status === 0) {
    assert.equal(stderr, "", "a clean run must print nothing to stderr");
  } else {
    const lines = stderr.trimEnd().split("\n");
    const header = /^TRACEABILITY_FAILURES:(\d+)$/.exec(lines[0]);
    assert.ok(header, `first stderr line is not the count header: ${lines[0]}`);
    const identifiers = lines
      .slice(1)
      .filter((line) => line.startsWith("TRACEABILITY_"));
    assert.equal(
      identifiers.length,
      Number(header[1]),
      "the declared failure count does not match the identifiers printed",
    );
    assert.ok(
      identifiers.length >= 1,
      "a failing run declared failures and printed none",
    );
  }
  if (stdout.length > 0) {
    const report = JSON.parse(stdout);
    assert.ok(report.citationGrammar, "the report omits the citation grammar");
  }
});

// ---------------------------------------------------------------------------
// Citation grammar: classification.
// ---------------------------------------------------------------------------

test("brace alternatives expand, and everything else is returned unchanged", () => {
  assert.deepEqual(expandCitationBraces("packages/db"), ["packages/db"]);
  assert.deepEqual(expandCitationBraces("apps/web/app/{a,b}/**"), [
    "apps/web/app/a/**",
    "apps/web/app/b/**",
  ]);
  assert.deepEqual(expandCitationBraces("a/{b,c}/{d,e}"), [
    "a/b/d",
    "a/b/e",
    "a/c/d",
    "a/c/e",
  ]);
});

test("prose is prose even when it contains a slash", () => {
  // The obvious rule - "a citation containing `/` must resolve on disk" - fails
  // 346 of the 410 slash-bearing citations in this ledger. These are the four
  // shapes that break it.
  for (const value of [
    "package boundaries",
    "quote/order artifacts",
    "localized money/date surfaces",
    "/v1/core",
    "/v1/webhooks/marketplaces/{provider}",
    "@clockwork/ui",
    "core/accounts",
    "packages/db schema",
    "packages/api generated OpenAPI/client",
    "all packages/apps",
    "db:reset",
    "RLS",
  ])
    assert.equal(
      classifyCitation(value).kind,
      "prose",
      `${value} should be grandfathered prose`,
    );
});

test("a citation anchored on a repository root is a path", () => {
  assert.deepEqual(classifyCitation("packages/domain/src/core"), {
    kind: "path",
    value: "packages/domain/src/core",
    targets: ["packages/domain/src/core"],
  });
  assert.deepEqual(classifyCitation("packages/domain/src/core/**").targets, [
    "packages/domain/src/core",
  ]);
  assert.deepEqual(
    classifyCitation("packages/testing/src/{demo,personas,visual}/**").targets,
    [
      "packages/testing/src/demo",
      "packages/testing/src/personas",
      "packages/testing/src/visual",
    ],
  );
  assert.deepEqual(
    classifyCitation(
      "apps/web/app/(experience)/(internal)/internal/queues/page.tsx",
    ).targets,
    ["apps/web/app/(experience)/(internal)/internal/queues/page.tsx"],
  );
});

test("path#symbol is recognised, and a broken one is not silently prose", () => {
  assert.deepEqual(
    classifyCitation(
      "packages/domain/src/core/reports/index.ts#capacityPlanning",
    ),
    {
      kind: "symbol",
      value: "packages/domain/src/core/reports/index.ts#capacityPlanning",
      path: "packages/domain/src/core/reports/index.ts",
      symbol: "capacityPlanning",
    },
  );
  assert.equal(
    classifyCitation("packages/x.ts#not a symbol").kind,
    "malformed",
  );
  assert.equal(classifyCitation("packages/x.ts#").kind, "malformed");
  const glob = classifyCitation("packages/*/src");
  assert.equal(glob.kind, "malformed");
  assert.match(glob.detail, /glob metacharacter/);
});

// ---------------------------------------------------------------------------
// Citation grammar: symbol declarations, against the real tree.
// ---------------------------------------------------------------------------

test("symbolIsDeclared finds the declaration forms this repository writes", () => {
  const reports = realFilesystem.readSource(
    "packages/domain/src/core/reports/index.ts",
  );
  for (const symbol of [
    "capacityPlanning",
    "weeklyScorecard",
    "toCsv",
    "threeWayTieOut",
    "RecurringRevenueInput",
    "ForecastLine",
  ])
    assert.ok(
      symbolIsDeclared(reports, symbol),
      `${symbol} is declared in the reports module and was not found`,
    );
  assert.equal(symbolIsDeclared(reports, "capacityPlanningX"), false);
  assert.equal(symbolIsDeclared(reports, "noSuchSymbolAnywhere"), false);
  // Word boundaries, not substrings.
  assert.equal(
    symbolIsDeclared("export function toCsvWriter() {}", "toCsv"),
    false,
  );
  // SQL objects, because the reports that actually ship are views.
  assert.ok(
    symbolIsDeclared(
      "create or replace view public.core_report_arr as select 1;",
      "core_report_arr",
    ),
  );
  assert.ok(
    symbolIsDeclared(
      'create policy "quotes_read" on public.quotes for select using (true);',
      "quotes_read",
    ),
  );
});

// ---------------------------------------------------------------------------
// Citation grammar: the check itself, on an injected tree.
// ---------------------------------------------------------------------------

const fakeTree = {
  entryKind: (relativePath) =>
    ({
      apps: "directory",
      docs: "directory",
      packages: "directory",
      patches: "directory",
      scripts: "directory",
      supabase: "directory",
      "packages/domain/src/core": "directory",
      "packages/domain/src/core/reports/index.ts": "file",
    })[relativePath] ?? null,
  readSource: () => "export function live() {}\n",
};

const requirement = (overrides) => ({
  id: "SPEC-01-01",
  domain: [],
  api: [],
  database: [],
  workflowProvider: [],
  portalDocument: [],
  tests: [],
  ...overrides,
});

test("a path that does not exist fails, and prose beside it does not", () => {
  const { failures, counts } = checkCitationGrammar({
    requirements: [
      requirement({
        domain: ["packages/domain/src/core", "packages/domain/src/gone"],
        tests: ["report tests"],
      }),
    ],
    ...fakeTree,
  });
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [
      "TRACEABILITY_CITATION_PATH_MISSING:SPEC-01-01:domain:packages/domain/src/gone",
    ],
  );
  assert.deepEqual(counts, {
    total: 3,
    path: 2,
    symbol: 0,
    prose: 1,
    malformed: 0,
  });
});

test("every brace alternative must exist, not just the first", () => {
  const { failures } = checkCitationGrammar({
    requirements: [
      requirement({ domain: ["packages/domain/src/{core,gone}"] }),
    ],
    ...fakeTree,
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0].detail, /packages\/domain\/src\/gone/);
});

test("a path#symbol citation must name a file that declares the symbol", () => {
  const { failures } = checkCitationGrammar({
    requirements: [
      requirement({
        domain: [
          "packages/domain/src/core/reports/index.ts#live",
          "packages/domain/src/core/reports/index.ts#dead",
          "packages/domain/src/core#live",
          "packages/domain/src/gone.ts#live",
        ],
      }),
    ],
    ...fakeTree,
  });
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [
      "TRACEABILITY_CITATION_SYMBOL_UNDEFINED:SPEC-01-01:domain:packages/domain/src/core/reports/index.ts#dead",
      "TRACEABILITY_CITATION_SYMBOL_NOT_A_FILE:SPEC-01-01:domain:packages/domain/src/core#live",
      "TRACEABILITY_CITATION_SYMBOL_FILE_MISSING:SPEC-01-01:domain:packages/domain/src/gone.ts#live",
    ],
  );
});

test("a missing anchor root fails rather than reclassifying its citations as prose", () => {
  // Deriving CITATION_PATH_ROOTS from the disk would make this pass silently,
  // which is the wrong direction to fail in.
  const { failures } = checkCitationGrammar({
    requirements: [requirement({ domain: ["packages/domain/src/core"] })],
    entryKind: (relativePath) =>
      relativePath === "packages" ? null : fakeTree.entryKind(relativePath),
    readSource: fakeTree.readSource,
  });
  assert.ok(
    failures.some(
      (failure) => failure.id === "TRACEABILITY_CITATION_ROOT_MISSING:packages",
    ),
  );
});

// ---------------------------------------------------------------------------
// The real ledger.
// ---------------------------------------------------------------------------

test("the shipped ledger satisfies the citation grammar", () => {
  const { failures, counts } = checkCitationGrammar({
    requirements: ledger.requirements,
    ...realFilesystem,
  });
  assert.deepEqual(
    failures.map((failure) => `${failure.id} (${failure.detail})`),
    [],
  );
  assert.ok(counts.total > 2000, "the citation corpus shrank unexpectedly");
  assert.ok(counts.path > 0, "no citation is being checked at all");
});

test("the grandfathering and the rule that narrows it are both written down", () => {
  // Refusing to check 2,141 prose citations is defensible; refusing to check
  // them without saying so is not.
  assert.ok(CITATION_GRANDFATHERING.rule.length > 0);
  assert.ok(CITATION_GRANDFATHERING.reason.length > 0);
  assert.ok(CITATION_GRANDFATHERING.narrowing.includes("path#symbol"));
  assert.ok(CITATION_COVERAGE.doesNotCover.length >= 4);
  assert.ok(
    CITATION_COVERAGE.doesNotCover.some((limit) =>
      limit.includes("GRANDFATHERED"),
    ),
    "the coverage statement does not admit that prose is unchecked",
  );
  assert.ok(CITATION_POLICY_NOTE.includes("path#symbol"));
  assert.deepEqual(CITATION_PATH_ROOTS.length > 0, true);
  assert.deepEqual(CITATION_COLUMNS.length, 6);
});
