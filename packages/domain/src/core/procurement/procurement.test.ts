import { describe, expect, it } from "vitest";

import {
  assessExemptionCertificate,
  assessExemptionCertificates,
  certificateAssessmentStatuses,
  certificateRowStatus,
  EXEMPTION_CERTIFICATE_KIND,
  EXEMPTION_EXPIRY_NOTICE_DAYS,
  EXPIRED_EXEMPTION_BLOCKS_INVOICING,
  procurementCertificateStatuses,
  raisedCertificates,
  readProcurementExemptions,
  type ProcurementExemption,
} from "./index";

const asOf = "2026-08-02";

function exemption(
  overrides: Partial<ProcurementExemption> = {},
): ProcurementExemption {
  return {
    jurisdiction: "US-CA",
    certificateDocumentId: "90000000-0000-4000-8000-000000000001",
    expiresOn: "2027-01-01",
    ...overrides,
  };
}

describe("exemption certificate expiry", () => {
  it("keeps a certificate valid well before its expiry", () => {
    const assessment = assessExemptionCertificate(exemption(), asOf);

    expect(assessment.status).toBe("valid");
    expect(assessment.daysUntilExpiry).toBe(152);
    expect(assessment.blocksInvoicing).toBe(false);
  });

  it("raises a certificate inside the notice window", () => {
    const assessment = assessExemptionCertificate(
      exemption({ expiresOn: "2026-08-20" }),
      asOf,
    );

    expect(assessment.status).toBe("expiring");
    expect(assessment.daysUntilExpiry).toBe(18);
    expect(assessment.blocksInvoicing).toBe(false);
  });

  it("treats the expiry date itself as the last valid day", () => {
    expect(
      assessExemptionCertificate(exemption({ expiresOn: asOf }), asOf),
    ).toMatchObject({ status: "expiring", daysUntilExpiry: 0 });
    expect(
      assessExemptionCertificate(exemption({ expiresOn: "2026-08-01" }), asOf),
    ).toMatchObject({ status: "expired", daysUntilExpiry: -1 });
  });

  it("flags a lapsed certificate without blocking invoicing", () => {
    const assessment = assessExemptionCertificate(
      exemption({ expiresOn: "2025-01-01" }),
      asOf,
    );

    expect(assessment.status).toBe("expired");
    expect(assessment.daysUntilExpiry).toBeLessThan(0);
    // EXT-TAX-01 owns the block policy; until it closes an expired
    // certificate flags for review and invoicing continues.
    expect(assessment.blocksInvoicing).toBe(false);
    expect(EXPIRED_EXEMPTION_BLOCKS_INVOICING).toBe(false);
  });

  it("never lapses a certificate with no expiry date", () => {
    const assessment = assessExemptionCertificate(
      exemption({ expiresOn: null }),
      asOf,
    );

    expect(assessment).toMatchObject({
      status: "valid",
      daysUntilExpiry: null,
      blocksInvoicing: false,
    });
  });

  it("honours the boundary of the configured notice window", () => {
    const atWindow = assessExemptionCertificate(
      exemption({ expiresOn: "2026-09-01" }),
      asOf,
    );
    const beyondWindow = assessExemptionCertificate(
      exemption({ expiresOn: "2026-09-02" }),
      asOf,
    );

    expect(EXEMPTION_EXPIRY_NOTICE_DAYS).toBe(30);
    expect(atWindow).toMatchObject({ status: "expiring", daysUntilExpiry: 30 });
    expect(beyondWindow).toMatchObject({
      status: "valid",
      daysUntilExpiry: 31,
    });
  });

  it("accepts an explicit notice window", () => {
    expect(
      assessExemptionCertificate(
        exemption({ expiresOn: "2026-08-20" }),
        asOf,
        7,
      ).status,
    ).toBe("valid");
    expect(() => assessExemptionCertificate(exemption(), asOf, -1)).toThrow(
      "non-negative",
    );
  });

  it("rejects a malformed date rather than treating it as valid", () => {
    expect(() =>
      assessExemptionCertificate(exemption({ expiresOn: "31-12-2026" }), asOf),
    ).toThrow("Invalid date");
  });

  it("raises only the certificates that need action", () => {
    const assessments = assessExemptionCertificates(
      [
        exemption({ jurisdiction: "US-CA", expiresOn: "2027-01-01" }),
        exemption({ jurisdiction: "US-NY", expiresOn: "2026-08-10" }),
        exemption({ jurisdiction: "ES", expiresOn: "2026-01-01" }),
        exemption({ jurisdiction: "GB", expiresOn: null }),
      ],
      asOf,
    );

    expect(assessments.map((item) => item.status)).toEqual([
      "valid",
      "expiring",
      "expired",
      "valid",
    ]);
    expect(
      raisedCertificates(assessments).map((item) => item.jurisdiction),
    ).toEqual(["US-NY", "ES"]);
  });

  it("names the certificate kind the JSONB entry does not carry", () => {
    expect(EXEMPTION_CERTIFICATE_KIND).toBe("tax_exemption");
  });
});

describe("persisted exemption entries", () => {
  it("reads the shape the onboarding writer produces", () => {
    expect(
      readProcurementExemptions([
        {
          jurisdiction: "US-CA",
          certificateDocumentId: "90000000-0000-4000-8000-000000000001",
          expiresOn: "2027-01-01",
        },
        {
          jurisdiction: "GB",
          certificateDocumentId: "90000000-0000-4000-8000-000000000002",
          expiresOn: null,
        },
      ]),
    ).toEqual([
      {
        jurisdiction: "US-CA",
        certificateDocumentId: "90000000-0000-4000-8000-000000000001",
        expiresOn: "2027-01-01",
      },
      {
        jurisdiction: "GB",
        certificateDocumentId: "90000000-0000-4000-8000-000000000002",
        expiresOn: null,
      },
    ]);
  });

  it("skips entries that do not match the persisted shape", () => {
    expect(
      readProcurementExemptions([
        { jurisdiction: "", certificateDocumentId: "doc", expiresOn: null },
        { jurisdiction: "US-CA", expiresOn: null },
        { jurisdiction: "US-CA", certificateDocumentId: "doc", expiresOn: 7 },
        "not-an-object",
        null,
      ]),
    ).toEqual([]);
  });

  it("reads a missing or non-array column as no exemptions", () => {
    expect(readProcurementExemptions(undefined)).toEqual([]);
    expect(readProcurementExemptions({})).toEqual([]);
    expect(readProcurementExemptions([])).toEqual([]);
  });
});

describe("durable certificate status", () => {
  it("records a lapse and leaves proximity to be recomputed on read", () => {
    // `expiring` is true only against a given day. Persisting it would leave a
    // row that is wrong the next morning with no writer having touched it, and
    // the column has never admitted the value.
    expect(certificateRowStatus("valid")).toBe("valid");
    expect(certificateRowStatus("expiring")).toBe("valid");
    expect(certificateRowStatus("expired")).toBe("expired");
  });

  it("stays inside the vocabulary the column has always enforced", () => {
    expect(procurementCertificateStatuses).toEqual([
      "pending",
      "valid",
      "expired",
      "revoked",
    ]);
    for (const status of certificateAssessmentStatuses)
      expect(procurementCertificateStatuses).toContain(
        certificateRowStatus(status),
      );
  });
});
