import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import {
  apiReferenceGroups,
  apiReferenceOperations,
  credentialReadiness,
} from "./api-reference";
import { ApiReferencePage } from "./reference-page";
import {
  authenticationClasses,
  enumerableAuthenticationClasses,
} from "./route-authentication";

/**
 * The page must publish the whole contract and must keep saying the
 * uncomfortable thing while it is still true.
 *
 * Confirmed to fail against the unfixed code:
 *  - dropping the credential notice from `reference-page.tsx` failed
 *    "says plainly that there is no credential a caller can hold" while every
 *    other assertion here still passed;
 *  - filtering the `core` group out of the rendered list failed "publishes
 *    every operation the contract declares", naming the eight rows it lost.
 *
 * The first attempt at that second injection filtered `webhooks` and the suite
 * stayed green, which was correct: operations are grouped by FIRST tag and
 * `webhooks` is nobody's first tag, so the filter removed nothing. The
 * injection was wrong, not the test -- but it is recorded here because it is
 * the reason the page now carries a Tags column: grouping by first tag alone
 * was hiding the secondary tags from the reader.
 */
describe("api reference page", () => {
  it("publishes every operation the contract declares", () => {
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    const rendered = new Set(
      screen
        .getAllByRole("row")
        .map((row) => row.textContent ?? "")
        .filter(Boolean),
    );
    for (const operation of apiReferenceOperations())
      expect(
        [...rendered].some(
          (text) =>
            text.includes(operation.path) && text.includes(operation.method),
        ),
        `${operation.method} ${operation.path} is not on the page`,
      ).toBe(true);
  });

  it("says plainly that there is no credential a caller can hold", () => {
    const readiness = credentialReadiness();
    // Guard the guard: if a machine credential ever ships, this test should
    // start failing loudly rather than quietly asserting a stale sentence.
    expect(readiness.machineUsableSchemes).toEqual([]);
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    expect(
      screen.getByText(/no API credential you can hold yet/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Issuing, listing and revoking a machine credential is not built/i,
      ),
    ).toBeInTheDocument();
  });

  /**
   * The refuted claim, and the shape of the replacement.
   *
   * The page used to answer "52 of 59 operations declare no security scheme"
   * with "each handler resolves a permission and an account scope before it
   * runs". It was hand-written, bound to nothing, and false for ten of the
   * fifty-two. An integrator would have made a security decision on it.
   *
   * Confirmed to fail against the unfixed page: restoring that clause fails
   * "makes no blanket claim about the operations that declare no scheme" on the
   * first pattern, while every other assertion in this file still passes --
   * which is why the assertion is written against the text rather than against
   * the absence of a section.
   */
  it("names every operation whose authentication is not a browser session", () => {
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    for (const entry of enumerableAuthenticationClasses())
      for (const operation of entry.operations)
        expect(
          screen.getAllByText(operation.path).length,
          `${operation.method} ${operation.path} is authenticated by ${entry.mechanism} and the page does not name it`,
        ).toBeGreaterThanOrEqual(1);
  });

  it("publishes a count for every authentication class it distinguishes", () => {
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    for (const entry of authenticationClasses()) {
      expect(screen.getAllByText(entry.title).length).toBeGreaterThanOrEqual(1);
      expect(
        screen.getAllByText(String(entry.operations.length)).length,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes no blanket claim about the operations that declare no scheme", () => {
    const { container } = render(
      <ApiReferencePage specHref="/developers/openapi.json" />,
    );
    const text = container.textContent ?? "";
    for (const forbidden of [
      /each handler resolves a permission and an account scope/i,
      /every handler resolves a permission/i,
      /all (?:of )?(?:these|those) (?:operations|handlers) (?:are|require) authenticated/i,
    ])
      expect(
        forbidden.test(text),
        `the page uses ${forbidden.source}, which is the claim that was false for ten operations`,
      ).toBe(false);
  });

  it("links the machine-readable contract", () => {
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    expect(
      screen.getByRole("link", { name: "/developers/openapi.json" }),
    ).toHaveAttribute("href", "/developers/openapi.json");
  });

  it("gives every table an accessible name and a header row", () => {
    render(<ApiReferencePage specHref="/developers/openapi.json" />);
    const tables = screen.getAllByRole("table");
    // One authentication table plus one per operation group.
    expect(tables.length).toBe(apiReferenceGroups().length + 1);
    for (const table of tables) {
      expect(table).toHaveAccessibleName();
      expect(
        within(table).getAllByRole("columnheader").length,
      ).toBeGreaterThanOrEqual(3);
    }
    for (const table of tables.filter((candidate) =>
      (candidate.querySelector("caption")?.textContent ?? "").endsWith(
        "operations",
      ),
    ))
      expect(
        within(table).getAllByRole("columnheader").length,
      ).toBeGreaterThanOrEqual(5);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ApiReferencePage specHref="/developers/openapi.json" />,
    );
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    expect(
      results.violations.map(
        (violation) => `${violation.id}: ${violation.help}`,
      ),
    ).toEqual([]);
  }, 60_000);
});

/**
 * An integrator evaluating this API has no account yet.
 *
 * The reference was reachable to signed-in users only, which meant the reader
 * it is written for could not read it. `apps/web/proxy.ts` now serves both the
 * page and the machine-readable contract beside it without a session.
 *
 * Confirmed to fail against the unfixed state: removing "/developers" from
 * `unauthenticatedPaths` fails "is served to a caller who is not signed in",
 * and removing "/developers/openapi.json" fails the spec assertion beside it --
 * the entries are matched exactly, not by prefix, so the second is not implied
 * by the first.
 */
describe("the reference reaches a caller with no account", () => {
  function workspaceRoot(): string {
    let directory = resolve(process.cwd());
    for (;;) {
      if (existsSync(join(directory, "pnpm-workspace.yaml"))) return directory;
      const parent = dirname(directory);
      if (parent === directory)
        throw new Error(
          "Workspace root was not found above the test directory",
        );
      directory = parent;
    }
  }

  const proxy = readFileSync(
    join(workspaceRoot(), "apps/web/proxy.ts"),
    "utf8",
  );
  const unauthenticatedPaths = [
    ...(/unauthenticatedPaths: \[([\s\S]*?)\]/
      .exec(proxy)?.[1]
      ?.matchAll(/"([^"]+)"/g) ?? []),
  ].map((match) => match[1]);

  it("is served to a caller who is not signed in", () => {
    expect(unauthenticatedPaths).toContain("/developers");
  });

  it("serves the machine-readable contract to the same caller", () => {
    expect(unauthenticatedPaths).toContain("/developers/openapi.json");
  });

  it("renders the same document for every reader", () => {
    expect(ApiReferencePage.length).toBe(1);
    const first = render(
      <ApiReferencePage specHref="/developers/openapi.json" />,
    ).container.textContent;
    const second = render(
      <ApiReferencePage specHref="/developers/openapi.json" />,
    ).container.textContent;
    expect(first).toBe(second);
    for (const leak of [
      { name: "an email address", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
      {
        name: "a UUID",
        pattern:
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
      },
    ])
      expect(
        leak.pattern.test(first ?? ""),
        `the page renders something matching ${leak.name}, which cannot have come from the contract`,
      ).toBe(false);
  });
});
