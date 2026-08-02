import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { uuidV7 } from "@clockwork/contracts";
import { demoPersonas } from "@clockwork/testing/personas";
import {
  findDemoProductionMarker,
  type DemoAdapterState,
  type DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { configuredDemoStateStore } from "./demo-state-store";
import {
  configuredEvidenceGateway,
  type EvidenceGateway,
} from "./evidence-gateway";
import {
  ExperienceProblem,
  type EsignReturnStatus,
  type EvidenceUploadRecord,
} from "./model";
import { DatabaseExperienceRepository } from "./repository";
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
 * The two demo-only collections. They are optional keys on the existing demo
 * state, so the schema version is unchanged and a store written by an older
 * build still parses. A reset drops them with everything else.
 */
interface DemoExperienceState extends DemoAdapterState {
  readonly esignCorrelations?: Readonly<Record<string, DemoEsignCorrelation>>;
  readonly evidenceUploads?: Readonly<Record<string, DemoEvidenceUpload>>;
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

/** A deterministic identifier shaped like the UUIDs the contract accepts. */
function demoUuid(seed: string): string {
  const hash = createHash("sha256").update(seed, "utf8").digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
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

  public createRenderRequest(): never {
    return unavailable("Document rendering");
  }

  public findRenderRequest(): never {
    return unavailable("Document rendering");
  }

  public claimRenderRequest(): never {
    return unavailable("Document rendering");
  }

  public failRenderRequest(): never {
    return unavailable("Document rendering");
  }

  public storeArtifact(): never {
    return unavailable("Document rendering");
  }

  public findArtifact(): never {
    return unavailable("Artifact download");
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
