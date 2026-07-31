import { IdempotencyKeySchema } from "@clockwork/contracts";
import type {
  CommercialArtifactIssueResult,
  CommercialArtifactRequest,
  PersistedCommercialArtifact,
} from "@clockwork/db";
import {
  commercialArtifactSourceHash,
  CommercialArtifactRequestSchema,
} from "@clockwork/db";
import type {
  EvidenceObject,
  EvidenceStoragePort,
} from "@clockwork/integrations";
import { z } from "zod";

import type { OutboxTopicHandler } from "../system/outbox-dispatcher";

const ArtifactRequestPayloadSchema = z.object({
  eventType: z.literal("commerce.commercial_artifact_requested"),
  data: z.object({ artifactRequest: CommercialArtifactRequestSchema }),
});

export interface CommercialArtifactPersistencePort {
  issue(input: {
    request: CommercialArtifactRequest;
    artifact: PersistedCommercialArtifact;
    requestId: string;
  }): Promise<CommercialArtifactIssueResult>;
}

export interface CommercialArtifactRenderer {
  render(input: {
    request: CommercialArtifactRequest;
    platformIssuer: CommercialArtifactParty;
  }): Promise<RenderedCommercialArtifact>;
}

export type CommercialArtifactParty =
  CommercialArtifactRequest["sourceDefinition"]["recipient"];

export interface RenderedCommercialArtifact {
  bytes: Uint8Array;
  contentHash: string;
  recordHash: string;
  documentId: string;
  version: string;
  mimeType: "application/pdf";
}

function evidenceKind(
  kind: CommercialArtifactRequest["documentKind"],
): "quote" | "order_form" | "amendment" {
  switch (kind) {
    case "direct_quote":
    case "partner_transfer_quote":
    case "partner_resale_quote":
      return "quote";
    case "order_form":
    case "amendment":
      return kind;
  }
}

function validateDefinitionBoundary(request: CommercialArtifactRequest): void {
  const definition = request.sourceDefinition;
  if (definition.kind !== request.documentKind)
    throw new Error("COMMERCIAL_ARTIFACT_DEFINITION_KIND_MISMATCH");
  if (definition.issuerMode === "partner") {
    if (definition.kind !== "partner_resale_quote" || !definition.partnerIssuer)
      throw new Error("COMMERCIAL_ARTIFACT_ISSUER_BOUNDARY_INVALID");
  } else if (definition.partnerIssuer)
    throw new Error("COMMERCIAL_ARTIFACT_ISSUER_BOUNDARY_INVALID");
}

function validateStoredEvidence(
  stored: EvidenceObject,
  request: CommercialArtifactRequest,
  rendered: RenderedCommercialArtifact,
): void {
  if (
    stored.documentId.length === 0 ||
    stored.storageKey.length === 0 ||
    stored.versionId.length === 0 ||
    stored.metadata.kind !== evidenceKind(request.documentKind) ||
    stored.metadata.contentHash !== rendered.contentHash ||
    stored.metadata.contentType !== "application/pdf" ||
    stored.metadata.retainUntil !== request.retainUntil ||
    stored.metadata.legalHold ||
    stored.metadata.scope.kind !== "account" ||
    stored.metadata.scope.id !== request.audienceAccountId ||
    stored.metadata.source !== `commercial-artifact:${request.requestId}` ||
    stored.metadata.scanStatus !== "clean"
  )
    throw new Error("COMMERCIAL_ARTIFACT_STORAGE_METADATA_INVALID");
}

export function createCommercialArtifactOutboxHandler(input: {
  evidence: EvidenceStoragePort;
  persistence: CommercialArtifactPersistencePort;
  platformIssuer: CommercialArtifactParty;
  renderer: CommercialArtifactRenderer;
}): OutboxTopicHandler {
  return async (invocation) => {
    if (invocation.topic !== "commerce.commercial_artifact_requested")
      throw new Error("COMMERCIAL_ARTIFACT_TOPIC_INVALID");
    const payload = ArtifactRequestPayloadSchema.parse(invocation.payload);
    const request = payload.data.artifactRequest;
    if (
      commercialArtifactSourceHash(request.sourceDefinition) !==
      request.sourceHash
    )
      throw new Error("COMMERCIAL_ARTIFACT_SOURCE_HASH_MISMATCH");
    validateDefinitionBoundary(request);
    const rendered = await input.renderer.render({
      request,
      platformIssuer: input.platformIssuer,
    });
    if (
      createHash("sha256").update(rendered.bytes).digest("hex") !==
        rendered.contentHash ||
      rendered.recordHash !== request.sourceHash ||
      rendered.version !== request.sourceDefinition.documentVersion ||
      rendered.documentId !== request.sourceDefinition.displayDocumentId ||
      rendered.mimeType !== "application/pdf"
    )
      throw new Error("COMMERCIAL_ARTIFACT_RENDER_METADATA_INVALID");
    const stored = await input.evidence.putImmutable({
      kind: evidenceKind(request.documentKind),
      bytes: rendered.bytes,
      contentHash: rendered.contentHash,
      contentType: rendered.mimeType,
      retainUntil: request.retainUntil,
      legalHold: false,
      source: `commercial-artifact:${request.requestId}`,
      scope: { kind: "account", id: request.audienceAccountId },
      idempotencyKey: IdempotencyKeySchema.parse(
        `commercial-artifact:${request.requestHash}`,
      ),
    });
    if (!stored.ok)
      throw new Error(`COMMERCIAL_ARTIFACT_STORAGE_FAILED:${stored.code}`);
    validateStoredEvidence(stored.value, request, rendered);
    await input.persistence.issue({
      request,
      artifact: {
        documentId: stored.value.documentId,
        storageKey: stored.value.storageKey,
        storageVersionId: stored.value.versionId,
        contentHash: rendered.contentHash,
        byteLength: rendered.bytes.byteLength,
        mimeType: "application/pdf",
        retainUntil: request.retainUntil,
        legalHold: false,
      },
      requestId: invocation.idempotencyKey,
    });
  };
}
import { createHash } from "node:crypto";
