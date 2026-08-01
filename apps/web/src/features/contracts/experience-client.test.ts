import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  artifactRepresentation,
  createArtifactRenderRequest,
  downloadArtifact,
  ExperienceClientError,
  readProjectionAction,
  renderArtifactRequest,
  sendProjectionAction,
} from "./experience-client";

const csrf = "c".repeat(32);
const idempotencyKey = "idempotency-key-0000000000000001";
const artifactId = "40000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000001";

const artifact = {
  id: artifactId,
  kind: "direct_quote" as const,
  subjectType: "quote",
  subjectId: "41000000-0000-4000-8000-000000000001",
  accountId,
  audience: "customer" as const,
  audienceAccountId: accountId,
  documentId: "42000000-0000-4000-8000-000000000001",
  version: "quote:r7",
  sourceHash: "a".repeat(64),
  contentHash: "b".repeat(64),
  mimeType: "application/pdf" as const,
  byteLength: "9",
  filename: "direct-quote.pdf",
  retainUntil: "2033-07-31T12:00:00.000Z",
  createdAt: "2026-07-31T12:00:00.000Z",
  downloadHref: `/api/experience/artifacts/direct_quote/${artifactId}`,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("experience client contract", () => {
  it("creates the exact public render-request DTO", async () => {
    const renderRequest = {
      id: "43000000-0000-4000-8000-000000000001",
      accountId,
      audience: "customer" as const,
      audienceAccountId: accountId,
      subjectType: "quote",
      subjectId: artifact.subjectId,
      kind: "direct_quote" as const,
      sourceHash: artifact.sourceHash,
      sourceVersion: "7",
      retainUntil: artifact.retainUntil,
      status: "pending" as const,
      version: 1,
    };
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(json(renderRequest)),
    );

    await expect(
      createArtifactRenderRequest(
        {
          kind: "direct_quote",
          subjectId: artifact.subjectId,
          expectedVersion: "7",
          audience: "customer",
          accountId,
        },
        { fetchImplementation, csrfToken: csrf, idempotencyKey },
      ),
    ).resolves.toEqual(renderRequest);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "/api/experience/artifacts/render-requests",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          kind: "direct_quote",
          subjectId: artifact.subjectId,
          expectedVersion: "7",
          audience: "customer",
          accountId,
        }),
      }),
    );
  });

  it("rejects an invalid artifact source version before sending", () => {
    const fetchImplementation = vi.fn();
    expect(() =>
      createArtifactRenderRequest(
        {
          kind: "direct_quote",
          subjectId: artifact.subjectId,
          expectedVersion: "x".repeat(81),
          audience: "customer",
        },
        { fetchImplementation, csrfToken: csrf, idempotencyKey },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "ARTIFACT_VERSION_INVALID" }),
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reads direct execute and public metadata representations", async () => {
    const executeFetch = vi.fn(() => Promise.resolve(json(artifact, 201)));
    await expect(
      renderArtifactRequest(artifactId, {
        fetchImplementation: executeFetch,
        csrfToken: csrf,
        idempotencyKey,
      }),
    ).resolves.toEqual(artifact);

    const representationFetch = vi.fn(() => Promise.resolve(json(artifact)));
    await expect(
      artifactRepresentation("direct_quote", artifactId, {
        fetchImplementation: representationFetch,
      }),
    ).resolves.toEqual(artifact);
    expect(representationFetch).toHaveBeenCalledWith(
      `/api/experience/artifacts/direct_quote/${artifactId}?representation=json`,
      { credentials: "same-origin", cache: "no-store" },
    );
  });

  it("downloads only a hash-bound PDF with consistent length", async () => {
    const bytes = new TextEncoder().encode("%PDF-safe");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(bytes, {
          headers: {
            "content-type": "application/pdf",
            "content-length": String(bytes.byteLength),
            "content-disposition": 'attachment; filename="direct-quote.pdf"',
            "x-content-sha256": contentHash,
          },
        }),
      ),
    );
    const downloaded = await downloadArtifact("direct_quote", artifactId, {
      fetchImplementation,
    });
    expect(Array.from(new Uint8Array(downloaded.bytes))).toEqual(
      Array.from(bytes),
    );
    expect(downloaded).toMatchObject({
      contentHash,
      contentDisposition: 'attachment; filename="direct-quote.pdf"',
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      `/api/experience/artifacts/direct_quote/${artifactId}`,
      { credentials: "same-origin", cache: "no-store" },
    );
  });

  it.each([
    ["wrong content type", { "content-type": "text/html" }, "%PDF-safe"],
    ["missing hash", { "content-type": "application/pdf" }, "%PDF-safe"],
    [
      "non-PDF bytes",
      {
        "content-type": "application/pdf",
        "x-content-sha256": artifact.contentHash,
      },
      "not-a-pdf",
    ],
  ])("rejects a %s binary response", async (_name, headers, body) => {
    await expect(
      downloadArtifact("direct_quote", artifactId, {
        fetchImplementation: vi.fn(() =>
          Promise.resolve(new Response(body, { headers })),
        ),
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "ARTIFACT_RESPONSE_INVALID",
    });
  });

  it("rejects same-length PDF bytes that do not match the declared hash", async () => {
    const expectedBytes = new TextEncoder().encode("%PDF-safe");
    const corruptBytes = new TextEncoder().encode("%PDF-fake");
    expect(corruptBytes.byteLength).toBe(expectedBytes.byteLength);
    await expect(
      downloadArtifact("direct_quote", artifactId, {
        fetchImplementation: vi.fn(() =>
          Promise.resolve(
            new Response(corruptBytes, {
              headers: {
                "content-type": "application/pdf",
                "content-length": String(expectedBytes.byteLength),
                "x-content-sha256": createHash("sha256")
                  .update(expectedBytes)
                  .digest("hex"),
              },
            }),
          ),
        ),
      }),
    ).rejects.toMatchObject({
      status: 502,
      code: "ARTIFACT_RESPONSE_INVALID",
    });
  });

  it("preserves problem details for a failed binary response", async () => {
    await expect(
      downloadArtifact("direct_quote", artifactId, {
        fetchImplementation: vi.fn(() =>
          Promise.resolve(
            json(
              {
                title: "Artifact not found",
                code: "ARTIFACT_NOT_FOUND",
              },
              404,
            ),
          ),
        ),
      }),
    ).rejects.toEqual(
      new ExperienceClientError(
        404,
        "ARTIFACT_NOT_FOUND",
        "Artifact not found",
      ),
    );
  });

  it("requires a positive projection version and reads nullable legacy replay truth", async () => {
    const invalidFetch = vi.fn();
    expect(() =>
      sendProjectionAction(
        {
          audience: "customer",
          channel: "quotes",
          recordKey: "Q-1",
          projectionId: "50000000-0000-4000-8000-000000000001",
          action: "accept",
          expectedVersion: 0,
        },
        { fetchImplementation: invalidFetch, csrfToken: csrf, idempotencyKey },
      ),
    ).toThrowError(
      expect.objectContaining({ code: "EXPECTED_VERSION_INVALID" }),
    );
    expect(invalidFetch).not.toHaveBeenCalled();

    const receipt = {
      id: "60000000-0000-4000-8000-000000000001",
      projectionId: "50000000-0000-4000-8000-000000000001",
      aggregateType: "quote",
      aggregateId: "61000000-0000-4000-8000-000000000001",
      action: "accept",
      expectedVersion: 1,
      status: "applied" as const,
      resultReference: "legacy-action:proof:applied",
      resultCode: "LEGACY_PORTAL_ACTION_APPLIED",
      authoritativeVersion: null,
      commandReplayed: null,
      createdAt: "2026-07-31T12:00:00.000Z",
      completedAt: "2026-07-31T12:00:01.000Z",
      auditEventId: "62000000-0000-4000-8000-000000000001",
      outboxMessageId: "63000000-0000-4000-8000-000000000001",
    };
    await expect(
      readProjectionAction(
        {
          audience: "customer",
          channel: "quotes",
          recordKey: "Q-1",
          actionRequestId: receipt.id,
        },
        { fetchImplementation: vi.fn(() => Promise.resolve(json(receipt))) },
      ),
    ).resolves.toEqual(receipt);
  });
});
