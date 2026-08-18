import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { verifyDownloadedArtifact } from "@clockwork/documents";
import { DOCUMENT_KINDS } from "@clockwork/documents/model";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { demoArtifactCatalog } from "./demo-artifact-catalog";
import {
  configuredExperienceRepository,
  DemoExperienceRepository,
} from "./demo-experience-repository";
import { DemoEvidenceGateway } from "./evidence-gateway";
import { ExperienceProblem } from "./model";
import { DemoOrderAcceptance } from "./demo-order-acceptance";
import { demoProjectionRecordId } from "./projection-source";

const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  organizationId: "31000000-0000-4000-8000-000000000001",
  accountIds: ["11000000-0000-4000-8000-000000000001"],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const otherSession: SessionClaims = {
  ...session,
  userId: "21000000-0000-4000-8000-000000000005",
};
const agreementId = "80000000-0000-4000-8000-000000000001";
const accountId = "11000000-0000-4000-8000-000000000001";
const now = new Date("2026-07-31T16:00:00.000Z");

function repository() {
  return new DemoExperienceRepository(
    createMemoryDemoStore(),
    () => new DemoEvidenceGateway(),
  );
}

async function launch(subject: DemoExperienceRepository, opaqueState: string) {
  const target = await subject.signingTarget(
    session,
    agreementId,
    accountId,
    "request-1",
  );
  await subject.createEsignCorrelation({
    session,
    target,
    envelopeId: "a0000000-0000-4000-8000-000000000001",
    opaqueState,
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    requestId: "request-1",
  });
  return target;
}

afterEach(() => vi.unstubAllEnvs());

describe("demo esign correlation", () => {
  it("round-trips a launch, a ceremony, and the signed document", async () => {
    const subject = repository();
    const opaqueState = "demo-opaque-state-0001";
    const target = await launch(subject, opaqueState);

    expect(target.signerUserId).toBe(session.userId);
    expect(target.signerEmail).toBe("mara.voss@meridian-archive.test");

    await expect(
      subject.readEsignReturn({
        session,
        opaqueState,
        now,
        requestId: "request-2",
      }),
    ).resolves.toMatchObject({ state: "pending", signedDocumentId: null });

    await expect(subject.completeDemoCeremony(opaqueState, now)).resolves.toBe(
      true,
    );

    const returned = await subject.readEsignReturn({
      session,
      opaqueState,
      now,
      requestId: "request-3",
    });
    expect(returned.state).toBe("completed");
    expect(returned.signedDocumentId).not.toBeNull();

    const signed = await subject.readEsignSignedDocument({
      session,
      opaqueState,
      now,
      requestId: "request-4",
    });
    expect(signed.mimeType).toBe("application/pdf");
    expect(signed.filename).toBe(`agreement-${agreementId}.pdf`);
    expect(signed.agreementId).toBe(agreementId);
  });

  it("serves bytes the download verification accepts", async () => {
    const gateway = new DemoEvidenceGateway();
    const subject = new DemoExperienceRepository(
      createMemoryDemoStore(),
      () => gateway,
    );
    const opaqueState = "demo-opaque-state-0002";
    await launch(subject, opaqueState);
    await subject.completeDemoCeremony(opaqueState, now);

    const signed = await subject.readEsignSignedDocument({
      session,
      opaqueState,
      now,
      requestId: "request-5",
    });
    const actual = await gateway.readImmutable(signed);

    expect(createHash("sha256").update(actual.bytes).digest("hex")).toBe(
      signed.contentHash,
    );
    expect(actual.bytes.byteLength.toString()).toBe(signed.byteLength);
    expect(new TextDecoder().decode(actual.bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("hides another signer's correlation", async () => {
    const subject = repository();
    const opaqueState = "demo-opaque-state-0003";
    await launch(subject, opaqueState);

    await expect(
      subject.readEsignReturn({
        session: otherSession,
        opaqueState,
        now,
        requestId: "request-6",
      }),
    ).rejects.toThrow("Signing return state is invalid");
  });

  it("expires a stale return state", async () => {
    const subject = repository();
    const opaqueState = "demo-opaque-state-0004";
    await launch(subject, opaqueState);

    await expect(
      subject.readEsignReturn({
        session,
        opaqueState,
        now: new Date(now.getTime() + 7_200_000),
        requestId: "request-7",
      }),
    ).rejects.toThrow("Signing return state expired");
  });

  it("refuses to sign an unknown ceremony", async () => {
    await expect(
      repository().completeDemoCeremony("unknown-state"),
    ).resolves.toBe(false);
  });
});

describe("demo evidence lifecycle", () => {
  it("reserves, binds, scans, and promotes an upload", async () => {
    const subject = repository();
    const reserved = await subject.reserveEvidence({
      session,
      accountId,
      organizationId: null,
      journey: "customer_paper",
      targetId: agreementId,
      kind: "agreement",
      contentHash: "a".repeat(64),
      mimeType: "application/pdf",
      byteLength: 2048,
      retainUntil: "2033-07-31T16:00:00.000Z",
      expiresAt: "2026-07-31T16:15:00.000Z",
      legalHold: false,
      idempotencyKey: "evidence-key-0001",
      requestId: "request-1",
    });
    expect(reserved.status).toBe("pending");
    expect(reserved).not.toHaveProperty("idempotencyKey");

    const bound = await subject.bindEvidenceProvider({
      session,
      uploadId: reserved.uploadId,
      providerUploadId: "demo-provider-1",
      quarantineKey: "demo/quarantine/1",
      requestId: "request-2",
    });
    expect(bound.status).toBe("uploaded");

    const scanning = await subject.markEvidenceScanning(
      session,
      reserved.uploadId,
      "request-3",
    );
    expect(scanning.status).toBe("scanning");

    const promoted = await subject.promoteEvidence({
      session,
      uploadId: reserved.uploadId,
      immutableStorageKey: "demo/immutable/1",
      storageVersionId: "demo_v_1",
      scanReference: "demo_scan_1",
      requestId: "request-4",
    });
    expect(promoted.status).toBe("promoted");
    expect(promoted.documentId).not.toBeNull();
  });

  it("replays a reservation for the same idempotency key", async () => {
    const subject = repository();
    const input = {
      session,
      accountId,
      organizationId: null,
      journey: "customer_paper" as const,
      targetId: agreementId,
      kind: "agreement" as const,
      contentHash: "b".repeat(64),
      mimeType: "application/pdf",
      byteLength: 1024,
      retainUntil: "2033-07-31T16:00:00.000Z",
      expiresAt: "2026-07-31T16:15:00.000Z",
      legalHold: false,
      idempotencyKey: "evidence-key-0002",
      requestId: "request-1",
    };
    const first = await subject.reserveEvidence(input);
    const replay = await subject.reserveEvidence(input);

    expect(replay.uploadId).toBe(first.uploadId);

    await expect(
      subject.reserveEvidence({ ...input, contentHash: "c".repeat(64) }),
    ).rejects.toThrow("Idempotency key was already used");
  });

  it("hides another owner's upload", async () => {
    const subject = repository();
    const reserved = await subject.reserveEvidence({
      session,
      accountId,
      organizationId: null,
      journey: "customer_paper",
      targetId: agreementId,
      kind: "agreement",
      contentHash: "d".repeat(64),
      mimeType: "application/pdf",
      byteLength: 512,
      retainUntil: "2033-07-31T16:00:00.000Z",
      expiresAt: "2026-07-31T16:15:00.000Z",
      legalHold: false,
      idempotencyKey: "evidence-key-0003",
      requestId: "request-1",
    });

    await expect(
      subject.readEvidence(otherSession, reserved.uploadId, "request-2"),
    ).rejects.toThrow("Evidence upload not found");
  });
});

describe("capabilities outside the demo subset", () => {
  it("answers with a problem instead of reaching for a database", () => {
    const subject = repository();

    expect(() => subject.invoiceDerivation()).toThrow(ExperienceProblem);
    expect(() => subject.invoiceDerivation()).toThrow(
      "is not available in the demo",
    );
  });
});

describe("demo document artifacts", () => {
  const internalSession: SessionClaims = {
    ...session,
    userId: "21000000-0000-4000-8000-000000000009",
    accountIds: [],
    roles: ["internal_operator"],
    isInternalStaff: true,
  };

  it("publishes the stored UUID for a prepared order form, not its printable reference", async () => {
    const store = createMemoryDemoStore();
    const acceptance = new DemoOrderAcceptance(store);
    const quoteId = demoProjectionRecordId(
      "customer",
      "quotes",
      "quote-direct-renewal-v2",
    );
    if (!quoteId) throw new Error("The demo renewal quote is missing");
    const prepared = await acceptance.prepare(
      session,
      {
        orderId: "70000000-0000-4000-8000-000000000091",
        accountId,
        quoteId,
        signerUserId: session.userId,
        authorityTitle: "Operations Director",
        authorityAttested: true,
        poNumber: "PO-DEMO-DOCUMENT-IDENTITY",
        serviceStartsOn: "2027-01-01",
        serviceEndsOn: "2027-12-31",
        acceptedAt: now.toISOString(),
        orderLineIds: ["90000000-0000-4000-8000-000000000091"],
      },
      now,
    );
    const subject = new DemoExperienceRepository(
      store,
      () => new DemoEvidenceGateway(),
    );

    const { representation } = await subject.findArtifact(
      session,
      "order_form",
      prepared.id,
      "request-prepared-order-form",
    );

    expect(representation).toMatchObject({
      id: prepared.id,
      kind: "order_form",
      subjectType: "order",
      subjectId: prepared.subjectId,
      documentId: prepared.documentId,
    });
    expect(representation.documentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    );
    expect(representation.documentId).not.toBe(
      prepared.definition.displayDocumentId,
    );
  }, 30_000);

  it("renders every catalogued kind through the shared renderer", async () => {
    const subject = repository();
    const kinds = new Set<string>();
    for (const fixture of demoArtifactCatalog) {
      const actor =
        fixture.audience === "internal"
          ? internalSession
          : { ...session, accountIds: [fixture.accountId as string] };
      const { representation } = await subject.findArtifact(
        actor,
        fixture.kind,
        fixture.id,
        "request-artifact",
      );
      expect(representation.contentHash, fixture.kind).toMatch(
        /^[a-f0-9]{64}$/,
      );
      expect(representation.filename, fixture.kind).toMatch(
        /^[a-z0-9][a-z0-9._-]{0,159}\.pdf$/,
      );
      expect(representation.downloadHref, fixture.kind).toBe(
        `/api/experience/artifacts/${fixture.kind}/${fixture.id}`,
      );
      expect(representation.sourceHash, fixture.kind).toMatch(/^[a-f0-9]{64}$/);
      kinds.add(fixture.kind);
    }
    // Every kind the renderer can produce is reachable from the demo.
    expect([...kinds].sort()).toEqual([...DOCUMENT_KINDS].sort());
  }, 120_000);

  it("serves bytes the download verifier accepts", async () => {
    const gateway = new DemoEvidenceGateway();
    const subject = new DemoExperienceRepository(
      createMemoryDemoStore(),
      () => gateway,
    );
    const fixture = demoArtifactCatalog.find(
      (entry) => entry.kind === "invoice_companion",
    );
    if (!fixture) throw new Error("The demo invoice fixture is missing");
    const download = await subject.findArtifact(
      session,
      fixture.kind,
      fixture.id,
      "request-invoice",
    );
    const actual = await gateway.readImmutable({
      storageKey: download.storageKey,
      storageVersionId: download.storageVersionId,
      filename: download.representation.filename,
    });

    const bytes = verifyDownloadedArtifact(download.representation, actual);
    expect(new TextDecoder("latin1").decode(bytes.slice(0, 5))).toBe("%PDF-");
  }, 30_000);

  it("refuses an artifact belonging to another account", async () => {
    const subject = repository();
    const fixture = demoArtifactCatalog.find(
      (entry) => entry.kind === "invoice_companion",
    );
    if (!fixture) throw new Error("The demo invoice fixture is missing");

    await expect(
      subject.findArtifact(
        { ...session, accountIds: ["11000000-0000-4000-8000-000000000005"] },
        fixture.kind,
        fixture.id,
        "request-forbidden",
      ),
    ).rejects.toMatchObject({ status: 403, code: "ARTIFACT_SCOPE_FORBIDDEN" });
  }, 30_000);

  it("walks the render-request lifecycle the controller drives", async () => {
    const subject = repository();
    const fixture = demoArtifactCatalog.find(
      (entry) => entry.kind === "order_form",
    );
    if (!fixture) throw new Error("The demo order form fixture is missing");

    const created = await subject.createRenderRequest({
      session,
      source: {
        kind: fixture.kind,
        subjectId: fixture.subjectId,
        expectedVersion: fixture.sourceVersion,
        audience: "customer",
        accountId: fixture.accountId,
      },
      requestId: "request-create",
    });
    expect(created).toMatchObject({ status: "pending", version: 1 });

    // The create is idempotent on the same source, exactly as the persisted
    // `on conflict do nothing` replay is.
    await expect(
      subject.createRenderRequest({
        session,
        source: {
          kind: fixture.kind,
          subjectId: fixture.subjectId,
          expectedVersion: fixture.sourceVersion,
          audience: "customer",
          accountId: fixture.accountId,
        },
        requestId: "request-create-again",
      }),
    ).resolves.toMatchObject({ id: created.id, version: 1 });

    await expect(
      subject.createRenderRequest({
        session,
        source: {
          kind: fixture.kind,
          subjectId: fixture.subjectId,
          expectedVersion: "not-the-version",
          audience: "customer",
          accountId: fixture.accountId,
        },
        requestId: "request-stale",
      }),
    ).rejects.toMatchObject({ code: "ARTIFACT_SOURCE_VERSION_CONFLICT" });

    const found = await subject.findRenderRequest(
      session,
      created.id,
      "request-find",
    );
    await subject.claimRenderRequest(found, "request-claim");
    // A second claim at the same expected version is refused, which is what
    // stops two workers rendering one request.
    await expect(
      subject.claimRenderRequest(found, "request-claim-again"),
    ).rejects.toMatchObject({ code: "RENDER_VERSION_CONFLICT" });

    const stored = await subject.storeArtifact({
      request: found,
      contentHash: "e".repeat(64),
      byteLength: 2048,
      filename: "order-form-demo.pdf",
      immutableVersion: fixture.sourceVersion,
      storageKey: "demo/immutable/e",
      storageVersionId: "demo_v_e",
      requestId: "request-store",
    });
    expect(stored).toMatchObject({ id: fixture.id, kind: "order_form" });
    await expect(
      subject.findRenderRequest(session, created.id, "request-final"),
    ).resolves.toMatchObject({ status: "stored" });
  }, 30_000);

  it("records a failed render so the controller can redrive it", async () => {
    const subject = repository();
    const fixture = demoArtifactCatalog.find(
      (entry) => entry.kind === "deletion_certificate",
    );
    if (!fixture)
      throw new Error("The deletion certificate fixture is missing");
    const created = await subject.createRenderRequest({
      session,
      source: {
        kind: fixture.kind,
        subjectId: fixture.subjectId,
        expectedVersion: fixture.sourceVersion,
        audience: "customer",
        accountId: fixture.accountId,
      },
      requestId: "request-create",
    });
    await subject.claimRenderRequest(created, "request-claim");
    await subject.failRenderRequest(created, "RENDER_FAILED", "request-fail");
    const failed = await subject.findRenderRequest(
      session,
      created.id,
      "request-read",
    );
    expect(failed.status).toBe("failed");
    // A failed request is claimable again; that is the redrive path.
    await expect(
      subject.claimRenderRequest(failed, "request-reclaim"),
    ).resolves.toBeUndefined();
  }, 30_000);
});

describe("repository selection", () => {
  it("selects the demo repository for the demo adapter", () => {
    vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
    for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
      vi.stubEnv(key, key === "NODE_ENV" ? "test" : "");

    expect(configuredExperienceRepository()).toBeInstanceOf(
      DemoExperienceRepository,
    );
  });

  it.each(DEMO_PRODUCTION_ENVIRONMENT_KEYS)(
    "fails closed when %s identifies production",
    (marker) => {
      vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
      for (const key of DEMO_PRODUCTION_ENVIRONMENT_KEYS)
        vi.stubEnv(key, key === "NODE_ENV" ? "test" : "");
      vi.stubEnv(marker, " Production ");

      expect(() => configuredExperienceRepository()).toThrow(
        `${marker} identifies production`,
      );
    },
  );
});
