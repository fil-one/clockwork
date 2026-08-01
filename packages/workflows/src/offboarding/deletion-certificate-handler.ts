import { IdempotencyKeySchema } from "@clockwork/contracts";
import type {
  DeletionCertificateIssueResult,
  DeletionCertificateRequest,
  PersistedDeletionCertificateArtifact,
} from "@clockwork/db";
import { DeletionCertificateRequestSchema } from "@clockwork/db";
import type {
  EvidenceObject,
  EvidenceStoragePort,
} from "@clockwork/integrations";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const CertificateOutboxPayloadSchema = z.object({
  eventType: z.literal("termination.deletion_certificate_requested"),
  data: z.object({
    certificateRequest: DeletionCertificateRequestSchema,
  }),
});

export interface DeletionCertificatePersistencePort {
  issue(input: {
    request: DeletionCertificateRequest;
    artifact: PersistedDeletionCertificateArtifact;
    requestId: string;
  }): Promise<DeletionCertificateIssueResult>;
}

export interface DeletionCertificateRenderer {
  render(
    request: DeletionCertificateRequest,
    presentation: {
      issuer: DeletionCertificateParty;
      brand?: DeletionCertificateBrand;
      locale: DeletionCertificateLocale;
    },
  ): Promise<RenderedDeletionCertificate>;
}

export type DeletionCertificateLocale = "en-US" | "en-GB" | "en-IE" | "es-ES";

export interface DeletionCertificateParty {
  legalName: string;
  address: {
    line1: string;
    line2?: string | undefined;
    locality: string;
    region?: string | undefined;
    postalCode: string;
    countryCode: string;
  };
  taxId?: string | undefined;
  contactName?: string | undefined;
  contactEmail?: string | undefined;
}

export interface DeletionCertificateBrand {
  wordmark: string;
  legalName: string;
  /** Base64 PNG or JPEG data URI; remote URLs are rejected by the renderer. */
  logo?: string;
  accentColor?: `#${string}`;
  supportEmail?: string;
  legalFooter?: string;
}

export interface RenderedDeletionCertificate {
  bytes: Uint8Array;
  contentHash: string;
  mimeType: "application/pdf";
}

function validateStoredEvidence(
  stored: EvidenceObject,
  request: DeletionCertificateRequest,
  rendered: RenderedDeletionCertificate,
): void {
  if (
    stored.documentId.length === 0 ||
    stored.storageKey.length === 0 ||
    stored.versionId.length === 0 ||
    stored.metadata.kind !== "deletion_certificate" ||
    stored.metadata.contentHash !== rendered.contentHash ||
    stored.metadata.contentType !== rendered.mimeType ||
    stored.metadata.retainUntil !== request.retainUntil ||
    stored.metadata.legalHold ||
    stored.metadata.scope.kind !== "account" ||
    stored.metadata.scope.id !== request.accountId ||
    stored.metadata.scanStatus !== "clean"
  )
    throw new Error("DELETION_CERTIFICATE_STORAGE_EVIDENCE_INVALID");
}

export function createDeletionCertificateOutboxHandler(input: {
  evidence: EvidenceStoragePort;
  persistence: DeletionCertificatePersistencePort;
  issuer: DeletionCertificateParty;
  brand?: DeletionCertificateBrand;
  locale?: DeletionCertificateLocale;
  automatedTeardownEnabled: boolean;
  renderer: DeletionCertificateRenderer;
}): OutboxTopicHandler {
  if (!input.automatedTeardownEnabled)
    throw new Error("AUTOMATED_TEARDOWN_EXTERNALLY_GATED");
  return async (invocation) => {
    if (invocation.topic !== "termination.deletion_certificate_requested")
      throw new Error("DELETION_CERTIFICATE_TOPIC_INVALID");
    const payload = CertificateOutboxPayloadSchema.parse(invocation.payload);
    const request = payload.data.certificateRequest;
    const rendered = await input.renderer.render(request, {
      issuer: input.issuer,
      ...(input.brand ? { brand: input.brand } : {}),
      locale: input.locale ?? "en-US",
    });
    if (
      createHash("sha256").update(rendered.bytes).digest("hex") !==
      rendered.contentHash
    )
      throw new Error("DELETION_CERTIFICATE_RENDER_HASH_INVALID");
    const stored = await input.evidence.putImmutable({
      kind: "deletion_certificate",
      bytes: rendered.bytes,
      contentHash: rendered.contentHash,
      contentType: rendered.mimeType,
      retainUntil: request.retainUntil,
      legalHold: false,
      source: `termination:${request.terminationId}:teardown-confirmation`,
      scope: { kind: "account", id: request.accountId },
      idempotencyKey: IdempotencyKeySchema.parse(
        `deletion-certificate:${request.requestHash}`,
      ),
    });
    if (!stored.ok)
      throw new Error(`DELETION_CERTIFICATE_STORAGE_FAILED:${stored.code}`);
    validateStoredEvidence(stored.value, request, rendered);
    await input.persistence.issue({
      request,
      artifact: {
        documentId: stored.value.documentId,
        storageKey: stored.value.storageKey,
        storageVersionId: stored.value.versionId,
        contentHash: rendered.contentHash,
        mimeType: "application/pdf",
        byteLength: rendered.bytes.byteLength,
        retainUntil: request.retainUntil,
        legalHold: false,
      },
      requestId: invocation.idempotencyKey,
    });
  };
}
import { createHash } from "node:crypto";
