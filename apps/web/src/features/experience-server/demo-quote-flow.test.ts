import { describe, expect, it } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

import {
  DemoQuoteFlow,
  type DemoQuoteCommand,
  type DemoQuoteState,
} from "./demo-quote-flow";
import { ExplicitDemoProjectionSource } from "./projection-source";
import { DemoOrderAcceptance } from "./demo-order-acceptance";
import { DemoExperienceRepository } from "./demo-experience-repository";
import { DemoEvidenceGateway } from "./evidence-gateway";

const accountId = "11000000-0000-4000-8000-000000000001";
const quoteId = "70000000-0000-4000-8000-000000000001";
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};
const now = new Date("2026-08-18T12:00:00.000Z");
const create: DemoQuoteCommand = {
  action: "create",
  quoteId,
  accountId,
  priceBookId: "66000000-0000-4000-8000-000000000001",
  seriesId: "71000000-0000-4000-8000-000000000001",
  route: "direct",
  lines: [
    {
      lineId: "72000000-0000-4000-8000-000000000001",
      sku: "LOCKED-STORAGE-TB",
      region: "us-east-2",
      quantity: "42",
      termMonths: 12,
    },
  ],
  expiresAt: "2026-09-01T12:00:00.000Z",
};

function hash(character: string): string {
  return character.repeat(64);
}

describe("DemoQuoteFlow", () => {
  it("atomically prices, prepares, binds, issues, and replays the quote journey", async () => {
    const store = createMemoryDemoStore();
    const flow = new DemoQuoteFlow(store);
    const created = await flow.execute({
      session,
      command: create,
      idempotencyKey: "create-quote-key-0001",
      requestHash: hash("a"),
      now,
    });
    expect(created).toMatchObject({
      replayed: false,
      result: {
        rowVersion: 1,
        data: {
          status: "draft",
          totalMinor: "7560000",
          currency: "USD",
          marginFloorResult: "pass",
        },
      },
    });

    const replay = await flow.execute({
      session,
      command: create,
      idempotencyKey: "create-quote-key-0001",
      requestHash: hash("a"),
      now: new Date("2026-08-18T13:00:00.000Z"),
    });
    expect(replay.replayed).toBe(true);
    expect(replay.result).toEqual(created.result);

    // Returning to an unchanged draft after a pause must still allow issuance.
    const later = new Date("2026-08-18T13:00:00.000Z");
    const savedDraft = await new ExplicitDemoProjectionSource(store).find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId,
      recordKey: `quote-${quoteId}`,
      now: later,
    });
    expect(savedDraft).toMatchObject({
      stale: false,
      version: 1,
      projectedAt: later.toISOString(),
      data: { authoritative: { status: "draft" } },
    });

    const prepared = await flow.execute({
      session,
      command: {
        action: "prepare_artifact",
        quoteId,
        accountId,
        expectedVersion: 1,
        audience: "end_client",
        issuedAt: "2026-08-18T12:05:00.000Z",
        retainUntil: "2033-08-18T12:05:00.000Z",
      },
      idempotencyKey: "prepare-quote-key-001",
      requestHash: hash("b"),
      now,
    });
    const artifact = prepared.result.data.artifactRequest as {
      documentId: string;
      requestId: string;
    };
    expect(artifact.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(artifact.documentId).toMatch(/^[0-9a-f-]{36}$/u);

    const repository = new DemoExperienceRepository(
      store,
      () => new DemoEvidenceGateway(),
    );
    const rendered = await repository.findArtifact(
      session,
      "direct_quote",
      artifact.requestId,
      "render-quote-1",
    );
    expect(rendered.representation).toMatchObject({
      id: artifact.requestId,
      documentId: artifact.documentId,
      subjectId: quoteId,
    });

    const issued = await flow.execute({
      session,
      command: {
        action: "issue",
        quoteId,
        accountId,
        expectedVersion: 1,
        artifactIssuedAt: "2026-08-18T12:05:00.000Z",
        renderedDocumentId: artifact.documentId,
      },
      idempotencyKey: "issue-quote-key-0001",
      requestHash: hash("c"),
      now,
    });
    expect(issued.result).toMatchObject({
      rowVersion: 2,
      data: { status: "issued", renderedDocumentId: artifact.documentId },
    });
    const state = (await store.read()) as DemoQuoteState;
    expect(state.createdQuotes?.[quoteId]).toMatchObject({
      rowVersion: 2,
      snapshot: { status: "issued", renderedDocumentId: artifact.documentId },
    });

    const quoteProjection = await new ExplicitDemoProjectionSource(store).find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId,
      recordKey: `quote-${quoteId}`,
      now,
    });
    expect(quoteProjection.data.artifacts).toEqual([
      {
        kind: "direct_quote",
        id: artifact.requestId,
        label: "Quote document",
        state: "stored",
      },
    ]);

    const acceptance = new DemoOrderAcceptance(store);
    const acceptanceCommand = {
      orderId: "74000000-0000-4000-8000-000000000001",
      accountId,
      quoteId,
      signerUserId: session.userId,
      authorityTitle: "Operations Director",
      authorityAttested: true,
      poNumber: "PO-DEMO-42",
      serviceStartsOn: "2026-09-02",
      serviceEndsOn: "2027-09-01",
      acceptedAt: "2026-08-18T12:10:00.000Z",
      orderLineIds: ["75000000-0000-4000-8000-000000000001"],
    } as const;
    const orderForm = await acceptance.prepare(session, acceptanceCommand, now);
    const order = await acceptance.create(
      session,
      { ...acceptanceCommand, orderFormDocumentId: orderForm.documentId },
      now,
    );
    expect(order).toMatchObject({
      quoteRecordKey: `quote-${quoteId}`,
      accountId,
      totalMinor: "7560000",
    });
    expect(
      ((await store.read()) as DemoQuoteState).projectionOverrides[quoteId],
    ).toMatchObject({ version: 3, data: { status: "accepted" } });
    const acceptedProjection = await new ExplicitDemoProjectionSource(
      store,
    ).find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId,
      recordKey: `quote-${quoteId}`,
      now,
    });
    expect(acceptedProjection).toMatchObject({
      version: 3,
      data: {
        status: "accepted",
        authoritative: { status: "accepted" },
        allowedActions: [],
      },
    });
    await expect(
      flow.execute({
        session,
        command: {
          ...create,
          action: "revise",
          expectedVersion: 2,
          revisionId: "70000000-0000-4000-8000-000000000088",
        },
        idempotencyKey: "accepted-revision-key",
        requestHash: hash("f"),
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("binds each idempotency key to the exact request hash", async () => {
    const flow = new DemoQuoteFlow(createMemoryDemoStore());
    await flow.execute({
      session,
      command: create,
      idempotencyKey: "create-quote-key-0002",
      requestHash: hash("a"),
      now,
    });
    await expect(
      flow.execute({
        session,
        command: create,
        idempotencyKey: "create-quote-key-0002",
        requestHash: hash("b"),
        now,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });

  it("refuses stale versions and an unbound issuance document", async () => {
    const flow = new DemoQuoteFlow(createMemoryDemoStore());
    await flow.execute({
      session,
      command: create,
      idempotencyKey: "create-quote-key-0003",
      requestHash: hash("a"),
      now,
    });
    await expect(
      flow.execute({
        session,
        command: {
          action: "prepare_artifact",
          quoteId,
          accountId,
          expectedVersion: 2,
          audience: "end_client",
          issuedAt: "2026-08-18T12:05:00.000Z",
          retainUntil: "2033-08-18T12:05:00.000Z",
        },
        idempotencyKey: "prepare-quote-key-002",
        requestHash: hash("b"),
        now,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
    const prepared = await flow.execute({
      session,
      command: {
        action: "prepare_artifact",
        quoteId,
        accountId,
        expectedVersion: 1,
        audience: "end_client",
        issuedAt: "2026-08-18T12:05:00.000Z",
        retainUntil: "2033-08-18T12:05:00.000Z",
      },
      idempotencyKey: "prepare-quote-key-003",
      requestHash: hash("d"),
      now,
    });
    const preparedDocumentId = (
      prepared.result.data.artifactRequest as { documentId: string }
    ).documentId;
    await expect(
      flow.execute({
        session,
        command: {
          action: "issue",
          quoteId,
          accountId,
          expectedVersion: 1,
          artifactIssuedAt: "2026-08-18T12:05:00.000Z",
          renderedDocumentId: preparedDocumentId,
        },
        idempotencyKey: "issue-quote-key-0004",
        requestHash: hash("e"),
        now,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "COMMERCIAL_ARTIFACT_BINDING_INVALID",
    });
    await expect(
      flow.execute({
        session,
        command: {
          action: "issue",
          quoteId,
          accountId,
          expectedVersion: 1,
          artifactIssuedAt: "2026-08-18T12:05:00.000Z",
          renderedDocumentId: "73000000-0000-4000-8000-000000000001",
        },
        idempotencyKey: "issue-quote-key-0002",
        requestHash: hash("c"),
        now,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "COMMERCIAL_ARTIFACT_BINDING_INVALID",
    });
  });
});

it("revises an issued quote atomically without changing its commercial snapshot", async () => {
  const store = createMemoryDemoStore();
  const flow = new DemoQuoteFlow(store);
  await flow.execute({
    session,
    command: create,
    idempotencyKey: "revision-create-key",
    requestHash: hash("a"),
    now,
  });
  // A prior issuance is an immutable historical fact; revisions create another ID.
  await store.update((current) => {
    const state = current as DemoQuoteState;
    const prior = state.createdQuotes?.[quoteId];
    if (!prior) throw new Error("Missing prior quote");
    return {
      ...state,
      createdQuotes: {
        [quoteId]: {
          ...prior,
          snapshot: {
            ...prior.snapshot,
            status: "issued" as const,
            issuedAt: now.toISOString(),
            immutableSnapshot: "original-commercial-evidence",
          },
          rowVersion: 2,
        },
      },
    };
  });
  const revisionId = "70000000-0000-4000-8000-000000000099";
  const line = create.lines[0];
  if (!line) throw new Error("Missing quote line");
  const command = {
    ...create,
    action: "revise" as const,
    revisionId,
    expectedVersion: 2,
    lines: [{ ...line, quantity: "50" }],
  };
  await flow.execute({
    session,
    command,
    idempotencyKey: "revision-save-key",
    requestHash: hash("b"),
    now,
  });
  const state = (await store.read()) as DemoQuoteState;
  expect(state.createdQuotes?.[quoteId]).toMatchObject({
    rowVersion: 3,
    snapshot: {
      status: "superseded",
      immutableSnapshot: "original-commercial-evidence",
      lines: [{ quantity: "42" }],
    },
  });
  expect(state.createdQuotes?.[revisionId]).toMatchObject({
    rowVersion: 1,
    snapshot: {
      status: "draft",
      revision: 2,
      previousRevisionId: quoteId,
      seriesId: create.seriesId,
      lines: [{ quantity: "50" }],
    },
  });
  await expect(
    flow.execute({
      session,
      command: {
        ...command,
        revisionId: "70000000-0000-4000-8000-000000000098",
      },
      idempotencyKey: "revision-stale-key",
      requestHash: hash("c"),
      now,
    }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
});
