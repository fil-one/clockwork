import { describe, expect, it } from "vitest";

import {
  collections,
  migrations,
  provisioning,
  renewals,
  type CollectionRecord,
  type ProvisioningRecord,
} from "./lifecycle-data";
import {
  assessRetry,
  buildReviewSummary,
  groupRenewals,
  prioritizeCollections,
  resolveMigration,
} from "./lifecycle-logic";

describe("finance lifecycle decision logic", () => {
  it("groups renewal exposure into the supported planning horizons", () => {
    const grouped = groupRenewals(renewals);

    expect(grouped["30"].map((record) => record.account)).toEqual([
      "Northstar Archive Labs",
      "Halcyon Research Cooperative",
    ]);
    expect(grouped["60-90"]).toHaveLength(2);
    expect(grouped["180"]).toHaveLength(1);
  });

  it("prioritizes collections by overdue value, then age, dispute, and owner", () => {
    function collection(index: number): CollectionRecord {
      const record = collections[index];
      if (!record) throw new Error(`Missing collection fixture ${index}.`);
      return record;
    }
    const ranked = prioritizeCollections([
      { ...collection(3), overdueCents: 100_00, ageDays: 10, owner: "Zed" },
      {
        ...collection(2),
        overdueCents: 100_00,
        ageDays: 20,
        dispute: "Evidence due",
        owner: "Mara",
      },
      {
        ...collection(1),
        overdueCents: 100_00,
        ageDays: 20,
        dispute: "Under review",
        owner: "Amina",
      },
      { ...collection(0), overdueCents: 200_00, ageDays: 1 },
    ]);

    expect(ranked.map((record) => record.overdueCents)).toEqual([
      200_00, 100_00, 100_00, 100_00,
    ]);
    expect(ranked[1]?.dispute).toBe("Under review");
    expect(ranked[2]?.dispute).toBe("Evidence due");
  });

  it("allows only transient provisioning retries with verified idempotency", () => {
    function operation(index: number): ProvisioningRecord {
      const record = provisioning[index];
      if (!record) throw new Error(`Missing provisioning fixture ${index}.`);
      return record;
    }
    expect(assessRetry(operation(0)).allowed).toBe(true);
    expect(assessRetry(operation(1))).toMatchObject({
      allowed: false,
      label: "Escalation required",
    });
    expect(assessRetry(operation(2))).toMatchObject({
      allowed: false,
      label: "Retry blocked",
    });
    expect(assessRetry(operation(3))).toMatchObject({
      allowed: false,
      label: "Activation test pending",
    });
  });

  it("blocks ambiguous migration account creation and retains the selected ID", () => {
    const ambiguous = migrations[0];
    expect(ambiguous).toBeDefined();
    if (!ambiguous) throw new Error("Missing ambiguous migration fixture.");

    expect(resolveMigration(ambiguous, "", true)).toMatchObject({
      allowed: false,
      action: "blocked",
    });
    const selected = ambiguous.candidates[0];
    expect(selected).toBeDefined();
    if (!selected) throw new Error("Missing migration candidate fixture.");
    expect(resolveMigration(ambiguous, selected.id, true)).toEqual({
      allowed: true,
      action: "link",
      reason: `Ready to review linking to ${selected.name}. No new account will be created.`,
    });
  });

  it("requires evidence confirmation for a no-match new-account review", () => {
    const noMatch = migrations[2];
    expect(noMatch).toBeDefined();
    if (!noMatch) throw new Error("Missing no-match migration fixture.");

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
