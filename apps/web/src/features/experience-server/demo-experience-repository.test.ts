import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import { DEMO_PRODUCTION_ENVIRONMENT_KEYS } from "@clockwork/testing/demo-state";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configuredExperienceRepository,
  DemoExperienceRepository,
} from "./demo-experience-repository";
import { DemoEvidenceGateway } from "./evidence-gateway";
import { ExperienceProblem } from "./model";

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

    for (const call of [
      () => subject.createRenderRequest(),
      () => subject.findRenderRequest(),
      () => subject.claimRenderRequest(),
      () => subject.failRenderRequest(),
      () => subject.storeArtifact(),
      () => subject.findArtifact(),
    ]) {
      expect(call).toThrow(ExperienceProblem);
      expect(call).toThrow("is not available in the demo");
    }
  });
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
