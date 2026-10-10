import { renderToBuffer } from "@react-pdf/renderer";

import { canonicalizeReactPdf } from "./canonicalize";
import { CommerceDocument } from "./documents";
import {
  assertIsoInstant,
  normalizeSha256Hash,
  sha256,
  slugifyFilePart,
} from "./format";
import type { CommerceDocumentInput, RenderedDocument } from "./model";

const SHA_256_PATTERN = /^(?:sha256:)?[a-fA-F0-9]{64}$/;
const LOGO_DATA_URI_PATTERN =
  /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

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
