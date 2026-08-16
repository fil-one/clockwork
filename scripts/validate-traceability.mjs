// Validates `docs/traceability/launch-requirements.json` against its schema, the
// contract it is generated from, `docs/backlog.md`, the external-gate registry,
// and - since P0-71 - the grammar of its own evidence citations.
//
// NO LEDGER COUNT APPEARS IN THIS HEADER, and that is a rule rather than a
// style. Earlier versions carried dated tallies - citation totals, prose shares,
// percentages - written by hand and re-derived by nothing, and one of those
// percentages had never been the share on any revision of this ledger. The
// ledger is owned by the lane remapping it and every one of those figures moves
// when it does. `validate-traceability.test.mjs` REJECTS ANY NUMBER IT DID NOT
// DERIVE ITSELF, in the comment forms it reads. Those forms are exactly two:
// every whole-line `//` comment, including this block, and every `/*` or `/**`
// block that starts a line. It does not read a comment that follows code on the
// same line, in either form, and it does not read the inside of a string
// literal - a figure written in either place is unchecked, so do not write one
// there. What it enforces is membership: a number in a scanned comment has to be
// one the test computed. It does not enforce placement, so it cannot tell that a
// figure it derived is being quoted for the wrong thing. The live figures are in
// `citationGrammar` in this script's own report, on every run.
//
// TWO THINGS CHANGED HERE, AND THEY ARE INDEPENDENT.
//
// 1. IT NO LONGER STOPS AT THE FIRST OFFENDER. Every check used to `throw` in
//    place, so a run reported exactly one identifier and the next run reported
//    the next one. Remapping a batch of ledger rows against a one-error-per-run
//    oracle costs one full validation per error. Failures are now collected and
//    printed together and the process exits non-zero at the end. The failure
//    IDENTIFIERS are unchanged, and any single-identifier grep over this
//    script's output still matches.
//
//    HOW THE RUN CAN STILL END EARLY, AS TWO SEPARATE CLAIMS. The previous
//    version of this paragraph ran them together and was false for it, so they
//    are kept apart here.
//
//    The first is a count of CODE, and it is small on purpose: this file has 2
//    explicit `fatal` call sites - a ledger whose `requirements` is not a usable
//    array, and an unreadable gate registry - and each prints the
//    TRACEABILITY_FAILURES header with everything collected before the stop. The
//    test derives that 2 by counting `fatal(` in the source, so the sentence
//    cannot drift from the code.
//
//    The second is a claim about BEHAVIOUR, and counting `fatal(` cannot
//    establish it. An uncaught TypeError also ends the run - exit non-zero, no
//    header, not one collected identifier - and by construction it has no
//    `fatal(` token for a token count to see. The previous version asserted that
//    the token count WAS the number of early stops, which is the same error in
//    miniature as the sentence it was written to fix. So the behaviour is
//    MEASURED instead: "a malformed ledger is reported, not crashed on" drives a
//    matrix of malformed shapes end to end through the real script in a fixture
//    tree and requires each to exit non-zero, print the header, and print no
//    TypeError. That matrix is a SAMPLE. It covers every shape known to have
//    crashed this script; a shape nobody has tried can still crash it, and no
//    test here can say otherwise. [UNCHECKED] as a universal claim.
//
//    THE SHAPES THAT DID CRASH IT, all pre-existing, all now reportable, and
//    all in the matrix. "`requirements` is not a usable array" has three of
//    them - not an array, empty, and an array of non-objects - and only the
//    empty one ever reached its own `fatal`; the other two died first inside
//    `assertSchemaShape`, on `for...of` over a non-iterable and on
//    `field in requirement` against a primitive. `isReadableRequirement` and
//    `requirementsFatal` below make those two reportable, and the guard's full
//    refused set is enumerated by "the complete refused set of the requirements
//    guard". A malformed `statusPolicy` produced the same outcome by four more
//    routes, none of which any earlier version of this header admitted to: a
//    PRIMITIVE `statusPolicy` (`??` catches null and undefined, not `"x"`, so
//    `field in statusPolicy` threw), a non-array `notes` (`.includes` is not a
//    function), and a non-string member of `reviewedAgainst` or of
//    `evidenceManifests` (`resolve()` refuses a number). `isPlainObject` and
//    `stringMembers` below make those four reportable too.
//
// 2. CITATION GRAMMAR (P0-71, LAYER 1). See CITATION_COVERAGE below for what a
//    green run does and does not prove. Read that before trusting this file.
//
// WHY THE BACKLOG ENTRY'S PRESCRIBED FIX IS NOT WHAT IS IMPLEMENTED. P0-71 asks
// for "every cited symbol resolves to a definition reachable from production".
// [UNCHECKED - a dated measurement of a file this lane does not own, re-derived
// by hand from the ledger as it stood before this grammar landed, and by no
// test] NOT ONE of the ledger's citations was then of the form
// `path#symbol`: the evidence columns held repository paths and, overwhelmingly,
// prose labels ("package boundaries", "external gate state", "report tests"),
// API route paths ("/v1/core"), package specifiers ("@clockwork/ui") and module
// shorthands ("core/accounts"). There is no symbol in any of those to resolve.
// Converting them is a corpus project, not a validator change, so the validator
// instead enforces the grammar the ledger ALREADY claims for itself in
// `statusPolicy.mappingSemantics` - "Path-like values are exact repository
// paths; ... remaining human-readable labels are search terms" - and says out
// loud which citations it did not check. The conversion is still under way; how
// far it has got is `citationGrammar.symbol` over `citationGrammar.total`.
//
// A NAIVE READING OF THAT RULE DOES NOT WORK EITHER, and this is worth writing
// down because it is the obvious first implementation. "A citation containing
// `/` must resolve on disk" fails the clear majority of slash-bearing
// citations, because "quote/order artifacts", "renewal/notice UI" and
// "/v1/lifecycle" all contain a slash and none of them is a path. That is not
// an estimate and it is not restated here as a figure either: the run measures
// the rejected rule against the current ledger and prints it as
// `citationGrammar.naiveSlashRule`, so a reader can see the damage it would do
// today rather than on the day this was written. The discriminator that works
// is an anchor on a real top-level repository directory plus the absence of
// whitespace; see `classifyCitation`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

/** The six evidence columns. `externalGates` and `backlog` are identifier
 * columns with their own referential checks and are deliberately excluded. */
export const CITATION_COLUMNS = Object.freeze([
  "domain",
  "api",
  "database",
  "workflowProvider",
  "portalDocument",
  "tests",
]);

/**
 * A citation is treated as a repository path only if it is anchored on one of
 * these. This list is FROZEN rather than read off the disk on purpose: deriving
 * it would mean that deleting `packages/` silently reclassifies every
 * `packages/...` citation as unchecked prose, which is the wrong direction to
 * fail in. Each root is itself asserted to exist, so the list cannot rot
 * unnoticed.
 */
export const CITATION_PATH_ROOTS = Object.freeze([
  "apps",
  "docs",
  "packages",
  "patches",
  "scripts",
  "supabase",
]);

/** What a green citation-grammar run proves, and what it does not. */
export const CITATION_COVERAGE = Object.freeze({
  covers: [
    "a citation anchored on a top-level repository directory names a path that exists on disk",
    "brace alternatives and a trailing `/**` or `/*` are expanded before that check, so each concrete prefix must exist",
    "a `path#symbol` citation names a file that exists and a symbol declared in that file",
    "each anchor directory in CITATION_PATH_ROOTS still exists",
  ],
  doesNotCover: [
    "prose citations: they are GRANDFATHERED and not checked at all - see CITATION_GRANDFATHERING",
    "whether a path that exists has anything to do with the requirement that cites it",
    "whether a declared symbol is the one the row means, or is referenced, or is reachable from production - `pnpm check:citation-liveness` covers the reference half, badly enough that it is not in verify:static",
    "symbol declarations the regex cannot see: re-exports through barrels, object-literal members, declaration merging, anything constructed dynamically",
    "API route paths, package specifiers and module shorthands, which are classified as prose",
  ],
});

/**
 * Prose citations are not checked, and that is a decision rather than an
 * oversight. The large majority of the ledger's citations are prose labels
 * inherited from a ledger written before any checker existed. Failing them all
 * would make the gate unrunnable on day one; converting them is a corpus
 * project that has to happen row by row against the code, which is what the
 * rows P0-71 names are for. The rule for NEW work is in CITATION_POLICY_NOTE.
 *
 * `reason` below carries NO percentage, deliberately, and neither does this
 * comment. The share falls with every converted row, and a number frozen into
 * an exported string is a false claim with a delay fuse - the string this
 * replaces quoted a percentage that had never been the share on any revision of
 * this ledger. `citationGrammar.prose` over `citationGrammar.total` in the
 * report is the live figure, and the test rejects any percentage written back
 * into either place.
 */
export const CITATION_GRANDFATHERING = Object.freeze({
  rule: "A citation that is neither anchored on a top-level repository directory nor of the form `path#symbol` is not checked.",
  reason:
    "The ledger predates any citation checker and the large majority of its citations are prose search terms, which statusPolicy.mappingSemantics already documents as search terms rather than locators. The current share is citationGrammar.prose over citationGrammar.total in this script's report.",
  narrowing:
    "Rows edited from now on must cite `path#symbol`, which moves citations out of the grandfathered class one row at a time.",
});

/**
 * The exact text `statusPolicy.notes` must carry, per P0-71's "add a rule to
 * statusPolicy.notes".
 *
 * NOT ASSERTED. This lane may not edit
 * `docs/traceability/launch-requirements.json` - the lane remapping the ledger
 * rows owns that file - so an assertion here would fail on a wording change
 * that lane is entitled to make, and would punish the wrong person.
 * `citationGrammar.statusPolicyNotePresent` in the report says whether the
 * ledger carries this exact string, and `statusPolicyNoteExpected` prints the
 * string to copy. Turning the flag into a gate is one line:
 *
 *   if (!stringMembers(statusPolicy.notes).includes(CITATION_POLICY_NOTE))
 *     fail("TRACEABILITY_CITATION_POLICY_NOTE_MISSING");
 *
 * The note is documentation; the grammar above is enforcement. The grammar does
 * not wait on the note.
 */
export const CITATION_POLICY_NOTE =
  "Evidence citations: every requirement row edited from this point forward must cite `path#symbol` in its implementation and tests columns, where the path exists in the repository and the symbol is declared in that file. Pre-existing prose citations are grandfathered and are converted row by row; `pnpm check:traceability` enforces the grammar and `pnpm check:citation-liveness` reports cited symbols that nothing references outside their own declaration and outside test files.";

function escapeRegExp(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * `a/{b,c}/d` -> `["a/b/d", "a/c/d"]`. Nested and repeated groups expand.
 * Anything without a group returns itself, so callers need no special case.
 */
export function expandCitationBraces(value) {
  const group = /\{([^{}]*)\}/.exec(value);
  if (!group) return [value];
  return group[1]
    .split(",")
    .flatMap((alternative) =>
      expandCitationBraces(
        value.slice(0, group.index) +
          alternative +
          value.slice(group.index + group[0].length),
      ),
    );
}

const SYMBOL_CITATION = /^([^\s#]+)#([A-Za-z_$][A-Za-z0-9_$]*)$/;

/**
 * `{ kind: "symbol" | "path" | "prose" | "malformed" }`.
 *
 * The whitespace test is what separates "packages/db schema" (a prose search
 * term that happens to start with a package directory) from "packages/db" (a
 * path). The root anchor is what separates "packages/domain/src/core" from
 * "core/accounts" and "/v1/core".
 */
export function classifyCitation(value) {
  const symbol = SYMBOL_CITATION.exec(value);
  if (symbol)
    return { kind: "symbol", value, path: symbol[1], symbol: symbol[2] };
  if (value.includes("#"))
    return {
      kind: "malformed",
      value,
      detail:
        "contains `#` but is not `path#symbol` with a valid identifier after the `#`",
    };
  if (/\s/.test(value)) return { kind: "prose", value };
  const anchored = CITATION_PATH_ROOTS.some(
    (root_) => value === root_ || value.startsWith(`${root_}/`),
  );
  if (!anchored) return { kind: "prose", value };
  const targets = [];
  for (const expanded of expandCitationBraces(value)) {
    const target = expanded.replace(/\/\*\*$/, "").replace(/\/\*$/, "");
    if (/[*?]/.test(target))
      return {
        kind: "malformed",
        value,
        detail: `glob metacharacter survives expansion in \`${target}\`; only a trailing \`/**\` or \`/*\` and \`{a,b}\` alternatives are understood`,
      };
    targets.push(target);
  }
  return { kind: "path", value, targets };
}

/**
 * Regex over declaration forms, not a parser, and the difference matters: it
 * answers "does this file declare that name", not "does this file export the
 * thing the row means". It covers the TypeScript declaration forms this
 * repository writes plus the `create ...` forms in the SQL migrations, because
 * the reports P0-71 is about ship as SQL views.
 */
export function symbolIsDeclared(sourceText, symbol) {
  const name = escapeRegExp(symbol);
  const typescript = [
    String.raw`\bexport\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s+${name}\b`,
    String.raw`\bexport\s+(?:declare\s+)?(?:const|let|var)\s+${name}\b`,
    String.raw`\bexport\s+(?:abstract\s+)?class\s+${name}\b`,
    String.raw`\bexport\s+(?:interface|type|enum|namespace)\s+${name}\b`,
    String.raw`\bexport\s+\{[^}]*\b${name}\b[^}]*\}`,
    String.raw`\b(?:async\s+)?function\s*\*?\s+${name}\b`,
    String.raw`\b(?:const|let|var)\s+${name}\s*[=:]`,
    String.raw`\b(?:abstract\s+)?class\s+${name}\b`,
    String.raw`\b(?:interface|enum|namespace)\s+${name}\b`,
    String.raw`\btype\s+${name}\s*[=<]`,
  ];
  if (typescript.some((pattern) => new RegExp(pattern).test(sourceText)))
    return true;
  const sql = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?(?:materialized\s+|unique\s+|recursive\s+)?(?:function|procedure|view|table|index|policy|trigger|type|schema)\s+(?:if\s+not\s+exists\s+)?(?:[a-z_][\w]*\.)?"?${name}"?\b`,
    "i",
  );
  return sql.test(sourceText);
}

/**
 * Pure. `entryKind(relativePath)` returns `"file" | "directory" | null`;
 * `readSource(relativePath)` returns the file text. Keeping both injected is
 * what lets the grammar be tested against a fixture tree with no disk.
 */
export function checkCitationGrammar({
  requirements,
  entryKind,
  readSource,
  columns = CITATION_COLUMNS,
  pathRoots = CITATION_PATH_ROOTS,
}) {
  const failures = [];
  const counts = { total: 0, path: 0, symbol: 0, prose: 0, malformed: 0 };
  const grandfathered = new Set();
  // The rejected implementation, measured rather than described. Keeping it in
  // the report is what lets the header stop quoting a number that rots: a
  // reader who thinks "a citation with a slash must be a path" can see the
  // damage that rule would do to THIS ledger, today.
  const naiveSlashRule = {
    rule: "a citation containing `/` must resolve on disk",
    slashBearing: 0,
    slashBearingDistinct: 0,
    wouldFail: 0,
    wouldFailDistinct: 0,
  };
  const slashSeen = new Set();
  const slashFailed = new Set();

  for (const root_ of pathRoots)
    if (entryKind(root_) !== "directory")
      failures.push({
        id: `TRACEABILITY_CITATION_ROOT_MISSING:${root_}`,
        detail:
          "CITATION_PATH_ROOTS anchors the path grammar on this directory and it is not a directory in the repository; every citation under it is being silently reclassified as prose",
      });

  for (const requirement of requirements) {
    for (const column of columns) {
      const values = Array.isArray(requirement[column])
        ? requirement[column]
        : [];
      for (const value of values) {
        if (typeof value !== "string" || value.length === 0) continue;
        counts.total += 1;
        if (value.includes("/")) {
          naiveSlashRule.slashBearing += 1;
          slashSeen.add(value);
          if (entryKind(value) === null) {
            naiveSlashRule.wouldFail += 1;
            slashFailed.add(value);
          }
        }
        const where = `${requirement.id}:${column}:${value}`;
        const citation = classifyCitation(value);
        if (citation.kind === "prose") {
          counts.prose += 1;
          grandfathered.add(value);
          continue;
        }
        if (citation.kind === "malformed") {
          counts.malformed += 1;
          failures.push({
            id: `TRACEABILITY_CITATION_MALFORMED:${where}`,
            detail: citation.detail,
          });
          continue;
        }
        if (citation.kind === "path") {
          counts.path += 1;
          for (const target of citation.targets)
            if (entryKind(target) === null)
              failures.push({
                id: `TRACEABILITY_CITATION_PATH_MISSING:${where}`,
                detail: `no file or directory at \`${target}\``,
              });
          continue;
        }
        counts.symbol += 1;
        const kind = entryKind(citation.path);
        if (kind === null) {
          failures.push({
            id: `TRACEABILITY_CITATION_SYMBOL_FILE_MISSING:${where}`,
            detail: `no file at \`${citation.path}\``,
          });
          continue;
        }
        if (kind !== "file") {
          failures.push({
            id: `TRACEABILITY_CITATION_SYMBOL_NOT_A_FILE:${where}`,
            detail: `\`${citation.path}\` is a directory; a \`path#symbol\` citation must name the file that declares the symbol`,
          });
          continue;
        }
        if (!symbolIsDeclared(readSource(citation.path), citation.symbol))
          failures.push({
            id: `TRACEABILITY_CITATION_SYMBOL_UNDEFINED:${where}`,
            detail: `no declaration of \`${citation.symbol}\` found in \`${citation.path}\``,
          });
      }
    }
  }

  naiveSlashRule.slashBearingDistinct = slashSeen.size;
  naiveSlashRule.wouldFailDistinct = slashFailed.size;

  return {
    failures,
    counts,
    grandfatheredDistinct: grandfathered.size,
    naiveSlashRule,
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A value `field in value` and `Object.keys(value)` can be run against without
 * throwing. `??` does not do this job: it passes a primitive straight through,
 * and `"x" ?? {}` is `"x"`, which is exactly how a primitive `statusPolicy`
 * used to end the run with an uncaught TypeError and no header.
 */
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The non-empty string members of a value that is supposed to be an array of
 * paths, and nothing else. `resolve()` throws on a number rather than returning
 * false, so filtering here is what turns a numeric member of `reviewedAgainst`
 * or `evidenceManifests` from a crash into a collected
 * TRACEABILITY_STATUS_POLICY_ARRAY_VALUE identifier.
 */
export function stringMembers(value) {
  return Array.isArray(value)
    ? value.filter((member) => typeof member === "string" && member.length > 0)
    : [];
}

/**
 * A `requirements` entry this validator can read at all. Everything downstream
 * does `field in requirement` and `requirement.id`, and `in` throws a TypeError
 * on a primitive rather than returning false.
 *
 * REFUSED SET, COMPLETE: `null`, and any value whose `typeof` is not `"object"`
 * - string, number, boolean, bigint, symbol, undefined, function - and arrays.
 * Nothing legitimate is in it. `launch-requirements.schema.json` declares
 * `requirements` as an array of `$defs.requirement`, whose `type` is `"object"`,
 * so every entry a valid ledger can hold is a plain object and passes. This
 * predicate does not look at the entry's CONTENTS: a `{}` with no `id` passes
 * here and is then reported field by field by `assertSchemaShape`, which is the
 * point - the guard exists to keep the collecting validator alive, not to
 * duplicate it.
 */
export function isReadableRequirement(value) {
  return isPlainObject(value);
}

/**
 * `null` when `requirements` can carry the rest of the run, otherwise the
 * identifier to stop on. Both outcomes belong to the SAME documented fatal
 * class - "a ledger whose `requirements` is not a usable array" - and there are
 * still exactly two such classes.
 *
 * The second identifier is why this function exists. An array of non-objects
 * cleared the old "is it an array, and is it non-empty" guard and then died
 * inside `assertSchemaShape` with an uncaught TypeError, printing no
 * TRACEABILITY_FAILURES header and not one collected identifier - strictly
 * worse than the fatal stop it evaded, and a third way for the run to end early
 * that the file header did not admit to. A non-array `requirements` reached the
 * same crash one step sooner, on `for...of` over a non-iterable, so the first
 * fatal was unreachable in the case it was written for.
 */
export function requirementsFatal(requirements) {
  if (!Array.isArray(requirements) || requirements.length === 0)
    return "TRACEABILITY_REQUIREMENTS_EMPTY";
  const unreadable = requirements
    .map((requirement, index) =>
      isReadableRequirement(requirement) ? -1 : index,
    )
    .filter((index) => index >= 0);
  if (unreadable.length > 0)
    return `TRACEABILITY_REQUIREMENTS_NOT_OBJECTS:${unreadable.join(",")}`;
  return null;
}

/**
 * Thrown by the two checks whose failure makes every later check meaningless:
 * a ledger with no usable `requirements` array, and an unreadable gate
 * registry. It carries everything collected before the stop so the run still
 * reports more than one identifier where it can.
 */
class FatalValidationError extends Error {
  constructor(failures) {
    super(failures.at(-1) ?? "TRACEABILITY_FATAL");
    this.name = "FatalValidationError";
    this.failures = failures;
  }
}

function main() {
  const failures = [];
  /** Collect and keep going. */
  const fail = (id) => {
    failures.push(String(id));
  };
  /** Collect, then stop: continuing past this point produces a TypeError
   * rather than another validation error. */
  const fatal = (id) => {
    fail(id);
    throw new FatalValidationError(failures);
  };

  const ledgerPath = resolve(
    root,
    "docs/traceability/launch-requirements.json",
  );
  const schemaPath = resolve(
    root,
    "docs/traceability/launch-requirements.schema.json",
  );
  const contractPath = resolve(root, "commerce_platform_spec.md");
  const backlogPath = resolve(root, "docs/backlog.md");
  const externalGatesPath = resolve(root, "docs/external-gates.md");
  const launchChecklistPath = resolve(root, "docs/launch-checklist.md");
  const gateRegistryPath = resolve(
    root,
    "packages/domain/src/system/external-gates.ts",
  );
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const contract = readFileSync(contractPath);
  const contractText = contract.toString("utf8");
  const backlog = readFileSync(backlogPath, "utf8");
  const externalGates = readFileSync(externalGatesPath, "utf8");
  const launchChecklist = readFileSync(launchChecklistPath, "utf8");
  const gateRegistry = readFileSync(gateRegistryPath, "utf8");
  // Normalised ONCE, and every read below goes through this binding rather than
  // through `ledger.statusPolicy`. `?.` and `??` are safe against null and
  // undefined and are not safe against a primitive, and mixing the two styles is
  // how `statusPolicy: "x"` used to reach `field in statusPolicy` and throw.
  const statusPolicy = isPlainObject(ledger.statusPolicy)
    ? ledger.statusPolicy
    : {};
  const statuses = new Set([
    "implemented",
    "partial",
    "unimplemented",
    "external-gated",
    "historical",
  ]);
  const arrayFields = [
    "domain",
    "api",
    "database",
    "workflowProvider",
    "portalDocument",
    "tests",
    "externalGates",
    "backlog",
  ];

  function assertSchemaShape() {
    for (const field of schema.required)
      if (!(field in ledger)) fail(`TRACEABILITY_SCHEMA_REQUIRED:${field}`);
    if (schema.additionalProperties === false) {
      const allowedRootFields = new Set(Object.keys(schema.properties));
      for (const field of Object.keys(ledger))
        if (!allowedRootFields.has(field))
          fail(`TRACEABILITY_SCHEMA_ADDITIONAL:${field}`);
    }
    for (const [field, definition] of Object.entries(schema.properties)) {
      if (definition.const !== undefined && ledger[field] !== definition.const)
        fail(`TRACEABILITY_SCHEMA_CONST:${field}`);
      if (
        definition.pattern &&
        typeof ledger[field] === "string" &&
        !new RegExp(definition.pattern).test(ledger[field])
      )
        fail(`TRACEABILITY_SCHEMA_PATTERN:${field}`);
    }

    const statusPolicySchema = schema.$defs.statusPolicy;
    if (!isPlainObject(ledger.statusPolicy))
      fail("TRACEABILITY_STATUS_POLICY_UNREADABLE");
    for (const field of statusPolicySchema.required)
      if (!(field in statusPolicy))
        fail(`TRACEABILITY_SCHEMA_REQUIRED:statusPolicy:${field}`);
    if (statusPolicySchema.additionalProperties === false) {
      const allowedStatusPolicyFields = new Set(
        Object.keys(statusPolicySchema.properties),
      );
      for (const field of Object.keys(statusPolicy))
        if (!allowedStatusPolicyFields.has(field))
          fail(`TRACEABILITY_SCHEMA_ADDITIONAL:statusPolicy:${field}`);
    }
    if (statusPolicy.generatedFrom !== "commerce_platform_spec.md")
      fail("TRACEABILITY_STATUS_POLICY_SOURCE");
    if (statusPolicy.activeBranch !== "main")
      fail("TRACEABILITY_ACTIVE_BRANCH");
    if (
      ![
        "pre-merge",
        "post-merge-pre-qualification",
        "repository-qualified",
        "launch-qualified",
      ].includes(statusPolicy.reviewState)
    )
      fail("TRACEABILITY_REVIEW_STATE");
    for (const field of ["reviewedAgainst", "evidenceManifests", "notes"]) {
      if (
        !Array.isArray(statusPolicy[field]) ||
        statusPolicy[field].length === 0
      ) {
        fail(`TRACEABILITY_STATUS_POLICY_ARRAY:${field}`);
        continue;
      }
      // Member types, not just the array. `reviewedAgainst` and
      // `evidenceManifests` are handed to `resolve()` below, which throws on a
      // number instead of returning false, and `notes` is handed to
      // `.includes()` when the report is built.
      if (
        statusPolicy[field].some(
          (member) => typeof member !== "string" || member.length === 0,
        )
      )
        fail(`TRACEABILITY_STATUS_POLICY_ARRAY_VALUE:${field}`);
      if (new Set(statusPolicy[field]).size !== statusPolicy[field].length)
        fail(`TRACEABILITY_STATUS_POLICY_DUPLICATE:${field}`);
    }
    for (const status of statuses)
      if (
        typeof statusPolicy.statuses?.[status] !== "string" ||
        statusPolicy.statuses[status].length === 0
      )
        fail(`TRACEABILITY_STATUS_POLICY_STATUS:${status}`);

    const requirementSchema = schema.$defs.requirement;
    const allowedFields = new Set(Object.keys(requirementSchema.properties));
    // Tolerant on purpose: a non-array `requirements` is not iterable and an
    // entry that is not an object throws on `in`, and both used to end the run
    // HERE with an uncaught TypeError - before the fatal written for exactly
    // those two shapes could report them. Skip them and let `requirementsFatal`
    // below name them with an identifier and a header.
    for (const requirement of Array.isArray(ledger.requirements)
      ? ledger.requirements
      : []) {
      if (!isReadableRequirement(requirement)) continue;
      for (const field of requirementSchema.required)
        if (!(field in requirement))
          fail(`TRACEABILITY_SCHEMA_REQUIRED:${requirement.id}:${field}`);
      if (requirementSchema.additionalProperties === false)
        for (const field of Object.keys(requirement))
          if (!allowedFields.has(field))
            fail(`TRACEABILITY_SCHEMA_ADDITIONAL:${requirement.id}:${field}`);
    }
  }

  assertSchemaShape();
  if (ledger.schemaVersion !== 1) fail("TRACEABILITY_SCHEMA_VERSION_INVALID");
  if (ledger.contract !== "commerce_platform_spec.md")
    fail("TRACEABILITY_CONTRACT_INVALID");
  if (ledger.contractSha256 !== sha256(contract))
    fail(
      `TRACEABILITY_CONTRACT_HASH:${ledger.contractSha256}:${sha256(contract)}`,
    );
  const requirementsStop = requirementsFatal(ledger.requirements);
  if (requirementsStop !== null) fatal(requirementsStop);

  const backlogEntries = [
    ...backlog.matchAll(
      /^- \*\*(P0-\d{2}) —[\s\S]*?`\[(OPEN|INTEGRATED-PENDING|COMPLETE|EXTERNAL-ONLY)\]`:\*\*/gm,
    ),
  ];
  const backlogIds = new Set(backlogEntries.map((match) => match[1]));
  const backlogStatuses = new Map(
    backlogEntries.map((match) => [match[1], match[2]]),
  );
  const backlogHeadings = [...backlog.matchAll(/^- \*\*(P0-\d{2}) —/gm)].map(
    (match) => match[1],
  );
  if (backlogIds.size !== backlogHeadings.length)
    fail(
      `TRACEABILITY_BACKLOG_STATUS:${backlogIds.size}:${backlogHeadings.length}`,
    );
  if (new Set(backlogHeadings).size !== backlogHeadings.length)
    fail("TRACEABILITY_BACKLOG_DUPLICATE");
  const aliases = isPlainObject(statusPolicy.backlogReferenceAliases)
    ? statusPolicy.backlogReferenceAliases
    : {};
  for (const [alias, target] of Object.entries(aliases)) {
    if (!backlogIds.has(target))
      fail(`TRACEABILITY_BACKLOG_ALIAS_TARGET:${alias}:${target}`);
  }

  const gateMatch = gateRegistry.match(
    /externalGateKeys\s*=\s*\[([\s\S]*?)\]\s*as const/,
  );
  if (!gateMatch) fatal("TRACEABILITY_GATE_REGISTRY_UNREADABLE");
  const gateIds = new Set(
    [...gateMatch[1].matchAll(/"(EXT-[A-Z]+-\d{2})"/g)].map(
      (match) => match[1],
    ),
  );
  const externalGateRows = [
    ...externalGates.matchAll(/^\| `(EXT-[A-Z]+-\d{2})`\s+\| ([^\n]+)$/gm),
  ];
  const documentedGateIds = new Set(externalGateRows.map((match) => match[1]));
  if (externalGateRows.length !== documentedGateIds.size)
    fail("TRACEABILITY_EXTERNAL_GATE_DUPLICATE");
  for (const gateId of gateIds)
    if (!documentedGateIds.has(gateId))
      fail(`TRACEABILITY_EXTERNAL_GATE_UNDOCUMENTED:${gateId}`);
  for (const gateId of documentedGateIds)
    if (!gateIds.has(gateId))
      fail(`TRACEABILITY_EXTERNAL_GATE_UNREGISTERED:${gateId}`);
  for (const [gateId, row] of externalGateRows.map((match) => [
    match[1],
    match[0],
  ])) {
    const cells = row.split("|").slice(1, -1);
    if (
      cells.length !== 5 ||
      cells.slice(1).some((cell) => cell.trim().length < 20)
    )
      fail(`TRACEABILITY_EXTERNAL_GATE_INCOMPLETE:${gateId}`);
    for (const requiredMarker of ["packages/", "Required by", "**`"]) {
      if (!row.includes(requiredMarker))
        fail(`TRACEABILITY_EXTERNAL_GATE_EVIDENCE:${gateId}:${requiredMarker}`);
    }
  }
  const gateAliases = isPlainObject(statusPolicy.gateReferenceAliases)
    ? statusPolicy.gateReferenceAliases
    : {};
  for (const [alias, target] of Object.entries(gateAliases))
    if (target !== "ALL_REGISTERED_EXTERNAL_GATES" && !gateIds.has(target))
      fail(`TRACEABILITY_GATE_ALIAS_TARGET:${alias}:${target}`);

  const ids = new Set();
  const referencedBacklogIds = new Map(
    [...backlogIds].map((backlogId) => [backlogId, new Set()]),
  );
  for (const requirement of ledger.requirements) {
    if (!/^SPEC-[0-9A-Z-]+$/.test(requirement.id))
      fail(`TRACEABILITY_ID_INVALID:${requirement.id}`);
    if (ids.has(requirement.id))
      fail(`TRACEABILITY_ID_DUPLICATE:${requirement.id}`);
    ids.add(requirement.id);
    if (!statuses.has(requirement.status))
      fail(`TRACEABILITY_STATUS_INVALID:${requirement.id}`);
    for (const field of ["source", "requirement", "rationale"])
      if (
        typeof requirement[field] !== "string" ||
        requirement[field].length === 0
      )
        fail(`TRACEABILITY_FIELD_INVALID:${requirement.id}:${field}`);
    for (const field of arrayFields) {
      if (!Array.isArray(requirement[field])) {
        fail(`TRACEABILITY_ARRAY_INVALID:${requirement.id}:${field}`);
        continue;
      }
      if (
        requirement[field].some(
          (value) => typeof value !== "string" || value.length === 0,
        )
      )
        fail(`TRACEABILITY_ARRAY_VALUE:${requirement.id}:${field}`);
      if (new Set(requirement[field]).size !== requirement[field].length)
        fail(`TRACEABILITY_ARRAY_DUPLICATE:${requirement.id}:${field}`);
    }
    const backlogReferences = Array.isArray(requirement.backlog)
      ? requirement.backlog
      : [];
    const gateReferences = Array.isArray(requirement.externalGates)
      ? requirement.externalGates
      : [];
    for (const reference of backlogReferences) {
      const target = aliases[reference] ?? reference;
      if (!backlogIds.has(target)) {
        fail(`TRACEABILITY_BACKLOG_REFERENCE:${requirement.id}:${reference}`);
        continue;
      }
      referencedBacklogIds.get(target).add(requirement.id);
      if (backlogStatuses.get(target) === "COMPLETE")
        fail(
          `TRACEABILITY_COMPLETED_BACKLOG_REFERENCE:${requirement.id}:${target}`,
        );
      if (
        backlogStatuses.get(target) === "EXTERNAL-ONLY" &&
        (requirement.status !== "external-gated" || gateReferences.length === 0)
      )
        fail(
          `TRACEABILITY_EXTERNAL_BACKLOG_WITHOUT_GATE:${requirement.id}:${target}`,
        );
    }
    for (const reference of gateReferences) {
      const target = gateAliases[reference] ?? reference;
      if (target !== "ALL_REGISTERED_EXTERNAL_GATES" && !gateIds.has(target))
        fail(`TRACEABILITY_GATE_REFERENCE:${requirement.id}:${reference}`);
    }
    if (requirement.status === "external-gated" && gateReferences.length === 0)
      fail(`TRACEABILITY_GATE_MISSING:${requirement.id}`);
    if (
      ["partial", "unimplemented"].includes(requirement.status) &&
      backlogReferences.length === 0 &&
      gateReferences.length === 0
    )
      fail(`TRACEABILITY_GAP_UNMAPPED:${requirement.id}`);
    if (
      ["implemented", "external-gated"].includes(requirement.status) &&
      (requirement.tests?.length ?? 0) === 0
    )
      fail(`TRACEABILITY_COMPLETION_WITHOUT_TEST:${requirement.id}`);
    if (
      ["implemented", "external-gated"].includes(requirement.status) &&
      [
        ...(requirement.domain ?? []),
        ...(requirement.api ?? []),
        ...(requirement.database ?? []),
        ...(requirement.workflowProvider ?? []),
        ...(requirement.portalDocument ?? []),
      ].length === 0
    )
      fail(`TRACEABILITY_COMPLETION_WITHOUT_IMPLEMENTATION:${requirement.id}`);
    if (
      ["implemented", "historical"].includes(requirement.status) &&
      backlogReferences.length > 0
    )
      fail(`TRACEABILITY_FALSE_COMPLETE:${requirement.id}`);
    if (
      requirement.status === "external-gated" &&
      backlogReferences.some(
        (reference) =>
          backlogStatuses.get(aliases[reference] ?? reference) !==
          "EXTERNAL-ONLY",
      )
    )
      fail(`TRACEABILITY_EXTERNAL_GATE_INTERNAL_BACKLOG:${requirement.id}`);
  }

  for (const [backlogId, backlogStatus] of backlogStatuses) {
    const references = referencedBacklogIds.get(backlogId);
    if (backlogStatus !== "COMPLETE" && references.size === 0)
      fail(`TRACEABILITY_BACKLOG_UNMAPPED:${backlogId}`);
    if (backlogStatus === "COMPLETE" && references.size > 0)
      fail(`TRACEABILITY_BACKLOG_COMPLETE_STILL_MAPPED:${backlogId}`);
  }

  const sortedIds = [...ids].sort();
  const idSetSha256 = sha256(`${sortedIds.join("\n")}\n`);
  if (statusPolicy.requirementCount !== ids.size)
    fail(
      `TRACEABILITY_REQUIREMENT_COUNT:${statusPolicy.requirementCount}:${ids.size}`,
    );
  if (statusPolicy.requirementIdSetSha256 !== idSetSha256)
    fail(
      `TRACEABILITY_REQUIREMENT_ID_SET:${statusPolicy.requirementIdSetSha256}:${idSetSha256}`,
    );

  for (const reviewedArtifact of stringMembers(statusPolicy.reviewedAgainst))
    if (!existsSync(resolve(root, reviewedArtifact)))
      fail(`TRACEABILITY_REVIEWED_ARTIFACT_MISSING:${reviewedArtifact}`);
  for (const artifact of stringMembers(statusPolicy.evidenceManifests))
    if (!existsSync(resolve(root, artifact)))
      fail(`TRACEABILITY_EVIDENCE_MISSING:${artifact}`);

  const normativeSpecSections = new Set(
    [...contractText.matchAll(/^## (\d+)\. /gm)]
      .map((match) => Number(match[1]))
      .filter((section) => section <= 22),
  );
  const coveredSpecSections = new Set();
  for (const requirement of ledger.requirements) {
    const sourceSection =
      typeof requirement.source === "string"
        ? requirement.source.match(/§(\d+)/)?.[1]
        : undefined;
    if (!sourceSection) {
      fail(`TRACEABILITY_SOURCE_SECTION_MISSING:${requirement.id}`);
      continue;
    }
    const section = Number(sourceSection);
    if (!normativeSpecSections.has(section))
      fail(`TRACEABILITY_SOURCE_SECTION_INVALID:${requirement.id}:${section}`);
    coveredSpecSections.add(section);
  }
  for (const section of normativeSpecSections)
    if (!coveredSpecSections.has(section))
      fail(`TRACEABILITY_SPEC_SECTION_UNMAPPED:${section}`);

  for (const rcId of [
    "SPEC-22-RC-01",
    "SPEC-22-RC-02",
    "SPEC-22-RC-03",
    "SPEC-22-RC-04",
    "SPEC-22-RC-05",
  ]) {
    const rcRequirement = ledger.requirements.find(
      (requirement) => requirement.id === rcId,
    );
    if (rcRequirement?.status !== "historical")
      fail(`TRACEABILITY_RETIRED_LANE_NOT_HISTORICAL:${rcId}`);
  }

  if (
    ["repository-qualified", "launch-qualified"].includes(
      statusPolicy.reviewState,
    )
  ) {
    const unresolvedRequirements = ledger.requirements.filter((requirement) =>
      ["partial", "unimplemented"].includes(requirement.status),
    );
    if (unresolvedRequirements.length > 0)
      fail(
        `TRACEABILITY_QUALIFIED_WITH_INTERNAL_GAPS:${unresolvedRequirements
          .map((requirement) => requirement.id)
          .join(",")}`,
      );
    const unresolvedBacklog = [...backlogStatuses].filter(([, status]) =>
      ["OPEN", "INTEGRATED-PENDING"].includes(status),
    );
    if (unresolvedBacklog.length > 0)
      fail(
        `TRACEABILITY_QUALIFIED_WITH_BACKLOG:${unresolvedBacklog
          .map(([backlogId]) => backlogId)
          .join(",")}`,
      );
  }

  if (statusPolicy.reviewState === "launch-qualified") {
    const designApprovalSection = launchChecklist.match(
      /### Human design approval required for any future RC\/launch designation([\s\S]*?)Blank names are a failed gate\./,
    )?.[1];
    if (!designApprovalSection)
      fail("TRACEABILITY_DESIGN_APPROVAL_SECTION_MISSING");
    else {
      const approvalFields = new Map(
        designApprovalSection
          .split("\n")
          .filter((line) => /^\|[^-].*\|$/.test(line))
          .map((line) =>
            line
              .split("|")
              .slice(1, -1)
              .map((cell) => cell.trim().replaceAll("**", "")),
          )
          .filter((cells) => cells.length === 2)
          .map(([field, value]) => [field.replace(/\s+/g, " "), value]),
      );
      const approvalName = approvalFields.get("Approver name") ?? "";
      const approvalDecision =
        approvalFields.get("Decision (`APPROVE` or `REJECT`)") ?? "";
      const approvalTimestamp = approvalFields.get("UTC timestamp") ?? "";
      const reviewedSha = approvalFields.get("Reviewed SHA") ?? "";
      const approvalEvidence = approvalFields.get("Evidence/reference") ?? "";
      const approvalConditions =
        approvalFields.get("Conditions and resolution") ?? "";
      if (
        approvalName.length < 2 ||
        /pending|assistant|unknown|tbd/i.test(approvalName)
      )
        fail("TRACEABILITY_DESIGN_APPROVER_INVALID");
      if (approvalDecision.replaceAll("`", "") !== "APPROVE")
        fail("TRACEABILITY_DESIGN_DECISION_INVALID");
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(approvalTimestamp))
        fail("TRACEABILITY_DESIGN_TIMESTAMP_INVALID");
      if (!/^[0-9a-f]{40}$/.test(reviewedSha.replaceAll("`", "")))
        fail("TRACEABILITY_DESIGN_SHA_INVALID");
      if (
        approvalEvidence.length < 5 ||
        /pending|unknown|tbd/i.test(approvalEvidence)
      )
        fail("TRACEABILITY_DESIGN_EVIDENCE_INVALID");
      if (
        approvalConditions.length < 2 ||
        /pending|unresolved|conditional|tbd/i.test(approvalConditions)
      )
        fail("TRACEABILITY_DESIGN_CONDITIONS_INVALID");
    }
  }

  const acceptanceIds = sortedIds.filter((id) => /^SPEC-22-AC-\d{2}$/.test(id));
  if (acceptanceIds.length !== 10)
    fail(`TRACEABILITY_ACCEPTANCE_COUNT:${acceptanceIds.length}`);

  const citationReport = checkCitationGrammar({
    requirements: ledger.requirements,
    entryKind: (relativePath) => {
      const absolute = resolve(root, relativePath);
      if (!existsSync(absolute)) return null;
      return statSync(absolute).isDirectory() ? "directory" : "file";
    },
    readSource: (relativePath) =>
      readFileSync(resolve(root, relativePath), "utf8"),
  });
  for (const failure of citationReport.failures)
    fail(`${failure.id} (${failure.detail})`);

  const counts = Object.fromEntries(
    [...statuses].map((status) => [
      status,
      ledger.requirements.filter((requirement) => requirement.status === status)
        .length,
    ]),
  );
  return {
    failures,
    report: {
      ledgerPath,
      schemaPath,
      contractSha256: ledger.contractSha256,
      requirementIdSetSha256: idSetSha256,
      requirements: ids.size,
      acceptanceRows: acceptanceIds.length,
      backlogIds: backlogIds.size,
      externalGateIds: gateIds.size,
      counts,
      citationGrammar: {
        ...citationReport.counts,
        grandfatheredDistinct: citationReport.grandfatheredDistinct,
        naiveSlashRule: citationReport.naiveSlashRule,
        statusPolicyNotePresent: stringMembers(statusPolicy.notes).includes(
          CITATION_POLICY_NOTE,
        ),
        statusPolicyNoteExpected: CITATION_POLICY_NOTE,
        grandfathering: CITATION_GRANDFATHERING,
        coverage: CITATION_COVERAGE,
      },
    },
  };
}

/**
 * Runs `main`, prints the report, and exits non-zero with EVERY collected
 * identifier rather than the first one. A fatal stop still prints what was
 * collected before it.
 */
export function run() {
  let outcome;
  try {
    outcome = main();
  } catch (error) {
    if (!(error instanceof FatalValidationError)) throw error;
    process.stderr.write(
      `TRACEABILITY_FAILURES:${error.failures.length}\n${error.failures.join("\n")}\n` +
        "(validation stopped at the last identifier: continuing past it reports a crash, not a finding)\n",
    );
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(outcome.report, null, 2));
  if (outcome.failures.length === 0) return;
  process.stderr.write(
    `TRACEABILITY_FAILURES:${outcome.failures.length}\n${outcome.failures.join("\n")}\n`,
  );
  process.exitCode = 1;
}

if (process.argv[1] === import.meta.filename) run();
