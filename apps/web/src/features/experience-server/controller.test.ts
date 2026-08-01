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

import {
  experienceRouteManifest,
  handleExperienceRequest,
  requireMutationSecurity,
} from "./controller";
import type { EvidenceGateway } from "./evidence-gateway";
import { artifactKinds, ExperienceProblem, type ProjectionPage } from "./model";
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

const internalSession: SessionClaims = {
  ...customerSession,
  accountIds: [],
  roles: ["internal_operator"],
  isInternalStaff: true,
};

const assistedSession: SessionClaims = {
  ...internalSession,
  impersonation: {
    accountId: accountB,
    reason: "Customer-requested billing assistance",
    sessionId: "assisted-session-0001",
    actualUserId: userId,
    actualActorEmail: "operator@example.test",
  },
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
    createRenderRequest: vi.fn(),
    findRenderRequest: vi.fn(),
    claimRenderRequest: vi.fn(),
    failRenderRequest: vi.fn(),
    storeArtifact: vi.fn(),
    findArtifact: vi.fn(),
    ...overrides,
  } as unknown as DatabaseExperienceRepository;
}

function requestedSourceAccountId(mock: {
  readonly mock: {
    readonly calls: readonly (readonly unknown[])[];
  };
}): unknown {
  const input = mock.mock.calls[0]?.[0];
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const source = (input as Record<string, unknown>).source;
  if (!source || typeof source !== "object" || Array.isArray(source))
    return undefined;
  return (source as Record<string, unknown>).accountId;
}

beforeEach(() => {
  process.env.CLOCKWORK_CANONICAL_ORIGIN = "https://app.example";
});

describe("authoritative artifact requests", () => {
  it("publishes one canonical artifact route with separate kind metadata", () => {
    expect(experienceRouteManifest.artifactRead).toBe(
      "GET /api/experience/artifacts/{kind}/{artifactId}",
    );
    expect(experienceRouteManifest.artifactKindCount).toBe(15);
    expect(experienceRouteManifest.artifactKinds).toEqual(artifactKinds);
  });

  it.each(artifactKinds)(
    "accepts only identity/version/scope for the %s source resolver",
    async (kind) => {
      const createRenderRequest = vi.fn(() =>
        Promise.resolve({
          id: "40000000-0000-4000-8000-000000000001",
          accountId: accountA,
          audience: "customer" as const,
          audienceAccountId: accountA,
          subjectType: "test",
          subjectId: documentId,
          kind,
          input: {},
          sourceHash: "a".repeat(64),
          sourceVersion: "7",
          retainUntil: "2033-07-31T16:00:00.000Z",
          status: "pending" as const,
          version: 1,
        }),
      );
      const response = await handleExperienceRequest(
        mutationRequest("/api/experience/artifacts/render-requests", {
          kind,
          subjectId: documentId,
          expectedVersion: "7",
          audience: "customer",
          accountId: accountA,
        }),
        ["artifacts", "render-requests"],
        {
          repository: repository({ createRenderRequest }),
          sessionResolver: resolver(),
        },
      );
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({
        id: "40000000-0000-4000-8000-000000000001",
        accountId: accountA,
        audience: "customer",
        audienceAccountId: accountA,
        subjectType: "test",
        subjectId: documentId,
        kind,
        sourceHash: "a".repeat(64),
        sourceVersion: "7",
        retainUntil: "2033-07-31T16:00:00.000Z",
        status: "pending",
        version: 1,
      });
      expect(createRenderRequest).toHaveBeenCalledWith({
        session: customerSession,
        source: {
          kind,
          subjectId: documentId,
          expectedVersion: "7",
          audience: "customer",
          accountId: accountA,
        },
        requestId: "request-12345678",
      });
    },
  );

  it("rejects browser-supplied issuer, recipient, totals, or document input before repository access", async () => {
    const createRenderRequest = vi.fn();
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/artifacts/render-requests", {
        kind: "receipt",
        subjectId: documentId,
        expectedVersion: "2",
        audience: "customer",
        accountId: accountA,
        issuer: { legalName: "Attacker" },
        amountPaid: { currency: "USD", minorUnits: "999999" },
      }),
      ["artifacts", "render-requests"],
      {
        repository: repository({ createRenderRequest }),
        sessionResolver: resolver(),
      },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "ARTIFACT_SOURCE_FIELDS_FORBIDDEN",
    });
    expect(createRenderRequest).not.toHaveBeenCalled();
  });

  it("returns only the public artifact representation without provider storage metadata", async () => {
    const representation = {
      id: documentId,
      kind: "direct_quote" as const,
      subjectType: "quote",
      subjectId: documentId,
      accountId: accountA,
      audience: "customer" as const,
      audienceAccountId: accountA,
      documentId,
      version: "direct-quote:1",
      sourceHash: "a".repeat(64),
      contentHash: "b".repeat(64),
      mimeType: "application/pdf" as const,
      byteLength: "2048",
      filename: "direct-quote.pdf",
      retainUntil: "2033-07-31T16:00:00.000Z",
      createdAt: "2026-08-01T12:00:00.000Z",
      downloadHref: `/api/experience/artifacts/direct_quote/${documentId}`,
    };
    const readImmutable = vi.fn();
    const response = await handleExperienceRequest(
      new Request(
        `https://app.example/api/experience/artifacts/direct_quote/${documentId}?representation=json`,
      ),
      ["artifacts", "direct_quote", documentId],
      {
        repository: repository({
          findArtifact: vi.fn(() =>
            Promise.resolve({
              representation,
              storageKey: "private/artifacts/direct-quote.pdf",
              storageVersionId: "private-provider-version-1",
            }),
          ),
        }),
        evidence: { readImmutable } as unknown as EvidenceGateway,
        sessionResolver: resolver(),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(representation);
    expect(readImmutable).not.toHaveBeenCalled();
  });

  it("rejects an unsupported artifact representation before provider access", async () => {
    const representation = {
      id: documentId,
      kind: "direct_quote" as const,
      accountId: accountA,
      audience: "customer" as const,
      audienceAccountId: accountA,
    };
    const readImmutable = vi.fn();
    const response = await handleExperienceRequest(
      new Request(
        `https://app.example/api/experience/artifacts/direct_quote/${documentId}?representation=xml`,
      ),
      ["artifacts", "direct_quote", documentId],
      {
        repository: repository({
          findArtifact: vi.fn(() =>
            Promise.resolve({
              representation,
              storageKey: "private/artifacts/direct-quote.pdf",
              storageVersionId: "private-provider-version-1",
            }),
          ),
        }),
        evidence: { readImmutable } as unknown as EvidenceGateway,
        sessionResolver: resolver(),
      },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "ARTIFACT_REPRESENTATION_INVALID",
    });
    expect(readImmutable).not.toHaveBeenCalled();
  });

  it.each([
    [
      "render request",
      "POST",
      ["artifacts", "render-requests", documentId, "retry"],
    ],
    [
      "artifact read",
      "GET",
      ["artifacts", "direct_quote", documentId, "metadata"],
    ],
  ] as const)(
    "rejects a trailing %s route alias",
    async (_name, method, segments) => {
      const findRenderRequest = vi.fn();
      const findArtifact = vi.fn();
      const request =
        method === "POST"
          ? mutationRequest(
              `/api/experience/artifacts/render-requests/${documentId}/retry`,
              {},
            )
          : new Request(
              `https://app.example/api/experience/artifacts/direct_quote/${documentId}/metadata`,
            );
      const response = await handleExperienceRequest(request, [...segments], {
        repository: repository({ findRenderRequest, findArtifact }),
        sessionResolver: resolver(),
      });
      expect(response.status).toBe(404);
      expect(findRenderRequest).not.toHaveBeenCalled();
      expect(findArtifact).not.toHaveBeenCalled();
    },
  );

  it("rejects an overlong source version before source resolution", async () => {
    const createRenderRequest = vi.fn();
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/artifacts/render-requests", {
        kind: "direct_quote",
        subjectId: documentId,
        expectedVersion: "v".repeat(81),
        audience: "customer",
        accountId: accountA,
      }),
      ["artifacts", "render-requests"],
      {
        repository: repository({ createRenderRequest }),
        sessionResolver: resolver(),
      },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "ARTIFACT_VERSION_INVALID",
    });
    expect(createRenderRequest).not.toHaveBeenCalled();
  });

  it("resolves an omitted customer account from the authenticated session", async () => {
    const createRenderRequest = vi.fn(() =>
      Promise.resolve({ id: documentId, status: "pending" }),
    );
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/artifacts/render-requests", {
        kind: "direct_quote",
        subjectId: documentId,
        expectedVersion: "1",
        audience: "customer",
      }),
      ["artifacts", "render-requests"],
      {
        repository: repository({ createRenderRequest }),
        sessionResolver: resolver(),
      },
    );
    expect(response.status).toBe(201);
    expect(createRenderRequest).toHaveBeenCalledOnce();
    expect(requestedSourceAccountId(createRenderRequest)).toBe(accountA);
  });

  it.each([
    [
      "unassisted internal tenant access",
      internalSession,
      "customer",
      "ASSISTED_SESSION_REQUIRED",
    ],
    [
      "customer-to-partner audience crossover",
      customerSession,
      "partner",
      "AUDIENCE_FORBIDDEN",
    ],
  ] as const)(
    "denies %s before source resolution",
    async (_name, session, audience, code) => {
      const createRenderRequest = vi.fn();
      const response = await handleExperienceRequest(
        mutationRequest("/api/experience/artifacts/render-requests", {
          kind: "direct_quote",
          subjectId: documentId,
          expectedVersion: "1",
          audience,
          accountId: accountA,
        }),
        ["artifacts", "render-requests"],
        {
          repository: repository({ createRenderRequest }),
          sessionResolver: resolver(session),
        },
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code });
      expect(createRenderRequest).not.toHaveBeenCalled();
    },
  );

  it("binds assisted source resolution to the audited impersonated account", async () => {
    const createRenderRequest = vi.fn(() =>
      Promise.resolve({ id: documentId, status: "pending" }),
    );
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/artifacts/render-requests", {
        kind: "invoice_companion",
        subjectId: documentId,
        expectedVersion: "2",
        audience: "customer",
      }),
      ["artifacts", "render-requests"],
      {
        repository: repository({ createRenderRequest }),
        sessionResolver: resolver(assistedSession),
      },
    );
    expect(response.status).toBe(201);
    expect(createRenderRequest).toHaveBeenCalledOnce();
    expect(requestedSourceAccountId(createRenderRequest)).toBe(accountB);
  });

  it("keeps internal report sources explicitly accountless", async () => {
    const createRenderRequest = vi.fn(() =>
      Promise.resolve({ id: documentId, status: "pending" }),
    );
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/artifacts/render-requests", {
        kind: "report_export",
        subjectId: documentId,
        expectedVersion: "txid:1",
        audience: "internal",
        accountId: null,
      }),
      ["artifacts", "render-requests"],
      {
        repository: repository({ createRenderRequest }),
        sessionResolver: resolver(internalSession),
      },
    );
    expect(response.status).toBe(201);
    expect(createRenderRequest).toHaveBeenCalledOnce();
    expect(requestedSourceAccountId(createRenderRequest)).toBeNull();
  });

  it("redrives an explicitly failed render through the version-bound claim", async () => {
    const failed = {
      id: documentId,
      accountId: accountA,
      audience: "customer" as const,
      audienceAccountId: accountA,
      subjectType: "quote",
      subjectId: documentId,
      kind: "direct_quote" as const,
      input: {},
      sourceHash: "a".repeat(64),
      sourceVersion: "1",
      retainUntil: "2033-07-31T16:00:00.000Z",
      status: "failed" as const,
      version: 7,
    };
    const claimRenderRequest = vi.fn(() =>
      Promise.reject(
        new ExperienceProblem(
          409,
          "RENDER_VERSION_CONFLICT",
          "Another worker won the redrive claim",
        ),
      ),
    );
    const response = await handleExperienceRequest(
      mutationRequest(
        `/api/experience/artifacts/render-requests/${documentId}`,
        {},
      ),
      ["artifacts", "render-requests", documentId],
      {
        repository: repository({
          findRenderRequest: vi.fn(() => Promise.resolve(failed)),
          claimRenderRequest,
        }),
        sessionResolver: resolver(),
      },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "RENDER_VERSION_CONFLICT",
    });
    expect(claimRenderRequest).toHaveBeenCalledWith(failed, "request-12345678");
  });

  it.each([
    [
      "terminal CAS conflict",
      new ExperienceProblem(
        409,
        "RENDER_VERSION_CONFLICT",
        "Another worker completed the request",
      ),
    ],
    [
      "failure-persistence outage",
      new Error("failure persistence unavailable"),
    ],
  ])(
    "preserves the renderer failure across a %s",
    async (_name, transition) => {
      const request = {
        id: documentId,
        accountId: accountA,
        audience: "customer" as const,
        audienceAccountId: accountA,
        subjectType: "quote",
        subjectId: documentId,
        kind: "direct_quote" as const,
        input: {},
        sourceHash: "a".repeat(64),
        sourceVersion: "1",
        retainUntil: "2033-07-31T16:00:00.000Z",
        status: "pending" as const,
        version: 3,
      };
      const original = new ExperienceProblem(
        502,
        "ARTIFACT_RENDERER_UNAVAILABLE",
        "Renderer unavailable",
      );
      const failRenderRequest = vi.fn(() => Promise.reject(transition));
      const response = await handleExperienceRequest(
        mutationRequest(
          `/api/experience/artifacts/render-requests/${documentId}`,
          {},
        ),
        ["artifacts", "render-requests", documentId],
        {
          repository: repository({
            findRenderRequest: vi.fn(() => Promise.resolve(request)),
            claimRenderRequest: vi.fn(() => Promise.resolve(undefined)),
            failRenderRequest,
          }),
          renderDocument: vi.fn(() => Promise.reject(original)),
          sessionResolver: resolver(),
        },
      );
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({
        code: "ARTIFACT_RENDERER_UNAVAILABLE",
      });
      expect(original.cause).toBe(transition);
      expect(failRenderRequest).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["render", ["artifacts", "render-requests", documentId], "POST"],
    ["read", ["artifacts", "direct_quote", documentId], "GET"],
  ] as const)(
    "denies cross-audience %s before provider effects",
    async (_name, segments, method) => {
      const claimRenderRequest = vi.fn();
      const findRenderRequest = vi.fn(() =>
        Promise.resolve({
          id: documentId,
          accountId: accountA,
          audience: "partner" as const,
          audienceAccountId: accountA,
          subjectType: "quote",
          subjectId: documentId,
          kind: "direct_quote" as const,
          input: {},
          sourceHash: "a".repeat(64),
          sourceVersion: "1",
          retainUntil: "2033-07-31T16:00:00.000Z",
          status: "pending" as const,
          version: 1,
        }),
      );
      const findArtifact = vi.fn(() =>
        Promise.resolve({
          representation: {
            id: documentId,
            accountId: accountA,
            audience: "partner" as const,
            audienceAccountId: accountA,
            kind: "direct_quote" as const,
          },
          storageKey: "private/artifact-key",
          storageVersionId: "private-version-id",
        }),
      );
      const request =
        method === "POST"
          ? mutationRequest(
              `/api/experience/artifacts/render-requests/${documentId}`,
              {},
            )
          : new Request(
              `https://app.example/api/experience/artifacts/direct_quote/${documentId}`,
            );
      const response = await handleExperienceRequest(request, [...segments], {
        repository: repository({
          findRenderRequest,
          findArtifact,
          claimRenderRequest,
        }),
        sessionResolver: resolver(),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "AUDIENCE_FORBIDDEN",
      });
      expect(claimRenderRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["render", ["artifacts", "render-requests", documentId], "POST"],
    ["read", ["artifacts", "direct_quote", documentId], "GET"],
  ] as const)(
    "denies unassisted internal %s access before provider effects",
    async (_name, segments, method) => {
      const claimRenderRequest = vi.fn();
      const findRenderRequest = vi.fn(() =>
        Promise.resolve({
          id: documentId,
          accountId: accountA,
          audience: "customer" as const,
          audienceAccountId: accountA,
          subjectType: "quote",
          subjectId: documentId,
          kind: "direct_quote" as const,
          input: {},
          sourceHash: "a".repeat(64),
          sourceVersion: "1",
          retainUntil: "2033-07-31T16:00:00.000Z",
          status: "pending" as const,
          version: 1,
        }),
      );
      const findArtifact = vi.fn(() =>
        Promise.resolve({
          representation: {
            id: documentId,
            accountId: accountA,
            audience: "customer" as const,
            audienceAccountId: accountA,
            kind: "direct_quote" as const,
          },
          storageKey: "private/artifact-key",
          storageVersionId: "private-version-id",
        }),
      );
      const request =
        method === "POST"
          ? mutationRequest(
              `/api/experience/artifacts/render-requests/${documentId}`,
              {},
            )
          : new Request(
              `https://app.example/api/experience/artifacts/direct_quote/${documentId}`,
            );
      const response = await handleExperienceRequest(request, [...segments], {
        repository: repository({
          findRenderRequest,
          findArtifact,
          claimRenderRequest,
        }),
        sessionResolver: resolver(internalSession),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "ASSISTED_SESSION_REQUIRED",
      });
      expect(claimRenderRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["stale version", "ARTIFACT_SOURCE_VERSION_CONFLICT", 409],
    ["cross-scope request", "ARTIFACT_SCOPE_FORBIDDEN", 403],
    ["corrupt persisted source", "ARTIFACT_SOURCE_CORRUPT", 409],
  ] as const)(
    "preserves a %s failure without retry masking",
    async (_name, code, status) => {
      const createRenderRequest = vi.fn(() =>
        Promise.reject(new ExperienceProblem(status, code, "Source rejected")),
      );
      const response = await handleExperienceRequest(
        mutationRequest("/api/experience/artifacts/render-requests", {
          kind: "receipt",
          subjectId: documentId,
          expectedVersion: "1",
          audience: "customer",
          accountId: accountA,
        }),
        ["artifacts", "render-requests"],
        {
          repository: repository({ createRenderRequest }),
          sessionResolver: resolver(),
        },
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({ code });
      expect(createRenderRequest).toHaveBeenCalledOnce();
    },
  );
});

afterEach(() => {
  delete process.env.CLOCKWORK_CANONICAL_ORIGIN;
  vi.restoreAllMocks();
});

describe("experience controller security", () => {
  it("uses exact same-origin equality at a local Next boundary without trusting its rewritten request URL", () => {
    delete process.env.CLOCKWORK_CANONICAL_ORIGIN;
    const headers = {
      host: "127.0.0.1:32124",
      origin: "http://127.0.0.1:32124",
      cookie: `clockwork-csrf=${csrf}`,
      "x-csrf-token": csrf,
    };
    expect(() =>
      requireMutationSecurity(
        new Request("http://localhost:3000/api/experience/projections", {
          method: "POST",
          headers,
        }),
      ),
    ).not.toThrow();
    expect(() =>
      requireMutationSecurity(
        new Request("http://localhost:3000/api/experience/projections", {
          method: "POST",
          headers: { ...headers, origin: "http://preview.example" },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ status: 403, code: "ORIGIN_FORBIDDEN" }),
    );
  });

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

  it("rejects a trailing e-sign launch alias before persistence or provider effects", async () => {
    const signingTarget = vi.fn();
    const fetchImplementation = vi.fn<typeof fetch>();
    const response = await handleExperienceRequest(
      mutationRequest("/api/experience/esign/launches/extra", {
        agreementId,
        mode: "redirect",
      }),
      ["esign", "launches", "extra"],
      {
        repository: repository({ signingTarget }),
        sessionResolver: resolver(),
        fetchImplementation,
      },
    );
    expect(response.status).toBe(404);
    expect(signingTarget).not.toHaveBeenCalled();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

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

  it("rejects a non-positive projection version before the action source runs", async () => {
    const action = vi.fn();
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
          expectedVersion: 0,
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
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "INVALID_BODY" });
    expect(action).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID projection identifier before the action source runs", async () => {
    const action = vi.fn();
    const source = {
      list: vi.fn(),
      find: vi.fn(),
      action,
    } as unknown as ProjectionSource;
    const response = await handleExperienceRequest(
      mutationRequest(
        "/api/experience/projections/customer/quotes/Q-1/actions",
        {
          projectionId: "not-a-projection-uuid",
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
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "INVALID_IDENTIFIER",
    });
    expect(action).not.toHaveBeenCalled();
  });

  it.each([
    ["action", "POST"],
    ["action receipt", "GET"],
  ] as const)(
    "rejects a trailing projection %s route alias",
    async (_name, method) => {
      const action = vi.fn();
      const receipt = vi.fn();
      const source = {
        list: vi.fn(),
        find: vi.fn(),
        action,
        receipt,
      } as unknown as ProjectionSource;
      const segments =
        method === "POST"
          ? ["projections", "customer", "quotes", "Q-1", "actions", "alias"]
          : [
              "projections",
              "customer",
              "quotes",
              "Q-1",
              "actions",
              "70000000-0000-4000-8000-000000000001",
              "alias",
            ];
      const request =
        method === "POST"
          ? mutationRequest(
              "/api/experience/projections/customer/quotes/Q-1/actions/alias",
              {
                projectionId: "50000000-0000-4000-8000-000000000001",
                action: "accept",
                expectedVersion: 1,
                payload: {},
              },
            )
          : new Request(
              "https://app.example/api/experience/projections/customer/quotes/Q-1/actions/70000000-0000-4000-8000-000000000001/alias",
            );
      const response = await handleExperienceRequest(request, segments, {
        repository: repository(),
        sessionResolver: resolver(),
        projections: source,
      });
      expect(response.status).toBe(404);
      expect(action).not.toHaveBeenCalled();
      expect(receipt).not.toHaveBeenCalled();
    },
  );

  it("returns an actor-scoped terminal action receipt", async () => {
    const receipt = vi.fn(() =>
      Promise.resolve({
        id: "70000000-0000-4000-8000-000000000001",
        projectionId: "50000000-0000-4000-8000-000000000001",
        aggregateType: "quote",
        aggregateId: "60000000-0000-4000-8000-000000000001",
        action: "expire",
        expectedVersion: 3,
        status: "applied" as const,
        resultReference: "core:quotes:result:version:4",
        resultCode: "PORTAL_ACTION_APPLIED",
        authoritativeVersion: 4,
        commandReplayed: false,
        createdAt: "2026-07-31T12:00:00.000Z",
        completedAt: "2026-07-31T12:00:01.000Z",
        auditEventId: "71000000-0000-4000-8000-000000000001",
        outboxMessageId: "72000000-0000-4000-8000-000000000001",
      }),
    );
    const source = {
      list: vi.fn(),
      find: vi.fn(),
      action: vi.fn(),
      receipt,
    } as unknown as ProjectionSource;
    const response = await handleExperienceRequest(
      new Request(
        "https://app.example/api/experience/projections/customer/quotes/Q-1/actions/70000000-0000-4000-8000-000000000001",
      ),
      [
        "projections",
        "customer",
        "quotes",
        "Q-1",
        "actions",
        "70000000-0000-4000-8000-000000000001",
      ],
      {
        repository: repository(),
        sessionResolver: resolver(),
        projections: source,
      },
    );
    expect(response.status).toBe(200);
    expect(receipt).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: accountA,
        actionRequestId: "70000000-0000-4000-8000-000000000001",
      }),
    );
    expect(await response.json()).toMatchObject({
      status: "applied",
      authoritativeVersion: 4,
    });
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
    ["complete", "POST"],
    ["download", "GET"],
  ] as const)(
    "rejects a trailing evidence %s alias before persistence or provider effects",
    async (operation, method) => {
      const readEvidence = vi.fn();
      const completeUpload = vi.fn();
      const createDownload = vi.fn();
      const path = `/api/experience/evidence/uploads/upload-1/${operation}/extra`;
      const request =
        method === "POST"
          ? mutationRequest(path, {})
          : new Request(`https://app.example${path}`);
      const response = await handleExperienceRequest(
        request,
        ["evidence", "uploads", "upload-1", operation, "extra"],
        {
          repository: repository({ readEvidence }),
          evidence: {
            completeUpload,
            createDownload,
          } as unknown as EvidenceGateway,
          sessionResolver: resolver(),
        },
      );
      expect(response.status).toBe(404);
      expect(readEvidence).not.toHaveBeenCalled();
      expect(completeUpload).not.toHaveBeenCalled();
      expect(createDownload).not.toHaveBeenCalled();
    },
  );

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
