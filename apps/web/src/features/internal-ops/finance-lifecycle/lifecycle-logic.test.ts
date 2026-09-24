import { describe, expect, it } from "vitest";

import { illustrativeMigrations } from "./lifecycle-data";
import { buildReviewSummary, resolveMigration } from "./lifecycle-logic";

describe("migration matching decision logic", () => {
  it("blocks ambiguous migration account creation and retains the selected ID", () => {
    const ambiguous = illustrativeMigrations[0];
    if (!ambiguous) throw new Error("Missing ambiguous migration example.");

    expect(resolveMigration(ambiguous, "", true)).toEqual({
      allowed: false,
      action: "blocked",
      reason: "ambiguous",
    });
    const selected = ambiguous.candidates[0];
    if (!selected) throw new Error("Missing migration candidate example.");
    // The reason is a code; the surface words it (with the candidate's name)
    // in the reader's language.
    expect(resolveMigration(ambiguous, selected.id, true)).toEqual({
      allowed: true,
      action: "link",
      reason: "readyToLink",
    });
  });

  it("requires evidence confirmation for a no-match new-account review", () => {
    const noMatch = illustrativeMigrations[2];
    if (!noMatch) throw new Error("Missing no-match migration example.");

    expect(resolveMigration(noMatch, "", false)).toEqual({
      allowed: false,
      action: "blocked",
      reason: "confirmEvidence",
    });
    expect(resolveMigration(noMatch, "", true)).toEqual({
      allowed: true,
      action: "create",
      reason: "newAccountReview",
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
      "REVIEW_REASON_REQUIRED",
    );
    expect(buildReviewSummary(summary, "  Evidence verified  ").reason).toBe(
      "Evidence verified",
    );
  });
});
