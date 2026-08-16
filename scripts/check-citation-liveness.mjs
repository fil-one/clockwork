// P0-71, LAYER 2. For every `path#symbol` citation in
// `docs/traceability/launch-requirements.json`, require a word-boundary
// reference to that symbol from somewhere other than its own declaration and
// other than a test file, across apps/, packages/, scripts/ and supabase/.
//
// HOW THIS HEADER IS KEPT TRUE, AND WHY IT NEEDS KEEPING. Every earlier version
// of this comment block shipped a false statement, including the rewrite that
// claimed to have fixed the previous ones. That rewrite's own framing - "prose
// in a header is unchecked; the table is checked, so the prose cites the table
// instead of restating it" - was the false part: nothing read the prose, and
// the prose went on restating counts nothing re-computed. So the text is now
// CHECKED rather than reviewed. `check-citation-liveness.test.mjs` reads this
// comment block and:
//
//   * scores every symbol named below against the working tree, through
//     `DOCUMENTED_SYMBOL_VERDICTS`, and checks it against the verdict recorded
//     there - as a floor, for the reason given under A SINGLE RECORDED VERDICT
//     IS A FLOOR - and separately checks that each recorded file really
//     declares the symbol;
//   * asserts the sentences below that carry a number, against numbers it
//     derives itself from that table and the tree;
//   * REJECTS ANY OTHER NUMBER in the comment forms it reads, and those forms
//     are exactly two: every whole-line `//` comment, including this block, and
//     every `/*` or `/**` block that starts a line. It does NOT read a comment
//     that follows code on the same line, in either form, and it does not read
//     the inside of a string literal. A figure written in either of those is
//     unchecked, so do not write one there. What it enforces is membership - a
//     number in a scanned comment has to be one it computed - and not
//     placement, so it cannot tell that a figure it derived is being quoted for
//     the wrong thing; the sentences carrying those figures are pinned by exact
//     text as well, which is what covers that.
//
// It follows that no count in this header is a LEDGER count. Ledger counts move
// with every remap, cannot be pinned by a test in a tree several lanes are
// editing, and are printed live instead: run `pnpm check:citation-liveness` and
// read `symbolCitations`, `distinctSymbols` and `verdicts` in its report.
//
// What the test cannot check is whether an unnumbered sentence is true. A
// sentence nothing in this repository can settle is marked [UNCHECKED].
//
// P0-71's failure mode stated as a check. The entry found the ledger citing
// `capacityPlanning` and `weeklyScorecard` in
// `packages/domain/src/core/reports/index.ts` as evidence; both are declared,
// neither has ANY non-test reference anywhere in the repository, and the
// reports that actually ship are SQL views. `toCsv` was referenced only by its
// own test until P0-64 collapsed the two CSV writers onto it - it now has real
// callers in `packages/api/src/routes/core/index.ts` and
// `packages/workflows/src/core/csv.ts`. Distinguishing these four states is the
// whole job:
//
//   referenced  a non-test file other than the declaring one names it
//   file-local  only its own module names it - a private helper, which is fine
//   test-only   only test files name it            -> FAILS (the toCsv state)
//   dead        nothing names it at all            -> FAILS
//
// `capacityPlanning` and `weeklyScorecard` are the P0-71 pair, and they score
// `test-only` rather than `dead` for a reason worth stating: the files that name
// them are test files asserting on them as citation STRINGS, which is limit 3
// below arriving through the back door. Which of the two failing verdicts they
// land in therefore depends on files this checker does not own, which is why
// `DOCUMENTED_SYMBOL_VERDICTS` records both verdicts as acceptable for that pair
// and the tests assert failure rather than a verdict. The identity of those
// files is deliberately not written down here: pinning it would let an unrelated
// lane's edit break this one.
//
// USED WITHIN ITS OWN FILE. The rule this checker was specified with was "at
// least one reference OUTSIDE its defining file", and it does not survive the
// corpus. Beside the P0-71 pair, `DOCUMENTED_SYMBOL_VERDICTS` records 12 cited
// symbols that rule scored dead, and 9 of the 12 are reached from inside their
// own module: `reportCsv`, `readReportView`, `recordDunningNotification`,
// `specExceptionQueues`, `CrmProjectionPort`, `crmProjectionTopics`,
// `mapCommerceEvent`, `withRuntimeBoundAdapters` and
// `lifecycleTaskExecutionSpecs`, each with its declaring file recorded in that
// table. They are recorded across 5 packages, and 1 of the 9 - `reportCsv` -
// is recorded in `packages/api/src/routes/core/index.ts`. The previous version
// of this sentence said NONE of them lived there while the table below recorded
// `reportCsv` at exactly that path, which is the kind of contradiction the
// number check now catches. A rule that called all 12 dead would be wrong about
// 9 of them: a 75% false-positive rate, which is not a checker. Occurrences
// inside the defining file are therefore counted, with the declaration itself
// discounted: more than one occurrence means at least one use. The 3 that
// survive the correction are recorded test-only - `FakeCrmProjectionAdapter`,
// `planExceptionEscalation` and `waitForMigrationReview`, cited as
// implementation evidence and, when recorded, reached by nothing but their own
// tests.
//
// A SINGLE RECORDED VERDICT IS A FLOOR, NOT A SNAPSHOT, and that is the answer
// to a control that blocked legitimate work. 6 of the 9 are exported, so a
// second production file importing one is ordinary work rather than a contrived
// edit. The table used to pin the exact verdict, so that ordinary import turned
// `check-citation-liveness.test.mjs` RED - and that file runs in `pnpm
// test:unit`, everyone's gate, not in the opt-in `pnpm check:citation-liveness`
// - which made a foreign lane edit this lane's table and this header's
// sentences in lockstep in order to land an improvement. What is checked now is
// that each entry scores AT LEAST the verdict recorded against it on the
// ladder dead < test-only < file-local < referenced, is never `unscanned`, and
// is declared in the file recorded for it; the 9 are additionally checked to
// have more than one occurrence in that file, which is the property the
// paragraph above actually claims and which an outside caller cannot take away.
// A symbol becoming MORE live passes. Becoming less live, losing its
// declaration, or moving file still fails, because those are the directions
// this header can be wrong in.
//
// THE ONE PIN THAT IS STILL EXACT is the P0-71 pair, whose entries record an
// array rather than a string: an array is an exact acceptable set, not a floor.
// A production caller for `capacityPlanning` or `weeklyScorecard` would turn
// `pnpm test:unit` red, deliberately, because it would retire P0-71's finding.
// The fix in that case is to delete the assertion and the entry, not to weaken
// the checker.
//
// ============================ WHAT IT DOES NOT PROVE ========================
//
// These limits are not a to-do list. They are the honest statement of what a
// green run buys, and P0-71 is itself the evidence for the first one.
//
// 1. A SAME-NAME COLLISION MASKS DEADNESS, and this is not hypothetical.
//    `threeWayTieOut` is declared twice in this repository, in
//    `packages/domain/src/core/reports/index.ts` and in
//    `packages/integrations/src/core/accounting/adapter.ts`. They are
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
//    `weeklyScorecard` as REFERENCED - not test-only, referenced - because the
//    header you are reading names them and `scripts/` is a scan root. Their
//    only "reference" was this comment. `threeWayTieOut` was affected
//    differently and the difference is worth keeping straight: it is referenced
//    for a real reason, the colliding declaration in limit 1, so the header only
//    added a second entry to its reference LIST and did not change its verdict.
//    SELF_DOCUMENTING_FILES below removes this file and its test from the corpus
//    for that reason, and nothing else is removed - the general case stands as a
//    limit. Stripping comments was considered and rejected: a regex that gets it
//    wrong produces a FALSE DEAD verdict, which is the direction that blocks a
//    pull request.
//
// 4. The scan is textual in the other direction too. A symbol reached only
//    through dynamic dispatch, a string key, a generated file outside these
//    roots, or a template is scored DEAD when it is live. The exception map
//    below is the pressure valve for exactly that case, and it demands a
//    written reason.
//
// 5. It says nothing about prose citations, which are the large majority of
//    the ledger's evidence values and are grandfathered in
//    `scripts/validate-traceability.mjs`. The split moves with every remap and
//    is deliberately not restated here; `pnpm check:traceability` prints it
//    live as `citationGrammar.prose` over `citationGrammar.total`.
//
// THE CHECKER IS NOT IN `verify:static`; ITS TEST FILE IS IN `test:unit`. Those
// are different things and this paragraph used to give only the first. Limits 1,
// 3 and 4 are false-verdict modes in both directions, and a checker that can
// wrongly block every future pull request does not belong in the gate that every
// pull request runs, so `main()` is opt-in: run it deliberately with
// `pnpm check:citation-liveness`. Same call the schema-drift work made, for a
// weaker reason. But `check-citation-liveness.test.mjs`, which reads this header
// and asserts `DOCUMENTED_SYMBOL_VERDICTS` against the tree, IS listed in
// `pnpm test:unit` and does run on every pull request. Anything pinned there is
// pinned for the whole repository, which is why the pins are floors.
//
// WHAT IT SAYS ABOUT THE LEDGER. Nothing, in this header. The ledger is owned
// by another lane and remapped row by row, so every figure about it lives in
// this script's own report and nowhere else: `symbolCitations`,
// `distinctSymbols`, `verdicts` and `exceptions`, re-derived on every run. The
// tests pin the verdicts in `DOCUMENTED_SYMBOL_VERDICTS` against the working
// tree instead, and those do not depend on the ledger at all.
//
// [UNCHECKED] Historical, and not re-derivable from this tree: the first run of
// this checker against real citations failed on test-only citations that the
// remapping lane then replaced. Nothing in the repository records that state,
// so no test asserts it and no count for it is given here.
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
// still lands in `testReferences`, which is reported and read as evidence, so a
// green verdict would be citing this checker's own assertions back at the
// reader. Both channels have to be closed for the reference SITES to mean
// anything.
//
// The exclusion of the test file is not load-bearing for the VERDICT of the
// P0-71 pair - other test files in the repository name those symbols too - but
// the exclusion of THIS file is: drop `check-citation-liveness.mjs` from the
// corpus list and both symbols pop straight to `referenced` off this header
// alone, which is exactly limit 3. That is asserted, both ways, by
// "the checker's own documentation does not make the symbols it names look live".

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
 * EVERY FACTUAL CLAIM THIS FILE'S HEADER MAKES ABOUT A NAMED SYMBOL, in the one
 * form a test can check. `verdict` says what `analyzeCitationLiveness` must
 * return for `path#symbol` against the real working tree, in two flavours:
 *
 *   a STRING is a FLOOR. The tree has to score the symbol at least this live on
 *     the ladder dead < test-only < file-local < referenced. Scoring higher is
 *     an improvement and passes, because a foreign lane giving one of these an
 *     outside caller is ordinary work and must not turn a repo-wide gate red.
 *   an ARRAY is an EXACT acceptable set, and the entry says why. It is used
 *     only where the failing state IS the finding, so that leaving the state is
 *     something a human should look at.
 *
 * This exists because this header's prose was wrong and nothing could read it.
 * The first version attributed `readReportView` to
 * `packages/api/src/routes/core/index.ts` when it is declared in
 * `packages/db/src/repositories/core/database-finance.ts`, and described
 * `capacityPlanning` as "referenced by nothing anywhere in the repository" when
 * a test file names it, which is the whole difference between the `dead` and
 * `test-only` verdicts this checker exists to separate. A later version said
 * none of the private helpers listed below lived in
 * `packages/api/src/routes/core/index.ts` while this very table recorded
 * `reportCsv` there. None of the three errors was reachable by any test,
 * because none was expressed as anything a test could read. Every claim the
 * header makes about a named symbol is now an entry here, and the header's
 * counts are derived FROM here rather than written beside it.
 *
 * IT REFUSES NO CITATION, BUT IT IS NOT HARMLESS EITHER, and the previous
 * version of this note got the second half wrong. The table is asserted by
 * `check-citation-liveness.test.mjs` and is not consulted by `main()`, so it
 * cannot fail a citation, exempt one, or change any verdict. What it can do is
 * fail `check-citation-liveness.test.mjs` - which `package.json` runs from
 * `pnpm test:unit`, the repo-wide gate, and NOT from the opt-in
 * `pnpm check:citation-liveness`. Calling that "this lane's own test suite", as
 * this note used to, understated it by the whole repository. That is why a
 * string verdict is a floor rather than a snapshot: the only edits that turn it
 * red are ones where the header has genuinely stopped being true.
 */
export const DOCUMENTED_SYMBOL_VERDICTS = Object.freeze([
  // The P0-71 pair: cited as evidence, zero non-test references. `dead` and
  // `test-only` are both failures and both correct depending on whether some
  // unrelated test file happens to name them, which is why both are accepted.
  // An array here means "any of these", not "unknown".
  Object.freeze({
    path: "packages/domain/src/core/reports/index.ts",
    symbol: "capacityPlanning",
    verdict: Object.freeze(["dead", "test-only"]),
  }),
  Object.freeze({
    path: "packages/domain/src/core/reports/index.ts",
    symbol: "weeklyScorecard",
    verdict: Object.freeze(["dead", "test-only"]),
  }),
  // Live, and the reason each is live is different.
  Object.freeze({
    path: "packages/domain/src/core/reports/index.ts",
    symbol: "toCsv",
    verdict: "referenced",
  }),
  // Referenced only by the OTHER declaration of the same name; limit 1.
  Object.freeze({
    path: "packages/domain/src/core/reports/index.ts",
    symbol: "threeWayTieOut",
    verdict: "referenced",
  }),
  // The private helpers the "outside its defining file" rule scored dead. Their
  // count, their package spread and how many of them share a file are all
  // derived from THIS LIST by the header-claims test; do not restate them here.
  Object.freeze({
    path: "packages/api/src/routes/core/index.ts",
    symbol: "reportCsv",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/db/src/repositories/core/database-finance.ts",
    symbol: "readReportView",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/db/src/repositories/workflows/core.ts",
    symbol: "recordDunningNotification",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/domain/src/exceptions/index.ts",
    symbol: "specExceptionQueues",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/integrations/src/crm/index.ts",
    symbol: "CrmProjectionPort",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/integrations/src/crm/index.ts",
    symbol: "crmProjectionTopics",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/integrations/src/crm/index.ts",
    symbol: "mapCommerceEvent",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/workflows/src/runtime/environment-production-adapters.ts",
    symbol: "withRuntimeBoundAdapters",
    verdict: "file-local",
  }),
  Object.freeze({
    path: "packages/workflows/src/runtime/provider-lifecycle.ts",
    symbol: "lifecycleTaskExecutionSpecs",
    verdict: "file-local",
  }),
  // The three the correction does not rescue: cited as implementation evidence,
  // named by nothing but their own tests. The remapping lane removed all three
  // from the ledger before this landed, so they are no longer cited; they are
  // still in this state in the tree, which is what makes them usable fixtures.
  Object.freeze({
    path: "packages/integrations/src/crm/index.ts",
    symbol: "FakeCrmProjectionAdapter",
    verdict: "test-only",
  }),
  Object.freeze({
    path: "packages/workflows/src/exceptions/index.ts",
    symbol: "planExceptionEscalation",
    verdict: "test-only",
  }),
  Object.freeze({
    path: "packages/workflows/src/migrations/index.ts",
    symbol: "waitForMigrationReview",
    verdict: "test-only",
  }),
]);

/**
 * Cited symbols that are genuinely dead to this checker's textual scan and are
 * kept anyway, each with the reason. Same shape and same both-directions
 * enforcement as `UNMIRRORED_TABLES` in `scripts/check-schema-drift.mjs`: an
 * unlisted dead symbol fails, AND a stale entry here fails - either because the
 * ledger no longer cites it or because it has acquired a reference and the
 * exception is no longer earned.
 *
 * Empty because nothing has earned an entry, not because there is nothing to
 * score: the ledger's `path#symbol` citations all currently score referenced or
 * file-local, so any entry added here today would immediately fail as
 * `CITATION_EXCEPTION_EARNED_BACK` or `CITATION_EXCEPTION_STALE`. The live
 * tallies are `verdicts` and `exceptions` in this script's report; they are not
 * restated here because they move with the ledger, which this lane does not own.
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
