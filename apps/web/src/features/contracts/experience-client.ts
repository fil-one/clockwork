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

async function result<T>(response: Response): Promise<T> {
  const value: unknown = await response.json();
  if (!response.ok) {
    const problem = value && typeof value === "object" ? value : {};
    throw new ExperienceClientError(
      response.status,
      "code" in problem && typeof problem.code === "string"
        ? problem.code
        : "EXPERIENCE_ERROR",
      "title" in problem && typeof problem.title === "string"
        ? problem.title
        : "The operation could not be completed",
    );
  }
  return value as T;
}

function mutation(options: ExperienceClientOptions) {
  const csrf = options.csrfToken ?? cookieValue("clockwork-csrf");
  if (!csrf || csrf.length < 32)
    throw new ExperienceClientError(
      403,
      "CSRF_MISSING",
      "The secure form token is unavailable",
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
    `/api/experience/artifacts/${kind}/${encodeURIComponent(id)}?representation=json`,
    { credentials: "same-origin", cache: "no-store" },
  ).then(result<ArtifactRepresentation>);
}
