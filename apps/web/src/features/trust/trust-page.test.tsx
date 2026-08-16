import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { render, screen, within } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { TrustPage } from "./trust-page";
import {
  tokenDistinctivenessCeiling,
  trustControls,
  trustGaps,
  trustIntegrations,
  trustUnselectedIntegrations,
} from "./trust-register";

/**
 * The page has one job beyond looking right: it must publish the whole
 * register, including the parts nobody wants to publish. A trust page that
 * quietly drops the "what this does not claim" section while keeping the
 * controls is the failure mode, and it is a rendering change away at any time.
 *
 * Confirmed to fail against the unfixed code by deleting the `trustGaps`
 * block from `trust-page.tsx` and re-running: "publishes every gap" and
 * "names the external gate" both failed, and the control and integration
 * assertions still passed -- which is the point.
 */
describe("trust page", () => {
  it("publishes every control in the register, and every file each one rests on", () => {
    render(<TrustPage />);
    for (const control of trustControls) {
      expect(screen.getByText(control.statement)).toBeInTheDocument();
      expect(
        screen.getAllByText(control.evidencePath).length,
      ).toBeGreaterThanOrEqual(1);
      // A control that cites an exception has to show the reader where the
      // exception lives, or the qualifying half of the sentence is unopenable.
      for (const citation of control.alsoCites ?? [])
        expect(
          screen.getAllByText(citation.path).length,
          `${control.id} rests on ${citation.path}, which the page does not name`,
        ).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * The lede is the one paragraph on this page that is a claim about the build
   * rather than a row of the register, and it is the paragraph that was false:
   * it promised the build failed when a file "no longer contains what the
   * control claims", which no check performed.
   *
   * Confirmed to fail against the unfixed wording: restoring the single
   * "That is the whole guarantee this page offers" sentence fails both
   * assertions below, because it states neither the distinctiveness check nor
   * the human judgement it was standing in for.
   */
  it("states each check the build performs rather than summarising them into a guarantee", () => {
    render(<TrustPage />);
    expect(screen.getByText(/the file exists/i)).toBeInTheDocument();
    expect(
      screen.getByText(/still contains the cited text/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `no more than ${tokenDistinctivenessCeiling * 100} per cent`,
          "i",
        ),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/any number of two or more digits/i),
    ).toBeInTheDocument();
  });

  it("says plainly that no check establishes the wording is a fair description", () => {
    render(<TrustPage />);
    expect(
      screen.getByText(
        /What the build cannot check at all is whether the sentence is a\s+fair description/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/human\s+judgement/i)).toBeInTheDocument();
  });

  it("makes no claim that a citation check catches a false statement", () => {
    const { container } = render(<TrustPage />);
    const text = container.textContent ?? "";
    // The wording that was refuted, and the family it belongs to. A page that
    // says any of this is promising a semantic check that does not exist.
    for (const forbidden of [
      /no longer contains what the control claims/i,
      /the whole guarantee/i,
      /guarantees? that (?:each|every) (?:control|statement|claim) is/i,
    ])
      expect(
        forbidden.test(text),
        `the page uses ${forbidden.source}, which promises more than the suite checks`,
      ).toBe(false);
  });

  it("publishes every gap and names the external gate that closes it", () => {
    render(<TrustPage />);
    for (const gap of trustGaps) {
      expect(screen.getByText(gap.statement)).toBeInTheDocument();
      expect(
        screen.getAllByText(`Requires ${gap.gate}`).length,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("says on the page itself that it publishes no certification or audit result", () => {
    render(<TrustPage />);
    expect(
      screen.getByText(
        /publishes no certification, audit result or policy text/i,
      ),
    ).toBeInTheDocument();
  });

  it("presents the integration list under a heading that refuses the subprocessor reading", () => {
    render(<TrustPage />);
    for (const integration of trustIntegrations)
      expect(screen.getByText(integration.name)).toBeInTheDocument();
    for (const entry of trustUnselectedIntegrations)
      expect(screen.getByText(entry.capability)).toBeInTheDocument();
    expect(
      screen.getByText(/not a subprocessor schedule/i, { selector: "div" }),
    ).toBeInTheDocument();
  });

  it("gives every table an accessible name and a header row", () => {
    render(<TrustPage />);
    const tables = screen.getAllByRole("table");
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table).toHaveAccessibleName();
      expect(
        within(table).getAllByRole("columnheader").length,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no axe violations", async () => {
    const { container } = render(<TrustPage />);
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
  }, 30_000);
});

/**
 * A trust page behind a login is not a trust page.
 *
 * An enterprise security review begins before first contact, so the reader this
 * surface exists for has no account and cannot be asked to make one. The route
 * was previously reachable to signed-in users only, with a comment saying the
 * fix was a one-line change in a file this lane did not own. The change is made;
 * this is what keeps it made.
 *
 * Confirmed to fail against the unfixed state: removing "/trust" from
 * `unauthenticatedPaths` fails "is served to a reader who is not signed in"
 * and nothing else.
 */
describe("the trust page reaches a reader with no account", () => {
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

  it("is served to a reader who is not signed in", () => {
    expect(unauthenticatedPaths).toContain("/trust");
  });

  it("renders without reading a session, a cookie or a request", () => {
    // The reason it is safe to serve anonymously, asserted rather than
    // asserted-in-a-comment: the component takes no props and the module it
    // renders is a constant. If either changes, this stops being true and the
    // proxy entry has to be reconsidered.
    expect(TrustPage.length).toBe(0);
    const first = render(<TrustPage />).container.textContent;
    const second = render(<TrustPage />).container.textContent;
    expect(first).toBe(second);
    // And nothing on it has the shape of a value that could only have come
    // from a request: an address, an identifier, a token.
    for (const leak of [
      { name: "an email address", pattern: /[\w.+-]+@[\w-]+\.[\w.]+/ },
      {
        name: "a UUID",
        pattern:
          /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
      },
      { name: "a bearer token", pattern: /\bBearer\s+\S+/ },
    ])
      expect(
        leak.pattern.test(first ?? ""),
        `the page renders something matching ${leak.name}, which cannot have come from the register`,
      ).toBe(false);
  });
});
