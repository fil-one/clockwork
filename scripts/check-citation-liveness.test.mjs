import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COVERAGE,
  DEAD_CITATION_EXCEPTIONS,
  DOCUMENTED_SYMBOL_VERDICTS,
  SELF_DOCUMENTING_FILES,
  analyzeCitationLiveness,
  collectSourceFiles,
  collectSymbolCitations,
  isTestFile,
} from "./check-citation-liveness.mjs";
// The other half of P0-71's tooling, used here only as an oracle for "is this
// symbol declared in this file". The verdicts alone do not settle that. Record
// a CALLER as the declaring file and the verdict comes out `referenced`, which
// is what the table already claims, so the entry passes while the attribution
// is wrong: `toCsv` moved to `packages/workflows/src/core/csv.ts` is the case,
// and it fails on this assertion and nothing else.
import { symbolIsDeclared } from "./validate-traceability.mjs";

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

// dead < test-only < file-local < referenced. A recorded STRING verdict is a
// floor on this ladder; a recorded ARRAY is an exact acceptable set.
const LIVENESS_LADDER = ["dead", "test-only", "file-local", "referenced"];
const atLeast = (recorded) =>
  LIVENESS_LADDER.slice(LIVENESS_LADDER.indexOf(recorded));
const acceptedVerdicts = (recorded) =>
  Array.isArray(recorded) ? [...recorded] : atLeast(recorded);

test("every symbol the header names is declared where the header says, with the verdict the header claims", () => {
  // The header of `check-citation-liveness.mjs` shipped with four false
  // statements, and the worst of them - `readReportView` attributed to
  // `packages/api/src/routes/core/index.ts` when it is declared in
  // `packages/db/src/repositories/core/database-finance.ts` - survived review
  // because nothing could read it. `DOCUMENTED_SYMBOL_VERDICTS` moves those
  // claims into data and this re-derives every one of them from the tree. A
  // wrong file now scores `unscanned` or `dead`, not `file-local`, and fails
  // here.
  assert.ok(
    DOCUMENTED_SYMBOL_VERDICTS.length >= 16,
    "the documented set shrank; a header claim was deleted rather than corrected",
  );
  const { symbols } = analyzeCitationLiveness({
    citations: DOCUMENTED_SYMBOL_VERDICTS.map((entry) =>
      cite(entry.symbol, entry.path),
    ),
    files,
  });
  const actual = new Map(
    symbols.map((symbol) => [`${symbol.path}#${symbol.symbol}`, symbol]),
  );
  for (const entry of DOCUMENTED_SYMBOL_VERDICTS) {
    const key = `${entry.path}#${entry.symbol}`;
    const scored = actual.get(key);
    assert.ok(scored, `${key} was not scored at all`);
    assert.notEqual(
      scored.verdict,
      "unscanned",
      `${key}: the header names a file that is not in the scanned corpus, so the attribution is wrong or the path is stale`,
    );
    const accepted = acceptedVerdicts(entry.verdict);
    assert.ok(
      accepted.includes(scored.verdict),
      Array.isArray(entry.verdict)
        ? `${key}: the header claims exactly ${accepted.join(" or ")}, the tree says ${scored.verdict}`
        : `${key}: the header claims at least ${entry.verdict}, the tree says ${scored.verdict}; a symbol going LESS live means the header is now wrong about it`,
    );
    assert.ok(
      symbolIsDeclared(
        readFileSync(resolve(root, entry.path), "utf8"),
        entry.symbol,
      ),
      `${key}: the table records this file as the declaring file and it does not declare the symbol`,
    );
  }
  // The property the header's "reached from inside their own module" sentence
  // actually claims, and the whole argument for counting in-file occurrences.
  //
  // This USED to assert that each of these had zero references outside its own
  // file, which is a different and much stronger claim - and a control that
  // blocked legitimate work: six of these symbols are exported, this file runs
  // in `pnpm test:unit`, and one ordinary production import turned the repo-wide
  // gate red and forced a foreign lane to edit this lane's table and header. The
  // in-file occurrence count is the part an outside caller cannot take away.
  for (const entry of DOCUMENTED_SYMBOL_VERDICTS.filter(
    (entry_) => entry_.verdict === "file-local",
  ))
    assert.ok(
      (actual.get(`${entry.path}#${entry.symbol}`)?.inFileOccurrences ?? 0) > 1,
      `${entry.path}#${entry.symbol}: the header says it is reached from inside its own module, and the declaration is now the only occurrence there`,
    );
});

// ---------------------------------------------------------------------------
// The header itself. Three rewrites of it shipped false statements, the last
// one while claiming to have fixed six, so it is now read by a test.
// ---------------------------------------------------------------------------

// EXACTLY the comment forms the number rule reads, and the header of
// check-citation-liveness.mjs names the same two:
//
//   * every block comment - single-star or double-star - that STARTS a line;
//   * every whole-line `//` comment, which includes the leading header block.
//
// Deliberately not read, and said so in the header instead of papered over: a
// comment that follows code on the same line, in either form, and the inside of
// a string literal. Both exclusions are structural rather than lazy. Whole-line
// `//` keeps a `//` inside a string from being mistaken for commentary;
// line-anchored blocks keep a literal slash-star inside a string from opening a
// false block that would swallow code as "commentary" and fail this test on
// numbers that were never claims.
//
// The single-star form matters because it was a live hole: a `/* ... */` block
// was read by neither the old regex nor the whole-line filter, so a fabricated
// tally could be written into one and the suite stayed green.
function commentaryOf(source) {
  const lines = source.split("\n");
  return [
    ...(source.match(/^[ \t]*\/\*[\s\S]*?\*\//gm) ?? []),
    ...lines.filter((line) => /^\s*\/\//.test(line)),
  ].join("\n");
}

/** The leading `//` block alone, unwrapped to one line so an assertion can
 * quote a sentence without knowing where it wraps. */
function headerSentences(source) {
  const header = [];
  for (const line of source.split("\n")) {
    if (!/^\s*\/\//.test(line)) break;
    header.push(line.replace(/^\s*\/\/\s?/, ""));
  }
  return header.join(" ").replaceAll(/\s+/g, " ");
}

// Whether `symbol` leaves its file under an `export`. Same regex family as
// `symbolIsDeclared` in validate-traceability.mjs, narrowed to the exported
// forms; it decides only whether a second production file COULD import the
// symbol, which is the property the header's floor argument rests on.
function isExported(sourceText, symbol) {
  return [
    String.raw`\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+${symbol}\b`,
    String.raw`\bexport\s+(?:declare\s+)?(?:const|let|var)\s+${symbol}\b`,
    String.raw`\bexport\s+(?:abstract\s+)?class\s+${symbol}\b`,
    String.raw`\bexport\s+(?:interface|type|enum|namespace)\s+${symbol}\b`,
    String.raw`\bexport\s*\{[^}]*\b${symbol}\b[^}]*\}`,
  ].some((pattern) => new RegExp(pattern).test(sourceText));
}

/** Every number in `text`, with the things that only look like numbers -
 * backlog identifiers and requirement identifiers - removed first. */
function numbersIn(text) {
  return [
    ...text
      .replaceAll(/\bP0-\d+\b/g, "")
      .replaceAll(/\bSPEC-[0-9A-Z-]+\b/g, "")
      .matchAll(/\d[\d,]*/g),
  ].map((match) => Number(match[0].replaceAll(",", "")));
}

test("every number in the checker's own commentary is one this test derived", () => {
  // THE DEFECT THIS EXISTS FOR. The header used to carry ledger tallies, a
  // false-positive percentage and a package spread, all written by hand and
  // re-derived by nothing. One of them ("none of the nine lives in
  // packages/api/src/routes/core/index.ts") directly contradicted
  // DOCUMENTED_SYMBOL_VERDICTS, which records `reportCsv` at exactly that path,
  // and no test could see it because no test read the sentence.
  //
  // Every figure below is computed here first and only then compared to the
  // text. Adding a number to any comment in check-citation-liveness.mjs that is
  // not derived here fails this test, which is the point: the escape hatch is
  // to derive it, or to leave the count out and let the report print it.
  const source = readFileSync(
    resolve(root, "scripts/check-citation-liveness.mjs"),
    "utf8",
  );
  const header = headerSentences(source);

  // Derived from the table, which the test above has already re-derived from
  // the working tree - so these are tree figures, not restated ones.
  const scoped = DOCUMENTED_SYMBOL_VERDICTS.filter(
    (entry) => !Array.isArray(entry.verdict) && entry.verdict !== "referenced",
  );
  const helpers = scoped.filter((entry) => entry.verdict === "file-local");
  const survivors = scoped.filter((entry) => entry.verdict === "test-only");
  const flagged = scoped.length;
  const packages = new Set(helpers.map((entry) => entry.path.split("/")[1]))
    .size;
  const inApiRoutes = helpers.filter(
    (entry) => entry.path === "packages/api/src/routes/core/index.ts",
  ).length;
  const falsePositivePercent = Math.round((helpers.length / flagged) * 100);
  // Derived, not counted by hand: the header's argument for making a recorded
  // verdict a floor is that importing one of these from a second production
  // file is ORDINARY work, which is only true of the exported ones.
  const exportedHelpers = helpers.filter((entry) =>
    isExported(readFileSync(resolve(root, entry.path), "utf8"), entry.symbol),
  ).length;
  assert.equal(
    helpers.length + survivors.length,
    flagged,
    "the scoped set is no longer exactly file-local plus test-only, so the figures below mean something else",
  );

  for (const [claim, sentence] of [
    [flagged, `records ${flagged} cited symbols`],
    [helpers.length, `and ${helpers.length} of the ${flagged}`],
    [packages, `recorded across ${packages} packages`],
    [
      inApiRoutes,
      `${inApiRoutes} of the ${helpers.length} - \`reportCsv\` - is recorded in \`packages/api/src/routes/core/index.ts\``,
    ],
    [
      falsePositivePercent,
      `wrong about ${helpers.length} of them: a ${falsePositivePercent}% false-positive rate`,
    ],
    [survivors.length, `The ${survivors.length} that survive the correction`],
    [
      exportedHelpers,
      `${exportedHelpers} of the ${helpers.length} are exported`,
    ],
  ])
    assert.ok(
      header.includes(sentence),
      `the header no longer says "${sentence}" (derived value ${claim}); correct the header, do not delete the claim`,
    );

  // Every private helper the header lists by name is in the table, and every
  // table entry is listed - so the prose list cannot drift from the data.
  for (const entry of helpers)
    assert.ok(
      header.includes(`\`${entry.symbol}\``),
      `${entry.symbol} is a documented private helper the header does not name`,
    );

  // The numbered limits supply the only other legitimate numbers: the list
  // markers themselves, read off the header rather than assumed to be 1..n.
  const listMarkers = [...source.matchAll(/^\/\/ (\d+)\. /gm)].map((match) =>
    Number(match[1]),
  );
  assert.ok(listMarkers.length > 0, "the numbered limits are gone");
  // A list marker is an allow-listed number, so an unbounded marker regex is a
  // hole rather than a convenience: `// 58. ` reads as a limit heading and
  // admits 58 anywhere else in the commentary. Requiring the markers to be the
  // sequence starting at one is what bounds the exemption to an actual list.
  assert.deepEqual(
    listMarkers,
    listMarkers.map((_, index) => index + 1),
    "the numbered limits are not a 1..n sequence; an out-of-sequence marker is an unchecked figure wearing a heading's clothes",
  );
  const allowed = new Set([
    ...listMarkers,
    flagged,
    helpers.length,
    survivors.length,
    packages,
    inApiRoutes,
    falsePositivePercent,
    exportedHelpers,
  ]);
  const stray = [...new Set(numbersIn(commentaryOf(source)))].filter(
    (value) => !allowed.has(value),
  );
  assert.deepEqual(
    stray,
    [],
    `check-citation-liveness.mjs comments carry ${stray.join(", ")}, which this test did not derive from the tree. Ledger counts, commit hashes and line numbers rot; derive the figure here or drop it and let the report print it.`,
  );

  // The [UNCHECKED] convention: the test can enforce the number rule but cannot
  // tell whether an unnumbered sentence is true, and the header has to admit
  // that rather than imply everything in it is verified.
  assert.ok(
    header.includes("[UNCHECKED]"),
    "the header claims its prose is checked without marking the part that is not",
  );
});

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

// `file-local` and `test-only` are properties of `analyzeCitationLiveness`, and
// a corpus this file owns settles them exactly. The two tests below used to pin
// them against real symbols in the working tree instead - `reportCsv` scoring
// file-local with an empty reference list, `planExceptionEscalation` scoring
// test-only with one named test file - and that made them the same control this
// lane is here to remove: `planExceptionEscalation` is exported, this file runs
// in `pnpm test:unit`, and one production import or one passing mention in any
// scanned non-test file turned the repo-wide gate red without anything being
// wrong. The mechanism is proved synthetically; the real symbols the header
// names are still read from the tree, as a FLOOR, in the second half of each.

const syntheticCorpus = (declaringText, extras = []) => [
  { path: "packages/fixture/src/index.ts", text: declaringText },
  { path: "packages/fixture/src/unrelated.ts", text: "export const z = 1;\n" },
  ...extras,
];

test("a private helper called by its own module is not dead", () => {
  // The rule this checker was specified with - "at least one reference OUTSIDE
  // its defining file" - scored nine of the ledger's first twelve flagged
  // symbols dead on exactly this shape.
  const path = "packages/fixture/src/index.ts";
  const { failures, symbols } = analyzeCitationLiveness({
    citations: [cite("helper", path)],
    files: syntheticCorpus(
      "function helper() {}\nexport function caller() {\n  return helper();\n}\n",
    ),
  });
  assert.deepEqual(failures, []);
  assert.equal(symbols[0].verdict, "file-local");
  assert.deepEqual(symbols[0].references, []);
  assert.ok(
    symbols[0].inFileOccurrences > 1,
    "the declaration alone must not be enough to score file-local",
  );
  // A declaration and nothing else is NOT file-local; without this the rule
  // would rescue genuinely dead symbols too.
  assert.equal(
    analyzeCitationLiveness({
      citations: [cite("helper", path)],
      files: syntheticCorpus("function helper() {}\n"),
    }).symbols[0].verdict,
    "dead",
  );
  // The header's own example, as a floor: `reportCsv` is declared at
  // packages/api/src/routes/core/index.ts and called in the same file.
  const shipped = verdictFor([
    cite("reportCsv", "packages/api/src/routes/core/index.ts"),
  ]).symbols[0];
  assert.ok(
    ["file-local", "referenced"].includes(shipped.verdict),
    `the header calls reportCsv a helper reached from inside its own module; the tree says ${shipped.verdict}`,
  );
  assert.ok(shipped.inFileOccurrences > 1);
});

test("a symbol named only by its own test fails as test-only, not as absent", () => {
  // The state P0-64 found `toCsv` in: cited as implementation evidence, reached
  // by nothing but its own test. Separating that from `dead` is the whole
  // reason the two verdicts exist.
  const path = "packages/fixture/src/index.ts";
  const { failures, symbols } = analyzeCitationLiveness({
    citations: [cite("onlyTested", path)],
    files: syntheticCorpus("export function onlyTested() {}\n", [
      {
        path: "packages/fixture/src/index.test.ts",
        text: "import { onlyTested } from './index';\nonlyTested();\n",
      },
    ]),
  });
  assert.equal(symbols[0].verdict, "test-only");
  assert.deepEqual(symbols[0].references, []);
  assert.deepEqual(symbols[0].testReferences, [
    "packages/fixture/src/index.test.ts",
  ]);
  assert.deepEqual(
    failures.map((failure) => failure.id),
    [`CITATION_TEST_ONLY:${path}#onlyTested`],
  );
  // The header names three symbols in this state. Read as a floor - at least
  // test-only, i.e. something names them and they are not invisible - so that a
  // later production caller is an improvement rather than a red gate.
  for (const [treePath, symbol] of [
    ["packages/integrations/src/crm/index.ts", "FakeCrmProjectionAdapter"],
    ["packages/workflows/src/exceptions/index.ts", "planExceptionEscalation"],
    ["packages/workflows/src/migrations/index.ts", "waitForMigrationReview"],
  ]) {
    const scored = verdictFor([cite(symbol, treePath)]).symbols[0];
    assert.notEqual(
      scored.verdict,
      "dead",
      `${treePath}#${symbol}: the header records it as reached by its own tests, and nothing names it at all`,
    );
    assert.notEqual(
      scored.verdict,
      "unscanned",
      `${treePath}#${symbol}: the header names a file outside the scanned corpus`,
    );
  }
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
  // DELIBERATELY DOES NOT ASSERT A GREEN RUN, in either direction. When this
  // was written `pnpm check:citation-liveness` failed on three real test-only
  // citations; at b4fbcc8 the remap has removed all three and it exits zero.
  // Pinning either state would turn a moving finding into a merge hazard while
  // the ledger is being remapped, and asserting the CURRENT green would be
  // worse than asserting the old red - it would fail the moment the checker
  // does its job. What is pinned is that the checker has subjects, that every
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
  // test-only reference count. The second one no longer changes the VERDICT of
  // this pair - `scripts/validate-traceability.test.mjs` names them too, so
  // they are `test-only` either way - but it still puts this lane's own
  // assertions into the evidence a reader is shown, which is the thing the
  // exclusion is for.
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

  // The header used to say the same thing happened to `threeWayTieOut`. It did
  // not, and the difference matters: that symbol is referenced for a real
  // reason - the colliding declaration in limit 1 - so the header changed its
  // reference LIST and not its verdict. Pinned so the corrected sentence cannot
  // drift back.
  const collision = (corpus) =>
    analyzeCitationLiveness({
      citations: [cite("threeWayTieOut")],
      files: corpus,
    }).symbols[0];
  assert.equal(collision(files).verdict, "referenced");
  assert.equal(collision(unexcluded).verdict, "referenced");
  assert.deepEqual(collision(files).references, [
    "packages/integrations/src/core/accounting/adapter.ts",
  ]);
  assert.deepEqual(collision(unexcluded).references, [
    "packages/integrations/src/core/accounting/adapter.ts",
    "scripts/check-citation-liveness.mjs",
  ]);
  // And `weeklyScorecard` behaves exactly as `capacityPlanning` does, which is
  // what the header now claims for the pair rather than for a pair that
  // included the collision.
  const scorecard = analyzeCitationLiveness({
    citations: [cite("weeklyScorecard")],
    files: unexcluded,
  }).symbols[0];
  assert.equal(scorecard.verdict, "referenced");
  assert.deepEqual(scorecard.references, [
    "scripts/check-citation-liveness.mjs",
  ]);
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
