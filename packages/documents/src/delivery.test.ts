import { describe, expect, it } from "vitest";

import { demoDocuments } from "./__fixtures__/demo-documents";
import {
  artifactDownloadHeaders,
  renderAuthorizedCommerceDocument,
  storedDocumentRepresentation,
  verifyDownloadedArtifact,
  type AuthorizedRenderContext,
} from "./delivery";
import { renderCommerceDocument } from "./render";

const accountId = "10000000-0000-4000-8000-000000000001";

function context(
  input: (typeof demoDocuments)[number],
  overrides: Partial<AuthorizedRenderContext> = {},
): AuthorizedRenderContext {
  return {
    actorUserId: "20000000-0000-4000-8000-000000000002",
    accountId,
    accountIds: [accountId],
    isInternalStaff: false,
    audience: "customer",
    audienceAccountId: accountId,
    kind: input.kind,
    sourceHash: input.verification.recordHash,
    requestId: "document-delivery-test",
    ...overrides,
  };
}

describe("authorized document delivery", () => {
  it("renders every immutable kind only from its persisted source binding", async () => {
    for (const input of demoDocuments) {
      const rendered = await renderAuthorizedCommerceDocument(
        input,
        context(input),
      );
      const representation = storedDocumentRepresentation({
        id: "40000000-0000-4000-8000-000000000001",
        kind: input.kind,
        subjectType: "launch_artifact",
        subjectId: input.documentId,
        rendered,
      });

      expect(representation.kind).toBe(input.kind);
      expect(representation.sourceHash).toBe(input.verification.recordHash);
      expect(representation.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(representation.downloadHref).toContain(input.kind);
    }
  }, 30_000);

  it("rejects forged account, audience, kind, and source bindings", async () => {
    const input = demoDocuments[0];
    if (!input) throw new Error("Document fixture missing");

    await expect(
      renderAuthorizedCommerceDocument(
        input,
        context(input, { accountIds: [] }),
      ),
    ).rejects.toThrow(/audience scope denied/);
    await expect(
      renderAuthorizedCommerceDocument(
        input,
        context(input, { audienceAccountId: "forged-account" }),
      ),
    ).rejects.toThrow(/audience scope denied/);
    await expect(
      renderAuthorizedCommerceDocument(
        input,
        context(input, { kind: "receipt" }),
      ),
    ).rejects.toThrow(/kind differs/);
    await expect(
      renderAuthorizedCommerceDocument(
        input,
        context(input, { sourceHash: "f".repeat(64) }),
      ),
    ).rejects.toThrow(/source hash differs/);
  });

  it("fails closed on corrupt bytes, MIME, length, hash, and filename", async () => {
    const input = demoDocuments[0];
    if (!input) throw new Error("Document fixture missing");
    const rendered = await renderCommerceDocument(input);
    const expected = {
      contentHash: rendered.contentHash,
      mimeType: rendered.mimeType,
      byteLength: rendered.bytes.byteLength.toString(),
      filename: rendered.fileName,
    };

    expect(
      verifyDownloadedArtifact(expected, {
        ...expected,
        bytes: rendered.bytes,
      }),
    ).toEqual(rendered.bytes);
    await expect(
      Promise.resolve().then(() =>
        verifyDownloadedArtifact(expected, {
          ...expected,
          bytes: rendered.bytes.with(20, rendered.bytes[20] === 0 ? 1 : 0),
        }),
      ),
    ).rejects.toThrow(/verification/);
    expect(() =>
      verifyDownloadedArtifact(expected, {
        ...expected,
        mimeType: "text/html",
        bytes: rendered.bytes,
      }),
    ).toThrow(/verification/);
    expect(() =>
      artifactDownloadHeaders({
        filename: "../agreement.pdf",
        contentHash: rendered.contentHash,
        byteLength: rendered.bytes.byteLength.toString(),
      }),
    ).toThrow(/unsafe/);
  });

  it("sets no-store, nosniff, semantic PDF MIME, filename, and hash headers", async () => {
    const input = demoDocuments[0];
    if (!input) throw new Error("Document fixture missing");
    const rendered = await renderCommerceDocument(input);
    expect(
      artifactDownloadHeaders({
        filename: rendered.fileName,
        contentHash: rendered.contentHash,
        byteLength: rendered.bytes.byteLength.toString(),
      }),
    ).toMatchObject({
      "cache-control": "private, no-store",
      "content-type": "application/pdf",
      "x-content-type-options": "nosniff",
      "x-content-sha256": rendered.contentHash,
    });
  });
});
