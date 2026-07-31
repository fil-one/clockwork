import { describe, expect, it } from "vitest";

import {
  authorizeEvidenceAccess,
  restrictedPartyGate,
  validateImmutableEvidenceMetadata,
} from ".";

describe("compliance policy", () => {
  it("blocks embargoed countries even if a provider incorrectly returns clear", () => {
    expect(
      restrictedPartyGate({
        accountId: "account-1",
        legalName: "Restricted Entity",
        country: "KP",
        reason: "registration",
        providerDecision: "clear",
        providerReference: "screen-1",
        screenedAt: "2026-07-31T16:00:00.000Z",
        refreshDays: 30,
        evidenceDocumentId: "document-1",
      }),
    ).toMatchObject({ mayProceed: false, record: { decision: "blocked" } });
  });

  it("enforces account scope for evidence downloads", () => {
    expect(() =>
      authorizeEvidenceAccess({
        actorId: "user-1",
        accountIds: ["account-1"],
        documentAccountId: "account-2",
        internalRoles: [],
        purpose: "business_owner_download",
        operation: "download",
      }),
    ).toThrow("EVIDENCE_ACCOUNT_SCOPE");
  });

  it("requires content addressing, versioning, compliance lock and future retention", () => {
    expect(
      validateImmutableEvidenceMetadata(
        {
          contentHash: "a".repeat(64),
          storageKey: `sha256/${"a".repeat(64)}`,
          versionId: "version-1",
          objectLockMode: "COMPLIANCE",
          retainUntil: "2033-07-31T16:00:00.000Z",
          legalHold: false,
          malwareScanStatus: "clean",
        },
        "2026-07-31T16:00:00.000Z",
      ),
    ).toMatchObject({ versionId: "version-1" });
  });
});
