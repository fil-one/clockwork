import type {
  ArtifactKind,
  ArtifactRepresentation,
  EsignReturnStatus,
  EvidenceJourney,
  EvidenceKind,
  EvidenceUploadRecord,
  ExperienceAudience,
  ProjectionActionReceipt,
  ProjectionChannel,
  ProjectionPage,
  ProjectionRecord,
} from "@/src/features/experience-server/model";

export interface ExperienceClientOptions {
  fetchImplementation?: typeof fetch;
  csrfToken?: string;
  idempotencyKey?: string;
}

export interface ArtifactRenderRequest {
  id: string;
  accountId: string | null;
  audience: ExperienceAudience;
  audienceAccountId: string | null;
  subjectType: string;
  subjectId: string;
  kind: ArtifactKind;
  sourceHash: string;
  sourceVersion: string;
  retainUntil: string;
  status: "pending" | "rendering" | "stored" | "failed";
  version: number;
}

export interface ArtifactDownload {
  bytes: ArrayBuffer;
  contentHash: string;
  contentDisposition: string | null;
}

export class ExperienceClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExperienceClientError";
  }
}

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function responseError(response: Response, value: unknown) {
  const problem = value && typeof value === "object" ? value : {};
  return new ExperienceClientError(
    response.status,
    "code" in problem && typeof problem.code === "string"
      ? problem.code
      : "EXPERIENCE_ERROR",
    "title" in problem && typeof problem.title === "string"
      ? problem.title
      : "The operation could not be completed", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
  );
}

async function errorResult(response: Response): Promise<ExperienceClientError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = undefined;
  }
  return responseError(response, value);
}

async function result<T>(response: Response): Promise<T> {
  if (!response.ok) throw await errorResult(response);
  return (await response.json()) as T;
}

function mutation(options: ExperienceClientOptions) {
  const csrf = options.csrfToken ?? cookieValue("clockwork-csrf");
  if (!csrf || csrf.length < 32)
    throw new ExperienceClientError(
      403,
      "CSRF_MISSING",
      "The secure form token is unavailable", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
  return {
    "content-type": "application/json",
    "x-csrf-token": csrf,
    "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
  };
}

function implementation(options: ExperienceClientOptions): typeof fetch {
  return options.fetchImplementation ?? fetch;
}

function requirePositiveVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ExperienceClientError(
      422,
      "EXPECTED_VERSION_INVALID",
      "expectedVersion must be a positive integer", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
}

function requireArtifactSourceVersion(value: string): void {
  if (!value.trim() || value.length > 80)
    throw new ExperienceClientError(
      422,
      "ARTIFACT_VERSION_INVALID",
      "expectedVersion must contain between 1 and 80 characters", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
}

function artifactPath(kind: ArtifactKind, id: string): string {
  return `/api/experience/artifacts/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function readProjection(
  input: {
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    accountId?: string;
    cursor?: string;
    limit?: number;
  },
  options: ExperienceClientOptions = {},
): Promise<ProjectionPage> {
  const url = new URL(
    `/api/experience/projections/${input.audience}/${input.channel}`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  if (input.accountId) url.searchParams.set("accountId", input.accountId);
  if (input.cursor) url.searchParams.set("cursor", input.cursor);
  url.searchParams.set("limit", String(input.limit ?? 25));
  return implementation(options)(url.pathname + url.search, {
    credentials: "same-origin",
    cache: "no-store",
  }).then(result<ProjectionPage>);
}

export function readProjectionRecord(
  input: {
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    recordKey: string;
    accountId?: string;
  },
  options: ExperienceClientOptions = {},
): Promise<ProjectionRecord> {
  const url = new URL(
    `/api/experience/projections/${input.audience}/${input.channel}/${encodeURIComponent(input.recordKey)}`,
    typeof window === "undefined" ? "http://localhost" : window.location.origin,
  );
  if (input.accountId) url.searchParams.set("accountId", input.accountId);
  return implementation(options)(url.pathname + url.search, {
    credentials: "same-origin",
    cache: "no-store",
  }).then(result<ProjectionRecord>);
}

export function sendProjectionAction(
  input: {
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    recordKey: string;
    projectionId: string;
    action: string;
    expectedVersion: number;
    accountId?: string;
    payload?: Readonly<Record<string, unknown>>;
  },
  options: ExperienceClientOptions = {},
): Promise<ProjectionActionReceipt> {
  requirePositiveVersion(input.expectedVersion);
  const query = input.accountId
    ? `?accountId=${encodeURIComponent(input.accountId)}`
    : "";
  return implementation(options)(
    `/api/experience/projections/${input.audience}/${input.channel}/${encodeURIComponent(input.recordKey)}/actions${query}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: mutation(options),
      body: JSON.stringify({
        projectionId: input.projectionId,
        action: input.action,
        expectedVersion: input.expectedVersion,
        payload: input.payload ?? {},
      }),
    },
  ).then(result<ProjectionActionReceipt>);
}

export function readProjectionAction(
  input: {
    audience: ExperienceAudience;
    channel: ProjectionChannel;
    recordKey: string;
    actionRequestId: string;
    accountId?: string;
  },
  options: ExperienceClientOptions = {},
): Promise<ProjectionActionReceipt> {
  const query = input.accountId
    ? `?accountId=${encodeURIComponent(input.accountId)}`
    : "";
  return implementation(options)(
    `/api/experience/projections/${input.audience}/${input.channel}/${encodeURIComponent(input.recordKey)}/actions/${encodeURIComponent(input.actionRequestId)}${query}`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<ProjectionActionReceipt>);
}

export function startAuthoritativeSigning(
  input: {
    agreementId: string;
    accountId?: string;
    mode: "redirect" | "embedded";
  },
  options: ExperienceClientOptions = {},
): Promise<{
  envelopeId: string;
  status: "pending";
  signingUrl: string;
  returnState: string;
}> {
  return implementation(options)("/api/experience/esign/launches", {
    method: "POST",
    credentials: "same-origin",
    headers: mutation(options),
    body: JSON.stringify(input),
  }).then(
    result<{
      envelopeId: string;
      status: "pending";
      signingUrl: string;
      returnState: string;
    }>,
  );
}

export function readAuthoritativeSigningReturn(
  opaqueState: string,
  options: ExperienceClientOptions = {},
): Promise<EsignReturnStatus> {
  return implementation(options)(
    `/api/experience/esign/returns/${encodeURIComponent(opaqueState)}`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<EsignReturnStatus>);
}

export function createEvidenceUpload(
  input: {
    accountId?: string;
    organizationId?: string;
    journey: EvidenceJourney;
    targetId: string;
    kind: EvidenceKind;
    contentHash: string;
    mimeType: string;
    byteLength: number;
    legalHold?: boolean;
  },
  options: ExperienceClientOptions = {},
) {
  return implementation(options)("/api/experience/evidence/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: mutation(options),
    body: JSON.stringify(input),
  }).then(
    result<{
      upload: EvidenceUploadRecord;
      method: "PUT";
      uploadUrl: string;
      headers: Readonly<Record<string, string>>;
      expiresAt: string;
    }>,
  );
}

export function completeEvidenceUpload(
  uploadId: string,
  options: ExperienceClientOptions = {},
) {
  return implementation(options)(
    `/api/experience/evidence/uploads/${encodeURIComponent(uploadId)}/complete`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: mutation(options),
      body: "{}",
    },
  ).then(result<{ upload: EvidenceUploadRecord; duplicate?: boolean }>);
}

export function readEvidenceUpload(
  uploadId: string,
  options: ExperienceClientOptions = {},
) {
  return implementation(options)(
    `/api/experience/evidence/uploads/${encodeURIComponent(uploadId)}`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<EvidenceUploadRecord>);
}

export function evidenceDownload(
  uploadId: string,
  options: ExperienceClientOptions = {},
) {
  return implementation(options)(
    `/api/experience/evidence/uploads/${encodeURIComponent(uploadId)}/download`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<{ url: string; expiresAt: string }>);
}

export function artifactRepresentation(
  kind: ArtifactKind,
  id: string,
  options: ExperienceClientOptions = {},
) {
  return implementation(options)(
    `${artifactPath(kind, id)}?representation=json`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<ArtifactRepresentation>);
}

export async function downloadArtifact(
  kind: ArtifactKind,
  id: string,
  options: ExperienceClientOptions = {},
): Promise<ArtifactDownload> {
  const response = await implementation(options)(artifactPath(kind, id), {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw await errorResult(response);
  if (
    response.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf"
  )
    throw new ExperienceClientError(
      502,
      "ARTIFACT_RESPONSE_INVALID",
      "The artifact response is not a PDF", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
  const contentHash = response.headers.get("x-content-sha256") ?? "";
  if (!/^[a-f0-9]{64}$/.test(contentHash))
    throw new ExperienceClientError(
      502,
      "ARTIFACT_RESPONSE_INVALID",
      "The artifact response has no valid content hash", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
  const bytes = await response.arrayBuffer();
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 5));
  const declaredLength = response.headers.get("content-length");
  if (
    prefix !== "%PDF-" ||
    (await sha256(bytes)) !== contentHash ||
    (declaredLength !== null &&
      (!/^[1-9][0-9]*$/.test(declaredLength) ||
        Number(declaredLength) !== bytes.byteLength))
  )
    throw new ExperienceClientError(
      502,
      "ARTIFACT_RESPONSE_INVALID",
      "The artifact response failed immutable metadata validation", // i18n-exempt: English diagnostic; surfaces render experienceErrorText(error, t)
    );
  return {
    bytes,
    contentHash,
    contentDisposition: response.headers.get("content-disposition"),
  };
}

export function createArtifactRenderRequest(
  input: {
    kind: ArtifactKind;
    subjectId: string;
    expectedVersion: string;
    audience: ExperienceAudience;
    accountId?: string | null;
  },
  options: ExperienceClientOptions = {},
): Promise<ArtifactRenderRequest> {
  requireArtifactSourceVersion(input.expectedVersion);
  return implementation(options)("/api/experience/artifacts/render-requests", {
    method: "POST",
    credentials: "same-origin",
    headers: mutation(options),
    body: JSON.stringify(input),
  }).then(result<ArtifactRenderRequest>);
}

export function renderArtifactRequest(
  requestId: string,
  options: ExperienceClientOptions = {},
) {
  return implementation(options)(
    `/api/experience/artifacts/render-requests/${encodeURIComponent(requestId)}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: mutation(options),
      body: "{}",
    },
  ).then(result<ArtifactRepresentation>);
}
