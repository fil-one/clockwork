import { createHash } from "node:crypto";

import type { SessionClaims, SessionResolver } from "@clockwork/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/auth/session", () => ({
  WorkosNextSessionResolver: class {
    public resolve() {
      return Promise.resolve(null);
    }
  },
}));

import { handleExperienceRequest } from "./controller";
import type { EvidenceGateway } from "./evidence-gateway";
import { ExperienceProblem, type ProjectionPage } from "./model";
import type { ProjectionSource } from "./projection-source";
import type { DatabaseExperienceRepository } from "./repository";

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const userId = "20000000-0000-4000-8000-000000000002";
const agreementId = "80000000-0000-4000-8000-000000000001";
const documentId = "90000000-0000-4000-8000-000000000001";
const envelopeId = "a0000000-0000-4000-8000-000000000001";
const csrf = "12345678901234567890123456789012";
const idempotency = "idempotency-key-000000000001";

const customerSession: SessionClaims = {
  userId,
  organizationId: "30000000-0000-4000-8000-000000000001",
  accountIds: [accountA],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function resolver(session: SessionClaims = customerSession): SessionResolver {
  return { resolve: vi.fn(() => Promise.resolve(session)) };
}

function fetchedUrl(input: RequestInfo | URL | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input?.url ?? "";
}

function requestBody(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

function mutationRequest(
  path: string,
  payload: Record<string, unknown>,
  origin = "https://app.example",
) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: `clockwork-csrf=${csrf}; workos-session=secret-session-cookie`,
      "x-csrf-token": csrf,
      "idempotency-key": idempotency,
      "x-request-id": "request-12345678",
    },
    body: JSON.stringify(payload),
  });
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    signingTarget: vi.fn(() =>
      Promise.resolve({
        agreementId,
        accountId: accountA,
        documentId,
        signerUserId: userId,
        signerEmail: "owner@example.test",
      }),
    ),
    createEsignCorrelation: vi.fn(() => Promise.resolve(undefined)),
    readEsignReturn: vi.fn(() =>
      Promise.resolve({
        state: "pending",
        envelopeId,
        agreementId,
        documentId,
        signedDocumentId: null,
        completionCertificateDocumentId: null,
        updatedAt: "2026-07-31T12:00:00.000Z",
      }),
    ),
    readEsignSignedDocument: vi.fn(),
    reserveEvidence: vi.fn(),
    readEvidence: vi.fn(),
    bindEvidenceProvider: vi.fn(),
    markEvidenceScanning: vi.fn(),
    expireEvidence: vi.fn(),
    quarantineEvidence: vi.fn(),
    promoteEvidence: vi.fn(),
    findRenderRequest: vi.fn(),
    claimRenderRequest: vi.fn(),
    failRenderRequest: vi.fn(),
    storeArtifact: vi.fn(),
    findArtifact: vi.fn(),
    ...overrides,
  } as unknown as DatabaseExperienceRepository;
}

beforeEach(() => {
  process.env.CLOCKWORK_CANONICAL_ORIGIN = "https://app.example";
});

afterEach(() => {
  delete process.env.CLOCKWORK_CANONICAL_ORIGIN;
  vi.restoreAllMocks();
});

describe("experience controller security", () => {
  it.each([
    ["hostile origin", "https://app.example", "https://attacker.example"],
    ["preview origin", "https://preview.example", "https://preview.example"],
    ["malformed origin", "https://app.example", "null"],
  ])(
    "sends no internal request or cookie for a %s",
    async (_label, requestOrigin, headerOrigin) => {
      const signingTarget = vi.fn();
      const guardedRepo = repository({ signingTarget });
      const fetchImplementation = vi.fn<typeof fetch>();
      const request = mutationRequest(
        "/api/experience/esign/launches",
        { agreementId, mode: "redirect" },
        requestOrigin,
      );
      request.headers.set("origin", headerOrigin);
      const response = await handleExperienceRequest(
        request,
        ["esign", "launches"],
        {
          repository: guardedRepo,
          sessionResolver: resolver(),
          fetchImplementation,
        },
      );
      expect(response.status).toBe(403);
      expect(signingTarget).not.toHaveBeenCalled();
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it("launches only the server-bound signer/document/account at the exact canonical origin", async () => {
    const createEsignCorrelation = vi.fn(() => Promise.resolve(undefined));
    const repo = repository({ createEsignCorrelation });
    const fetchImplementation = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({
          id: envelopeId,
          signingUrl: "https://esign.clockwork.test/session",
        }),
      ),
    );
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/esign/launches", {
        agreementId,
        accountId: accountA,
        documentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        signerEmail: "attacker@example.test",
        mode: "redirect",
      }),
      ["esign", "launches"],
      { repository: repo, sessionResolver: resolver(), fetchImplementation },
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(fetchedUrl(url)).toBe(
      "https://app.example/api/v1/lifecycle/agreements/envelopes",
    );
    expect(JSON.parse(requestBody(init))).toMatchObject({
      accountId: accountA,
      agreementId,
      documentId,
      signerEmail: "owner@example.test",
    });
    expect(requestBody(init)).not.toContain("attacker@example.test");
    expect(new Headers(init?.headers).get("cookie")).toContain(
      "workos-session=secret-session-cookie",
    );
    expect(createEsignCorrelation).toHaveBeenCalledOnce();
  });

  it("denies forged account projection reads before the source runs", async () => {
    const list = vi.fn();
    const source = {
      list,
      find: vi.fn(),
      action: vi.fn(),
    } as unknown as ProjectionSource;
    const response = await handleExperienceRequest(
      new Request(
        `https://app.example/api/experience/projections/customer/quotes?accountId=${accountB}`,
      ),
      ["projections", "customer", "quotes"],
      {
        repository: repository(),
        sessionResolver: resolver(),
        projections: source,
      },
    );
    expect(response.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });

  it("passes a stable cursor/limit and returns source freshness without interception", async () => {
    const page: ProjectionPage = {
      items: [],
      nextCursor: "next-page",
      generatedAt: "2026-07-31T12:00:00.000Z",
      freshnessSeconds: 300,
    };
    const list = vi.fn(() => Promise.resolve(page));
    const source = {
      list,
      find: vi.fn(),
      action: vi.fn(),
    } as unknown as ProjectionSource;
    const response = await handleExperienceRequest(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes?cursor=opaque&limit=17",
      ),
      ["projections", "customer", "quotes"],
      {
        repository: repository(),
        sessionResolver: resolver(),
        projections: source,
      },
    );
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: accountA,
        cursor: "opaque",
        limit: 17,
      }),
    );
    expect(await response.json()).toEqual(page);
  });

  it("returns a stale conflict from a version-bound action without retrying", async () => {
    const action = vi.fn(() =>
      Promise.reject(
        new ExperienceProblem(
          409,
          "VERSION_CONFLICT",
          "Projection record changed",
        ),
      ),
    );
    const source = {
      list: vi.fn(),
      find: vi.fn(),
      action,
    } as unknown as ProjectionSource;
    const response = await handleExperienceRequest(
      mutationRequest(
        "/api/experience/projections/customer/quotes/Q-1/actions",
        {
          projectionId: "50000000-0000-4000-8000-000000000001",
          action: "accept",
          expectedVersion: 1,
          payload: {},
        },
      ),
      ["projections", "customer", "quotes", "Q-1", "actions"],
      {
        repository: repository(),
        sessionResolver: resolver(),
        projections: source,
      },
    );
    expect(response.status).toBe(409);
    expect(action).toHaveBeenCalledOnce();
  });
});

describe("authoritative e-sign readback", () => {
  it("does not treat an altered opaque state as success", async () => {
    const repo = repository({
      readEsignReturn: vi.fn(() =>
        Promise.reject(
          new ExperienceProblem(
            404,
            "ESIGN_RETURN_NOT_FOUND",
            "Signing return state is invalid",
          ),
        ),
      ),
    });
    const response = await handleExperienceRequest(
      new Request("https://app.example/api/experience/esign/returns/altered"),
      ["esign", "returns", "altered"],
      { repository: repo, sessionResolver: resolver() },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      code: "ESIGN_RETURN_NOT_FOUND",
    });
  });

  it("streams a completed signed document only after immutable hash/MIME/length verification", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    const filename = `agreement-${agreementId}.pdf`;
    const repo = repository({
      readEsignSignedDocument: vi.fn(() =>
        Promise.resolve({
          envelopeId,
          agreementId,
          documentId,
          storageKey: "signed/key",
          storageVersionId: "version-1",
          contentHash,
          byteLength: String(bytes.byteLength),
          mimeType: "application/pdf",
          filename,
        }),
      ),
    });
    const gateway = {
      readImmutable: vi.fn(() =>
        Promise.resolve({
          bytes,
          contentHash,
          byteLength: String(bytes.byteLength),
          mimeType: "application/pdf",
          filename,
        }),
      ),
    } as unknown as EvidenceGateway;
    const response = await handleExperienceRequest(
      new Request(
        "https://app.example/api/experience/esign/returns/opaque/signed-document",
      ),
      ["esign", "returns", "opaque", "signed-document"],
      { repository: repo, sessionResolver: resolver(), evidence: gateway },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-content-sha256")).toBe(contentHash);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(
      Array.from(bytes),
    );
  });

  it("returns no signed bytes when storage content is corrupt", async () => {
    const expected = new TextEncoder().encode("%PDF-1.4\n%%EOF");
    const corrupt = new TextEncoder().encode("%PDF-1.4\nCORRUPT");
    const contentHash = createHash("sha256").update(expected).digest("hex");
    const filename = `agreement-${agreementId}.pdf`;
    const repo = repository({
      readEsignSignedDocument: vi.fn(() =>
        Promise.resolve({
          envelopeId,
          agreementId,
          documentId,
          storageKey: "signed/key",
          storageVersionId: "version-1",
          contentHash,
          byteLength: String(expected.byteLength),
          mimeType: "application/pdf",
          filename,
        }),
      ),
    });
    const gateway = {
      readImmutable: vi.fn(() =>
        Promise.resolve({
          bytes: corrupt,
          contentHash,
          byteLength: String(corrupt.byteLength),
          mimeType: "application/pdf",
          filename,
        }),
      ),
    } as unknown as EvidenceGateway;
    const response = await handleExperienceRequest(
      new Request(
        "https://app.example/api/experience/esign/returns/opaque/signed-document",
      ),
      ["esign", "returns", "opaque", "signed-document"],
      { repository: repo, sessionResolver: resolver(), evidence: gateway },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });
});

describe("evidence request policy", () => {
  it.each([
    ["invalid MIME", { mimeType: "text/html" }, 422],
    ["oversize", { byteLength: 50 * 1024 * 1024 + 1 }, 422],
    ["invalid journey kind", { kind: "deletion_certificate" }, 422],
    ["caller retention", { retainUntil: "9999-12-31T00:00:00.000Z" }, 422],
    ["legal hold escalation", { legalHold: true }, 403],
  ])(
    "rejects %s before durable reservation",
    async (_label, override, status) => {
      const reserveEvidence = vi.fn();
      const guardedRepo = repository({ reserveEvidence });
      const payload = {
        journey: "customer_paper",
        targetId: agreementId,
        kind: "agreement",
        contentHash: "a".repeat(64),
        mimeType: "application/pdf",
        byteLength: 1024,
        ...override,
      };
      const response = await handleExperienceRequest(
        mutationRequest("/api/experience/evidence/uploads", payload),
        ["evidence", "uploads"],
        { repository: guardedRepo, sessionResolver: resolver() },
      );
      expect(response.status).toBe(status);
      expect(reserveEvidence).not.toHaveBeenCalled();
    },
  );
});
