import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FinancePageFrame } from "./page-frame";

describe("FinancePageFrame provenance", () => {
  it("prints the instant a projection read was generated", () => {
    render(
      <FinancePageFrame
        title="Collections priority"
        description="…"
        provenance={{
          kind: "projection",
          channel: "collections",
          generatedAt: "2026-08-15T09:15:00.000Z",
          stale: false,
          pagesRead: 2,
          recordCount: 140,
        }}
      >
        <p>rows</p>
      </FinancePageFrame>,
    );

    expect(
      screen.getByText("2026-08-15T09:15:00.000Z", { selector: "time" }),
    ).toBeVisible();
    expect(screen.getByRole("status").textContent).toContain("2 server pages");
    expect(screen.getByRole("status").textContent).toContain("140 records");
  });

  it("raises an alert rather than a status when the projection is stale", () => {
    render(
      <FinancePageFrame
        title="Collections priority"
        description="…"
        provenance={{
          kind: "projection",
          channel: "collections",
          generatedAt: "2026-08-15T09:15:00.000Z",
          stale: true,
          pagesRead: 1,
          recordCount: 1,
        }}
      >
        <p>rows</p>
      </FinancePageFrame>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Stale projection");
  });

  it("says plainly when a surface is not wired to anything", () => {
    render(
      <FinancePageFrame
        title="Migration matching"
        description="…"
        provenance={{ kind: "unwired", detail: "No channel backs this." }}
      >
        <p>rows</p>
      </FinancePageFrame>,
    );

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "This surface is not wired to a data source.",
    );
    expect(alert.textContent).toContain("No channel backs this.");
  });

  it("distinguishes a completed read from one that never happened", () => {
    const { rerender } = render(
      <FinancePageFrame
        title="Stopped work"
        description="…"
        provenance={{
          kind: "read",
          source: "Dispatch queue",
          readAt: "2026-08-15T09:15:00.000Z",
        }}
      >
        <p>rows</p>
      </FinancePageFrame>,
    );
    expect(screen.getByText("Read at page load")).toBeVisible();

    rerender(
      <FinancePageFrame
        title="Stopped work"
        description="…"
        provenance={{
          kind: "unreadable",
          source: "No queue read is available",
        }}
      >
        <p>rows</p>
      </FinancePageFrame>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "No read completed for this request",
    );
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry) ? [path] : [];
  });
}

/**
 * The freshness lines these surfaces used to print were the defect, not a
 * detail of it: "Collections ledger refreshed 3 minutes ago" and "Operational
 * snapshot refreshed 4 minutes ago" sat above frozen literals, and
 * "4 operations · live provider state" described a checked-in array as live.
 * A hand-written age can only ever be wrong, so none may reappear.
 */
const FROZEN_FRESHNESS =
  /refreshed \d+ minutes? ago|\bUpdated \d+ (?:minutes?|hours?) ago|\d+ min ago|live provider state/iu;

/**
 * Comments are stripped first. Several of these modules quote the retired
 * strings to explain why they are gone, and a guard that could not tell an
 * explanation from a rendered literal would push the explanations out.
 */
function withoutComments(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
    .replaceAll(/(^|[^:])\/\/.*$/gmu, "$1");
}

describe("no surface states a freshness it did not read", () => {
  const root = join(import.meta.dirname, "..");
  /**
   * `administration-safety/data.ts` is the external-gate register's
   * fail-closed fallback, which `/internal/gates` selects deliberately and
   * labels as a fallback. It is not one of the surfaces under repair here.
   */
  const excluded = join(root, "administration-safety", "data.ts");

  it.each(
    sourceFiles(root).filter(
      (path) => path !== excluded && !path.endsWith("provenance.test.tsx"),
    ),
  )("%s", (path) => {
    expect(withoutComments(readFileSync(path, "utf8"))).not.toMatch(
      FROZEN_FRESHNESS,
    );
  });
});
