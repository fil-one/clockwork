import { timingSafeEqual } from "node:crypto";

import {
  artifactDownloadHeaders,
  renderAuthorizedCommerceDocument,
  verifyDownloadedArtifact,
  type CommerceDocumentInput,
} from "@clockwork/documents";

import { WorkosNextSessionResolver } from "@/src/auth/session";
import type { SessionResolver } from "@clockwork/api";

import {
  idempotencyKey,
  requestId,
  requireAuthenticatedSession,
  resolveScopedAccount,
} from "./authorization";
import {
  configuredEvidenceGateway,
  type EvidenceGateway,
} from "./evidence-gateway";
import {
  artifactKinds,
  evidenceJourneys,
  evidenceKinds,
  ExperienceProblem,
  isArtifactKind,
  isAudience,
  isEvidenceJourney,
  isEvidenceKind,
  isProjectionChannel,
} from "./model";
import {
  configuredProjectionSource,
  projectionInput,
  type ProjectionSource,
} from "./projection-source";
import {
  createOpaqueEsignState,
  DatabaseExperienceRepository,
  publicRenderRequest,
} from "./repository";
import { requireProjectionActionAuthority } from "./projection-authorization";

interface ControllerDependencies {
  repository?: DatabaseExperienceRepository;
  projections?: ProjectionSource;
  evidence?: EvidenceGateway;
  sessionResolver?: SessionResolver;
  now?: () => Date;
  fetchImplementation?: typeof fetch;
  renderDocument?: typeof renderAuthorizedCommerceDocument;
}

function json(
  value: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function problem(error: unknown, id: string): Response {
  const value =
    error instanceof ExperienceProblem
      ? error
      : new ExperienceProblem(
          503,
          "EXPERIENCE_UNAVAILABLE",
          process.env.NODE_ENV === "production"
            ? "The experience service is unavailable"
            : error instanceof Error
              ? error.message
              : "The experience service is unavailable",
        );
  return json(
    {
      type: `https://clockwork.test/problems/${value.code.toLowerCase().replaceAll("_", "-")}`,
      title: value.message,
      status: value.status,
      code: value.code,
      requestId: id,
      retryable: value.status >= 500,
    },
    value.status,
    { "content-type": "application/problem+json" },
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      "Request body must be an object",
    );
  return value as Record<string, unknown>;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";")[0];
  if (contentType !== "application/json")
    throw new ExperienceProblem(
      422,
      "CONTENT_TYPE_INVALID",
      "application/json is required",
    );
  try {
    return record(await request.json());
  } catch (error) {
    if (error instanceof ExperienceProblem) throw error;
    throw new ExperienceProblem(422, "INVALID_BODY", "Request JSON is invalid");
  }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || !item.trim())
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is required`);
  return item.trim();
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const item = value[key];
  if (item === null || item === undefined || item === "") return null;
  if (typeof item !== "string")
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is invalid`);
  return item.trim();
}

function requiredInteger(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isSafeInteger(item))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be an integer`,
    );
  return item;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maximumEvidenceBytes = 50 * 1024 * 1024;
const allowedEvidenceMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
]);
const journeyKinds = Object.freeze({
  customer_paper: new Set(["agreement"]),
  poc: new Set(["acceptance", "screening", "approval"]),
  procurement: new Set(["quote", "order_form", "notice", "approval"]),
  exception: new Set(["notice", "screening", "approval"]),
  approval: new Set([
    "agreement",
    "approval",
    "order_form",
    "amendment",
    "notice",
    "deletion_certificate",
  ]),
});
const retentionDays = Object.freeze({
  customer_paper: 2557,
  poc: 365,
  procurement: 2557,
  exception: 1095,
  approval: 2557,
});

function uuid(value: Record<string, unknown>, key: string): string {
  const id = requiredString(value, key);
  if (!uuidPattern.test(id))
    throw new ExperienceProblem(422, "INVALID_IDENTIFIER", `${key} is invalid`);
  return id;
}

function cookieValue(cookie: string, name: string): string | undefined {
  return cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function equalSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export function requireMutationSecurity(request: Request): void {
  const requestUrl = new URL(request.url);
  const configured = process.env.CLOCKWORK_CANONICAL_ORIGIN?.trim();
  let expectedOrigin: string;
  if (configured) {
    expectedOrigin = new URL(configured).origin;
  } else if (process.env.NODE_ENV === "production") {
    throw new ExperienceProblem(
      503,
      "CANONICAL_ORIGIN_REQUIRED",
      "Canonical origin is not configured",
    );
  } else {
    const host = request.headers.get("host")?.trim();
    if (!host || !/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host))
      throw new ExperienceProblem(
        403,
        "ORIGIN_FORBIDDEN",
        "Same-origin request required",
      );
    expectedOrigin = `${requestUrl.protocol}//${host}`;
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== expectedOrigin)
    throw new ExperienceProblem(
      403,
      "ORIGIN_FORBIDDEN",
      "Same-origin request required",
    );
  const token = request.headers.get("x-csrf-token") ?? "";
  const cookie =
    cookieValue(request.headers.get("cookie") ?? "", "clockwork-csrf") ?? "";
  if (token.length < 32 || cookie.length < 32 || !equalSecret(token, cookie))
    throw new ExperienceProblem(
      403,
      "CSRF_INVALID",
      "Secure form token is invalid",
    );
}

function routeOrigin(request: Request): URL {
  const incoming = new URL(request.url);
  const configured = process.env.CLOCKWORK_CANONICAL_ORIGIN?.trim();
  if (configured) {
    const canonical = new URL(configured);
    if (canonical.origin !== incoming.origin)
      throw new ExperienceProblem(
        403,
        "CANONICAL_ORIGIN_MISMATCH",
        "Request origin is not canonical",
      );
    return canonical;
  }
  if (process.env.NODE_ENV === "production")
    throw new ExperienceProblem(
      503,
      "CANONICAL_ORIGIN_REQUIRED",
      "Canonical origin is not configured",
    );
  if (!["localhost", "127.0.0.1"].includes(incoming.hostname))
    throw new ExperienceProblem(
      403,
      "CANONICAL_ORIGIN_MISMATCH",
      "Non-local origin is not allowed",
    );
  return incoming;
}

function cleanSegments(segments: readonly string[]): string[] {
  return segments.map((segment) => decodeURIComponent(segment)).filter(Boolean);
}

export async function handleExperienceRequest(
  request: Request,
  rawSegments: readonly string[],
  dependencies: ControllerDependencies = {},
): Promise<Response> {
  const id = requestId(request);
  try {
    const segments = cleanSegments(rawSegments);
    const resolver =
      dependencies.sessionResolver ?? new WorkosNextSessionResolver();
    const session = requireAuthenticatedSession(
      await resolver.resolve(request),
    );
    const now = dependencies.now?.() ?? new Date();
    let resolvedRepository = dependencies.repository;
    const repository = () =>
      (resolvedRepository ??= new DatabaseExperienceRepository());

    if (segments[0] === "projections") {
      const audienceValue = segments[1] ?? "";
      const channelValue = segments[2] ?? "";
      if (!isAudience(audienceValue) || !isProjectionChannel(channelValue))
        throw new ExperienceProblem(
          404,
          "ROUTE_NOT_FOUND",
          "Projection route not found",
        );
      const url = new URL(request.url);
      const requestedLimit = Number(url.searchParams.get("limit") ?? "25");
      if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)
        throw new ExperienceProblem(
          422,
          "INVALID_LIMIT",
          "Projection limit is invalid",
        );
      const cursor = url.searchParams.get("cursor");
      const input = projectionInput({
        session,
        audience: audienceValue,
        channel: channelValue,
        requestedAccountId: url.searchParams.get("accountId"),
        ...(cursor ? { cursor } : {}),
        limit: Math.min(100, requestedLimit),
        now,
      });
      const source = dependencies.projections ?? configuredProjectionSource();
      if (segments.length === 3 && request.method === "GET")
        return json(await source.list(input));
      const recordKey = segments[3];
      if (!recordKey)
        throw new ExperienceProblem(
          404,
          "ROUTE_NOT_FOUND",
          "Projection record route not found",
        );
      if (segments.length === 4 && request.method === "GET")
        return json(
          await source.find({
            session,
            audience: input.audience,
            channel: input.channel,
            accountId: input.accountId,
            recordKey,
            now,
          }),
        );
      if (
        segments.length === 5 &&
        segments[4] === "actions" &&
        request.method === "POST"
      ) {
        requireMutationSecurity(request);
        const value = await body(request);
        const action = requiredString(value, "action");
        requireProjectionActionAuthority(
          session.roles,
          input.audience,
          input.channel,
          action,
        );
        const expectedVersion = requiredInteger(value, "expectedVersion");
        if (expectedVersion < 1)
          throw new ExperienceProblem(
            422,
            "INVALID_BODY",
            "expectedVersion must be positive",
          );
        return json(
          await source.action({
            session,
            audience: input.audience,
            channel: input.channel,
            accountId: input.accountId,
            recordKey,
            projectionId: uuid(value, "projectionId"),
            action,
            expectedVersion,
            idempotencyKey: idempotencyKey(request),
            payload: record(value.payload ?? {}),
            requestId: id,
          }),
          202,
        );
      }
      if (
        segments.length === 6 &&
        segments[4] === "actions" &&
        segments[5] &&
        request.method === "GET"
      )
        return json(
          await source.receipt({
            session,
            audience: input.audience,
            channel: input.channel,
            accountId: input.accountId,
            recordKey,
            actionRequestId: segments[5],
            requestId: id,
          }),
        );
    }

    if (
      segments[0] === "esign" &&
      segments[1] === "launches" &&
      segments.length === 2 &&
      request.method === "POST"
    ) {
      requireMutationSecurity(request);
      const value = await body(request);
      const accountId = resolveScopedAccount(
        session,
        "customer",
        optionalString(value, "accountId"),
      );
      if (!accountId)
        throw new ExperienceProblem(
          403,
          "ACCOUNT_SCOPE_FORBIDDEN",
          "Account access denied",
        );
      const mode = requiredString(value, "mode");
      if (mode !== "redirect" && mode !== "embedded")
        throw new ExperienceProblem(
          422,
          "SIGNING_MODE_INVALID",
          "Signing mode is invalid",
        );
      const origin = routeOrigin(request);
      const target = await repository().signingTarget(
        session,
        uuid(value, "agreementId"),
        accountId,
        id,
      );
      const opaqueState = createOpaqueEsignState();
      const returnUrl = new URL("/signing/return", origin);
      returnUrl.searchParams.set("state", opaqueState);
      const csrf = request.headers.get("x-csrf-token") ?? "";
      const cookie = request.headers.get("cookie") ?? "";
      const lifecycleUrl = new URL(
        "/api/v1/lifecycle/agreements/envelopes",
        origin,
      );
      const response = await (dependencies.fetchImplementation ?? fetch)(
        lifecycleUrl,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrf,
            cookie,
            origin: origin.origin,
            "idempotency-key": idempotencyKey(request),
            "x-request-id": id,
          },
          body: JSON.stringify({
            accountId: target.accountId,
            agreementId: target.agreementId,
            documentId: target.documentId,
            signerEmail: target.signerEmail,
            mode,
            returnUrl: returnUrl.toString(),
          }),
          cache: "no-store",
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new ExperienceProblem(
          response.status === 403 ? 403 : 503,
          "ESIGN_LAUNCH_FAILED",
          "The persisted agreement could not start an e-sign session",
        );
      const launched = record(await response.json());
      const envelopeId = requiredString(launched, "id");
      const signingUrl = requiredString(launched, "signingUrl");
      await repository().createEsignCorrelation({
        session,
        target,
        envelopeId,
        opaqueState,
        expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        requestId: id,
      });
      return json({
        envelopeId,
        status: "pending",
        signingUrl,
        returnState: opaqueState,
      });
    }

    if (
      segments[0] === "esign" &&
      segments[1] === "returns" &&
      segments[2] &&
      segments.length === 3 &&
      request.method === "GET"
    )
      return json(
        await repository().readEsignReturn({
          session,
          opaqueState: segments[2],
          now,
          requestId: id,
        }),
      );

    if (
      segments[0] === "esign" &&
      segments[1] === "returns" &&
      segments[2] &&
      segments[3] === "signed-document" &&
      segments.length === 4 &&
      request.method === "GET"
    ) {
      const signed = await repository().readEsignSignedDocument({
        session,
        opaqueState: segments[2],
        now,
        requestId: id,
      });
      const gateway = dependencies.evidence ?? configuredEvidenceGateway();
      const actual = await gateway.readImmutable({
        storageKey: signed.storageKey,
        storageVersionId: signed.storageVersionId,
        contentHash: signed.contentHash,
        byteLength: signed.byteLength,
        mimeType: signed.mimeType,
        filename: signed.filename,
      });
      const bytes = verifyDownloadedArtifact(signed, actual);
      return new Response(new Uint8Array(bytes).buffer, {
        status: 200,
        headers: artifactDownloadHeaders(signed),
      });
    }

    if (segments[0] === "evidence" && segments[1] === "uploads") {
      const uploadId = segments[2];
      if (segments.length === 2 && !uploadId && request.method === "POST") {
        requireMutationSecurity(request);
        const value = await body(request);
        const journey = requiredString(value, "journey");
        const kind = requiredString(value, "kind");
        if (!isEvidenceJourney(journey) || !isEvidenceKind(kind))
          throw new ExperienceProblem(
            422,
            "EVIDENCE_TYPE_INVALID",
            "Evidence journey or kind is invalid",
          );
        if (!journeyKinds[journey].has(kind))
          throw new ExperienceProblem(
            422,
            "EVIDENCE_KIND_FORBIDDEN",
            "Evidence kind is not allowed for this journey",
          );
        const mimeType = requiredString(value, "mimeType").toLowerCase();
        const byteLength = requiredInteger(value, "byteLength");
        const contentHash = requiredString(value, "contentHash");
        if (!allowedEvidenceMimeTypes.has(mimeType))
          throw new ExperienceProblem(
            422,
            "EVIDENCE_MIME_FORBIDDEN",
            "Evidence MIME type is not allowed",
          );
        if (byteLength < 1 || byteLength > maximumEvidenceBytes)
          throw new ExperienceProblem(
            422,
            "EVIDENCE_SIZE_INVALID",
            "Evidence size exceeds the upload limit",
          );
        if (!sha256Pattern.test(contentHash))
          throw new ExperienceProblem(
            422,
            "INVALID_CONTENT_HASH",
            "Evidence hash is invalid",
          );
        if ("retainUntil" in value)
          throw new ExperienceProblem(
            422,
            "RETENTION_SERVER_MANAGED",
            "Evidence retention is server managed",
          );
        const requestedAccountId = optionalString(value, "accountId");
        const accountId =
          session.isInternalStaff && !session.impersonation
            ? null
            : resolveScopedAccount(
                session,
                session.roles.some((role) => role.startsWith("partner_"))
                  ? "partner"
                  : "customer",
                requestedAccountId,
              );
        const legalHoldRequested = value.legalHold === true;
        const legalHoldAllowed =
          session.isInternalStaff &&
          journey === "approval" &&
          session.roles.some((role) => role === "legal_approver");
        if (legalHoldRequested && !legalHoldAllowed)
          throw new ExperienceProblem(
            403,
            "LEGAL_HOLD_FORBIDDEN",
            "Legal hold requires legal approval authority",
          );
        const expiresAt = new Date(
          now.getTime() + 15 * 60 * 1000,
        ).toISOString();
        const retainUntil = new Date(
          now.getTime() + retentionDays[journey] * 24 * 60 * 60 * 1000,
        ).toISOString();
        const reserved = await repository().reserveEvidence({
          session,
          accountId,
          organizationId: optionalString(value, "organizationId"),
          journey,
          targetId: uuid(value, "targetId"),
          kind,
          contentHash,
          mimeType,
          byteLength,
          retainUntil,
          expiresAt,
          legalHold: legalHoldRequested,
          idempotencyKey: idempotencyKey(request),
          requestId: id,
        });
        if (reserved.status !== "pending" && reserved.providerUploadId)
          return json({ upload: reserved, replayed: true }, 200);
        const gateway = dependencies.evidence ?? configuredEvidenceGateway();
        const provider = await gateway.reserveUpload(reserved);
        const bound = await repository().bindEvidenceProvider({
          session,
          uploadId: reserved.uploadId,
          providerUploadId: provider.providerUploadId,
          quarantineKey: provider.quarantineKey,
          requestId: id,
        });
        return json(
          {
            upload: bound,
            method: provider.method,
            uploadUrl: provider.uploadUrl,
            headers: provider.headers,
            expiresAt: provider.expiresAt,
          },
          201,
        );
      }
      if (uploadId && segments.length === 3 && request.method === "GET")
        return json(await repository().readEvidence(session, uploadId, id));
      if (
        uploadId &&
        segments.length === 4 &&
        segments[3] === "complete" &&
        request.method === "POST"
      ) {
        requireMutationSecurity(request);
        let upload = await repository().readEvidence(session, uploadId, id);
        if (upload.status === "promoted")
          return json({ upload, duplicate: true });
        if (upload.status === "quarantined")
          throw new ExperienceProblem(
            422,
            "EVIDENCE_QUARANTINED",
            "Evidence remains quarantined",
          );
        if (Date.parse(upload.expiresAt) <= now.getTime()) {
          await repository().expireEvidence(session, uploadId, id);
          throw new ExperienceProblem(
            410,
            "EVIDENCE_UPLOAD_EXPIRED",
            "Evidence upload expired",
          );
        }
        if (upload.status === "uploaded")
          upload = await repository().markEvidenceScanning(
            session,
            uploadId,
            id,
          );
        if (upload.status !== "scanning")
          throw new ExperienceProblem(
            409,
            "EVIDENCE_STATE_CONFLICT",
            "Evidence upload is not ready to complete",
          );
        const gateway = dependencies.evidence ?? configuredEvidenceGateway();
        const completed = await gateway.completeUpload(upload);
        if (!completed.clean) {
          const quarantined = await repository().quarantineEvidence({
            session,
            uploadId,
            scanReference: completed.scanReference,
            failureCode: completed.failureCode,
            requestId: id,
          });
          return json({ upload: quarantined }, 422);
        }
        if (
          completed.contentHash !== upload.contentHash ||
          completed.byteLength !== upload.byteLength ||
          completed.mimeType !== upload.mimeType
        )
          throw new ExperienceProblem(
            502,
            "EVIDENCE_PROVIDER_MISMATCH",
            "Scanned evidence metadata does not match its declaration",
          );
        return json({
          upload: await repository().promoteEvidence({
            session,
            uploadId,
            immutableStorageKey: completed.immutableStorageKey,
            storageVersionId: completed.storageVersionId,
            scanReference: completed.scanReference,
            requestId: id,
          }),
        });
      }
      if (
        uploadId &&
        segments.length === 4 &&
        segments[3] === "download" &&
        request.method === "GET"
      ) {
        const upload = await repository().readEvidence(session, uploadId, id);
        if (
          upload.status !== "promoted" ||
          !upload.documentId ||
          !upload.storageVersionId
        )
          throw new ExperienceProblem(
            409,
            "EVIDENCE_NOT_AVAILABLE",
            "Evidence is not available for download",
          );
        const gateway = dependencies.evidence ?? configuredEvidenceGateway();
        return json(await gateway.createDownload(upload, 300));
      }
    }

    if (
      segments[0] === "artifacts" &&
      segments[1] === "render-requests" &&
      segments.length === 2 &&
      request.method === "POST"
    ) {
      requireMutationSecurity(request);
      const value = await body(request);
      const allowed = new Set([
        "kind",
        "subjectId",
        "expectedVersion",
        "audience",
        "accountId",
      ]);
      if (Object.keys(value).some((key) => !allowed.has(key)))
        throw new ExperienceProblem(
          422,
          "ARTIFACT_SOURCE_FIELDS_FORBIDDEN",
          "Only artifact identity, version, and audience scope are accepted",
        );
      const kind = requiredString(value, "kind");
      if (!isArtifactKind(kind))
        throw new ExperienceProblem(
          422,
          "ARTIFACT_KIND_INVALID",
          "Artifact kind is invalid",
        );
      const audience = requiredString(value, "audience");
      if (!isAudience(audience))
        throw new ExperienceProblem(
          422,
          "ARTIFACT_AUDIENCE_INVALID",
          "Artifact audience is invalid",
        );
      const expectedVersion = requiredString(value, "expectedVersion");
      if (expectedVersion.length > 80)
        throw new ExperienceProblem(
          422,
          "ARTIFACT_VERSION_INVALID",
          "Artifact source version is invalid",
        );
      const accountId = optionalString(value, "accountId");
      if (accountId && !uuidPattern.test(accountId))
        throw new ExperienceProblem(
          422,
          "INVALID_IDENTIFIER",
          "accountId is invalid",
        );
      const scopedAccountId = resolveScopedAccount(
        session,
        audience,
        accountId,
      );
      return json(
        publicRenderRequest(
          await repository().createRenderRequest({
            session,
            source: {
              kind,
              subjectId: uuid(value, "subjectId"),
              expectedVersion,
              audience,
              accountId: scopedAccountId,
            },
            requestId: id,
          }),
        ),
        201,
      );
    }

    if (
      segments[0] === "artifacts" &&
      segments[1] === "render-requests" &&
      segments[2] &&
      segments.length === 3 &&
      request.method === "POST"
    ) {
      requireMutationSecurity(request);
      const renderRequest = await repository().findRenderRequest(
        session,
        segments[2],
        id,
      );
      const renderScope = resolveScopedAccount(
        session,
        renderRequest.audience,
        renderRequest.accountId,
      );
      if (renderScope !== renderRequest.accountId)
        throw new ExperienceProblem(
          403,
          "ARTIFACT_SCOPE_FORBIDDEN",
          "The render request is outside the authorized audience scope",
        );
      if (renderRequest.status === "stored")
        throw new ExperienceProblem(
          409,
          "ARTIFACT_ALREADY_STORED",
          "Artifact is already stored",
        );
      // A persisted failure is downstream of authoritative source validation:
      // explicit POST redrives renderer/storage work through the same CAS claim.
      if (
        renderRequest.status !== "pending" &&
        renderRequest.status !== "failed"
      )
        throw new ExperienceProblem(
          409,
          "RENDER_STATE_CONFLICT",
          "Render request cannot be claimed",
        );
      await repository().claimRenderRequest(renderRequest, id);
      try {
        const rendered = await (
          dependencies.renderDocument ?? renderAuthorizedCommerceDocument
        )(renderRequest.input as unknown as CommerceDocumentInput, {
          actorUserId: session.userId,
          accountId: renderRequest.accountId,
          accountIds: session.impersonation
            ? [session.impersonation.accountId]
            : session.accountIds,
          isInternalStaff: session.isInternalStaff,
          audience: renderRequest.audience,
          audienceAccountId: renderRequest.audienceAccountId,
          kind: renderRequest.kind,
          sourceHash: renderRequest.sourceHash,
          requestId: id,
        });
        const gateway = dependencies.evidence ?? configuredEvidenceGateway();
        const stored = await gateway.storeImmutable({
          bytes: rendered.bytes,
          contentHash: rendered.contentHash,
          mimeType: rendered.mimeType,
          retainUntil: renderRequest.retainUntil,
          accountId: renderRequest.accountId,
          internalScopeId: renderRequest.subjectId,
          source: `render:${renderRequest.id}`,
        });
        if (
          stored.contentHash !== rendered.contentHash ||
          stored.byteLength !== rendered.bytes.byteLength.toString() ||
          stored.mimeType !== rendered.mimeType
        )
          throw new ExperienceProblem(
            502,
            "ARTIFACT_STORAGE_MISMATCH",
            "Stored artifact metadata does not match rendered bytes",
          );
        return json(
          await repository().storeArtifact({
            request: renderRequest,
            contentHash: rendered.contentHash,
            byteLength: rendered.bytes.byteLength,
            filename: rendered.fileName,
            immutableVersion: rendered.version,
            storageKey: stored.storageKey,
            storageVersionId: stored.storageVersionId,
            requestId: id,
          }),
          201,
        );
      } catch (error) {
        try {
          await repository().failRenderRequest(
            renderRequest,
            error instanceof ExperienceProblem ? error.code : "RENDER_FAILED",
            id,
          );
        } catch (transitionError) {
          if (error instanceof Error && error.cause === undefined)
            error.cause = transitionError;
        }
        throw error;
      }
    }

    if (
      segments[0] === "artifacts" &&
      segments[1] &&
      segments[2] &&
      segments.length === 3 &&
      request.method === "GET"
    ) {
      if (!isArtifactKind(segments[1]))
        throw new ExperienceProblem(
          404,
          "ARTIFACT_KIND_NOT_FOUND",
          "Artifact kind not found",
        );
      const download = await repository().findArtifact(
        session,
        segments[1],
        segments[2],
        id,
      );
      const artifact = download.representation;
      const artifactScope = resolveScopedAccount(
        session,
        artifact.audience,
        artifact.accountId,
      );
      if (artifactScope !== artifact.accountId)
        throw new ExperienceProblem(
          403,
          "ARTIFACT_SCOPE_FORBIDDEN",
          "The artifact is outside the authorized audience scope",
        );
      const representation = new URL(request.url).searchParams.get(
        "representation",
      );
      if (representation === "json") return json(artifact);
      if (representation !== null)
        throw new ExperienceProblem(
          422,
          "ARTIFACT_REPRESENTATION_INVALID",
          "Artifact representation is invalid",
        );
      const gateway = dependencies.evidence ?? configuredEvidenceGateway();
      const actual = await gateway.readImmutable({
        storageKey: download.storageKey,
        storageVersionId: download.storageVersionId,
        contentHash: artifact.contentHash,
        byteLength: artifact.byteLength,
        mimeType: artifact.mimeType,
        filename: artifact.filename,
      });
      const bytes = verifyDownloadedArtifact(artifact, actual);
      return new Response(new Uint8Array(bytes).buffer, {
        status: 200,
        headers: artifactDownloadHeaders(artifact),
      });
    }

    throw new ExperienceProblem(
      404,
      "ROUTE_NOT_FOUND",
      "Experience route not found",
    );
  } catch (error) {
    return problem(error, id);
  }
}

export const experienceRouteManifest = Object.freeze({
  projectionList: "GET /api/experience/projections/{audience}/{channel}",
  projectionDetail:
    "GET /api/experience/projections/{audience}/{channel}/{recordKey}",
  projectionAction:
    "POST /api/experience/projections/{audience}/{channel}/{recordKey}/actions",
  projectionActionReceipt:
    "GET /api/experience/projections/{audience}/{channel}/{recordKey}/actions/{actionRequestId}",
  esignLaunch: "POST /api/experience/esign/launches",
  esignReturn: "GET /api/experience/esign/returns/{opaqueState}",
  esignSignedDocument:
    "GET /api/experience/esign/returns/{opaqueState}/signed-document",
  evidenceCreate: "POST /api/experience/evidence/uploads",
  evidenceStatus: "GET /api/experience/evidence/uploads/{uploadId}",
  evidenceComplete: "POST /api/experience/evidence/uploads/{uploadId}/complete",
  evidenceDownload: "GET /api/experience/evidence/uploads/{uploadId}/download",
  artifactRequest: "POST /api/experience/artifacts/render-requests",
  artifactRender: "POST /api/experience/artifacts/render-requests/{requestId}",
  artifactRead: "GET /api/experience/artifacts/{kind}/{artifactId}",
  artifactKindCount: artifactKinds.length,
  artifactKinds,
  evidenceJourneys,
  evidenceKinds,
});
