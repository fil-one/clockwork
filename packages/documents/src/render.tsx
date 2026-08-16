import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";

import { canonicalizeReactPdf } from "./canonicalize";
import { CommerceDocument } from "./documents";
import {
  assertIsoInstant,
  normalizeSha256Hash,
  sha256,
  slugifyFilePart,
} from "./format";
import type {
  AmendmentDocumentInput,
  CommerceDocumentInput,
  CommissionStatementDocumentInput,
  DeletionCertificateDocumentInput,
  InvoiceDocumentInput,
  OrderFormDocumentInput,
  PocDocumentInput,
  QuoteDocumentInput,
  RenderedDocument,
  RenewalConfirmationDocumentInput,
  ReportDocumentInput,
} from "./model";

const SHA_256_PATTERN = /^(?:sha256:)?[a-fA-F0-9]{64}$/;
const LOGO_DATA_URI_PATTERN =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

type QuotePayload = Omit<QuoteDocumentInput, "kind">;
type OrderFormPayload = Omit<OrderFormDocumentInput, "kind">;
type AmendmentPayload = Omit<AmendmentDocumentInput, "kind">;
type PocPayload = Omit<PocDocumentInput, "kind">;
type InvoicePayload = Omit<InvoiceDocumentInput, "kind">;
type CommissionStatementPayload = Omit<
  CommissionStatementDocumentInput,
  "kind"
>;
type RenewalPayload = Omit<RenewalConfirmationDocumentInput, "kind">;
type DeletionCertificatePayload = Omit<
  DeletionCertificateDocumentInput,
  "kind"
>;
type ReportPayload = Omit<ReportDocumentInput, "kind">;

function validateInput(input: CommerceDocumentInput): void {
  if (input.documentId.trim().length === 0) {
    throw new Error("documentId cannot be empty");
  }
  if (input.version.trim().length === 0) {
    throw new Error("version cannot be empty");
  }
  assertIsoInstant(input.issuedAt, "issuedAt");
  if (!SHA_256_PATTERN.test(input.verification.recordHash)) {
    throw new Error("verification.recordHash must be a SHA-256 hash");
  }
  if (
    input.brand?.accentColor &&
    !/^#[0-9a-fA-F]{6}$/.test(input.brand.accentColor)
  ) {
    throw new Error("brand.accentColor must be a six-digit hex color");
  }
  if (input.brand?.logo && !LOGO_DATA_URI_PATTERN.test(input.brand.logo)) {
    throw new Error("brand.logo must be a base64 PNG or JPEG data URI");
  }
  if (input.issuer.legalName.trim().length === 0) {
    throw new Error("issuer.legalName cannot be empty");
  }
  if (input.recipient.legalName.trim().length === 0) {
    throw new Error("recipient.legalName cannot be empty");
  }
  if (
    (input.kind === "reconciliation_report" ||
      input.kind === "report_export") &&
    input.columns.length === 0
  ) {
    throw new Error("Report documents require at least one column");
  }
}

/**
 * A renderer failure that still names what failed.
 *
 * `renderToBuffer` runs a React reconciler, a layout pass and a PDF writer, and
 * anything any of them throws arrives here as a bare `TypeError` with a stack
 * that only mentions bundle chunks. Every caller above this line turns an
 * unrecognized error into a generic 5xx, so that bare error is the last place
 * the cause exists at all. This preserves it: the document being rendered is on
 * the error, and the original is on `cause`.
 *
 * That is not decoration. A misconfigured bundler made `@react-pdf/renderer`
 * resolve React's `react-server` build, whose client internals are absent, so
 * the reconciler read `undefined.S` and every artifact in the product answered
 * 503 with the TypeError discarded. Finding that needed a patched error handler.
 */
export class DocumentRenderError extends Error {
  public readonly code = "DOCUMENT_RENDER_FAILED";

  public constructor(
    public readonly kind: CommerceDocumentInput["kind"],
    public readonly documentId: string,
    cause: unknown,
  ) {
    super(
      `Rendering ${kind} document ${documentId} failed: ${
        cause instanceof Error
          ? `${cause.name}: ${cause.message}`
          : String(cause)
      }`,
      { cause },
    );
    this.name = "DocumentRenderError";
  }
}

export async function renderCommerceDocument(
  input: CommerceDocumentInput,
): Promise<RenderedDocument> {
  validateInput(input);
  let rendered: Awaited<ReturnType<typeof renderToBuffer>>;
  try {
    rendered = await renderToBuffer(<CommerceDocument input={input} />);
  } catch (error) {
    throw new DocumentRenderError(input.kind, input.documentId, error);
  }
  const bytes = canonicalizeReactPdf(new Uint8Array(rendered));
  const contentHash = sha256(bytes);
  return {
    bytes,
    contentHash,
    documentId: input.documentId,
    fileName: `${slugifyFilePart(input.kind)}-${slugifyFilePart(
      input.documentId,
    )}-v${slugifyFilePart(input.version)}.pdf`,
    mimeType: "application/pdf",
    recordHash: normalizeSha256Hash(input.verification.recordHash),
    version: input.version,
  };
}

export function renderDirectQuote(input: QuotePayload) {
  return renderCommerceDocument({ ...input, kind: "direct_quote" });
}

export function renderPartnerTransferQuote(input: QuotePayload) {
  return renderCommerceDocument({ ...input, kind: "partner_transfer_quote" });
}

export function renderPartnerResaleQuote(input: QuotePayload) {
  return renderCommerceDocument({ ...input, kind: "partner_resale_quote" });
}

export function renderOrderForm(input: OrderFormPayload) {
  return renderCommerceDocument({ ...input, kind: "order_form" });
}

export function renderAmendment(input: AmendmentPayload) {
  return renderCommerceDocument({ ...input, kind: "amendment" });
}

export function renderPocSummary(input: PocPayload) {
  return renderCommerceDocument({ ...input, kind: "poc_summary" });
}

export function renderPocFinalReport(input: PocPayload) {
  return renderCommerceDocument({ ...input, kind: "poc_final_report" });
}

export function renderInvoiceCompanion(input: InvoicePayload) {
  return renderCommerceDocument({ ...input, kind: "invoice_companion" });
}

export function renderReceipt(input: InvoicePayload) {
  return renderCommerceDocument({ ...input, kind: "receipt" });
}

export function renderCommissionStatement(input: CommissionStatementPayload) {
  return renderCommerceDocument({ ...input, kind: "commission_statement" });
}

export function renderRenewalConfirmation(input: RenewalPayload) {
  return renderCommerceDocument({ ...input, kind: "renewal_confirmation" });
}

export function renderDeclineConfirmation(input: RenewalPayload) {
  return renderCommerceDocument({ ...input, kind: "decline_confirmation" });
}

export function renderDeletionCertificate(input: DeletionCertificatePayload) {
  return renderCommerceDocument({ ...input, kind: "deletion_certificate" });
}

export function renderReconciliationReport(input: ReportPayload) {
  return renderCommerceDocument({ ...input, kind: "reconciliation_report" });
}

export function renderReportExport(input: ReportPayload) {
  return renderCommerceDocument({ ...input, kind: "report_export" });
}
