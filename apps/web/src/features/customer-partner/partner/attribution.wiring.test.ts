import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

describe("partner attribution wiring", () => {
  it("mounts derived display only on partner resale and registration surfaces", () => {
    expect(
      source("src/features/customer-partner/partner/resale-quote-builder.tsx"),
    ).toContain("attributionStatement(");
    expect(
      source("src/features/customer-partner/partner/partner-collection.tsx"),
    ).toContain("registrationCreditLabel(record.status)");
  });

  it("adds no attribution or influence capture to the customer quote builder", () => {
    const customer = source(
      "src/features/customer-partner/commercial/quote-builder.tsx",
    );
    expect(customer).not.toContain("attributionStatement");
    expect(customer).not.toContain("registrationCreditLabel");
    expect(customer).not.toMatch(/name=["'](?:attribution|influenceBps)["']/);
  });

  it("pins sourced display to the repository's approved-status derivation", () => {
    const repository = source(
      "../../packages/db/src/repositories/core/database-finance.ts",
    );
    expect(repository).toContain(
      'credit: prior.status === "approved" ? "sourced" : "none"',
    );
  });
});
