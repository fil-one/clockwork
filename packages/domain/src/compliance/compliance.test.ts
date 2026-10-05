import { permissionsForRoles } from "@clockwork/contracts";
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
        permissions: ["account:read"],
        purpose: "business_owner_download",
        operation: "download",
      }),
    ).toThrow("EVIDENCE_ACCOUNT_SCOPE");
  });

  it("lets operators and legal approvers scan and audit any evidence", () => {
    for (const roles of [
      ["internal_operator"],
      ["legal_approver"],
      ["commerce_admin"],
    ] as const)
      for (const purpose of ["malware_scan", "retention_audit"] as const)
        expect(() =>
          authorizeEvidenceAccess({
            actorId: "user-1",
            accountIds: [],
            documentAccountId: "account-2",
            permissions: permissionsForRoles(roles),
            purpose,
            operation: "metadata",
          }),
        ).not.toThrow();
    for (const role of ["finance_approver", "revenue", "owner"] as const)
      expect(() =>
        authorizeEvidenceAccess({
          actorId: "user-1",
          accountIds: ["account-2"],
          documentAccountId: "account-2",
          permissions: permissionsForRoles([role]),
          purpose: "malware_scan",
          operation: "metadata",
        }),
      ).toThrow("MALWARE_SCANNER_ROLE_REQUIRED");
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
