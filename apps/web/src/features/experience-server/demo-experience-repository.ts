import "server-only";
// i18n-exempt-file: demo mirror of the experience repository: API problem titles (integrator contract; the interface maps `code`, see contracts/error-text.ts) and the bytes of a fixture PDF (rule 5).

import { createHash, randomBytes } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import type { InvoiceDerivation } from "@clockwork/db";
import { uuidV7 } from "@clockwork/contracts";
import {
  renderAuthorizedCommerceDocument,
  type CommerceDocumentInput,
} from "@clockwork/documents";
import { demoPersonas } from "@clockwork/testing/personas";
import {
  findDemoProductionMarker,
  type DemoAdapterState,
  type DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import {
  artifactSourceHash,
  commercialArtifactSource,
  verifyResolvedArtifactSource,
  type ResolvedArtifactSource,
} from "./artifact-sources";
import {
  demoArtifactById,
  demoArtifactBySubject,
  demoPlatformIssuer,
  demoUuid,
  type DemoArtifactFixture,
} from "./demo-artifact-catalog";
import type { DemoCommercialArtifactRequest } from "./demo-order-acceptance";
import type { DemoQuoteCommercialArtifactRequest } from "./demo-quote-flow";
import { configuredDemoStateStore } from "./demo-state-store";
import {
  configuredEvidenceGateway,
  type EvidenceGateway,
} from "./evidence-gateway";
import {
  ExperienceProblem,
  type ArtifactKind,
  type ArtifactRepresentation,
  type EsignReturnStatus,
  type EvidenceUploadRecord,
  type ExperienceAudience,
} from "./model";
import {
  DatabaseExperienceRepository,
  type ArtifactDownloadRecord,
  type RenderRequestRecord,
} from "./repository";
import type { ExperienceRepository } from "./repository-port";

export interface DemoEsignCorrelation {
  readonly envelopeId: string;
  readonly agreementId: string;
  readonly accountId: string;
  readonly documentId: string;
  readonly signerUserId: string;
  readonly signerEmail: string;
  readonly state: "pending" | "completed";
  readonly signedDocumentId: string | null;
  readonly completionCertificateDocumentId: string | null;
  readonly expiresAt: string;
  readonly updatedAt: string;
}

interface DemoEvidenceUpload extends EvidenceUploadRecord {
  readonly idempotencyKey: string;
}

/**
 * A stored render request and the token of the write that produced it.
 *
 * The token is what makes a compare-and-swap answerable. The demo store may
 * replay an updater when its own CAS retries, so an updater cannot report its
 * own outcome; and reading the committed row back is not enough either,
 * because a CONCURRENT claim leaves the row in exactly the state this call
 * wanted. Only "the committed version carries my token" distinguishes the two,
 * which is what `update ... where row_version = $n returning row_version`
 * gives the persisted path for free.
 */
interface DemoRenderRequestEntry {
  readonly record: RenderRequestRecord;
  readonly writeToken: string;
}

/**
 * The two demo-only collections. They are optional keys on the existing demo
 * state, so the schema version is unchanged and a store written by an older
 * build still parses. A reset drops them with everything else.
 */
interface DemoExperienceState extends DemoAdapterState {
  readonly commercialArtifactRequests?: Readonly<
    Record<
      string,
      DemoCommercialArtifactRequest | DemoQuoteCommercialArtifactRequest
    >
  >;
  readonly esignCorrelations?: Readonly<Record<string, DemoEsignCorrelation>>;
  readonly evidenceUploads?: Readonly<Record<string, DemoEvidenceUpload>>;
  readonly renderRequests?: Readonly<Record<string, DemoRenderRequestEntry>>;
  readonly artifactDeliveries?: Readonly<
    Record<string, ArtifactRepresentation>
  >;
}

function unavailable(capability: string): never {
  throw new ExperienceProblem(
    503,
    "DEMO_CAPABILITY_UNAVAILABLE",
    `${capability} is not available in the demo`,
  );
}

function stateKey(opaqueState: string): string {
  return createHash("sha256").update(opaqueState, "utf8").digest("hex");
}

function demoSignerEmail(session: SessionClaims): string {
  return (
    Object.values(demoPersonas).find(
      (persona) => persona.userId === session.userId,
    )?.email ?? "demo.signer@fil-one-demo.test"
  );
}

function demoSignedPdfBytes(): Uint8Array {
  const content =
    "BT /F1 20 Tf 72 720 Td (Fil One Commerce) Tj ET\n" +
    "BT /F1 12 Tf 72 692 Td (Demo signed agreement) Tj ET\n" +
    "BT /F1 10 Tf 72 668 Td (Fixture document. No legal effect.) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  // Every byte is ASCII, so string length and byte offset agree and the xref
  // table can be built from the assembled text.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const signedDocument = demoSignedPdfBytes();
const signedDocumentHash = createHash("sha256")
  .update(signedDocument)
  .digest("hex");

/**
 * A demo fixture, finalized into exactly the shape the persisted artifact
 * pipeline produces.
 *
 * The hash discipline is the production one, function for function:
 * `artifactSourceHash` over the canonical document with the record hash zeroed,
 * the hash written back into `verification.recordHash`, and
 * `verifyResolvedArtifactSource` asserting the round trip. That matters because
 * `renderAuthorizedCommerceDocument` refuses to render a document whose record
 * hash differs from the source hash it was authorized against — the demo goes
 * through that refusal rather than around it.
 */
async function resolveDemoArtifactSource(
  fixture: DemoArtifactFixture,
): Promise<ResolvedArtifactSource> {
  const body = await fixture.document();
  const draft = {
    ...body,
    verification: {
      recordHash: "0".repeat(64),
      objectVersion: fixture.sourceVersion,
    },
  } as CommerceDocumentInput;
  const sourceHash = artifactSourceHash({
    kind: fixture.kind,
    subjectType: fixture.subjectType,
    subjectId: fixture.subjectId,
    sourceVersion: fixture.sourceVersion,
    document: draft,
  });
  const resolved: ResolvedArtifactSource = {
    accountId: fixture.accountId,
    audience: fixture.audience,
    audienceAccountId: fixture.accountId,
    subjectType: fixture.subjectType,
    subjectId: fixture.subjectId,
    kind: fixture.kind,
    sourceVersion: fixture.sourceVersion,
    sourceHash,
    retainUntil: fixture.retainUntil,
    input: {
      ...draft,
      verification: { ...draft.verification, recordHash: sourceHash },
    },
  };
  verifyResolvedArtifactSource(resolved);
  return resolved;
}

/**
 * The audience-scope test `resolveArtifactSource` applies on the persisted
 * path, restated against fixtures rather than rows.
 *
 * It is deliberately the same predicate and not a looser one. A demo that let a
 * customer persona download another account's order form would be showing a
 * behaviour the product refuses, which is the misleading direction.
 */
function assertDemoArtifactScope(
  session: SessionClaims,
  source: {
    accountId: string | null;
    audience: ExperienceAudience;
    audienceAccountId: string | null;
  },
): void {
  const audienceAccountId = source.audienceAccountId;
  const permitted =
    source.audience === "internal"
      ? session.isInternalStaff &&
        session.impersonation === undefined &&
        source.accountId === null &&
        audienceAccountId === null
      : source.accountId !== null &&
        audienceAccountId !== null &&
        !(session.isInternalStaff && !session.impersonation) &&
        (session.impersonation
          ? session.impersonation.accountId === audienceAccountId
          : session.isInternalStaff ||
            session.accountIds.includes(audienceAccountId));
  if (!permitted)
    throw new ExperienceProblem(
      403,
      "ARTIFACT_SCOPE_FORBIDDEN",
      "The artifact source is outside the authorized audience scope",
    );
}

function publicEvidence(record: DemoEvidenceUpload): EvidenceUploadRecord {
  // The idempotency key is internal correlation and never leaves the server.
  const { idempotencyKey, ...rest } = record;
  void idempotencyKey;
  return rest;
}

/**
 * Fixture-backed stand-in for the persisted experience repository. It covers
 * the signing correlations and evidence lifecycle the controller reaches on a
 * demo deploy; every other capability answers with a problem document that says
 * so, rather than failing on an absent database.
 */
export class DemoExperienceRepository implements ExperienceRepository {
  readonly #store: DemoAdapterStateStore;
  readonly #openGateway: () => EvidenceGateway;
  #gateway: EvidenceGateway | undefined;

  public constructor(
    store: DemoAdapterStateStore = configuredDemoStateStore(),
    openGateway: () => EvidenceGateway = configuredEvidenceGateway,
  ) {
    this.#store = store;
    this.#openGateway = openGateway;
  }

  async #read(): Promise<DemoExperienceState> {
    return await this.#store.read();
  }

  #evidenceGateway(): EvidenceGateway {
    this.#gateway ??= this.#openGateway();
    return this.#gateway;
  }

  public invoiceDerivation(): never {
    unavailable("Invoice derivation");
  }

  public accountInvoiceDerivations(): Promise<readonly InvoiceDerivation[]> {
    return Promise.resolve([]);
  }

  public signingTarget(
    session: SessionClaims,
    agreementId: string,
    accountId: string,
    _requestId: string,
  ) {
    return Promise.resolve({
      agreementId,
      accountId,
      documentId: demoUuid(`document:${agreementId}`),
      signerUserId: session.userId,
      signerEmail: demoSignerEmail(session),
    });
  }

  public async createEsignCorrelation(input: {
    session: SessionClaims;
    target: {
      agreementId: string;
      accountId: string;
      documentId: string;
      signerUserId: string;
      signerEmail: string;
    };
    envelopeId: string;
    opaqueState: string;
    expiresAt: string;
    requestId: string;
  }): Promise<void> {
    const key = stateKey(input.opaqueState);
    await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const existing = state.esignCorrelations?.[key];
      if (existing && existing.envelopeId !== input.envelopeId)
        throw new ExperienceProblem(
          409,
          "ESIGN_CORRELATION_CONFLICT",
          "Envelope correlation conflict",
        );
      const next: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        esignCorrelations: {
          ...state.esignCorrelations,
          [key]: existing ?? {
            envelopeId: input.envelopeId,
            agreementId: input.target.agreementId,
            accountId: input.target.accountId,
            documentId: input.target.documentId,
            signerUserId: input.target.signerUserId,
            signerEmail: input.target.signerEmail,
            state: "pending",
            signedDocumentId: null,
            completionCertificateDocumentId: null,
            expiresAt: input.expiresAt,
            updatedAt: new Date().toISOString(),
          },
        },
      };
      return next;
    });
  }

  async #correlation(
    opaqueState: string,
    session: SessionClaims,
    now: Date,
  ): Promise<DemoEsignCorrelation> {
    const correlation = (await this.#read()).esignCorrelations?.[
      stateKey(opaqueState)
    ];
    if (!correlation || correlation.signerUserId !== session.userId)
      throw new ExperienceProblem(
        404,
        "ESIGN_RETURN_NOT_FOUND",
        "Signing return state is invalid",
      );
    if (Date.parse(correlation.expiresAt) <= now.getTime())
      throw new ExperienceProblem(
        410,
        "ESIGN_RETURN_EXPIRED",
        "Signing return state expired",
      );
    return correlation;
  }

  public async readEsignReturn(input: {
    session: SessionClaims;
    opaqueState: string;
    now: Date;
    requestId: string;
  }): Promise<EsignReturnStatus> {
    const correlation = await this.#correlation(
      input.opaqueState,
      input.session,
      input.now,
    );
    return {
      state: correlation.state,
      envelopeId: correlation.envelopeId,
      agreementId: correlation.agreementId,
      documentId: correlation.documentId,
      signedDocumentId: correlation.signedDocumentId,
      completionCertificateDocumentId:
        correlation.completionCertificateDocumentId,
      updatedAt: correlation.updatedAt,
    };
  }

  public async readEsignSignedDocument(input: {
    session: SessionClaims;
    opaqueState: string;
    now: Date;
    requestId: string;
  }) {
    const correlation = await this.#correlation(
      input.opaqueState,
      input.session,
      input.now,
    );
    if (correlation.state !== "completed" || !correlation.signedDocumentId)
      throw new ExperienceProblem(
        404,
        "ESIGN_SIGNED_DOCUMENT_NOT_FOUND",
        "The signed agreement is not available for this return state",
      );
    // The canned bytes are written through the same gateway the controller
    // reads them back from, so the download still verifies hash, length, and
    // MIME type exactly as a provider-returned document does.
    const stored = await this.#evidenceGateway().storeImmutable({
      bytes: signedDocument,
      contentHash: signedDocumentHash,
      mimeType: "application/pdf",
      retainUntil: new Date(
        input.now.getTime() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      accountId: correlation.accountId,
      internalScopeId: correlation.agreementId,
      source: `demo-esign:${correlation.envelopeId}`,
    });
    return {
      envelopeId: correlation.envelopeId,
      agreementId: correlation.agreementId,
      documentId: correlation.signedDocumentId,
      storageKey: stored.storageKey,
      storageVersionId: stored.storageVersionId,
      contentHash: signedDocumentHash,
      byteLength: String(signedDocument.byteLength),
      mimeType: "application/pdf" as const,
      filename: `agreement-${correlation.agreementId}.pdf`,
    };
  }

  /** Ceremony view for the demo signing page, which holds no session. */
  public async readDemoCeremony(
    opaqueState: string,
    now = new Date(),
  ): Promise<DemoEsignCorrelation | undefined> {
    const correlation = (await this.#read()).esignCorrelations?.[
      stateKey(opaqueState)
    ];
    if (!correlation || Date.parse(correlation.expiresAt) <= now.getTime())
      return undefined;
    return correlation;
  }

  /** Marks the ceremony signed. The real return reconciliation still runs. */
  public async completeDemoCeremony(
    opaqueState: string,
    now = new Date(),
  ): Promise<boolean> {
    const key = stateKey(opaqueState);
    // The store may run this updater more than once when its compare-and-swap
    // retries, so the outcome is read from the committed state rather than
    // recorded by the updater itself.
    const committed = (await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const correlation = state.esignCorrelations?.[key];
      if (!correlation || Date.parse(correlation.expiresAt) <= now.getTime())
        return state;
      const next: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        esignCorrelations: {
          ...state.esignCorrelations,
          [key]: {
            ...correlation,
            state: "completed",
            signedDocumentId: demoUuid(`signed:${correlation.envelopeId}`),
            completionCertificateDocumentId: demoUuid(
              `certificate:${correlation.envelopeId}`,
            ),
            updatedAt: now.toISOString(),
          },
        },
      };
      return next;
    })) as DemoExperienceState;
    return committed.esignCorrelations?.[key]?.state === "completed";
  }

  public async reserveEvidence(input: {
    session: SessionClaims;
    accountId: string | null;
    organizationId: string | null;
    journey: EvidenceUploadRecord["journey"];
    targetId: string;
    kind: EvidenceUploadRecord["kind"];
    contentHash: string;
    mimeType: string;
    byteLength: number;
    retainUntil: string;
    expiresAt: string;
    legalHold: boolean;
    idempotencyKey: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const existing = Object.values(
      (await this.#read()).evidenceUploads ?? {},
    ).find(
      (record) =>
        record.ownerUserId === input.session.userId &&
        record.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      if (
        existing.contentHash !== input.contentHash ||
        existing.targetId !== input.targetId ||
        existing.kind !== input.kind
      )
        throw new ExperienceProblem(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Idempotency key was already used for different evidence",
        );
      return publicEvidence(existing);
    }
    const uploadId = `upl_${randomBytes(24).toString("base64url")}`;
    const record: DemoEvidenceUpload = {
      id: uuidV7(),
      uploadId,
      providerUploadId: null,
      ownerUserId: input.session.userId,
      accountId: input.accountId,
      journey: input.journey,
      targetId: input.targetId,
      kind: input.kind,
      contentHash: input.contentHash,
      mimeType: input.mimeType,
      byteLength: String(input.byteLength),
      retainUntil: input.retainUntil,
      expiresAt: input.expiresAt,
      legalHold: input.legalHold,
      status: "pending",
      scanReference: null,
      documentId: null,
      immutableStorageKey: null,
      storageVersionId: null,
      version: 1,
      idempotencyKey: input.idempotencyKey,
    };
    await this.#write(record);
    return publicEvidence(record);
  }

  async #write(record: DemoEvidenceUpload): Promise<void> {
    await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const next: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        evidenceUploads: {
          ...state.evidenceUploads,
          [record.uploadId]: record,
        },
      };
      return next;
    });
  }

  async #owned(
    session: SessionClaims,
    uploadId: string,
  ): Promise<DemoEvidenceUpload> {
    const record = (await this.#read()).evidenceUploads?.[uploadId];
    if (!record || record.ownerUserId !== session.userId)
      throw new ExperienceProblem(
        404,
        "EVIDENCE_UPLOAD_NOT_FOUND",
        "Evidence upload not found",
      );
    return record;
  }

  async #transition(
    session: SessionClaims,
    uploadId: string,
    from: readonly EvidenceUploadRecord["status"][],
    change: (record: DemoEvidenceUpload) => DemoEvidenceUpload,
  ): Promise<EvidenceUploadRecord> {
    const current = await this.#owned(session, uploadId);
    if (!from.includes(current.status))
      throw new ExperienceProblem(
        409,
        "EVIDENCE_VERSION_CONFLICT",
        "Evidence upload changed",
      );
    const next = { ...change(current), version: current.version + 1 };
    await this.#write(next);
    return publicEvidence(next);
  }

  public async readEvidence(
    session: SessionClaims,
    uploadId: string,
    _requestId: string,
  ): Promise<EvidenceUploadRecord> {
    return publicEvidence(await this.#owned(session, uploadId));
  }

  public bindEvidenceProvider(input: {
    session: SessionClaims;
    uploadId: string;
    providerUploadId: string;
    quarantineKey: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    return this.#transition(
      input.session,
      input.uploadId,
      ["pending"],
      (record) => ({
        ...record,
        providerUploadId: input.providerUploadId,
        status: "uploaded",
      }),
    );
  }

  public async markEvidenceScanning(
    session: SessionClaims,
    uploadId: string,
    _requestId: string,
  ): Promise<EvidenceUploadRecord> {
    const current = await this.#owned(session, uploadId);
    if (current.status === "promoted" || current.status === "quarantined")
      return publicEvidence(current);
    return this.#transition(session, uploadId, ["uploaded"], (record) => ({
      ...record,
      status: "scanning",
    }));
  }

  public async expireEvidence(
    session: SessionClaims,
    uploadId: string,
    _requestId: string,
  ): Promise<EvidenceUploadRecord> {
    const current = await this.#owned(session, uploadId);
    if (
      ["expired", "promoted", "quarantined", "failed"].includes(current.status)
    )
      return publicEvidence(current);
    return this.#transition(
      session,
      uploadId,
      ["pending", "uploaded", "scanning"],
      (record) => ({ ...record, status: "expired" }),
    );
  }

  public async quarantineEvidence(input: {
    session: SessionClaims;
    uploadId: string;
    scanReference: string;
    failureCode: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const current = await this.#owned(input.session, input.uploadId);
    if (current.status === "quarantined") return publicEvidence(current);
    return this.#transition(
      input.session,
      input.uploadId,
      ["scanning"],
      (record) => ({
        ...record,
        status: "quarantined",
        scanReference: input.scanReference,
      }),
    );
  }

  public async promoteEvidence(input: {
    session: SessionClaims;
    uploadId: string;
    immutableStorageKey: string;
    storageVersionId: string;
    scanReference: string;
    requestId: string;
  }): Promise<EvidenceUploadRecord> {
    const current = await this.#owned(input.session, input.uploadId);
    if (current.status === "promoted") return publicEvidence(current);
    return this.#transition(
      input.session,
      input.uploadId,
      ["scanning"],
      (record) => ({
        ...record,
        status: "promoted",
        immutableStorageKey: input.immutableStorageKey,
        storageVersionId: input.storageVersionId,
        scanReference: input.scanReference,
        documentId: demoUuid(`evidence:${record.uploadId}`),
      }),
    );
  }

  /* ----------------------------------------------------------------------
   * Documents
   *
   * The demo renders the same fifteen document kinds the product renders,
   * through the same `@clockwork/documents` renderer, from the same
   * `CommerceDocumentInput` the persisted pipeline assembles. What differs is
   * only where the inputs come from: fixtures instead of rows.
   * ------------------------------------------------------------------- */

  async #renderRequestState(
    id: string,
  ): Promise<RenderRequestRecord | undefined> {
    const stored = (await this.#read()).renderRequests?.[id]?.record;
    if (!stored) return undefined;
    // The persisted reader re-verifies every request it hands back, so a
    // corrupted store cannot feed a document body into the renderer. The demo
    // store is a file a presenter can edit, which is if anything more exposed.
    verifyResolvedArtifactSource({
      kind: stored.kind,
      subjectType: stored.subjectType,
      subjectId: stored.subjectId,
      sourceVersion: stored.sourceVersion,
      input: stored.input as unknown as CommerceDocumentInput,
      sourceHash: stored.sourceHash,
    });
    return stored;
  }

  async #putRenderRequest(record: RenderRequestRecord): Promise<void> {
    const writeToken = randomBytes(16).toString("hex");
    await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      // An existing request is never overwritten: the persisted insert is
      // `on conflict do nothing` and replays the row it found.
      if (state.renderRequests?.[record.id]) return state;
      const next: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        renderRequests: {
          ...state.renderRequests,
          [record.id]: { record, writeToken },
        },
      };
      return next;
    });
  }

  /**
   * Applies a compare-and-swap to a render request, exactly as the persisted
   * `update ... where status in (...) and row_version = $n` does. The store may
   * replay an updater when its own compare-and-swap retries, so the outcome is
   * read from the committed state rather than recorded by the updater.
   */
  async #transitionRenderRequest(
    id: string,
    from: readonly RenderRequestRecord["status"][],
    expectedVersion: number,
    next: (record: RenderRequestRecord) => RenderRequestRecord,
  ): Promise<RenderRequestRecord> {
    const writeToken = randomBytes(16).toString("hex");
    const committed = (await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const entry = state.renderRequests?.[id];
      if (
        !entry ||
        !from.includes(entry.record.status) ||
        entry.record.version !== expectedVersion
      )
        return state;
      const updated = {
        ...next(entry.record),
        version: entry.record.version + 1,
      };
      const value: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        renderRequests: {
          ...state.renderRequests,
          [id]: { record: updated, writeToken },
        },
      };
      return value;
    })) as DemoExperienceState;
    const result = committed.renderRequests?.[id];
    if (!result || result.writeToken !== writeToken)
      throw new ExperienceProblem(
        409,
        "RENDER_VERSION_CONFLICT",
        "Render request changed",
      );
    return result.record;
  }

  /**
   * The artifact source for a subject, whether it was seeded or prepared here.
   *
   * A form a prospect prepared during this demo is a source in exactly the way
   * a catalogue fixture is, and both render call sites have to see it: the
   * on-read download AND this two-step pipeline. Answering the two-step with
   * `ARTIFACT_SOURCE_NOT_FOUND` for a document the demo had just composed
   * would be the demo disagreeing with itself about what exists.
   */
  async #subjectSource(
    kind: ArtifactKind,
    subjectId: string,
  ): Promise<ResolvedArtifactSource | undefined> {
    if (
      kind === "order_form" ||
      kind === "direct_quote" ||
      kind === "partner_transfer_quote" ||
      kind === "partner_resale_quote"
    ) {
      const request = Object.values(
        (await this.#read()).commercialArtifactRequests ?? {},
      ).find(
        (candidate) =>
          candidate.subjectId === subjectId && candidate.documentKind === kind,
      );
      if (request) return (await this.#preparedArtifact(request.id))?.source;
    }
    const fixture = demoArtifactBySubject(kind, subjectId);
    return fixture ? resolveDemoArtifactSource(fixture) : undefined;
  }

  public async createRenderRequest(input: {
    session: SessionClaims;
    source: {
      kind: ArtifactKind;
      subjectId: string;
      expectedVersion: string;
      audience: ExperienceAudience;
      accountId: string | null;
    };
    requestId: string;
  }): Promise<RenderRequestRecord> {
    const source = await this.#subjectSource(
      input.source.kind,
      input.source.subjectId,
    );
    if (!source)
      throw new ExperienceProblem(
        404,
        "ARTIFACT_SOURCE_NOT_FOUND",
        "No document source exists for that subject",
      );
    if (
      input.source.accountId !== source.accountId ||
      input.source.audience !== source.audience
    )
      throw new ExperienceProblem(
        403,
        "ARTIFACT_SCOPE_FORBIDDEN",
        "The artifact source is outside the authorized audience scope",
      );
    assertDemoArtifactScope(input.session, source);
    if (source.sourceVersion !== input.source.expectedVersion)
      throw new ExperienceProblem(
        409,
        "ARTIFACT_SOURCE_VERSION_CONFLICT",
        "The artifact source changed; reload before requesting a render",
      );
    // The persisted table is unique on (subject_type, subject_id,
    // document_kind, source_hash) and replays the existing row, so the demo
    // derives its identifier from the same four values and does the same.
    const id = demoUuid(
      `render-request:${source.subjectType}:${source.subjectId}:${source.kind}:${source.sourceHash}`,
    );
    const existing = await this.#renderRequestState(id);
    if (existing) return existing;
    const record: RenderRequestRecord = {
      id,
      accountId: source.accountId,
      audience: source.audience,
      audienceAccountId: source.audienceAccountId,
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      kind: source.kind,
      input: source.input as unknown as Readonly<Record<string, unknown>>,
      sourceHash: source.sourceHash,
      sourceVersion: source.sourceVersion,
      retainUntil: source.retainUntil,
      status: "pending",
      version: 1,
    };
    await this.#putRenderRequest(record);
    return (await this.#renderRequestState(id)) ?? record;
  }

  public async findRenderRequest(
    session: SessionClaims,
    id: string,
    _requestId: string,
  ): Promise<RenderRequestRecord> {
    const record = await this.#renderRequestState(id);
    if (!record)
      throw new ExperienceProblem(
        404,
        "RENDER_REQUEST_NOT_FOUND",
        "Render request not found",
      );
    assertDemoArtifactScope(session, record);
    return record;
  }

  public async claimRenderRequest(
    request: RenderRequestRecord,
    _requestId: string,
  ): Promise<void> {
    await this.#transitionRenderRequest(
      request.id,
      ["pending", "failed"],
      request.version,
      (record) => ({ ...record, status: "rendering" }),
    );
  }

  public async failRenderRequest(
    request: RenderRequestRecord,
    _failureCode: string,
    _requestId: string,
  ): Promise<void> {
    // The claim already advanced the row, so the failure transition expects the
    // claimed version, matching `row_version = ${request.version + 1}` on the
    // persisted path.
    await this.#transitionRenderRequest(
      request.id,
      ["rendering"],
      request.version + 1,
      (record) => ({ ...record, status: "failed" }),
    );
  }

  public async storeArtifact(input: {
    request: RenderRequestRecord;
    contentHash: string;
    byteLength: number;
    filename: string;
    immutableVersion: string;
    storageKey: string;
    storageVersionId: string;
    requestId: string;
  }): Promise<ArtifactRepresentation> {
    // The download identifier for this subject: the catalogue fixture's own,
    // or -- for a form prepared during this demo -- the artifact request that
    // composed it, which is what the download route resolves for those.
    const deliveryId =
      demoArtifactBySubject(input.request.kind, input.request.subjectId)?.id ??
      Object.values((await this.#read()).commercialArtifactRequests ?? {}).find(
        (candidate) =>
          candidate.subjectId === input.request.subjectId &&
          candidate.documentKind === input.request.kind,
      )?.id;
    if (!deliveryId)
      throw new ExperienceProblem(
        404,
        "ARTIFACT_SOURCE_NOT_FOUND",
        "No document source exists for that subject",
      );
    const documentId = input.request.input.documentId;
    const representation: ArtifactRepresentation = {
      id: deliveryId,
      kind: input.request.kind,
      subjectType: input.request.subjectType,
      subjectId: input.request.subjectId,
      accountId: input.request.accountId,
      audience: input.request.audience,
      audienceAccountId: input.request.audienceAccountId,
      documentId: typeof documentId === "string" ? documentId : deliveryId,
      version: input.immutableVersion,
      sourceHash: input.request.sourceHash,
      contentHash: input.contentHash,
      mimeType: "application/pdf",
      byteLength: String(input.byteLength),
      filename: input.filename,
      retainUntil: input.request.retainUntil,
      createdAt: new Date().toISOString(),
      downloadHref: `/api/experience/artifacts/${input.request.kind}/${deliveryId}`,
    };
    await this.#transitionRenderRequest(
      input.request.id,
      ["rendering"],
      input.request.version + 1,
      (record) => ({ ...record, status: "stored" }),
    );
    await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const next: DemoExperienceState = {
        ...state,
        revision: state.revision + 1,
        artifactDeliveries: {
          ...state.artifactDeliveries,
          [representation.id]: representation,
        },
      };
      return next;
    });
    return representation;
  }

  /**
   * The download.
   *
   * It renders and stores on read rather than looking for bytes an earlier
   * request left behind. That is not a shortcut: the demo's immutable store is
   * process-local, so a serverless instance that did not serve the render would
   * answer a perfectly valid download link with "artifact not found" — a dead
   * link on the one journey this whole file exists to open. Rendering is
   * deterministic and content addressed, so re-rendering produces the identical
   * bytes, hash and storage key the first render produced.
   */
  /**
   * An order form a prospect prepared during this demo, resolved the way the
   * persisted download resolves one: by the artifact request identifier.
   *
   * `commercialArtifactSource` is the same translation the database path runs
   * over `core_commercial_artifact_requests.source_definition`. Only the row
   * comes from somewhere else.
   */
  async #preparedArtifact(id: string): Promise<
    | {
        source: ResolvedArtifactSource;
        request:
          DemoCommercialArtifactRequest | DemoQuoteCommercialArtifactRequest;
      }
    | undefined
  > {
    const request = (await this.#read()).commercialArtifactRequests?.[id];
    if (!request) return undefined;
    return {
      request,
      source: commercialArtifactSource({
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        audienceAccountId: request.audienceAccountId,
        audience: request.audience === "partner" ? "partner" : "customer",
        kind: request.documentKind,
        definition: request.definition,
        sourceHash: request.sourceHash,
        retainUntil: request.retainUntil,
        issuer: demoPlatformIssuer,
      }),
    };
  }

  public async findArtifact(
    session: SessionClaims,
    kind: ArtifactKind,
    id: string,
    requestId: string,
  ): Promise<ArtifactDownloadRecord> {
    const prepared =
      kind === "order_form" ||
      kind === "direct_quote" ||
      kind === "partner_transfer_quote" ||
      kind === "partner_resale_quote"
        ? await this.#preparedArtifact(id)
        : undefined;
    if (prepared)
      return this.#download(session, prepared.source, requestId, {
        id,
        documentId: prepared.request.documentId,
        createdAt: prepared.request.createdAt,
        retainUntil: prepared.request.retainUntil,
      });
    const fixture = demoArtifactById(kind, id);
    if (!fixture)
      throw new ExperienceProblem(
        404,
        "ARTIFACT_NOT_FOUND",
        "Artifact not found",
      );
    return this.#download(
      session,
      await resolveDemoArtifactSource(fixture),
      requestId,
      {
        id: fixture.id,
        createdAt: fixture.createdAt,
        retainUntil: fixture.retainUntil,
      },
    );
  }

  async #download(
    session: SessionClaims,
    source: ResolvedArtifactSource,
    requestId: string,
    entry: {
      id: string;
      documentId?: string;
      createdAt: string;
      retainUntil: string;
    },
  ): Promise<ArtifactDownloadRecord> {
    assertDemoArtifactScope(session, source);
    const rendered = await renderAuthorizedCommerceDocument(source.input, {
      actorUserId: session.userId,
      accountId: source.accountId,
      accountIds: session.impersonation
        ? [session.impersonation.accountId]
        : session.accountIds,
      isInternalStaff: session.isInternalStaff,
      audience: source.audience,
      audienceAccountId: source.audienceAccountId,
      kind: source.kind,
      sourceHash: source.sourceHash,
      requestId,
    });
    const stored = await this.#evidenceGateway().storeImmutable({
      bytes: rendered.bytes,
      contentHash: rendered.contentHash,
      mimeType: rendered.mimeType,
      retainUntil: entry.retainUntil,
      accountId: source.accountId,
      internalScopeId: source.subjectId,
      source: `demo-render:${entry.id}`,
    });
    const representation: ArtifactRepresentation = {
      id: entry.id,
      kind: source.kind,
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      accountId: source.accountId,
      audience: source.audience,
      audienceAccountId: source.audienceAccountId,
      // A commercial definition's `displayDocumentId` is printable paper
      // identity (`ORD-…`), not the UUID of the immutable document row. The
      // persisted demo request carries that UUID just like production does;
      // publish it when this artifact came from a two-pass order prepare.
      documentId: entry.documentId ?? source.input.documentId,
      version: rendered.version,
      sourceHash: source.sourceHash,
      contentHash: rendered.contentHash,
      mimeType: "application/pdf",
      byteLength: String(rendered.bytes.byteLength),
      filename: rendered.fileName,
      retainUntil: entry.retainUntil,
      createdAt: entry.createdAt,
      downloadHref: `/api/experience/artifacts/${source.kind}/${entry.id}`,
    };
    await this.#store.update((current) => {
      const state = current as DemoExperienceState;
      const prior = state.artifactDeliveries?.[entry.id];
      if (
        prior?.contentHash === representation.contentHash &&
        prior.sourceHash === representation.sourceHash &&
        prior.documentId === representation.documentId
      )
        return state;
      return {
        ...state,
        revision: state.revision + 1,
        artifactDeliveries: {
          ...state.artifactDeliveries,
          [entry.id]: representation,
        },
      } satisfies DemoExperienceState;
    });
    return {
      representation,
      storageKey: stored.storageKey,
      storageVersionId: stored.storageVersionId,
    };
  }
}

export function demoExperienceEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    environment.CLOCKWORK_EXPERIENCE_ADAPTER?.trim() === "demo" &&
    !findDemoProductionMarker(environment)
  );
}

let demoRepository: DemoExperienceRepository | undefined;

export function demoExperienceRepository(): DemoExperienceRepository {
  demoRepository ??= new DemoExperienceRepository();
  return demoRepository;
}

/**
 * Chooses the repository the same way the projection source chooses its data:
 * an explicit demo adapter selection, refused whenever the environment reports
 * production through any of its own markers.
 */
export function configuredExperienceRepository(): ExperienceRepository {
  const adapter = process.env.CLOCKWORK_EXPERIENCE_ADAPTER?.trim();
  if (adapter === "demo") {
    const productionMarker = findDemoProductionMarker(process.env);
    if (productionMarker)
      throw new ExperienceProblem(
        503,
        "DEMO_ADAPTER_FORBIDDEN",
        `Demo experience records are disabled because ${productionMarker} identifies production`,
      );
    return demoExperienceRepository();
  }
  return new DatabaseExperienceRepository();
}
