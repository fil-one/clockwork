import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  COVERAGE,
  DEAD_CITATION_EXCEPTIONS,
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
const files = collectSourceFiles();
const reports = "packages/domain/src/core/reports/index.ts";
const cite = (symbol, path = reports) => ({
  id: "SPEC-FIXTURE",
  column: "domain",
  value: `${path}#${symbol}`,
  path,
  symbol,
});
const corpus = (declaration, extras = []) => [
  { path: "packages/fixture/src/index.ts", text: declaration },
  ...extras,
];

test("only path#symbol citations become liveness subjects", () => {
  const citations = collectSymbolCitations({
    requirements: [
      {
        id: "SPEC-01",
        domain: ["packages/a.ts#alpha", "packages/domain/src/core"],
        tests: ["prose evidence", "packages/b.ts#beta"],
      },
    ],
  });
  assert.deepEqual(
    citations.map((citation) => citation.value),
    ["packages/a.ts#alpha", "packages/b.ts#beta"],
  );
});

test("test and fixture paths are classified conservatively", () => {
  for (const path of [
    "packages/a/src/a.test.ts",
    "packages/a/src/a.integration.test.ts",
    "apps/web/e2e/a.spec.ts",
    "packages/testing/src/helper.ts",
    "supabase/tests/a.sql",
    "apps/web/src/a.stories.tsx",
  ])
    assert.ok(isTestFile(path), path);
  assert.equal(isTestFile("packages/a/src/index.ts"), false);
});

test("a private helper with a real in-module call is live", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("helper", path)],
    files: corpus(
      "function helper() { return 1; }\nexport function caller() { return helper(); }\n",
    ),
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.symbols[0].verdict, "file-local");
  assert.equal(result.symbols[0].inFileReferenceCount, 1);
});

test("comments and strings do not make a TypeScript symbol live", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("deadFunction", path)],
    files: corpus("export function deadFunction() {}\n", [
      {
        path: "packages/fixture/src/comment.ts",
        text: "// deadFunction is important\nexport const label = 'deadFunction';\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.deepEqual(result.symbols[0].references, []);
});

test("an unrelated declaration with the same name does not mask deadness", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("sameName", path)],
    files: corpus("export function sameName() {}\n", [
      {
        path: "packages/other/src/index.ts",
        text: "export function sameName() { return 'different'; }\nsameName();\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
});

test("unused imports and re-exports do not count, but a real aliased call does", () => {
  const path = "packages/fixture/src/index.ts";
  const declaration = "export function liveFunction() { return 1; }\n";
  const unused = analyzeCitationLiveness({
    citations: [cite("liveFunction", path)],
    files: corpus(declaration, [
      {
        path: "packages/fixture/src/barrel.ts",
        text: "export { liveFunction } from './index';\n",
      },
      {
        path: "packages/fixture/src/unused.ts",
        text: "import { liveFunction } from './index';\nexport const other = 1;\n",
      },
    ]),
  });
  assert.equal(unused.symbols[0].verdict, "dead");

  const used = analyzeCitationLiveness({
    citations: [cite("liveFunction", path)],
    files: corpus(declaration, [
      {
        path: "packages/fixture/src/caller.ts",
        text: "import { liveFunction as invoke } from './index';\nexport const value = invoke();\n",
      },
    ]),
  });
  assert.equal(used.symbols[0].verdict, "referenced");
  assert.deepEqual(used.symbols[0].references, [
    "packages/fixture/src/caller.ts",
  ]);
});

test("an import-then-export barrel resolves to the original declaration", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("liveFunction", path)],
    files: corpus("export function liveFunction() { return 1; }\n", [
      {
        path: "packages/fixture/src/barrel.ts",
        text: "import { liveFunction } from './index';\nexport { liveFunction };\n",
      },
      {
        path: "packages/fixture/src/caller.ts",
        text: "import { liveFunction } from './barrel';\nexport const value = liveFunction();\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "referenced");
  assert.deepEqual(result.symbols[0].references, [
    "packages/fixture/src/caller.ts",
  ]);
});

test("a nested lexical shadow does not count as a use of an imported symbol", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("target", path)],
    files: corpus("export function target() {}\n", [
      {
        path: "packages/fixture/src/shadow.ts",
        text: "import { target } from './index';\nexport function caller(target: () => void) { target(); }\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.deepEqual(result.symbols[0].references, []);
});

test("loop-local bindings do not count as uses of an imported symbol", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("target", path)],
    files: corpus("export function target() {}\n", [
      {
        path: "packages/fixture/src/loops.ts",
        text: [
          "import { target } from './index';",
          "const values = [() => undefined];",
          "for (const target of values) target();",
          "for (const target in { one: true }) void target;",
          "for (let target = () => undefined; false; ) target();",
        ].join("\n"),
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.deepEqual(result.symbols[0].references, []);

  const rightHandUse = analyzeCitationLiveness({
    citations: [cite("target", path)],
    files: corpus("export function target() { return []; }\n", [
      {
        path: "packages/fixture/src/for-of-expression.ts",
        text: "import { target } from './index';\nfor (const target of target()) void target;\n",
      },
    ]),
  });
  assert.equal(rightHandUse.symbols[0].verdict, "referenced");
});

test("switch lexical bindings and function-scoped var do not count as import uses", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("target", path)],
    files: corpus("export function target() {}\n", [
      {
        path: "packages/fixture/src/switch.ts",
        text: "import { target } from './index';\nswitch (1) { case 1: const target = () => undefined; target(); break; }\n",
      },
      {
        path: "packages/fixture/src/var.ts",
        text: "import { target } from './index';\nexport function caller(flag: boolean) { if (flag) var target = () => undefined; target(); }\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.deepEqual(result.symbols[0].references, []);
});

test("named expressions and labels do not count as import uses", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("target", path)],
    files: corpus("export function target() {}\n", [
      {
        path: "packages/fixture/src/names.ts",
        text: [
          "import { target } from './index';",
          "export const recursive = function target() { target(); };",
          "export const recursiveClass = class target { method() { return target; } };",
          "target: for (;;) { break target; }",
        ].join("\n"),
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.deepEqual(result.symbols[0].references, []);
});

test("overload declarations alone do not count as an in-file call", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("overloaded", path)],
    files: corpus(
      "export function overloaded(value: string): string;\nexport function overloaded(value: number): number;\nexport function overloaded(value: string | number) { return value; }\n",
    ),
  });
  assert.equal(result.symbols[0].verdict, "dead");
  assert.equal(result.symbols[0].inFileReferenceCount, 0);
});

test("a symbol reached only by a test is test-only", () => {
  const path = "packages/fixture/src/index.ts";
  const result = analyzeCitationLiveness({
    citations: [cite("onlyTested", path)],
    files: corpus("export function onlyTested() {}\n", [
      {
        path: "packages/fixture/src/index.test.ts",
        text: "import { onlyTested } from './index';\nonlyTested();\n",
      },
    ]),
  });
  assert.equal(result.symbols[0].verdict, "test-only");
  assert.deepEqual(result.symbols[0].testReferences, [
    "packages/fixture/src/index.test.ts",
  ]);
});

test("SQL comments do not count, while an executable query reference does", () => {
  const path = "supabase/migrations/fixture.sql";
  const citation = cite("core_fixture_view", path);
  const base = [
    {
      path,
      text: "create view core_fixture_view as select 1 as value;\n",
    },
    {
      path: "packages/fixture/src/comment.ts",
      text: "// core_fixture_view\nexport const note = 'not a query';\n",
    },
    {
      path: "supabase/migrations/comment.sql",
      text: "-- select * from core_fixture_view;\n",
    },
    {
      path: "supabase/migrations/nested-comment.sql",
      text: "/* outer /* inner */ select * from core_fixture_view; */\n",
    },
  ];
  const dead = analyzeCitationLiveness({ citations: [citation], files: base });
  assert.equal(dead.symbols[0].verdict, "dead");

  const live = analyzeCitationLiveness({
    citations: [citation],
    files: [
      ...base,
      {
        path: "packages/fixture/src/query.ts",
        text: "export const query = `select * from core_fixture_view`;\n",
      },
    ],
  });
  assert.equal(live.symbols[0].verdict, "referenced");
  assert.deepEqual(live.symbols[0].references, [
    "packages/fixture/src/query.ts",
  ]);
});

test("exceptions are required to remain specific, cited, and earned", () => {
  const path = "packages/fixture/src/index.ts";
  const citation = cite("dynamicOnly", path);
  const fixture = corpus("export function dynamicOnly() {}\n");
  const key = `${path}#dynamicOnly`;
  assert.deepEqual(
    analyzeCitationLiveness({
      citations: [citation],
      files: fixture,
      exceptions: {
        [key]: "Resolved by documented reflective dispatch in production.",
      },
    }).failures,
    [],
  );
  assert.ok(
    analyzeCitationLiveness({
      citations: [],
      files: fixture,
      exceptions: {
        [key]: "Resolved by documented reflective dispatch in production.",
      },
    }).failures.some((failure) =>
      failure.id.startsWith("CITATION_EXCEPTION_STALE"),
    ),
  );
  assert.ok(
    analyzeCitationLiveness({
      citations: [citation],
      files: fixture,
      exceptions: { [key]: "too short" },
    }).failures.some((failure) =>
      failure.id.startsWith("CITATION_EXCEPTION_REASON_INVALID"),
    ),
  );
});

test("the original dead reporting helpers remain dead by symbol identity", () => {
  const result = analyzeCitationLiveness({
    citations: [cite("capacityPlanning"), cite("weeklyScorecard")],
    files,
  });
  assert.ok(result.symbols.every((symbol) => symbol.verdict === "dead"));
});

test("the real ledger is green with no exception", () => {
  assert.deepEqual(DEAD_CITATION_EXCEPTIONS, {});
  const citations = collectSymbolCitations(ledger);
  assert.ok(citations.length > 0);
  const result = analyzeCitationLiveness({ citations, files });
  assert.deepEqual(result.failures, []);
  assert.ok(
    result.symbols.every((symbol) =>
      ["referenced", "file-local"].includes(symbol.verdict),
    ),
  );
});

test("the scanner covers the repository and states its remaining limits", () => {
  assert.ok(files.length > 500);
  assert.ok(files.some((file) => file.path === reports));
  assert.ok(files.some((file) => file.path.endsWith(".sql")));
  assert.ok(files.every((file) => !file.path.includes("node_modules")));
  assert.ok(
    COVERAGE.doesNotCover.some((limitation) =>
      limitation.includes("production entrypoint"),
    ),
  );
  assert.ok(
    COVERAGE.doesNotCover.some((limitation) => limitation.includes("prose")),
  );
});
