import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isScannableFile,
  looksLikeCopy,
  scanPaths,
  scanSource,
} from "./i18n-scan.mjs";

function texts(source, path = "fixture.tsx", options = {}) {
  return scanSource(path, source, options).findings.map(
    ({ kind, text }) => `${kind}:${text}`,
  );
}

test("reports JSX text", () => {
  assert.deepEqual(texts(`const A = () => <p>Rows per page</p>;`), [
    "jsx-text:Rows per page",
  ]);
});

test("reports a rendered attribute and ignores className and href", () => {
  assert.deepEqual(
    texts(
      `const A = () => <nav aria-label="Results pages" className="pager wide-pager" href="/partner/portfolio" />;`,
    ),
    ["jsx-attr:Results pages"],
  );
});

test("ignores strings beneath a non-copy attribute, even in a conditional", () => {
  assert.deepEqual(
    texts(`const A = ({ x }) => <p className={x ? "is open" : "closed"} />;`),
    [],
  );
});

test("ignores proper nouns and reports a sentence that contains one", () => {
  assert.deepEqual(
    texts(`export const rows = [
      { owner: "Juno Okafor", name: "Halcyon Research Cooperative" },
      { context: "Resale · US East · 280 TB committed" },
    ];`),
    ["literal:Resale · US East · 280 TB committed"],
  );
});

test("reports a Title Case phrase made of ordinary words", () => {
  assert.deepEqual(
    texts(`export const role = { jobTitle: "Commercial Director" };`),
    ["literal:Commercial Director"],
  );
});

test("reports a single capitalized interface word", () => {
  assert.deepEqual(
    texts(`const A = () => <button type="submit">Apply</button>;`),
    ["jsx-text:Apply"],
  );
  assert.deepEqual(texts(`export const copy = { search: "Search" };`), [
    "literal:Search",
  ]);
});

test("ignores message IDs passed to the translator and identifier strings", () => {
  const messageIds = new Set(["partner.detail.reference"]);
  assert.deepEqual(
    texts(
      `const A = ({ t }) => <span>{t("partner.detail.reference", { name: "Atlas Field Imaging" })}</span>;
       const status = "open";
       const sort = ["name-asc", "risk-desc"];
       const label = "partner.detail.reference";`,
      "fixture.tsx",
      { messageIds },
    ),
    [],
  );
});

test("reports template literals with English static text in JSX", () => {
  assert.deepEqual(
    texts("const A = ({ noun }) => <input placeholder={`Search ${noun}`} />;"),
    ["jsx-template:`Search ${noun}`"],
  );
});

test("reports setState messages and error messages", () => {
  assert.deepEqual(
    texts(`function f(setMessage) {
      setMessage("Renewal request submitted.");
      throw new Error("The renewal record is no longer actionable.");
    }`),
    [
      "literal:Renewal request submitted.",
      "error:The renewal record is no longer actionable.",
    ],
  );
});

test("a trailing marker covers its line and a standalone marker the next line", () => {
  const result = scanSource(
    "fixture.tsx",
    `const a = <p>Visible copy</p>;
// i18n-exempt: provider status text, shown verbatim by policy rule 1
const b = <p>Provider says hello</p>;
const c = <p>Also exempt</p>; // i18n-exempt: fixture for the scanner test
const d = <p>Not exempt</p>;
const e = <div>{/* i18n-exempt: JSX comment form */}Exempt in JSX</div>;`,
  );
  assert.deepEqual(
    result.findings.map(({ text }) => text),
    ["Visible copy", "Not exempt"],
  );
  assert.deepEqual(
    result.exempted.map(({ text }) => text),
    ["Provider says hello", "Also exempt", "Exempt in JSX"],
  );
});

test("an exemption without a reason is reported and exempts nothing", () => {
  const result = scanSource(
    "fixture.tsx",
    `// i18n-exempt:
const b = <p>Still reported</p>;
const c = <p>Also reported</p>; // i18n-exempt`,
  );
  assert.deepEqual(result.findings.map(({ kind }) => kind).sort(), [
    "exempt-without-reason",
    "exempt-without-reason",
    "jsx-text",
    "jsx-text",
  ]);
  assert.equal(result.exempted.length, 0);
});

test("a file exemption in the header exempts the whole file", () => {
  const result = scanSource(
    "fixture.ts",
    `// i18n-exempt-file: generated PDF content, not translated (policy rule 5)
export const lines = ["Storage capacity", "Egress allowance"];`,
  );
  assert.deepEqual(result.findings, []);
  assert.equal(result.exempted.length, 2);
  assert.equal(
    result.fileExemption,
    "generated PDF content, not translated (policy rule 5)",
  );
});

test("a file exemption below the header is reported, not honoured", () => {
  const filler = Array.from(
    { length: 25 },
    (_, index) => `const v${index} = ${index};`,
  );
  const result = scanSource(
    "fixture.ts",
    `${filler.join("\n")}\n// i18n-exempt-file: too late\nexport const copy = { title: "Price books" };`,
  );
  assert.deepEqual(
    result.findings.map(({ kind }) => kind),
    ["exempt-misplaced", "literal"],
  );
});

test("skips test, story, fixture, declaration, and catalog files", () => {
  for (const path of [
    "apps/web/src/a.test.tsx",
    "apps/web/src/a.spec.ts",
    "packages/ui/src/stories/a.stories.tsx",
    "apps/web/src/a.test-fixture.ts",
    "apps/web/src/a.d.ts",
    "apps/web/src/i18n/messages/partner.ts",
    "apps/web/e2e/language.ts",
  ])
    assert.equal(isScannableFile(path), false, path);
  assert.equal(isScannableFile("apps/web/src/features/a.tsx"), true);
});

test("walks directories, skips test files, and reports per file", () => {
  const directory = mkdtempSync(join(tmpdir(), "i18n-scan-"));
  try {
    mkdirSync(join(directory, "feature"));
    writeFileSync(
      join(directory, "feature", "page.tsx"),
      `export const Page = () => <h1>End-client portfolio</h1>;`,
    );
    writeFileSync(
      join(directory, "feature", "page.test.tsx"),
      `export const Page = () => <h1>Only in a test</h1>;`,
    );
    const result = scanPaths(["feature"], {
      cwd: directory,
      messageIds: new Set(),
    });
    assert.equal(result.total, 1);
    assert.deepEqual(
      result.files.map(({ path, count }) => [path, count]),
      [["feature/page.tsx", 1]],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not treat URLs, CSS classes, or CSP grammar as copy", () => {
  for (const value of [
    "https://app.fil.one/buckets",
    "/partner/portfolio",
    "flex items-center gap-2",
    "default-src 'self'",
    "owner@northstar.test",
    "application/pdf",
    "2026-09-23T10:00:00Z",
    "PARTNER_ADMIN",
    "Fil One",
    "280 TB",
  ])
    assert.equal(looksLikeCopy(value), false, value);
  for (const value of [
    "Search",
    "Rows per page",
    "Page",
    "3 of 4 tests passed",
  ])
    assert.equal(looksLikeCopy(value), true, value);
});
