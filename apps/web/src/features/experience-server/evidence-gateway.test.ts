import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";

import type { EvidenceUploadRecord } from "./model";
import {
  configuredEvidenceGateway,
  HttpEvidenceGateway,
  safeUploadHeaders,
} from "./evidence-gateway";

const now = new Date("2026-07-31T12:00:00.000Z");

function upload(): EvidenceUploadRecord {
  return {
    id: "70000000-0000-4000-8000-000000000001",
    uploadId: "upl_opaque",
    providerUploadId: "provider-upload",
    ownerUserId: "20000000-0000-4000-8000-000000000002",
    accountId: "10000000-0000-4000-8000-000000000001",
    journey: "customer_paper",
    targetId: "80000000-0000-4000-8000-000000000001",
    kind: "agreement",
    contentHash: "a".repeat(64),
    mimeType: "application/pdf",
    byteLength: "1024",
    retainUntil: "2027-07-31T12:00:00.000Z",
    expiresAt: "2026-07-31T12:15:00.000Z",
    legalHold: false,
    status: "uploaded",
    scanReference: null,
    documentId: "90000000-0000-4000-8000-000000000001",
    immutableStorageKey: "immutable/key",
    storageVersionId: "version-1",
    version: 2,
  };
}

function gateway(fetchImplementation: typeof fetch) {
  return new HttpEvidenceGateway({
    baseUrl: "https://storage.internal.example/",
    bearerToken: "storage-token-that-is-longer-than-32-bytes",
    allowedClientOrigins: ["https://upload.example"],
    fetchImplementation,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("evidence credential containment and expiry", () => {
  it("allows only upload-safe headers and rejects cookie or authorization passthrough", () => {
    expect(
      safeUploadHeaders({
        "Content-Type": "application/pdf",
        "X-Amz-Checksum-Sha256": "checksum",
      }),
    ).toEqual({
      "content-type": "application/pdf",
      "x-amz-checksum-sha256": "checksum",
    });
    expect(() => safeUploadHeaders({ cookie: "session=secret" })).toThrow(
      "unsafe upload header",
    );
    expect(() => safeUploadHeaders({ authorization: "Bearer secret" })).toThrow(
      "unsafe upload header",
    );
  });

  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "rejects the demo evidence adapter when %s marks production",
    (productionKey) => {
      for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
        vi.stubEnv(key, "test");
      vi.stubEnv("CLOCKWORK_EVIDENCE_ADAPTER", "demo");
      vi.stubEnv(productionKey, " Production ");

      expect(() => configuredEvidenceGateway()).toThrow(
        expect.objectContaining({
          status: 503,
          code: "DEMO_ADAPTER_FORBIDDEN",
        }),
      );
    },
  );

  it("rejects non-HTTP local gateway and client credential URLs", async () => {
    expect(
      () =>
        new HttpEvidenceGateway({
          baseUrl: "ftp://localhost/",
          bearerToken: "storage-token-that-is-longer-than-32-bytes",
          allowedClientOrigins: ["ftp://localhost"],
        }),
    ).toThrow("Evidence storage gateway must use HTTPS");

    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          uploadId: "provider-upload",
          storageKey: "quarantine/key",
          url: "ftp://localhost/upload",
          headers: { "content-type": "application/pdf" },
          expiresAt: "2026-07-31T12:05:00.000Z",
        }),
      ),
    );
    const localGateway = new HttpEvidenceGateway({
      baseUrl: "http://localhost:8787/",
      bearerToken: "storage-token-that-is-longer-than-32-bytes",
      allowedClientOrigins: ["ftp://localhost"],
      fetchImplementation,
    });
    await expect(localGateway.reserveUpload(upload())).rejects.toMatchObject({
      code: "EVIDENCE_PROVIDER_URL_FORBIDDEN",
    });
  });

  it.each([
    ["expired", "2026-07-31T11:59:59.000Z"],
    ["long-lived", "2026-07-31T13:00:00.000Z"],
  ])("rejects a %s upload credential", async (_label, expiresAt) => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          uploadId: "provider-upload",
          storageKey: "quarantine/key",
          url: "https://upload.example/upload",
          headers: { "content-type": "application/pdf" },
          expiresAt,
        }),
      ),
    );
    await expect(
      gateway(fetchImplementation).reserveUpload(upload()),
    ).rejects.toMatchObject({
      code: "EVIDENCE_UPLOAD_EXPIRY_INVALID",
    });
  });

  it.each([
    ["expired", "2026-07-31T11:59:59.000Z"],
    ["long-lived", "2026-07-31T12:30:00.000Z"],
  ])("rejects a %s download credential", async (_label, expiresAt) => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ url: "https://upload.example/download", expiresAt }),
      ),
    );
    await expect(
      gateway(fetchImplementation).createDownload(upload(), 300),
    ).rejects.toMatchObject({ code: "EVIDENCE_DOWNLOAD_EXPIRY_INVALID" });
  });

  it("binds provider calls to versioned storage without exposing the bearer token", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          url: "https://upload.example/download",
          expiresAt: "2026-07-31T12:05:00.000Z",
        }),
      ),
    );
    const result = await gateway(fetchImplementation).createDownload(
      upload(),
      300,
    );
    expect(result.expiresAt).toBe("2026-07-31T12:05:00.000Z");
    const requestBody = fetchImplementation.mock.calls[0]?.[1]?.body;
    const body: unknown = JSON.parse(
      typeof requestBody === "string" ? requestBody : "{}",
    );
    expect(body).toMatchObject({
      versionId: "version-1",
      expiresInSeconds: 300,
    });
    expect(JSON.stringify(result)).not.toContain("storage-token");
  });
});
