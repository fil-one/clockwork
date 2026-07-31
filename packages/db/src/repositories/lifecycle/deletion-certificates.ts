import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import { deletionCertificates, documents, terminations } from "../../schema";
import {
  lifecycleOffboardingPlans,
  lifecycleProvisioningAttempts,
} from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const LockedExclusionSchema = z.object({
  objectId: z.string().min(1),
  scope: z.string().min(1),
  retainUntil: z.iso.datetime({ offset: true }),
  legalHold: z.boolean(),
});
const PersistedPlanEvidenceSchema = z.object({
  status: z.literal("teardown_confirmed"),
  teardownOperationId: z.string().min(1),
  teardownConfirmedAt: z.iso.datetime({ offset: true }),
  teardownExcludedObjectIds: z.array(z.string().min(1)),
  lockedExclusions: z.array(LockedExclusionSchema),
  approvals: z.array(
    z.object({
      approvalId: z.uuid(),
      approverId: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
      decidedAt: z.iso.datetime({ offset: true }),
      evidenceHash: Sha256Schema,
      recentAuthentication: z.object({ evidenceHash: Sha256Schema }),
    }),
  ),
});
const PersistedAttemptEvidenceSchema = z.object({
  state: z.literal("confirmed"),
  providerOperationId: z.string().min(1),
  command: z.object({
    commandId: z.string().min(1),
    idempotencyKey: z.string().min(1),
    operation: z.literal("teardown"),
  }),
});

export const DeletionCertificateRequestSchema = z.object({
  requestVersion: z.literal(1),
  requestHash: Sha256Schema,
  terminationId: z.uuid(),
  accountId: z.uuid(),
  orderId: z.uuid(),
  organizationId: z.uuid(),
  certificateNumber: z.string().min(1),
  account: z.object({
    legalName: z.string().min(1),
    address: z.object({
      line1: z.string().min(1),
      line2: z.string().optional(),
      locality: z.string().min(1),
      region: z.string().optional(),
      postalCode: z.string().min(1),
      countryCode: z.string().min(2),
    }),
  }),
  deletedScope: z.array(z.string().min(1)).min(1),
  deletionMethod: z.string().min(1),
  completedAt: z.iso.datetime({ offset: true }),
  retainedObjectExclusions: z.array(LockedExclusionSchema),
  approvals: z
    .array(
      z.object({
        approvalId: z.uuid(),
        approverId: z.uuid(),
        approverName: z.string().min(1),
        role: z.string().min(1),
        approvedAt: z.iso.datetime({ offset: true }),
        evidenceHash: Sha256Schema,
        authenticationEvidenceHash: Sha256Schema,
      }),
    )
    .length(2),
  providerEvidence: z.object({
    commandId: z.string().min(1),
    commandIdempotencyKey: z.string().min(1),
    confirmationId: z.string().min(1),
    operationId: z.string().min(1),
    tenantId: z.string().min(1),
    confirmedAt: z.iso.datetime({ offset: true }),
  }),
  retainUntil: z.iso.datetime({ offset: true }),
});

export type DeletionCertificateRequest = z.output<
  typeof DeletionCertificateRequestSchema
>;

export interface PersistedDeletionCertificateArtifact {
  documentId: string;
  storageKey: string;
  storageVersionId: string;
  contentHash: string;
  mimeType: "application/pdf";
  byteLength: number;
  retainUntil: string;
  legalHold: boolean;
}

export interface DeletionCertificateIssueResult {
  certificateId: string;
  documentId: string;
  duplicate: boolean;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("NON_FINITE_JSON_NUMBER");
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = z.record(z.string(), z.unknown()).parse(value);
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function deletionCertificateRequestHash(
  request: Omit<DeletionCertificateRequest, "requestHash">,
): string {
  return createHash("sha256").update(canonicalJson(request)).digest("hex");
}

export class DatabaseDeletionCertificateStore {
  public constructor(private readonly database: RuntimeDatabase) {}

  public issue(input: {
    request: DeletionCertificateRequest;
    artifact: PersistedDeletionCertificateArtifact;
    requestId: string;
  }): Promise<DeletionCertificateIssueResult> {
    const request = DeletionCertificateRequestSchema.parse(input.request);
    const { requestHash, ...body } = request;
    if (deletionCertificateRequestHash(body) !== requestHash)
      throw new Error("DELETION_CERTIFICATE_REQUEST_HASH_MISMATCH");
    if (
      !Sha256Schema.safeParse(input.artifact.contentHash).success ||
      input.artifact.retainUntil !== request.retainUntil ||
      input.artifact.byteLength < 1 ||
      !input.artifact.storageVersionId
    )
      throw new Error("DELETION_CERTIFICATE_ARTIFACT_INVALID");
    return withInternalTransaction(
      this.database,
      input.requestId,
      (transaction) =>
        this.issueInTransaction(transaction, request, input.artifact),
    );
  }

  private async issueInTransaction(
    transaction: RuntimeTransaction,
    request: DeletionCertificateRequest,
    artifact: PersistedDeletionCertificateArtifact,
  ): Promise<DeletionCertificateIssueResult> {
    const existing = await transaction
      .select({
        certificateId: deletionCertificates.id,
        documentId: documents.id,
        contentHash: documents.contentHash,
        storageVersionId: documents.storageVersionId,
        scope: deletionCertificates.scope,
        method: deletionCertificates.method,
        completedAt: deletionCertificates.completedAt,
        lockedExclusions: deletionCertificates.lockedExclusions,
      })
      .from(deletionCertificates)
      .innerJoin(documents, eq(documents.id, deletionCertificates.documentId))
      .where(eq(deletionCertificates.terminationId, request.terminationId))
      .limit(1);
    const prior = existing[0];
    const scope = request.deletedScope.join("\n");
    if (prior) {
      if (
        prior.documentId !== artifact.documentId ||
        prior.contentHash !== artifact.contentHash ||
        prior.storageVersionId !== artifact.storageVersionId ||
        prior.scope !== scope ||
        prior.method !== request.deletionMethod ||
        prior.completedAt.toISOString() !== request.completedAt ||
        canonicalJson(prior.lockedExclusions) !==
          canonicalJson(request.retainedObjectExclusions)
      )
        throw new Error("DELETION_CERTIFICATE_REPLAY_CONFLICT");
      return {
        certificateId: prior.certificateId,
        documentId: prior.documentId,
        duplicate: true,
      };
    }

    const [termination, plan, attempt] = await Promise.all([
      transaction.query.terminations.findFirst({
        where: and(
          eq(terminations.id, request.terminationId),
          eq(terminations.accountId, request.accountId),
          eq(terminations.orderId, request.orderId),
          eq(terminations.teardownStatus, "teardown_confirmed"),
        ),
      }),
      transaction.query.lifecycleOffboardingPlans.findFirst({
        where: and(
          eq(lifecycleOffboardingPlans.terminationId, request.terminationId),
          eq(lifecycleOffboardingPlans.accountId, request.accountId),
          eq(lifecycleOffboardingPlans.organizationId, request.organizationId),
        ),
      }),
      transaction.query.lifecycleProvisioningAttempts.findFirst({
        where: and(
          eq(
            lifecycleProvisioningAttempts.commandId,
            request.providerEvidence.commandId,
          ),
          eq(lifecycleProvisioningAttempts.orderId, request.orderId),
          eq(lifecycleProvisioningAttempts.operation, "teardown"),
          eq(lifecycleProvisioningAttempts.state, "confirmed"),
        ),
      }),
    ]);
    if (!termination || !plan || !attempt)
      throw new Error("DELETION_CERTIFICATE_TEARDOWN_EVIDENCE_MISSING");
    const persistedPlan = PersistedPlanEvidenceSchema.parse(plan.plan);
    const persistedAttempt = PersistedAttemptEvidenceSchema.parse(
      attempt.attempt,
    );
    const approved = persistedPlan.approvals.filter(
      (approval) => approval.decision === "approved",
    );
    const canonicalApprovals = approved.slice(0, 2).map((approval) => ({
      approvalId: approval.approvalId,
      approverId: approval.approverId,
      approvedAt: approval.decidedAt,
      evidenceHash: approval.evidenceHash,
      authenticationEvidenceHash: approval.recentAuthentication.evidenceHash,
    }));
    const requestedApprovals = request.approvals.map((approval) => ({
      approvalId: approval.approvalId,
      approverId: approval.approverId,
      approvedAt: approval.approvedAt,
      evidenceHash: approval.evidenceHash,
      authenticationEvidenceHash: approval.authenticationEvidenceHash,
    }));
    if (
      termination.teardownConfirmedAt?.toISOString() !== request.completedAt ||
      persistedPlan.teardownOperationId !==
        request.providerEvidence.operationId ||
      persistedPlan.teardownConfirmedAt !== request.completedAt ||
      attempt.providerOperationId !== request.providerEvidence.operationId ||
      persistedAttempt.providerOperationId !==
        request.providerEvidence.operationId ||
      persistedAttempt.command.commandId !==
        request.providerEvidence.commandId ||
      persistedAttempt.command.idempotencyKey !==
        request.providerEvidence.commandIdempotencyKey ||
      canonicalJson(canonicalApprovals) !== canonicalJson(requestedApprovals) ||
      canonicalJson(
        persistedPlan.lockedExclusions.filter((exclusion) =>
          persistedPlan.teardownExcludedObjectIds.includes(exclusion.objectId),
        ),
      ) !== canonicalJson(request.retainedObjectExclusions)
    )
      throw new Error("DELETION_CERTIFICATE_PROVIDER_EVIDENCE_MISMATCH");

    const [document] = await transaction
      .insert(documents)
      .values({
        id: artifact.documentId,
        accountId: request.accountId,
        kind: "deletion_certificate",
        storageKey: artifact.storageKey,
        contentHash: artifact.contentHash,
        mimeType: artifact.mimeType,
        byteLength: BigInt(artifact.byteLength),
        objectLockMode: "COMPLIANCE",
        retainUntil: new Date(artifact.retainUntil),
        legalHold: artifact.legalHold,
        storageVersionId: artifact.storageVersionId,
      })
      .returning();
    if (!document)
      throw new Error("DELETION_CERTIFICATE_DOCUMENT_INSERT_FAILED");
    const [certificate] = await transaction
      .insert(deletionCertificates)
      .values({
        terminationId: request.terminationId,
        documentId: document.id,
        scope,
        method: request.deletionMethod,
        completedAt: new Date(request.completedAt),
        lockedExclusions: request.retainedObjectExclusions,
      })
      .returning();
    if (!certificate) throw new Error("DELETION_CERTIFICATE_INSERT_FAILED");
    await appendAuditAndOutbox(transaction, {
      accountId: request.accountId,
      aggregateType: "deletion_certificate",
      aggregateId: certificate.id,
      aggregateVersion: certificate.version,
      eventType: "termination.deletion_certificate_issued",
      topic: "termination.deletion_certificate_issued",
      actor: { kind: "system", id: "deletion-certificate-workflow" },
      requestId: inputRequestId(request),
      occurredAt: new Date(request.completedAt),
      after: {
        certificateId: certificate.id,
        documentId: document.id,
        terminationId: request.terminationId,
        accountId: request.accountId,
        orderId: request.orderId,
        contentHash: document.contentHash,
        storageVersionId: document.storageVersionId,
        retainUntil: document.retainUntil.toISOString(),
        requestHash: request.requestHash,
      },
    });
    return {
      certificateId: certificate.id,
      documentId: document.id,
      duplicate: false,
    };
  }
}

function inputRequestId(request: DeletionCertificateRequest): string {
  return `deletion-certificate:${request.terminationId}:${request.requestHash}`;
}
