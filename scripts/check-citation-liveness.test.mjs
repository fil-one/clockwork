import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COVERAGE,
  DEAD_CITATION_EXCEPTIONS,
  SELF_DOCUMENTING_FILES,
  analyzeCitationLiveness,
  collectSourceFiles,
  collectSymbolCitations,
  isTestFile,
} from "./check-citation-liveness.mjs";

const root = resolve(import.meta.dirname, "..");
const ledger = JSON.parse(
  readFileSync(
    resolve(root, "docs/traceability/launch-requirements.json"),
    "utf8",
  ),
);

const REPORTS = "packages/domain/src/core/reports/index.ts";
const cite = (symbol, path = REPORTS) => ({
  id: "SPEC-17-R02",
  column: "domain",
  value: `${path}#${symbol}`,
  path,
  symbol,
});

// Read once; every real-tree assertion below shares it.
const files = collectSourceFiles();
const verdictFor = (citations, exceptions) =>
  analyzeCitationLiveness({ citations, files, exceptions });

test("only path#symbol citations are subjects", () => {
  const citations = collectSymbolCitations({
    requirements: [
      {
        id: "SPEC-01-01",
        domain: ["packages/domain/src/core", "packages/a.ts#alpha"],
        tests: ["report tests", "packages/b.ts#beta"],
        api: ["/v1/core"],
      },
    ],
  });
  assert.deepEqual(
    citations.map((citation) => citation.value),
    ["packages/a.ts#alpha", "packages/b.ts#beta"],
  );
  assert.deepEqual(citations[0], {
    id: "SPEC-01-01",
    column: "domain",
    value: "packages/a.ts#alpha",
    path: "packages/a.ts",
    symbol: "alpha",
  });
});

test("test and fixture files are excluded from the reference count", () => {
  for (const path of [
    "packages/domain/src/core/core-finance.test.ts",
    "packages/integrations/src/core/accounting/adapter.test.ts",
    "packages/integrations/src/support/webhooks.contract.test.ts",
    "packages/api/src/routes/lifecycle/lifecycle.integration.test.ts",
    "apps/web/e2e/experience.spec.ts",
    "packages/testing/src/personas/playwright.ts",
    "supabase/tests/000_schema.test.sql",
    "apps/web/src/features/x/y.stories.tsx",
  ])
    assert.ok(isTestFile(path), `${path} should count as a test file`);
  for (const path of [
    "packages/domain/src/core/reports/index.ts",
    "packages/api/src/routes/core/index.ts",
    "packages/workflows/src/core/csv.ts",
    "supabase/migrations/000100_core_finance.sql",
  ])
    assert.equal(isTestFile(path), false, `${path} is not a test file`);
});

// ---------------------------------------------------------------------------
// The real symbols P0-71 names. These assertions read the working tree on
// purpose: fixtures would prove the regex, not the finding.
// ---------------------------------------------------------------------------

test("the two symbols P0-71 names as unreachable fail", () => {
  // If either of these ever acquires a real caller, this test fails and the
  // right response is to delete the assertion, not to weaken the checker.
  //
  // It asserts FAILURE rather than the exact verdict. `dead` and `test-only`
  // are both failures, and which one these two land in depends on whether some
  // other test file in the repository happens to name them - which is limit 3,
  // and pinning it here would make an unrelated test suite able to break this
  // one. `scripts/validate-traceability.test.mjs` names `capacityPlanning`
  // today, so the verdict is `test-only`; that is not a fact worth pinning.
  const { failures, symbols } = verdictFor([
    cite("capacityPlanning"),
    cite("weeklyScorecard"),
  ]);
  for (const symbol of symbols) {
    assert.ok(
      ["dead", "test-only"].includes(symbol.verdict),
      `${symbol.value} scored ${symbol.verdict}; it has no production reference`,
    );
    assert.deepEqual(
      symbol.references,
      [],
      `${symbol.value} acquired a non-test reference`,
    );
  }
  assert.deepEqual(
    failures.map((failure) => failure.id.split(":").slice(1).join(":")).sort(),
    [`${REPORTS}#capacityPlanning`, `${REPORTS}#weeklyScorecard`],
  );
});

test("toCsv is live now that P0-64 gave it real callers, and its own test does not count", () => {
  const { failures, symbols } = verdictFor([cite("toCsv")]);
  assert.deepEqual(failures, []);
  assert.equal(symbols[0].verdict, "referenced");
  assert.ok(
    symbols[0].references.includes("packages/api/src/routes/core/index.ts"),
    "the HTTP download path is the reference that makes toCsv live",
  );
  assert.ok(
    symbols[0].references.every((path) => !isTestFile(path)),
    "a test file leaked into the reference set",
  );
});

test("a same-name collision scores a dead symbol as live - the documented limit", () => {
  // P0-71's own example, pinned so the limit in the file header cannot quietly
  // become a claim. `threeWayTieOut` is declared twice; the domain one is
  // referenced by nothing but its test, and this checker still calls it
  // referenced because the OTHER declaration matches the same identifier text.
  const { failures, symbols } = verdictFor([cite("threeWayTieOut")]);
  assert.deepEqual(failures, [], "the collision is not detected, by design");
  assert.equal(symbols[0].verdict, "referenced");
  assert.deepEqual(symbols[0].references, [
    "packages/integrations/src/core/accounting/adapter.ts",
  ]);
  const collidingDeclaration = readFileSync(
    resolve(root, "packages/integrations/src/core/accounting/adapter.ts"),
    "utf8",
  );
  assert.match(
    collidingDeclaration,
    /export function threeWayTieOut\(/,
    "the sole 'reference' is a different declaration of the same name, which is the whole point of this test",
  );
});

test("a private helper called by its own module is not dead", () => {
  // The rule this checker was specified with - "at least one reference OUTSIDE
  // its defining file" - scored nine of the ledger's first twelve flagged
  // symbols dead on exactly this shape. `reportCsv` is declared at
  // packages/api/src/routes/core/index.ts:445 and called at :694.
  const { failures, symbols } = verdictFor([
    cite("reportCsv", "packages/api/src/routes/core/index.ts"),
  ]);
  assert.deepEqual(failures, []);
  assert.equal(symbols[0].verdict, "file-local");
  assert.deepEqual(symbols[0].references, []);
  assert.ok(
    symbols[0].inFileOccurrences > 1,
    "the declaration alone must not be enough to score file-local",
  );
});

test("a symbol named only by its own test fails as test-only, not as absent", () => {
  // The state P0-64 found `toCsv` in, and the state three of the ledger's
  // current citations are in. `planExceptionEscalation` is declared in
  // packages/workflows/src/exceptions/index.ts and named by index.test.ts alone.
  const path = "packages/workflows/src/exceptions/index.ts";
  const { failures, symbols } = verdictFor([
    cite("planExceptionEscalation", path),
  ]);
  assert.equal(symbols[0].verdict, "test-only");
  assert.deepEqual(symbols[0].references, []);
  assert.deepEqual(symbols[0].testReferences, [
    "packages/workflows/src/exceptions/index.test.ts",
  ]);
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [`CITATION_TEST_ONLY:${path}#planExceptionEscalation`],
  );
});

test("a citation whose file is outside the scanned corpus is reported, not scored", () => {
  const { failures, symbols } = verdictFor([
    cite("anything", "docs/traceability/launch-requirements.json"),
  ]);
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [
      "CITATION_DEFINING_FILE_UNSCANNED:docs/traceability/launch-requirements.json#anything",
    ],
  );
  assert.equal(symbols[0].verdict, "unscanned");
});

// ---------------------------------------------------------------------------
// The exception map, enforced in both directions.
// ---------------------------------------------------------------------------

test("a recorded exception silences a dead symbol", () => {
  const { failures } = verdictFor([cite("capacityPlanning")], {
    [`${REPORTS}#capacityPlanning`]: "reason",
  });
  assert.deepEqual(failures, []);
});

test("an exception on a symbol that is now referenced fails", () => {
  const { failures } = verdictFor([cite("toCsv")], {
    [`${REPORTS}#toCsv`]: "reason",
  });
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [`CITATION_EXCEPTION_EARNED_BACK:${REPORTS}#toCsv`],
  );
});

test("an exception the ledger no longer cites fails", () => {
  const { failures } = verdictFor([cite("capacityPlanning")], {
    [`${REPORTS}#capacityPlanning`]: "reason",
    [`${REPORTS}#retiredSymbol`]: "reason",
  });
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [`CITATION_EXCEPTION_STALE:${REPORTS}#retiredSymbol`],
  );
});

// ---------------------------------------------------------------------------
// The shipped state.
// ---------------------------------------------------------------------------

test("the shipped ledger's own citations are analysed, and the exception map is consistent", () => {
  // DELIBERATELY DOES NOT ASSERT A GREEN RUN. `pnpm check:citation-liveness`
  // currently fails on three real test-only citations, and pinning that set
  // here would turn a moving finding into a merge hazard while the ledger is
  // being remapped. What is pinned is that the checker has subjects, that every
  // failure it raises is a known kind, and that the exception map is neither
  // stale nor unearned - the two directions that are this file's own contract
  // rather than the ledger's.
  const citations = collectSymbolCitations(ledger);
  assert.ok(
    citations.length > 0,
    "the ledger carries no `path#symbol` citation, so this checker has no subjects at all",
  );
  assert.deepEqual(
    DEAD_CITATION_EXCEPTIONS,
    {},
    "an exception was added without updating this assertion and its reason",
  );
  const { failures, symbols } = analyzeCitationLiveness({ citations, files });
  const kinds = new Set(failures.map((failure) => failure.id.split(":")[0]));
  assert.deepEqual(
    [...kinds].filter(
      (kind) => !["CITATION_TEST_ONLY", "CITATION_DEAD"].includes(kind),
    ),
    [],
    `the ledger raised a failure kind this test does not expect: ${[...kinds].join(", ")}`,
  );
  assert.ok(
    symbols.every((symbol) => symbol.verdict !== "unscanned"),
    "a cited file is outside the scanned corpus, so its liveness is undecidable",
  );
});

test("the checker's own documentation does not make the symbols it names look live", () => {
  // Found by these tests on their first run, not by review: this file and the
  // checker both name `capacityPlanning` and `threeWayTieOut` in prose, and
  // `scripts/` is a scan root, so every documented dead symbol scored
  // referenced. The exclusion below is what makes the two assertions above
  // mean anything, and this proves it is load-bearing by re-running without it.
  assert.ok(
    files.every((file) => !SELF_DOCUMENTING_FILES.includes(file.path)),
    "a self-documenting file is still in the corpus",
  );
  const unexcluded = collectSourceFiles(root, undefined, []);
  const { symbols: unexcludedSymbols } = analyzeCitationLiveness({
    citations: [cite("capacityPlanning")],
    files: unexcluded,
  });
  assert.equal(
    unexcludedSymbols[0].verdict,
    "referenced",
    "without the exclusion this symbol should be wrongly scored live; if it is not, the exclusion is now dead weight",
  );
  assert.deepEqual(unexcludedSymbols[0].references, [
    "scripts/check-citation-liveness.mjs",
  ]);
  // Both files need the exclusion, and for different reasons: the checker
  // pollutes the non-test reference count, and this test file pollutes the
  // test-only reference count, which is enough to turn `dead` into `test-only`.
  assert.deepEqual(SELF_DOCUMENTING_FILES, [
    "scripts/check-citation-liveness.mjs",
    "scripts/check-citation-liveness.test.mjs",
  ]);
  assert.ok(
    unexcludedSymbols[0].testReferences.includes(
      "scripts/check-citation-liveness.test.mjs",
    ),
  );
  assert.ok(isTestFile("scripts/check-citation-liveness.test.mjs"));
});

test("the corpus it scans is real, and its limits are written down", () => {
  assert.ok(files.length > 500, `only ${files.length} source files scanned`);
  assert.ok(
    files.some((file) => file.path === REPORTS),
    "the reports module is not in the scanned corpus",
  );
  assert.ok(
    files.some((file) => file.path.endsWith(".sql")),
    "SQL is not in the scanned corpus, so a view citation could never resolve",
  );
  assert.ok(
    files.every((file) => !file.path.includes("node_modules")),
    "node_modules leaked into the scan",
  );
  assert.ok(
    COVERAGE.doesNotCover.some((limit) => limit.includes("threeWayTieOut")),
    "the coverage statement does not name the collision that defeats it",
  );
  assert.ok(
    COVERAGE.doesNotCover.some((limit) => limit.includes("reachab")),
    "the coverage statement does not distinguish referenced from reachable",
  );
});
