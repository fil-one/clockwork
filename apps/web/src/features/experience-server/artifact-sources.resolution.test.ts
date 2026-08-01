import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import type { RuntimeTransaction } from "@clockwork/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveArtifactSource,
  type ArtifactSourceRequest,
} from "./artifact-sources";
import { artifactKinds, type ArtifactKind } from "./model";

const accountId = "10000000-0000-4000-8000-000000000001";
const subjectId = "90000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000001";
const now = "2026-07-31T16:00:00.000Z";
const retainUntil = "2033-07-31T16:00:00.000Z";
const hash = "a".repeat(64);
const party = {
  legalName: "Clockwork Platform, Inc.",
  address: {
    line1: "1 Evidence Way",
    locality: "Wilmington",
    region: "DE",
    postalCode: "19801",
    countryCode: "US",
  },
  contactEmail: "commerce@example.test",
};

const customerSession: SessionClaims = {
  userId,
  organizationId: "30000000-0000-4000-8000-000000000001",
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const partnerSession: SessionClaims = {
  ...customerSession,
  roles: ["partner_admin"],
};
const internalSession: SessionClaims = {
  ...customerSession,
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
};

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function accountRow() {
  return {
    legal_name: "Customer Archive Ltd.",
    registered_address: {
      line1: "2 Customer Street",
      city: "New York",
      region: "NY",
      postalCode: "10001",
      country: "US",
    },
    tax_ids: [{ value: "US-TAX-1" }],
    billing_contact: {
      name: "Billing Owner",
      email: "billing@example.test",
    },
    locale: "en-US",
  };
}

function transaction(results: readonly unknown[][]): RuntimeTransaction {
  const remaining = results.map((rows) => [...rows]);
  return {
    execute: vi.fn(() => Promise.resolve(remaining.shift() ?? [])),
  } as unknown as RuntimeTransaction;
}

function baseDefinition(kind: ArtifactKind) {
  return {
    kind,
    displayDocumentId: `${kind}-${subjectId}`,
    documentVersion: "1",
    issuedAt: now,
    locale: "en-US",
    recipient: party,
    issuerMode: kind === "partner_resale_quote" ? "partner" : "platform",
    ...(kind === "partner_resale_quote" ? { partnerIssuer: party } : {}),
  };
}

function commercialDefinition(kind: ArtifactKind) {
  const base = baseDefinition(kind);
  if (
    kind === "direct_quote" ||
    kind === "partner_transfer_quote" ||
    kind === "partner_resale_quote"
  )
    return {
      ...base,
      quoteNumber: "Q-1",
      validUntil: "2026-08-31",
      currency: "USD",
      lineItems: [
        {
          id: "line-1",
          description: "Archive service",
          amount: { currency: "USD", minorUnits: "10000" },
        },
      ],
      totals: {
        subtotal: { currency: "USD", minorUnits: "10000" },
        total: { currency: "USD", minorUnits: "10000" },
      },
      paymentTerms: "Due on receipt",
    };
  if (kind === "order_form")
    return {
      ...base,
      orderNumber: "ORD-1",
      quoteReference: "Q-1",
      governingAgreementReference: "AGR-1",
      servicePeriod: { startDate: "2026-08-01", endDate: "2027-07-31" },
      currency: "USD",
      lineItems: [
        {
          id: "line-1",
          description: "Archive service",
          amount: { currency: "USD", minorUnits: "10000" },
        },
      ],
      totals: {
        subtotal: { currency: "USD", minorUnits: "10000" },
        total: { currency: "USD", minorUnits: "10000" },
      },
      paymentTerms: "Due on receipt",
      signer: {
        name: "Buyer",
        title: "Owner",
        acceptedAt: now,
        authorityAttestation: "Authorized to bind the customer",
      },
    };
  return {
    ...base,
    amendmentNumber: "AMD-1",
    parentOrderReference: "ORD-1",
    governingAgreementReference: "AGR-1",
    effectiveDate: "2026-09-01",
    prorationMethod: "daily",
    deltaLines: [],
    netChange: { currency: "USD", minorUnits: "0" },
  };
}

function csvEvidence(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string | number | boolean | null>>[],
) {
  const safe = (raw: string) => {
    const protectedValue = /^(?:[=+\-@]|\s+[=+\-@])/.test(raw)
      ? `'${raw}`
      : raw;
    return /[",\r\n]/.test(protectedValue)
      ? `"${protectedValue.replace(/"/g, '""')}"`
      : protectedValue;
  };
  const lines = [
    columns.map(safe).join(","),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const value = row[column];
          return safe(
            value === null || value === undefined ? "" : String(value),
          );
        })
        .join(","),
    ),
  ];
  const bytes = new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
  return {
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };
}

interface Fixture {
  request: ArtifactSourceRequest;
  session: SessionClaims;
  results: readonly unknown[][];
}

function fixture(kind: ArtifactKind): Fixture {
  if (
    [
      "direct_quote",
      "partner_transfer_quote",
      "partner_resale_quote",
      "order_form",
      "amendment",
    ].includes(kind)
  ) {
    const definition = commercialDefinition(kind);
    const partner = kind === "partner_transfer_quote";
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: "1",
        audience: partner ? "partner" : "customer",
        accountId,
      },
      session: partner ? partnerSession : customerSession,
      results: [
        [
          {
            subject_type:
              kind === "order_form"
                ? "order"
                : kind === "amendment"
                  ? "amendment"
                  : "quote",
            subject_id: subjectId,
            commercial_account_id: accountId,
            audience_account_id: accountId,
            audience: partner ? "partner" : "end_client",
            document_kind: kind,
            source_definition: definition,
            source_hash: sha(definition),
            retain_until: retainUntil,
          },
        ],
      ],
    };
  }
  if (kind === "poc_summary" || kind === "poc_final_report") {
    const evidenceBody = {
      snapshotId: "snapshot-1",
      pocId: subjectId,
      source: "poc_milestone_ledger",
      evaluatedAt: now,
      evaluatorId: userId,
      tests: [{ testId: "restore", passed: true, evidenceHash: hash }],
    };
    const evidenceHash = sha(evidenceBody);
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: kind === "poc_final_report" ? `2:snapshot-row-1` : "2",
        audience: "customer",
        accountId,
      },
      session: customerSession,
      results: [
        [
          {
            id: subjectId,
            account_id: accountId,
            partner_account_id: null,
            owner_name: "POC Owner",
            workload: "Restore qualification",
            permitted_data_class: "synthetic",
            success_tests: [
              {
                id: "restore",
                description: "Restore succeeds",
                target: "100% checksum match",
              },
            ],
            capacity_cap: "10",
            egress_cap: "1",
            status: "active",
            row_version: 2,
            kickoff_at: "2026-07-01T16:00:00.000Z",
            expires_at: "2026-08-31T16:00:00.000Z",
            updated_at: now,
            ...(kind === "poc_final_report"
              ? {
                  evidence_id: "snapshot-row-1",
                  evidence_payload: {
                    ...evidenceBody,
                    evidenceHash,
                  },
                  evidence_hash: evidenceHash,
                  evidence_recorded_at: now,
                }
              : {
                  evidence_id: null,
                  evidence_payload: null,
                  evidence_hash: null,
                  evidence_recorded_at: null,
                }),
          },
        ],
        [accountRow()],
      ],
    };
  }
  if (kind === "invoice_companion" || kind === "receipt") {
    const lineItems = [
      {
        id: "line-1",
        description: "Archive service",
        quantity: "1",
        unitPrice: { currency: "USD", minorUnits: "10000" },
        amount: { currency: "USD", minorUnits: "10000" },
      },
    ];
    const snapshotSourceVersion = `quote:${subjectId}:r1`;
    const snapshot = {
      invoiceId: subjectId,
      orderId: subjectId,
      quoteId: subjectId,
      currency: "USD",
      lineItems,
      subtotalMinor: "10000",
      taxMinor: "0",
      totalMinor: "10000",
      sourceVersion: snapshotSourceVersion,
    };
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: `2:${snapshotSourceVersion}`,
        audience: "customer",
        accountId,
      },
      session: customerSession,
      results: [
        [
          {
            id: subjectId,
            account_id: accountId,
            currency: "USD",
            po_number: "PO-1",
            due_at: "2026-08-31T16:00:00.000Z",
            paid_at: kind === "receipt" ? now : null,
            row_version: 2,
            created_at: now,
            updated_at: now,
            source_order_id: subjectId,
            line_items: lineItems,
            subtotal_minor: "10000",
            tax_minor: "0",
            total_minor: "10000",
            source_version: snapshotSourceVersion,
            snapshot_source_hash: sha(snapshot),
            snapshot_quote_id: subjectId,
            paid_minor: kind === "receipt" ? "10000" : "0",
            payment_reference: kind === "receipt" ? "pi_123" : null,
          },
        ],
        [accountRow()],
      ],
    };
  }
  if (kind === "commission_statement")
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: "3",
        audience: "partner",
        accountId,
      },
      session: partnerSession,
      results: [
        [
          {
            id: subjectId,
            partner_account_id: accountId,
            period_starts_on: "2026-07-01",
            period_ends_on: "2026-07-31",
            currency: "USD",
            gross_accrued_minor: "1200",
            clawback_minor: "100",
            holdback_minor: "100",
            payable_minor: "1000",
            status: "approved",
            created_at: now,
            updated_at: now,
            row_version: 3,
            document_lines: [
              {
                id: "line-1",
                endClientName: "End Client",
                invoiceReference: "INV-1",
                collectedRevenue: { currency: "USD", minorUnits: "10000" },
                commissionRateBasisPoints: 1200,
                earned: { currency: "USD", minorUnits: "1200" },
              },
            ],
          },
        ],
        [accountRow()],
      ],
    };
  if (kind === "renewal_confirmation" || kind === "decline_confirmation") {
    const decline = kind === "decline_confirmation";
    const evidenceBody = decline
      ? {
          declineId: subjectId,
          orderId: subjectId,
          accountId,
          declinedAt: now,
          servedOn: "2026-07-31",
          exactDeclineTextHash: hash,
        }
      : {
          requestId: subjectId,
          sourceOrderId: subjectId,
          sourceOrderVersion: 4,
          accountId,
          proposedStartsOn: "2027-08-01",
          proposedEndsOn: "2028-07-31",
          requestedAction: "renew",
          createdAt: now,
        };
    const evidenceHash = sha(evidenceBody);
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: evidenceHash,
        audience: "customer",
        accountId,
      },
      session: customerSession,
      results: [
        [
          {
            id: subjectId,
            order_id: subjectId,
            action: decline ? "decline" : "renew",
            evidence_hash: evidenceHash,
            payload: decline ? { ...evidenceBody, evidenceHash } : evidenceBody,
            customer_account_id: accountId,
            partner_account_id: null,
            sourcing: "direct",
            service_starts_on: "2026-08-01",
            service_ends_on: "2027-07-31",
            agreement_id: subjectId,
            renewal_type: "expires",
            actor_name: "Customer Owner",
            created_at: now,
          },
        ],
        [accountRow()],
      ],
    };
  }
  if (kind === "deletion_certificate") {
    const exclusion = {
      objectId: subjectId,
      scope: "document:agreement",
      retainUntil,
      legalHold: false,
      reason: "object_lock_retention",
    };
    const requestBody = {
      requestVersion: 1,
      terminationId: subjectId,
      accountId,
      orderId: subjectId,
      organizationId: subjectId,
      certificateNumber: "DEL-1",
      account: { legalName: "Customer Archive Ltd.", address: party.address },
      deletedScope: ["expired mutable objects"],
      deletionMethod: "cryptographic erasure",
      completedAt: now,
      retainedObjectExclusions: [exclusion],
      approvals: [
        {
          approvalId: subjectId,
          approverId: userId,
          approverName: "Approver One",
          role: "destructive_action_approver",
          approvedAt: now,
          evidenceHash: hash,
          authenticationEvidenceHash: hash,
        },
      ],
      providerEvidence: {
        commandId: "command-1",
        commandIdempotencyKey: "idempotency-00000001",
        confirmationId: "confirmation-1",
        operationId: "operation-1",
        tenantId: "tenant-1",
        confirmedAt: now,
      },
      retainUntil,
    };
    const requestHash = sha(requestBody);
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: requestHash,
        audience: "customer",
        accountId,
      },
      session: customerSession,
      results: [
        [
          {
            id: subjectId,
            account_id: accountId,
            order_id: subjectId,
            legal_name: "Customer Archive Ltd.",
            request_evidence: {
              certificateRequest: { ...requestBody, requestHash },
            },
            locked_exclusions: [exclusion],
            completed_at: now,
          },
        ],
        [accountRow()],
      ],
    };
  }
  if (kind === "reconciliation_report")
    return {
      request: {
        kind,
        subjectId,
        expectedVersion: "5",
        audience: "internal",
        accountId: null,
      },
      session: internalSession,
      results: [
        [
          {
            id: subjectId,
            provider: "aws_marketplace",
            period_starts_on: "2026-07-01",
            period_ends_on: "2026-07-31",
            currency: "USD",
            provider_gross_minor: "10000",
            platform_gross_minor: "10000",
            provider_fees_minor: "1000",
            platform_fees_minor: "1000",
            variance_minor: "0",
            status: "matched",
            resolution: null,
            row_version: 5,
            created_at: now,
            updated_at: now,
          },
        ],
      ],
    };
  const columns = ["metric", "value"];
  const rows = [{ metric: "active_orders", value: 12 }];
  const csv = csvEvidence(columns, rows);
  const sourceVersion = "txid:42";
  return {
    request: {
      kind,
      subjectId,
      expectedVersion: sourceVersion,
      audience: "internal",
      accountId: null,
    },
    session: internalSession,
    results: [
      [
        {
          id: subjectId,
          report: "weekly_scorecard",
          parameters: {
            asOf: now,
            retainUntil,
            renderSource: {
              columns,
              rows,
              rowCount: rows.length,
              sourceVersion,
              contentHash: csv.contentHash,
              byteLength: csv.byteLength,
            },
          },
          document_content_hash: csv.contentHash,
          document_byte_length: csv.byteLength,
          updated_at: now,
        },
      ],
    ],
  };
}

beforeEach(() => {
  process.env.PLATFORM_ISSUER_JSON = JSON.stringify(party);
});

afterEach(() => {
  delete process.env.PLATFORM_ISSUER_JSON;
});

describe("all authoritative artifact source resolvers", () => {
  it.each(artifactKinds)(
    "resolves and verifies persisted %s truth",
    async (kind) => {
      const value = fixture(kind);
      const source = await resolveArtifactSource(
        transaction(value.results),
        value.session,
        value.request,
      );
      expect(source).toMatchObject({
        kind,
        subjectId,
        sourceVersion: value.request.expectedVersion,
        audience: value.request.audience,
        accountId: value.request.accountId,
      });
      expect(source.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(source.input.verification).toEqual({
        objectVersion: source.sourceVersion,
        recordHash: source.sourceHash,
      });
    },
  );

  it("rejects stale, cross-scope, and corrupt persisted source bindings", async () => {
    const exact = fixture("direct_quote");
    await expect(
      resolveArtifactSource(transaction(exact.results), exact.session, {
        ...exact.request,
        expectedVersion: "2",
      }),
    ).rejects.toMatchObject({
      code: "ARTIFACT_SOURCE_VERSION_CONFLICT",
    });
    await expect(
      resolveArtifactSource(transaction(exact.results), exact.session, {
        ...exact.request,
        accountId: "10000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_SCOPE_FORBIDDEN" });
    const corruptRows = exact.results.map((rows) =>
      rows.map((row) => ({ ...(row as Record<string, unknown>) })),
    );
    (corruptRows[0]?.[0] as Record<string, unknown>).source_hash = "f".repeat(
      64,
    );
    await expect(
      resolveArtifactSource(
        transaction(corruptRows),
        exact.session,
        exact.request,
      ),
    ).rejects.toThrow("ARTIFACT_SOURCE_CORRUPT");
  });
});
