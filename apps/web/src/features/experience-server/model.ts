import type { SessionClaims } from "@clockwork/api";

export const experienceAudiences = ["customer", "partner", "internal"] as const;
export type ExperienceAudience = (typeof experienceAudiences)[number];

export const projectionChannels = [
  "dashboard",
  "agreements",
  "quotes",
  "orders",
  "services",
  "pocs",
  "billing",
  "amendments",
  "procurement",
  "users",
  "marketplace",
  "support",
  "portfolio",
  "registrations",
  "disputes",
  "commissions",
  "renewals",
  "sandboxes",
  "brand",
  "queues",
  "approvals",
  "collections",
  "provisioning",
  "reports",
] as const;
export type ProjectionChannel = (typeof projectionChannels)[number];

export interface ProjectionRecord {
  id: string;
  recordKey: string;
  aggregateType: string;
  aggregateId: string;
  accountId: string | null;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  version: number;
  sourceUpdatedAt: string;
  projectedAt: string;
  stale: boolean;
  data: Readonly<Record<string, unknown>>;
}

export interface ProjectionPage {
  items: readonly ProjectionRecord[];
  nextCursor: string | null;
  generatedAt: string;
  freshnessSeconds: number;
}

export interface ProjectionListInput {
  session: SessionClaims;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  accountId: string | null;
  cursor?: string;
  limit: number;
  now: Date;
}

export interface ProjectionActionInput {
  session: SessionClaims;
  projectionId: string;
  recordKey: string;
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  accountId: string | null;
  action: string;
  expectedVersion: number;
  idempotencyKey: string;
  payload: Readonly<Record<string, unknown>>;
  requestId: string;
}

export interface ProjectionActionReceipt {
  id: string;
  projectionId: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  expectedVersion: number;
  status: "queued" | "applied" | "rejected" | "failed";
  createdAt: string;
  auditEventId: string;
  outboxMessageId: string;
}

export type EsignPublicState =
  "pending" | "completed" | "declined" | "expired" | "failed";

export interface EsignReturnStatus {
  state: EsignPublicState;
  envelopeId: string;
  agreementId: string;
  documentId: string;
  signedDocumentId: string | null;
  completionCertificateDocumentId: string | null;
  updatedAt: string;
}

export const evidenceJourneys = [
  "customer_paper",
  "poc",
  "procurement",
  "exception",
  "approval",
] as const;
export type EvidenceJourney = (typeof evidenceJourneys)[number];

export const evidenceKinds = [
  "agreement",
  "acceptance",
  "quote",
  "order_form",
  "amendment",
  "notice",
  "completion_certificate",
  "deletion_certificate",
  "screening",
  "approval",
] as const;
export type EvidenceKind = (typeof evidenceKinds)[number];

export type EvidenceUploadState =
  | "pending"
  | "uploaded"
  | "scanning"
  | "quarantined"
  | "promoted"
  | "expired"
  | "failed";

export interface EvidenceUploadRecord {
  id: string;
  uploadId: string;
  providerUploadId: string | null;
  ownerUserId: string;
  accountId: string | null;
  journey: EvidenceJourney;
  targetId: string;
  kind: EvidenceKind;
  contentHash: string;
  mimeType: string;
  byteLength: string;
  retainUntil: string;
  expiresAt: string;
  legalHold: boolean;
  status: EvidenceUploadState;
  scanReference: string | null;
  documentId: string | null;
  immutableStorageKey: string | null;
  storageVersionId: string | null;
  version: number;
}

export const artifactKinds = [
  "direct_quote",
  "partner_transfer_quote",
  "partner_resale_quote",
  "order_form",
  "amendment",
  "poc_summary",
  "poc_final_report",
  "invoice_companion",
  "receipt",
  "commission_statement",
  "renewal_confirmation",
  "decline_confirmation",
  "deletion_certificate",
  "reconciliation_report",
  "report_export",
] as const;
export type ArtifactKind = (typeof artifactKinds)[number];

export interface ArtifactRepresentation {
  id: string;
  kind: ArtifactKind;
  subjectType: string;
  subjectId: string;
  accountId: string;
  audience: ExperienceAudience;
  audienceAccountId: string | null;
  documentId: string;
  version: string;
  sourceHash: string;
  contentHash: string;
  mimeType: "application/pdf";
  byteLength: string;
  filename: string;
  retainUntil: string;
  createdAt: string;
  downloadHref: string;
}

export class ExperienceProblem extends Error {
  public constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 422 | 502 | 503,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExperienceProblem";
  }
}

export function isAudience(value: string): value is ExperienceAudience {
  return (experienceAudiences as readonly string[]).includes(value);
}

export function isProjectionChannel(value: string): value is ProjectionChannel {
  return (projectionChannels as readonly string[]).includes(value);
}

export function isEvidenceJourney(value: string): value is EvidenceJourney {
  return (evidenceJourneys as readonly string[]).includes(value);
}

export function isEvidenceKind(value: string): value is EvidenceKind {
  return (evidenceKinds as readonly string[]).includes(value);
}

export function isArtifactKind(value: string): value is ArtifactKind {
  return (artifactKinds as readonly string[]).includes(value);
}
