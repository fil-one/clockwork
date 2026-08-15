// Validates `docs/traceability/launch-requirements.json` against its schema, the
// contract it is generated from, `docs/backlog.md`, the external-gate registry,
// and - since P0-71 - the grammar of its own evidence citations.
//
// TWO THINGS CHANGED HERE, AND THEY ARE INDEPENDENT.
//
// 1. IT NO LONGER STOPS AT THE FIRST OFFENDER. Every check used to `throw` in
//    place, so a run reported exactly one identifier and the next run reported
//    the next one. Remapping a batch of ledger rows against a one-error-per-run
//    oracle costs one full validation per error. Failures are now collected and
//    printed together and the process exits non-zero at the end. The failure
//    IDENTIFIERS are unchanged, and any single-identifier grep over this
//    script's output still matches. Two classes still stop the run early
//    (`fatal`): a ledger whose `requirements` is not a usable array, and an
//    unreadable gate registry - continuing past either only produces a
//    TypeError wearing a validation error's clothes.
//
// 2. CITATION GRAMMAR (P0-71, LAYER 1). See CITATION_COVERAGE below for what a
//    green run does and does not prove. Read that before trusting this file.
//
// WHY THE BACKLOG ENTRY'S PRESCRIBED FIX IS NOT WHAT IS IMPLEMENTED. P0-71 asks
// for "every cited symbol resolves to a definition reachable from production".
// Measured against the ledger when this was written, the six evidence columns of
// the 312 rows held 2,264 citations: 100 repository paths, ZERO of the form
// `path#symbol`, and the rest prose labels ("package boundaries", "external gate
// state", "report tests"), API route paths ("/v1/core"), package specifiers
// ("@clockwork/ui") and module shorthands ("core/accounts"). There is no symbol
// in any of those to resolve. Converting them is a corpus project, not a
// validator change, so the validator instead enforces the grammar the ledger
// ALREADY claims for itself in `statusPolicy.mappingSemantics` - "Path-like
// values are exact repository paths; ... remaining human-readable labels are
// search terms" - and says out loud which citations it did not check. The live
// counts are in `citationGrammar` in this script's own output; they move as rows
// are converted, and the conversion has started.
//
// A NAIVE READING OF THAT RULE DOES NOT WORK EITHER, and this is worth writing
// down because it is the obvious first implementation. "A citation containing
// `/` must resolve on disk" fails 346 of the 410 slash-bearing citations,
// because "quote/order artifacts", "renewal/notice UI" and "/v1/lifecycle" all
// contain a slash and none of them is a path. The discriminator that works is
// an anchor on a real top-level repository directory plus the absence of
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
 * oversight. When this was written 1,777 of the ledger's 2,264 citations were
 * prose labels inherited from a ledger written before any checker existed.
 * Failing them all would make the gate unrunnable on day one; converting them
 * is a corpus project that has to happen row by row against the code, which is
 * what P0-71's fifteen named rows are for. The rule for NEW work is in
 * CITATION_POLICY_NOTE.
 */
export const CITATION_GRANDFATHERING = Object.freeze({
  rule: "A citation that is neither anchored on a top-level repository directory nor of the form `path#symbol` is not checked.",
  reason:
    "The ledger predates any citation checker and 78% of its citations are prose search terms, which statusPolicy.mappingSemantics already documents as search terms rather than locators.",
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
 *   if (!(ledger.statusPolicy?.notes ?? []).includes(CITATION_POLICY_NOTE))
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

  return { failures, counts, grandfatheredDistinct: grandfathered.size };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    const statusPolicy = ledger.statusPolicy ?? {};
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
      )
        fail(`TRACEABILITY_STATUS_POLICY_ARRAY:${field}`);
      else if (new Set(statusPolicy[field]).size !== statusPolicy[field].length)
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
    for (const requirement of ledger.requirements ?? []) {
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
  if (!Array.isArray(ledger.requirements) || ledger.requirements.length === 0)
    fatal("TRACEABILITY_REQUIREMENTS_EMPTY");

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
  const aliases = ledger.statusPolicy?.backlogReferenceAliases ?? {};
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
  const gateAliases = ledger.statusPolicy?.gateReferenceAliases ?? {};
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
  if (ledger.statusPolicy?.requirementCount !== ids.size)
    fail(
      `TRACEABILITY_REQUIREMENT_COUNT:${ledger.statusPolicy?.requirementCount}:${ids.size}`,
    );
  if (ledger.statusPolicy?.requirementIdSetSha256 !== idSetSha256)
    fail(
      `TRACEABILITY_REQUIREMENT_ID_SET:${ledger.statusPolicy?.requirementIdSetSha256}:${idSetSha256}`,
    );

  for (const reviewedArtifact of ledger.statusPolicy?.reviewedAgainst ?? [])
    if (!existsSync(resolve(root, reviewedArtifact)))
      fail(`TRACEABILITY_REVIEWED_ARTIFACT_MISSING:${reviewedArtifact}`);
  for (const artifact of ledger.statusPolicy?.evidenceManifests ?? [])
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
      ledger.statusPolicy?.reviewState,
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

  if (ledger.statusPolicy?.reviewState === "launch-qualified") {
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
        statusPolicyNotePresent: (ledger.statusPolicy?.notes ?? []).includes(
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
