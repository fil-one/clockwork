import { timingSafeEqual } from "node:crypto";

import { normalizeSha256Hash, sha256 } from "./format";
import type {
  CommerceDocumentInput,
  DocumentKind,
  RenderedDocument,
} from "./model";
import { renderCommerceDocument } from "./render";

export type DocumentAudience = "customer" | "partner" | "internal";

export interface AuthorizedRenderContext {
  actorUserId: string;
  accountId: string;
  accountIds: readonly string[];
  isInternalStaff: boolean;
  audience: DocumentAudience;
  audienceAccountId: string | null;
  kind: DocumentKind;
  sourceHash: string;
  requestId: string;
}

export interface AuthorizedRenderedDocument extends RenderedDocument {
  accountId: string;
  audience: DocumentAudience;
  audienceAccountId: string | null;
  actorUserId: string;
  requestId: string;
}

export interface StoredDocumentRepresentation {
  id: string;
  kind: DocumentKind;
  subjectType: string;
  subjectId: string;
  documentId: string;
  version: string;
  sourceHash: string;
  contentHash: string;
  mimeType: "application/pdf";
  byteLength: string;
  filename: string;
  state: "stored";
  downloadHref: string;
}

export interface DownloadedArtifact {
  bytes: Uint8Array;
  contentHash: string;
  mimeType: string;
  byteLength: string;
  filename: string;
}

function equalHash(left: string, right: string): boolean {
  const leftBytes = Buffer.from(normalizeSha256Hash(left), "hex");
  const rightBytes = Buffer.from(normalizeSha256Hash(right), "hex");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function assertAuthorization(context: AuthorizedRenderContext): void {
  if (!context.actorUserId.trim() || !context.requestId.trim())
    throw new Error("Authenticated actor and request IDs are required");
  if (
    !context.isInternalStaff &&
    !context.accountIds.includes(context.accountId)
  )
    throw new Error("Document account scope denied");
  if (context.audience === "internal") {
    if (!context.isInternalStaff || context.audienceAccountId !== null)
      throw new Error("Internal document audience is invalid");
    return;
  }
  if (
    !context.audienceAccountId ||
    (!context.isInternalStaff &&
      !context.accountIds.includes(context.audienceAccountId))
  )
    throw new Error("Document audience scope denied");
}

/** Render only from the immutable, server-loaded request and its signed scope. */
export async function renderAuthorizedCommerceDocument(
  input: CommerceDocumentInput,
  context: AuthorizedRenderContext,
): Promise<AuthorizedRenderedDocument> {
  assertAuthorization(context);
  if (input.kind !== context.kind)
    throw new Error("Document kind differs from the persisted render request");
  if (!equalHash(input.verification.recordHash, context.sourceHash))
    throw new Error("Document source hash differs from the persisted record");
  const rendered = await renderCommerceDocument(input);
  return {
    ...rendered,
    accountId: context.accountId,
    audience: context.audience,
    audienceAccountId: context.audienceAccountId,
    actorUserId: context.actorUserId,
    requestId: context.requestId,
  };
}

export function storedDocumentRepresentation(input: {
  id: string;
  kind: DocumentKind;
  subjectType: string;
  subjectId: string;
  rendered: RenderedDocument;
}): StoredDocumentRepresentation {
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    documentId: input.rendered.documentId,
    version: input.rendered.version,
    sourceHash: input.rendered.recordHash,
    contentHash: input.rendered.contentHash,
    mimeType: "application/pdf",
    byteLength: input.rendered.bytes.byteLength.toString(),
    filename: input.rendered.fileName,
    state: "stored",
    downloadHref: `/api/experience/artifacts/${input.kind}/${input.id}`,
  });
}

/** Verify provider bytes before any response headers or body are exposed. */
export function verifyDownloadedArtifact(
  expected: {
    contentHash: string;
    mimeType: "application/pdf";
    byteLength: string;
    filename: string;
  },
  actual: DownloadedArtifact,
): Uint8Array {
  if (
    actual.mimeType !== expected.mimeType ||
    actual.byteLength !== expected.byteLength ||
    actual.filename !== expected.filename ||
    !equalHash(actual.contentHash, expected.contentHash) ||
    !equalHash(sha256(actual.bytes), expected.contentHash) ||
    actual.bytes.byteLength.toString() !== expected.byteLength
  )
    throw new Error(
      "Downloaded artifact failed immutable metadata verification",
    );
  const prefix = new TextDecoder("latin1").decode(actual.bytes.slice(0, 5));
  if (prefix !== "%PDF-") throw new Error("Downloaded artifact is not a PDF");
  return actual.bytes.slice();
}

export function artifactDownloadHeaders(input: {
  filename: string;
  contentHash: string;
  byteLength: string;
}): Readonly<Record<string, string>> {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,159}\.pdf$/.test(input.filename) ||
    input.filename.includes("..")
  )
    throw new Error("Artifact filename is unsafe");
  return Object.freeze({
    "content-type": "application/pdf",
    "content-length": input.byteLength,
    "content-disposition": `attachment; filename="${input.filename}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "x-content-sha256": normalizeSha256Hash(input.contentHash),
  });
}
