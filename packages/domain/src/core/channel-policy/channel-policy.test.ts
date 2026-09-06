import { describe, expect, it } from "vitest";
import {
  ChannelPolicyTermsSchema,
  applyChannelPolicyCommand,
  channelPolicySnapshot,
  type ChannelPolicyRecord,
} from "./index";
const creator = "20000000-0000-4000-8000-000000000001",
  reviewer = "20000000-0000-4000-8000-000000000002";
const draft: ChannelPolicyRecord = {
  id: "90000000-0000-4000-8000-000000001431",
  rowVersion: 1,
  status: "draft",
  terms: {
    version: 1,
    effectiveFrom: "2026-09-06",
    selfServeThresholdTb: 250,
    defaultProtectionDays: 30,
    maximumProtectionDays: 60,
    extensionDays: 30,
    maximumExtensions: 1,
    sourceEvidence: "approved-source",
  },
  createdBy: creator,
  lastEditedBy: creator,
  proposedBy: null,
  approvedBy: null,
  approvalEvidence: null,
  decisionReason: "",
  createdAt: "2026-09-06T00:00:00Z",
  updatedAt: "2026-09-06T00:00:00Z",
};
const now = draft.createdAt;
describe("channel policy approval", () => {
  it("rejects impossible date, nonpositive threshold and default beyond allowed protection", () => {
    for (const patch of [
      { effectiveFrom: "2026-02-30" },
      { selfServeThresholdTb: 0 },
      { defaultProtectionDays: 61 },
    ])
      expect(
        ChannelPolicyTermsSchema.safeParse({ ...draft.terms, ...patch })
          .success,
      ).toBe(false);
  });
  it("freezes proposed controls and requires a distinct reviewer", () => {
    const proposed = applyChannelPolicyCommand({
      current: draft,
      command: {
        action: "propose",
        id: draft.id,
        expectedRowVersion: 1,
        reason: "Ready for review",
      },
      userId: creator,
      now,
    });
    expect(() =>
      applyChannelPolicyCommand({
        current: proposed,
        command: {
          action: "save",
          id: draft.id,
          expectedRowVersion: 2,
          terms: draft.terms,
        },
        userId: creator,
        now,
      }),
    ).toThrow("NOT_DRAFT");
    const command = {
      action: "approve" as const,
      id: draft.id,
      expectedRowVersion: 2,
      reason: "Reviewed controls",
      approvalEvidence: "signed-evidence",
    };
    expect(() =>
      applyChannelPolicyCommand({
        current: proposed,
        command,
        userId: creator,
        now,
      }),
    ).toThrow("DISTINCT_APPROVER");
    const approved = applyChannelPolicyCommand({
      current: proposed,
      command,
      userId: reviewer,
      now,
    });
    expect(channelPolicySnapshot(approved)).toMatchObject({
      source: "approved_policy",
      selfServeThresholdTb: 250,
      defaultProtectionDays: 30,
    });
    expect(() =>
      applyChannelPolicyCommand({
        current: approved,
        command: { ...command, expectedRowVersion: 3 },
        userId: reviewer,
        now,
      }),
    ).toThrow("IMMUTABLE");
  });
  it("rejects stale versions and approval after the effective date", () => {
    expect(() =>
      applyChannelPolicyCommand({
        current: draft,
        command: {
          action: "save",
          id: draft.id,
          expectedRowVersion: 2,
          terms: draft.terms,
        },
        userId: creator,
        now,
      }),
    ).toThrow("VERSION_CONFLICT");
    const proposed = {
      ...draft,
      status: "proposed" as const,
      proposedBy: creator,
    };
    expect(() =>
      applyChannelPolicyCommand({
        current: proposed,
        command: {
          action: "approve",
          id: draft.id,
          expectedRowVersion: 1,
          reason: "Reviewed controls",
          approvalEvidence: "signed-evidence",
        },
        userId: reviewer,
        now: "2026-09-07T00:00:00Z",
      }),
    ).toThrow("BACKDATED");
  });
  it("distinguishes legacy defaults from approved policy", () => {
    expect(channelPolicySnapshot(undefined)).toMatchObject({
      source: "legacy_defaults",
      version: 0,
      defaultProtectionDays: 90,
      selfServeThresholdTb: 100,
      maximumProtectionDays: null,
    });
    expect(() => channelPolicySnapshot(draft)).toThrow("APPROVED_REQUIRED");
  });
});
