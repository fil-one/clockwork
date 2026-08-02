/**
 * Tax exemption certificates captured during procurement onboarding.
 *
 * The live record is `procurement_profiles.exemptions`, a JSONB array whose
 * entries carry a jurisdiction, a document, and an expiry date. Expiry is
 * checked once when that row is written and never again, so a lapsed exemption
 * stays acceptable at invoice time. This module supplies the re-evaluation.
 *
 * The JSONB entry has no kind and no status. Both are named here rather than
 * chosen per row, so every durable `core_procurement_certificates` row the
 * sweep writes says the same thing about what it is.
 */

/** Every exemption in the procurement profile is a tax exemption certificate. */
export const EXEMPTION_CERTIFICATE_KIND = "tax_exemption";

/**
 * What `core_procurement_certificates.status` may hold. This vocabulary has been
 * constrained in the database since the foundation migration; `pending` is the
 * column default and `revoked` is set by hand, so the sweep writes only `valid`
 * and `expired`.
 */
export const procurementCertificateStatuses = [
  "pending",
  "valid",
  "expired",
  "revoked",
] as const;
export type ProcurementCertificateStatus =
  (typeof procurementCertificateStatuses)[number];

/**
 * What the sweep concludes about a certificate on a given day.
 *
 * `expiring` is deliberately absent from the persisted vocabulary above: it is
 * true only relative to the as-of date, so a row stamped `expiring` would be
 * wrong the next morning with no writer having touched it. The durable row
 * records whether the certificate has lapsed; whether it is close to lapsing is
 * recomputed from `expires_on` and the notice window on every read.
 */
export const certificateAssessmentStatuses = [
  "valid",
  "expiring",
  "expired",
] as const;
export type CertificateAssessmentStatus =
  (typeof certificateAssessmentStatuses)[number];

/** The durable status for an assessment. A certificate expiring has not lapsed. */
export function certificateRowStatus(
  status: CertificateAssessmentStatus,
): ProcurementCertificateStatus {
  return status === "expired" ? "expired" : "valid";
}

/**
 * Placeholders pending EXT-TAX-01, which supplies the approved exemption,
 * expiry, and country policy. Neither value is approved policy today:
 *
 * - `EXEMPTION_EXPIRY_NOTICE_DAYS` is how far ahead of expiry the sweep raises
 *   a certificate, so collections has time to request a replacement.
 * - `EXPIRED_EXEMPTION_BLOCKS_INVOICING` stays false. A lapsed certificate is
 *   flagged for review; invoicing continues, because withholding an invoice
 *   over an internal record gap is a decision for the gate, not for the sweep.
 *
 * Change either one only with the gate's answer, and update the pgTAP and unit
 * expectations in the same change.
 */
export const EXEMPTION_EXPIRY_NOTICE_DAYS = 30;
export const EXPIRED_EXEMPTION_BLOCKS_INVOICING = false;

/** One entry of `procurement_profiles.exemptions`. */
export interface ProcurementExemption {
  jurisdiction: string;
  certificateDocumentId: string;
  expiresOn: string | null;
}

export interface CertificateExpiryAssessment {
  jurisdiction: string;
  certificateDocumentId: string;
  expiresOn: string | null;
  status: CertificateAssessmentStatus;
  /** Whole days from the as-of date to expiry; negative once lapsed. */
  daysUntilExpiry: number | null;
  blocksInvoicing: boolean;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function epochDay(date: string): number {
  if (!datePattern.test(date)) throw new Error(`Invalid date: ${date}`);
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) throw new Error(`Invalid date: ${date}`);
  return Math.floor(parsed / 86_400_000);
}

/**
 * A certificate with no expiry date never lapses, which is the same reading the
 * onboarding check applies when it writes the profile.
 */
export function assessExemptionCertificate(
  exemption: ProcurementExemption,
  asOfDate: string,
  noticeDays: number = EXEMPTION_EXPIRY_NOTICE_DAYS,
): CertificateExpiryAssessment {
  if (!Number.isSafeInteger(noticeDays) || noticeDays < 0)
    throw new Error(
      "Notice window must be a non-negative whole number of days",
    );
  const shared = {
    jurisdiction: exemption.jurisdiction,
    certificateDocumentId: exemption.certificateDocumentId,
    expiresOn: exemption.expiresOn,
  };
  if (!exemption.expiresOn)
    return {
      ...shared,
      status: "valid",
      daysUntilExpiry: null,
      blocksInvoicing: false,
    };
  const daysUntilExpiry = epochDay(exemption.expiresOn) - epochDay(asOfDate);
  if (daysUntilExpiry < 0)
    return {
      ...shared,
      status: "expired",
      daysUntilExpiry,
      blocksInvoicing: EXPIRED_EXEMPTION_BLOCKS_INVOICING,
    };
  return {
    ...shared,
    status: daysUntilExpiry <= noticeDays ? "expiring" : "valid",
    daysUntilExpiry,
    blocksInvoicing: false,
  };
}

export function assessExemptionCertificates(
  exemptions: readonly ProcurementExemption[],
  asOfDate: string,
  noticeDays: number = EXEMPTION_EXPIRY_NOTICE_DAYS,
): readonly CertificateExpiryAssessment[] {
  return exemptions.map((exemption) =>
    assessExemptionCertificate(exemption, asOfDate, noticeDays),
  );
}

/** Certificates the sweep raises. A valid certificate is left alone. */
export function raisedCertificates(
  assessments: readonly CertificateExpiryAssessment[],
): readonly CertificateExpiryAssessment[] {
  return assessments.filter(
    (assessment) =>
      assessment.status === "expired" || assessment.status === "expiring",
  );
}

/**
 * Reads the persisted JSONB entries. An entry that does not match the shape the
 * onboarding writer produces is skipped rather than guessed at, so a malformed
 * row cannot silently become a valid certificate.
 */
export function readProcurementExemptions(
  value: unknown,
): readonly ProcurementExemption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const jurisdiction = item.jurisdiction;
    const certificateDocumentId = item.certificateDocumentId;
    const expiresOn = item.expiresOn;
    if (
      typeof jurisdiction !== "string" ||
      !jurisdiction.trim() ||
      typeof certificateDocumentId !== "string" ||
      !certificateDocumentId.trim() ||
      !(
        expiresOn === null ||
        expiresOn === undefined ||
        (typeof expiresOn === "string" && datePattern.test(expiresOn))
      )
    )
      return [];
    return [
      {
        jurisdiction,
        certificateDocumentId,
        expiresOn: typeof expiresOn === "string" ? expiresOn : null,
      },
    ];
  });
}
