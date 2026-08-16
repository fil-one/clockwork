import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  isPlainObject,
  isReadableRequirement,
  requirementsFatal,
  stringMembers,
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

// EXACTLY the comment forms the number rule reads, and the header of
// validate-traceability.mjs names the same two:
//
//   * every block comment - single-star or double-star - that STARTS a line;
//   * every whole-line `//` comment, which includes the leading header block.
//
// Deliberately not read, and said so in the header rather than papered over:
// a comment that follows code on the same line, in either form, and the inside
// of a string literal. Both exclusions are structural. Whole-line `//` keeps a
// `//` inside a string from being mistaken for commentary; line-anchored blocks
// keep a literal slash-star inside a string - CITATION_COVERAGE contains one -
// from opening a false block that would swallow code as "commentary" and fail
// this test on numbers that are not claims at all.
function commentaryOf(source) {
  const lines = source.split("\n");
  return [
    ...(source.match(/^[ \t]*\/\*[\s\S]*?\*\//gm) ?? []),
    ...lines.filter((line) => /^\s*\/\//.test(line)),
  ].join("\n");
}

/** The leading `//` block alone, unwrapped to one line. */
function headerSentences(source) {
  const header = [];
  for (const line of source.split("\n")) {
    if (!/^\s*\/\//.test(line)) break;
    header.push(line.replace(/^\s*\/\/\s?/, ""));
  }
  return header.join(" ").replaceAll(/\s+/g, " ");
}

/** Every number in `text`, with backlog and requirement identifiers removed. */
function numbersIn(text) {
  return [
    ...text
      .replaceAll(/\bP0-\d+\b/g, "")
      .replaceAll(/\bSPEC-[0-9A-Z-]+\b/g, "")
      .matchAll(/\d[\d,]*/g),
  ].map((match) => Number(match[0].replaceAll(",", "")));
}

test("every number in this script's commentary is one this test derived", () => {
  // THE DEFECT THIS EXISTS FOR. This header used to carry a dated census of the
  // ledger - totals, path counts, prose shares, a percentage - none of which any
  // test re-computed, on a file another lane rewrites row by row. One exported
  // string in it had quoted a share that was never true on any revision. The
  // header now states the argument and the report states the numbers, and this
  // is what keeps it that way.
  //
  // The escape hatch for a future number is to derive it here first, exactly as
  // the two below are derived.
  const source = readFileSync(script, "utf8");
  const header = headerSentences(source);

  // Derived from the source: how many `fatal(` call sites this file has.
  //
  // THAT IS ALL IT IS, and the previous version of this comment claimed more -
  // "the count of `fatal` call sites IS the number of checks that stop the run
  // early" - which is false, and was a false statement inside the tooling built
  // to catch false statements. A `fatal(` count cannot see an early stop with no
  // `fatal(` token in it, and an uncaught TypeError is exactly that: it ends the
  // run with no header and no identifiers, and four `statusPolicy` shapes plus
  // two `requirements` shapes used to do it. The behavioural claim is measured
  // by "a malformed ledger is reported, not crashed on" below, which runs the
  // real script. This assertion pins only that the header's `2` matches the
  // code, and the header says only that. `requirementsFatal` and
  // `FatalValidationError` are capitalised and do not match.
  // Counted over CODE, with the commentary removed first: the header now
  // discusses `fatal(` in prose, and counting those mentions would let the
  // sentence inflate its own figure by describing itself.
  const codeOnly = source
    .replaceAll(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
  const fatalCallSites = (codeOnly.match(/(?<![A-Za-z0-9_.])fatal\(/g) ?? [])
    .length;
  assert.ok(fatalCallSites > 0, "the fatal stop is gone entirely");
  assert.ok(
    header.includes(`this file has ${fatalCallSites}`),
    `the header no longer states the explicit \`fatal\` call-site count as ${fatalCallSites}`,
  );
  assert.ok(
    header.includes(`test derives that ${fatalCallSites} by counting`),
    "the header no longer says the fatal call-site count is derived by counting call sites, which is the only thing this assertion establishes",
  );

  const listMarkers = [...source.matchAll(/^\/\/ (\d+)\. /gm)].map((match) =>
    Number(match[1]),
  );
  assert.ok(listMarkers.length > 0, "the numbered sections are gone");
  // A list marker is an allow-listed number, so an unbounded marker regex is a
  // hole: `// 58. ` reads as a section heading and admits 58 anywhere in the
  // commentary. Bounding the markers to the sequence starting at one is what
  // closes it.
  assert.deepEqual(
    listMarkers,
    listMarkers.map((_, index) => index + 1),
    "the numbered sections are not a 1..n sequence; an out-of-sequence marker is an unchecked figure wearing a section heading's clothes",
  );
  const allowed = new Set([
    ...listMarkers,
    fatalCallSites,
    CITATION_COLUMNS.length,
    CITATION_PATH_ROOTS.length,
  ]);
  const stray = [...new Set(numbersIn(commentaryOf(source)))].filter(
    (value) => !allowed.has(value),
  );
  assert.deepEqual(
    stray,
    [],
    `validate-traceability.mjs comments carry ${stray.join(", ")}, which this test did not derive. Ledger tallies and commit hashes rot into false claims; derive the figure here or drop it and let citationGrammar print it.`,
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
// Early termination, measured rather than counted.
// ---------------------------------------------------------------------------

test("the plain-object and string-member guards refuse exactly what throws, and nothing else", () => {
  // `isPlainObject` is the predicate `field in value` and `Object.keys(value)`
  // need. `??` is not it - `"x" ?? {}` is `"x"` - which is the whole mechanism
  // behind the `statusPolicy` crashes.
  for (const throwsOnIn of [undefined, null, "x", "", 0, 42, true, false, 7n])
    assert.equal(
      isPlainObject(throwsOnIn),
      false,
      `${String(throwsOnIn)} cannot be used with the \`in\` operator`,
    );
  assert.equal(isPlainObject([]), false, "an array is not a policy object");
  for (const usable of [
    {},
    Object.create(null),
    ledger.statusPolicy,
    new Map(),
  ])
    assert.ok(isPlainObject(usable), "a usable object was refused");
  // Directly: `in` throws on everything the predicate refuses except arrays,
  // and does not throw on anything it accepts.
  for (const value of [{}, [], ledger.statusPolicy])
    assert.doesNotThrow(() => "generatedFrom" in value);
  for (const value of ["x", 42, true])
    assert.throws(() => "generatedFrom" in value, TypeError);

  // `stringMembers` exists because `resolve()` throws on a number rather than
  // returning false. It drops what would throw and keeps every legitimate
  // member, so it cannot hide a real path.
  assert.deepEqual(stringMembers(["a", 3, "", null, "b", {}]), ["a", "b"]);
  for (const notAnArray of [undefined, null, "abc", 7, {}])
    assert.deepEqual(stringMembers(notAnArray), []);
  assert.deepEqual(
    stringMembers(ledger.statusPolicy.reviewedAgainst),
    ledger.statusPolicy.reviewedAgainst,
    "a legitimate reviewedAgainst list lost a member",
  );
  assert.deepEqual(
    stringMembers(ledger.statusPolicy.evidenceManifests),
    ledger.statusPolicy.evidenceManifests,
    "a legitimate evidenceManifests list lost a member",
  );
  assert.deepEqual(
    stringMembers(ledger.statusPolicy.notes),
    ledger.statusPolicy.notes,
    "a legitimate notes list lost a member",
  );
});

test("the complete refused set of the requirements guard, and nothing legitimate in it", () => {
  // Stated exhaustively because a control that refuses valid input is as bad as
  // one that permits invalid input. The guard refuses exactly: not-an-array,
  // empty, and an array containing anything that is not a plain object.
  for (const unusable of [undefined, null, 0, "", "x", {}, new Map(), []])
    assert.equal(
      requirementsFatal(unusable),
      "TRACEABILITY_REQUIREMENTS_EMPTY",
      `${String(unusable)} should stop the run`,
    );
  assert.equal(
    requirementsFatal([{ id: "SPEC-01-01" }, "SPEC-01-02", 3, null, []]),
    "TRACEABILITY_REQUIREMENTS_NOT_OBJECTS:1,2,3,4",
    "the stop must name every unreadable index, not just the first",
  );
  // Nothing a valid ledger can hold is refused. The schema declares
  // requirements as an array of $defs.requirement with type "object", so this
  // is the full space of legitimate entries: any object, however incomplete.
  const requirementSchema = JSON.parse(
    readFileSync(
      resolve(root, "docs/traceability/launch-requirements.schema.json"),
      "utf8",
    ),
  ).$defs.requirement;
  assert.equal(requirementSchema.type, "object");
  for (const legitimate of [
    {},
    { id: "SPEC-01-01" },
    Object.create(null),
    ...ledger.requirements,
  ])
    assert.ok(
      isReadableRequirement(legitimate),
      "a legitimate requirement entry was refused",
    );
  assert.equal(requirementsFatal(ledger.requirements), null);
  assert.equal(requirementsFatal([{}]), null, "an empty object is readable");
});

// Every ledger shape known to have ended this script's run with an uncaught
// TypeError - no TRACEABILITY_FAILURES header, no collected identifiers, a
// crash wearing a validation error's clothes. All are PRE-EXISTING defects
// rather than regressions, and all are driven end to end through the REAL
// script rather than through an exported guard, because none of the crashes was
// ever in a guard: two were in `assertSchemaShape`, which runs first, and two
// more were in code that runs after every check has already passed.
//
// This is the measurement the `fatal(` count cannot make. A token count sees
// only stops that carry a `fatal(` token; every row below is a stop that does
// not. It is a SAMPLE and the header says so - it cannot show that no other
// shape crashes, only that these do not.
//
// Re-confirmed against the unfixed scripts rather than taken on trust: at
// b4fbcc8 the array-of-non-objects row exits 1 with
// `TypeError: Cannot use 'in' operator` at `field in requirement` and prints no
// header, and the four `statusPolicy` rows below are byte-identical defects at
// that commit.
const MALFORMED_LEDGER_SHAPES = [
  {
    shape: "requirements is an array of non-objects",
    patch: { requirements: ["SPEC-01-01", 7] },
    expected: /TRACEABILITY_REQUIREMENTS_NOT_OBJECTS:0,1/,
  },
  {
    shape: "requirements is not an array at all",
    patch: { requirements: { "SPEC-01-01": {} } },
    expected: /TRACEABILITY_REQUIREMENTS_EMPTY/,
  },
  {
    shape: "requirements is empty",
    patch: { requirements: [] },
    expected: /TRACEABILITY_REQUIREMENTS_EMPTY/,
  },
  {
    shape: "statusPolicy is a string",
    patch: { statusPolicy: "x" },
    expected: /TRACEABILITY_STATUS_POLICY_UNREADABLE/,
  },
  {
    shape: "statusPolicy is a number",
    patch: { statusPolicy: 42 },
    expected: /TRACEABILITY_STATUS_POLICY_UNREADABLE/,
  },
  {
    shape: "statusPolicy is a boolean",
    patch: { statusPolicy: true },
    expected: /TRACEABILITY_STATUS_POLICY_UNREADABLE/,
  },
  {
    shape: "statusPolicy.notes is not an array",
    patch: (base) => ({ statusPolicy: { ...base.statusPolicy, notes: 3 } }),
    expected: /TRACEABILITY_STATUS_POLICY_ARRAY:notes/,
  },
  {
    shape: "statusPolicy.reviewedAgainst holds a non-string",
    patch: (base) => ({
      statusPolicy: { ...base.statusPolicy, reviewedAgainst: [3] },
    }),
    expected: /TRACEABILITY_STATUS_POLICY_ARRAY_VALUE:reviewedAgainst/,
  },
  {
    shape: "statusPolicy.evidenceManifests holds a non-string",
    patch: (base) => ({
      statusPolicy: { ...base.statusPolicy, evidenceManifests: [{}] },
    }),
    expected: /TRACEABILITY_STATUS_POLICY_ARRAY_VALUE:evidenceManifests/,
  },
];

test("a malformed ledger is reported, not crashed on", async () => {
  // realpath, because on macOS mkdtemp hands back a /var symlink while
  // `import.meta.filename` resolves to /private/var, and the script's
  // `process.argv[1] === import.meta.filename` entrypoint guard would then
  // never fire - the run would exit 0 having validated nothing.
  const fixture = await realpath(
    await mkdtemp(join(tmpdir(), "traceability-fixture-")),
  );
  try {
    await mkdir(join(fixture, "scripts"), { recursive: true });
    await mkdir(join(fixture, "docs/traceability"), { recursive: true });
    await mkdir(join(fixture, "packages/domain/src/system"), {
      recursive: true,
    });
    for (const file of [
      "scripts/validate-traceability.mjs",
      "docs/traceability/launch-requirements.schema.json",
      "commerce_platform_spec.md",
      "docs/backlog.md",
      "docs/external-gates.md",
      "docs/launch-checklist.md",
      "packages/domain/src/system/external-gates.ts",
    ])
      await copyFile(resolve(root, file), join(fixture, file));

    for (const { shape, patch, expected } of MALFORMED_LEDGER_SHAPES) {
      // schemaVersion is wrong too, so every run has something to collect
      // BEFORE any stop and the last assertion below is not vacuous.
      const document = {
        ...ledger,
        schemaVersion: 2,
        ...(typeof patch === "function" ? patch(ledger) : patch),
      };
      await writeFile(
        join(fixture, "docs/traceability/launch-requirements.json"),
        JSON.stringify(document),
      );

      let status = 0;
      let stderr = "";
      try {
        execFileSync(
          process.execPath,
          [join(fixture, "scripts/validate-traceability.mjs")],
          { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        status = error.status;
        stderr = error.stderr ?? "";
      }
      assert.equal(status, 1, `${shape}: must exit 1, not crash`);
      assert.doesNotMatch(
        stderr,
        /TypeError/,
        `${shape}: the run dies with a TypeError wearing a validation error's clothes`,
      );
      assert.match(
        stderr,
        /^TRACEABILITY_FAILURES:\d+\n/,
        `${shape}: no TRACEABILITY_FAILURES header, so a grep over this script's output finds nothing`,
      );
      assert.match(stderr, expected, `${shape}: wrong identifier`);
      // The whole point of the collect-don't-throw conversion: a stop still
      // reports everything gathered before it.
      assert.ok(
        stderr.split("\n").filter((line) => line.startsWith("TRACEABILITY_"))
          .length >= 3,
        `${shape}: one identifier reported; the run is supposed to carry what was collected before the stop`,
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
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
  // the clear majority of the slash-bearing citations in this ledger. The exact
  // figure is not written down here, because it moves with the remap and a
  // stale number in a comment is the defect this lane exists to stop; the run
  // reports it as `citationGrammar.naiveSlashRule` and the test below asserts
  // the shape of the finding rather than its size. These are the four shapes
  // that break the rule.
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
  // Refusing to check the prose majority of the ledger's citations is
  // defensible; refusing to check them without saying so is not. The count is
  // deliberately absent from both this comment and CITATION_GRANDFATHERING:
  // it was 2,141 of 2,264 before the remap and 2,033 of 2,323 after, and the
  // exported string used to claim a third figure that matched neither.
  assert.ok(CITATION_GRANDFATHERING.rule.length > 0);
  assert.ok(CITATION_GRANDFATHERING.reason.length > 0);
  assert.equal(
    /\b\d{1,3}(?:,\d{3})+\b|\b\d{1,3}\s?%/.test(
      Object.values(CITATION_GRANDFATHERING).join(" "),
    ),
    false,
    "CITATION_GRANDFATHERING quotes a citation count or percentage; those move with every remap and rot into a false claim - point at citationGrammar in the report instead",
  );
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
