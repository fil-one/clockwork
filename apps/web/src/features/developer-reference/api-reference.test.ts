import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  apiReferenceDocument,
  apiReferenceGroups,
  apiReferenceOperations,
  credentialReadiness,
} from "./api-reference";

function workspaceRoot(): string {
  let directory = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error("Workspace root was not found above the test directory");
    directory = parent;
  }
}

const generatedArtifact: unknown = JSON.parse(
  readFileSync(
    join(workspaceRoot(), "packages/api/src/generated/openapi.json"),
    "utf8",
  ),
);

describe("the published reference is the generated contract", () => {
  /**
   * The load-bearing assertion. Everything else on the page is a rendering of
   * this document, so if it is byte-identical to the committed artifact then
   * the page cannot drift from the API without `check:generated` failing first.
   *
   * Confirmed to fail against a hand-written reference: replacing the body of
   * `apiReferenceDocument()` with a literal document holding three paths made
   * this test fail with a diff of 55 missing paths, while every other test in
   * this file still passed. That is exactly the defect a second copy causes and
   * exactly why the other tests are not enough on their own.
   *
   * IF YOU JUST ADDED AN API ROUTE AND THIS FAILED, run `pnpm generate`. It is
   * the same failure `pnpm check:generated` reports and the same fix; this test
   * reaches it first only because it runs in a faster suite. It is deliberately
   * not softened to "the page is a superset of the artifact", because that
   * weaker form would pass while the two disagreed, which is the whole thing
   * being prevented.
   */
  it("renders the same document that packages/api/src/generated/openapi.json holds", () => {
    expect(
      apiReferenceDocument(),
      "The published reference and packages/api/src/generated/openapi.json disagree. Run `pnpm generate` and commit the result.",
    ).toEqual(generatedArtifact);
  });

  it("publishes every path and operation the contract declares", () => {
    const paths = Object.keys(
      (generatedArtifact as { paths: Record<string, unknown> }).paths,
    );
    const operations = apiReferenceOperations();
    expect(new Set(operations.map((operation) => operation.path)).size).toBe(
      paths.length,
    );
    const grouped = apiReferenceGroups().flatMap((group) => group.operations);
    expect(grouped).toHaveLength(operations.length);
  });

  it("hides no operation behind a missing tag", () => {
    const untagged = apiReferenceOperations().filter(
      (operation) => operation.tags.length === 0,
    );
    const published = apiReferenceGroups().find(
      (group) => group.tag === "untagged",
    );
    expect(published?.operations.length ?? 0).toBe(untagged.length);
  });

  it("carries the request and response detail a caller needs", () => {
    const command = apiReferenceOperations().find(
      (operation) =>
        operation.path === "/v1/core/commands/{resource}" &&
        operation.method === "POST",
    );
    expect(command).toBeDefined();
    expect(command?.parameters.map((parameter) => parameter.name)).toContain(
      "idempotency-key",
    );
    expect(command?.requestBodyRequired).toBe(true);
    expect(command?.requestContentTypes).toContain("application/json");
    expect(command?.responses.map((response) => response.status)).toContain(
      "200",
    );
  });
});

describe("credential readiness is counted, not described", () => {
  /**
   * This is the honest half of the surface. The reference is publishable
   * today; a credential a caller could hold is not built, and the page says so
   * from the contract rather than from a sentence someone typed.
   *
   * Confirmed to fail against a fabricated claim: adding a bearer scheme to
   * `components.securitySchemes` in a local copy of the document moved it into
   * `machineUsableSchemes` and failed the assertion below, which is the
   * direction that matters -- the page stops saying "no machine credential"
   * the moment one is declared, whether or not anyone remembers to edit it.
   */
  it("finds no security scheme a caller without a browser could present", () => {
    const readiness = credentialReadiness();
    expect(readiness.schemes.length).toBeGreaterThan(0);
    expect(readiness.machineUsableSchemes).toEqual([]);
    expect(
      readiness.schemes.every(
        (scheme) => scheme.type === "apiKey" && scheme.location === "cookie",
      ),
    ).toBe(true);
  });

  it("counts the operations the contract attaches no security to at all", () => {
    const readiness = credentialReadiness();
    expect(readiness.operationCount).toBe(apiReferenceOperations().length);
    expect(
      readiness.operationsWithDeclaredSecurity +
        readiness.operationsWithNoDeclaredSecurity,
    ).toBe(readiness.operationCount);
    expect(readiness.operationsWithNoDeclaredSecurity).toBeGreaterThan(0);
  });
});
