import { describe, expect, it } from "vitest";

import { illustrativeMigrations } from "./lifecycle-data";
import { buildReviewSummary, resolveMigration } from "./lifecycle-logic";

describe("migration matching decision logic", () => {
  it("blocks ambiguous migration account creation and retains the selected ID", () => {
    const ambiguous = illustrativeMigrations[0];
    if (!ambiguous) throw new Error("Missing ambiguous migration example.");

    expect(resolveMigration(ambiguous, "", true)).toMatchObject({
      allowed: false,
      action: "blocked",
    });
    const selected = ambiguous.candidates[0];
    if (!selected) throw new Error("Missing migration candidate example.");
    expect(resolveMigration(ambiguous, selected.id, true)).toEqual({
      allowed: true,
      action: "link",
      reason: `Ready to review linking to ${selected.name}. No new account will be created.`,
    });
  });

  it("requires evidence confirmation for a no-match new-account review", () => {
    const noMatch = illustrativeMigrations[2];
    if (!noMatch) throw new Error("Missing no-match migration example.");

    expect(resolveMigration(noMatch, "", false).allowed).toBe(false);
    expect(resolveMigration(noMatch, "", true)).toMatchObject({
      allowed: true,
      action: "create",
    });
  });

  it("normalizes review reasons and rejects blank decisions", () => {
    const summary = {
      action: "Retry",
      entity: "Northstar",
      impact: "One provider attempt",
      evidence: "Transient failure",
      policyBasis: "Recovery policy",
      downstreamEffect: "Activation test",
      technicalId: "PRV-1",
      actorAuthority: "Server-derived",
    };

    expect(() => buildReviewSummary(summary, "   ")).toThrow(
      "A decision reason is required.",
    );
    expect(buildReviewSummary(summary, "  Evidence verified  ").reason).toBe(
      "Evidence verified",
    );
  });
});
