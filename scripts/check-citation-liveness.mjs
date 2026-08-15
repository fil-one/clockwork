// P0-71, LAYER 2. For every `path#symbol` citation in
// `docs/traceability/launch-requirements.json`, require a word-boundary
// reference to that symbol from somewhere other than its own declaration and
// other than a test file, across apps/, packages/, scripts/ and supabase/.
//
// That is P0-71's failure mode stated as a check. The entry found the ledger
// citing `capacityPlanning` and `weeklyScorecard` in
// `packages/domain/src/core/reports/index.ts` as evidence; both are declared,
// both are referenced by nothing anywhere in the repository, and the reports
// that actually ship are SQL views. `toCsv` was referenced only by its own test
// until P0-64 collapsed the two CSV writers onto it - it now has real callers
// in `packages/api/src/routes/core/index.ts` and
// `packages/workflows/src/core/csv.ts`. Distinguishing those three states is
// the whole job:
//
//   referenced  a non-test file other than the declaring one names it
//   file-local  only its own module names it - a private helper, which is fine
//   test-only   only test files name it            -> FAILS (the toCsv state)
//   dead        nothing names it at all            -> FAILS (capacityPlanning)
//
// USED WITHIN ITS OWN FILE. The rule this checker was specified with was "at
// least one reference OUTSIDE its defining file", and it does not survive the
// corpus. Run against the ledger's first 58 `path#symbol` citations it scored
// 12 dead, and NINE of the twelve were private helpers called from their own
// module: `reportCsv` (declared at packages/api/src/routes/core/index.ts:445,
// called at :694), `readReportView` (:2416, called at :7707),
// `recordDunningNotification`, `specExceptionQueues`, `CrmProjectionPort`,
// `crmProjectionTopics`, `mapCommerceEvent`, `withRuntimeBoundAdapters` and
// `lifecycleTaskExecutionSpecs`. A checker with a 75% false-positive rate is
// not a checker. Occurrences inside the defining file are therefore counted,
// with the declaration itself discounted: more than one occurrence means at
// least one use. The three that survive the correction are real, and are
// exactly P0-71's class - `FakeCrmProjectionAdapter`, `planExceptionEscalation`
// and `waitForMigrationReview` are cited as implementation evidence and are
// named by nothing but their own tests.
//
// ============================ WHAT IT DOES NOT PROVE ========================
//
// These limits are not a to-do list. They are the honest statement of what a
// green run buys, and P0-71 is itself the evidence for the first one.
//
// 1. A SAME-NAME COLLISION MASKS DEADNESS, and this is not hypothetical.
//    `threeWayTieOut` is declared twice in this repository:
//    `packages/domain/src/core/reports/index.ts:323` and
//    `packages/integrations/src/core/accounting/adapter.ts:296`. They are
//    different functions. A citation of the domain one is scored LIVE by this
//    checker, because the text `threeWayTieOut` appears outside the defining
//    file - in the OTHER declaration. The reference count is over identifier
//    text, not over an import graph, so it cannot tell the two apart. Every
//    green result for a symbol whose name is not unique is worth exactly
//    nothing.
//
// 2. ONE NON-TEST REFERENCE PROVES REFERENCED, NOT REACHABLE. A symbol used
//    only by other dead code passes. A symbol re-exported by a barrel that
//    nothing imports passes. Reachability from a production entrypoint needs a
//    real module graph and an entrypoint set, neither of which this has.
//
// 3. The scan is textual, and a COMMENT COUNTS AS A REFERENCE. It does not
//    distinguish code from prose, so `// capacityPlanning is dead` in any
//    scanned file scores that symbol live. This is not theoretical: the first
//    run of this checker's own tests scored `capacityPlanning` and
//    `threeWayTieOut` as referenced, because the header you are reading names
//    them and `scripts/` is a scan root. SELF_DOCUMENTING_FILES below removes
//    this file and its test from the corpus for that reason, and nothing else
//    is removed - the general case stands as a limit. Stripping comments was
//    considered and rejected: a regex that gets it wrong produces a FALSE DEAD
//    verdict, which is the direction that blocks a pull request.
//
// 4. The scan is textual in the other direction too. A symbol reached only
//    through dynamic dispatch, a string key, a generated file outside these
//    roots, or a template is scored DEAD when it is live. The exception map
//    below is the pressure valve for exactly that case, and it demands a
//    written reason.
//
// 5. It says nothing about prose citations, which are 2,141 of the ledger's
//    2,264 and are grandfathered in `scripts/validate-traceability.mjs`.
//
// NOT IN `verify:static`. Limits 1, 3 and 4 are false-verdict modes in both
// directions, and a checker that can wrongly block every future pull request
// does not belong in the gate that every pull request runs. Same call the
// schema-drift work made, for a weaker reason. Run it deliberately:
// `pnpm check:citation-liveness`.
//
// WHAT IT SAID ABOUT THE LEDGER, AND WHAT IT SAYS NOW. The ledger was being
// remapped while this was written. The first run against real citations scored
// 58 distinct symbols - 46 referenced, 9 file-local, 3 test-only, 0 dead - and
// the three test-only citations were replaced by the remapping lane before this
// landed. The current run is 55 distinct symbols, 46 referenced and 9
// file-local, and it exits zero. Those numbers move with every remap and the
// tests deliberately do not pin them; they pin the four verdicts against named
// symbols in the working tree instead.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

export const SCAN_ROOTS = Object.freeze([
  "apps",
  "packages",
  "scripts",
  "supabase",
]);

export const SCAN_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".sql",
]);

/**
 * Removed from the scanned corpus. This checker documents dead symbols BY NAME
 * in its header and asserts on them by name in its test, and `scripts/` is a
 * scan root, so scanning itself makes every symbol it discusses look
 * referenced. Nothing else is excluded: a comment in any other file still
 * counts as a reference, and that is limit 3 above rather than a bug to route
 * around here.
 */
export const SELF_DOCUMENTING_FILES = Object.freeze([
  "scripts/check-citation-liveness.mjs",
  "scripts/check-citation-liveness.test.mjs",
]);
// The test file needs its own entry even though `isTestFile` already matches
// it. Being a test file only keeps it out of the NON-test reference count; it
// still lands in `testReferences`, and that was enough to turn `dead` into
// `test-only` for the two symbols the tests assert on. Both channels have to be
// closed for the assertions to mean anything.

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  ".git",
  "dist",
  "build",
  "coverage",
  "out",
  "storybook-static",
  "playwright-report",
  "test-results",
]);

/** What a green run proves, and what it does not. */
export const COVERAGE = Object.freeze({
  covers: [
    "every `path#symbol` citation has a word-boundary occurrence of the symbol somewhere other than its own declaration and other than a test file",
    "a symbol named only by test files is reported separately as test-only rather than as absent",
    "every symbol scored dead or test-only is either a failure or a recorded exception with a written reason",
    "every recorded exception still names a cited symbol that is still dead or test-only",
  ],
  doesNotCover: [
    "symbol identity: a different declaration of the same name counts as a reference (`threeWayTieOut`)",
    "reachability: one non-test reference proves referenced, not reachable from a production entrypoint; a file-local verdict does not even prove the module is reached",
    "code versus prose: a mention in a comment counts as a reference",
    "declaration counting: an overloaded or twice-declared symbol reaches two occurrences on declarations alone and is scored file-local",
    "dynamic dispatch, string-keyed lookup, generated or templated call sites",
    "prose citations, which validate-traceability.mjs grandfathers",
    "whether the cited symbol is the one the requirement row actually means",
  ],
});

/**
 * Cited symbols that are genuinely dead to this checker's textual scan and are
 * kept anyway, each with the reason. Same shape and same both-directions
 * enforcement as `UNMIRRORED_TABLES` in `scripts/check-schema-drift.mjs`: an
 * unlisted dead symbol fails, AND a stale entry here fails - either because the
 * ledger no longer cites it or because it has acquired a reference and the
 * exception is no longer earned.
 *
 * Empty on purpose. The ledger has no `path#symbol` citations yet, so any entry
 * here today would be stale by construction and this file would fail its own
 * check.
 */
export const DEAD_CITATION_EXCEPTIONS = Object.freeze({});

/**
 * Test and fixture files, which are excluded from the reference count: a symbol
 * referenced only by its own test is exactly the state P0-64 found `toCsv` in,
 * and counting that as live would make the checker unable to see it.
 */
export function isTestFile(relativePath) {
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "e2e" ||
        segment === "__tests__" ||
        segment === "__fixtures__" ||
        segment === ".storybook",
    )
  )
    return true;
  if (relativePath.startsWith("packages/testing/")) return true;
  if (relativePath.startsWith("supabase/tests/")) return true;
  const file = segments.at(-1) ?? "";
  return /\.(test|spec|contract\.test|integration\.test|stories)\./.test(file);
}

/** `[{ id, column, value, path, symbol }]` from a ledger object. */
export function collectSymbolCitations(
  ledger,
  columns = [
    "domain",
    "api",
    "database",
    "workflowProvider",
    "portalDocument",
    "tests",
  ],
) {
  const citations = [];
  for (const requirement of ledger.requirements ?? [])
    for (const column of columns)
      for (const value of requirement[column] ?? []) {
        const match = /^([^\s#]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(value);
        if (!match) continue;
        citations.push({
          id: requirement.id,
          column,
          value,
          path: match[1],
          symbol: match[2],
        });
      }
  return citations;
}

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Pure. `files` is `[{ path, text }]` with repository-relative paths.
 * Returns `{ failures, symbols }` where each `symbols` entry records the
 * reference sites, so a green verdict can be inspected rather than trusted.
 */
export function analyzeCitationLiveness({
  citations,
  files,
  exceptions = DEAD_CITATION_EXCEPTIONS,
  isTest = isTestFile,
}) {
  const failures = [];
  const byKey = new Map();
  for (const citation of citations) {
    const key = `${citation.path}#${citation.symbol}`;
    if (!byKey.has(key)) byKey.set(key, { ...citation, key, citedBy: [] });
    byKey.get(key).citedBy.push(`${citation.id}:${citation.column}`);
  }

  const symbols = [];
  const deadKeys = new Set();
  for (const key of [...byKey.keys()].sort()) {
    const citation = byKey.get(key);
    const definingFile = files.find((file) => file.path === citation.path);
    if (!definingFile) {
      failures.push({
        id: `CITATION_DEFINING_FILE_UNSCANNED:${key}`,
        detail: `\`${citation.path}\` is not in the scanned corpus (${SCAN_ROOTS.join(", ")} with ${SCAN_EXTENSIONS.join(" ")}), so liveness cannot be decided either way`,
      });
      symbols.push({ ...citation, verdict: "unscanned", references: [] });
      continue;
    }
    const name = escapeRegExp(citation.symbol);
    const anywhere = new RegExp(String.raw`\b${name}\b`);
    const everywhere = new RegExp(String.raw`\b${name}\b`, "g");
    const others = files.filter((file) => file.path !== citation.path);
    const references = others
      .filter((file) => !isTest(file.path) && anywhere.test(file.text))
      .map((file) => file.path);
    const testReferences = others
      .filter((file) => isTest(file.path) && anywhere.test(file.text))
      .map((file) => file.path);
    // More than one occurrence in the defining file means at least one use
    // beside the declaration - a private helper called by its own module. See
    // the "USED WITHIN ITS OWN FILE" note in the header for why this is here.
    const inFileOccurrences = (definingFile.text.match(everywhere) ?? [])
      .length;
    const fileLocal = !isTest(definingFile.path) && inFileOccurrences > 1;

    let verdict = "dead";
    if (references.length > 0) verdict = "referenced";
    else if (fileLocal) verdict = "file-local";
    else if (testReferences.length > 0) verdict = "test-only";

    const excepted = Object.hasOwn(exceptions, key);
    const live = verdict === "referenced" || verdict === "file-local";
    if (!live) {
      deadKeys.add(key);
      if (!excepted)
        failures.push(
          verdict === "test-only"
            ? {
                id: `CITATION_TEST_ONLY:${key}`,
                detail: `cited as evidence by ${citation.citedBy.join(", ")}, and the only references are test files (${testReferences.join(", ")}); this is the state P0-64 found \`toCsv\` in`,
              }
            : {
                id: `CITATION_DEAD:${key}`,
                detail: `cited as evidence by ${citation.citedBy.join(", ")}, declared in \`${citation.path}\` and referenced nowhere at all, including inside its own file`,
              },
        );
    } else if (excepted) {
      failures.push({
        id: `CITATION_EXCEPTION_EARNED_BACK:${key}`,
        detail: `recorded in DEAD_CITATION_EXCEPTIONS, but it is now ${verdict} (${[...references, ...(fileLocal ? [`${inFileOccurrences} occurrences in ${citation.path}`] : [])].join(", ")}); delete the exception`,
      });
    }
    symbols.push({
      ...citation,
      verdict,
      excepted,
      references,
      testReferences,
      inFileOccurrences,
    });
  }

  for (const key of Object.keys(exceptions).sort()) {
    if (deadKeys.has(key)) continue;
    if (byKey.has(key)) continue;
    failures.push({
      id: `CITATION_EXCEPTION_STALE:${key}`,
      detail:
        "recorded in DEAD_CITATION_EXCEPTIONS, but the ledger no longer carries this citation",
    });
  }

  return { failures, symbols };
}

/** Repository-relative source files under SCAN_ROOTS. */
export function collectSourceFiles(
  baseDirectory = root,
  scanRoots = SCAN_ROOTS,
  selfDocumenting = SELF_DOCUMENTING_FILES,
) {
  const excluded = new Set(selfDocumenting);
  const files = [];
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".storybook") continue;
      const child = resolve(absolute, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        walk(child);
        continue;
      }
      if (!SCAN_EXTENSIONS.some((extension) => entry.name.endsWith(extension)))
        continue;
      const path = relative(baseDirectory, child);
      if (excluded.has(path)) continue;
      files.push({ path, text: readFileSync(child, "utf8") });
    }
  };
  for (const scanRoot of scanRoots) {
    const absolute = resolve(baseDirectory, scanRoot);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(absolute);
  }
  return files;
}

function main() {
  const ledger = JSON.parse(
    readFileSync(
      resolve(root, "docs/traceability/launch-requirements.json"),
      "utf8",
    ),
  );
  const citations = collectSymbolCitations(ledger);
  const files = collectSourceFiles();
  const { failures, symbols } = analyzeCitationLiveness({ citations, files });
  console.log(
    JSON.stringify(
      {
        source:
          "docs/traceability/launch-requirements.json `path#symbol` citations",
        scannedFiles: files.length,
        scannedNonTestFiles: files.filter((file) => !isTestFile(file.path))
          .length,
        symbolCitations: citations.length,
        distinctSymbols: symbols.length,
        verdicts: Object.fromEntries(
          ["referenced", "file-local", "test-only", "dead", "unscanned"].map(
            (verdict) => [
              verdict,
              symbols.filter((symbol) => symbol.verdict === verdict).length,
            ],
          ),
        ),
        exceptions: Object.keys(DEAD_CITATION_EXCEPTIONS).length,
        selfExcludedFromCorpus: SELF_DOCUMENTING_FILES,
        symbols,
        coverage: COVERAGE,
      },
      null,
      2,
    ),
  );
  if (failures.length > 0)
    throw new Error(
      `CITATION_LIVENESS_FAILED:${failures.length}\n${failures
        .map((failure) => `${failure.id} (${failure.detail})`)
        .join("\n")}`,
    );
}

if (process.argv[1] === import.meta.filename) main();
