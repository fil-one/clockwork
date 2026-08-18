import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";
import {
  createPristineDemoAdapterState,
  type DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";
import { demoAccountIds, demoPersonas } from "@clockwork/testing/personas";
import { beforeEach, describe, expect, it } from "vitest";

import { formatMoney } from "@/src/features/shared/format";

import { commercialArtifactSource } from "./artifact-sources";
import { demoPlatformIssuer } from "./demo-artifact-catalog";
import {
  demoAcceptanceQuoteBook,
  DemoOrderAcceptance,
  type DemoOrderCommand,
} from "./demo-order-acceptance";
import {
  demoAdditionalRecords,
  demoCreatedOrderRecord,
} from "./demo-portal-records";
import { ExperienceProblem } from "./model";
import {
  demoProjectionRecordId,
  ExplicitDemoProjectionSource,
} from "./projection-source";

const persona = demoPersonas.directBuyer;

const session: SessionClaims = {
  userId: persona.userId,
  organizationId: persona.organizationId,
  accountIds: [demoAccountIds.direct],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function renewalQuoteKey(): string {
  const renewal = demoAcceptanceQuoteBook.find(
    (quote) => quote.recordKey === "quote-direct-renewal-v2",
  );
  if (!renewal) throw new Error("the renewal quote left the acceptance book");
  return renewal.recordKey;
}

/**
 * The clock the surface would mint. It is deliberately "now" rather than a
 * frozen fixture instant, because the defect this whole lane exists around was
 * an acceptance that could not be completed once the clock moved.
 */
const now = new Date();
const acceptedAt = now.toISOString();

function orderId(suffix: string): string {
  return `70000000-0000-4000-8000-00000000${suffix}`;
}

function command(overrides: Partial<DemoOrderCommand> = {}): DemoOrderCommand {
  return {
    orderId: orderId("0001"),
    accountId: demoAccountIds.direct,
    quoteId:
      demoProjectionRecordId("customer", "quotes", renewalQuoteKey()) ?? "",
    signerUserId: persona.userId,
    authorityTitle: "Operations Director",
    authorityAttested: true,
    poNumber: "PO-DEMO-4417",
    serviceStartsOn: "2027-01-01",
    serviceEndsOn: "2027-12-31",
    acceptedAt,
    orderLineIds: ["90000000-0000-4000-8000-000000000001"],
    ...overrides,
  };
}

let acceptance: DemoOrderAcceptance;
let store: DemoAdapterStateStore;

beforeEach(() => {
  store = createMemoryDemoStore();
  acceptance = new DemoOrderAcceptance(store);
});

async function walk(overrides: Partial<DemoOrderCommand> = {}) {
  const first = command(overrides);
  const prepared = await acceptance.prepare(session, first, now);
  const created = await acceptance.create(
    session,
    { ...first, orderFormDocumentId: prepared.documentId },
    now,
  );
  return { prepared, created };
}

describe("the demo two-pass acceptance", () => {
  it("prepares an order form and then creates the order it was bound to", async () => {
    const { prepared, created } = await walk();

    expect(prepared.subjectId).toBe(orderId("0001"));
    expect(prepared.documentKind).toBe("order_form");
    expect(created.id).toBe(orderId("0001"));
    expect(created.orderFormDocumentId).toBe(prepared.documentId);
    expect(created.artifactRequestId).toBe(prepared.id);
  });

  /**
   * The gap the authoritative repository was fixed for today. `acceptedAt` is
   * documentary and carried across both passes; the server's own instant is
   * what `immutableAt` records. A demo that required them equal would be
   * demonstrating the defect rather than the product.
   */
  it("accepts a create pass that arrives after the instant the form states", async () => {
    const stated = new Date(now.getTime() - 90_000).toISOString();
    const first = command({ acceptedAt: stated });
    const prepared = await acceptance.prepare(session, first, now);
    const created = await acceptance.create(
      session,
      { ...first, orderFormDocumentId: prepared.documentId },
      new Date(now.getTime() + 90_000),
    );

    expect(created.acceptedAt).toBe(stated);
    expect(Date.parse(created.immutableAt)).toBeGreaterThan(Date.parse(stated));
  });

  it("is idempotent on both passes", async () => {
    const first = command();
    const a = await acceptance.prepare(session, first, now);
    const b = await acceptance.prepare(session, first, now);
    expect(b).toEqual(a);

    const second = { ...first, orderFormDocumentId: a.documentId };
    const x = await acceptance.create(session, second, now);
    const y = await acceptance.create(session, second, now);
    expect(y).toEqual(x);
  });

  it("persists an exact command response and refuses key reuse for different request bytes", async () => {
    const first = command();
    const input = {
      session,
      action: "prepare_artifact" as const,
      command: first,
      idempotencyKey: "demo-prepare-command-0001",
      requestHash: "a".repeat(64),
      now,
    };
    const initial = await acceptance.execute(input);
    const replay = await acceptance.execute(input);

    expect(initial.replayed).toBe(false);
    expect(replay).toEqual({ result: initial.result, replayed: true });
    await expect(
      acceptance.execute({ ...input, requestHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_CONFLICT", status: 409 });
  });

  it("allows exactly one order per source quote under concurrent creates", async () => {
    const first = command({ orderId: orderId("0011") });
    const second = command({ orderId: orderId("0012") });
    const [firstForm, secondForm] = await Promise.all([
      acceptance.prepare(session, first, now),
      acceptance.prepare(session, second, now),
    ]);

    const attempts = await Promise.allSettled([
      acceptance.create(
        session,
        { ...first, orderFormDocumentId: firstForm.documentId },
        now,
      ),
      acceptance.create(
        session,
        { ...second, orderFormDocumentId: secondForm.documentId },
        now,
      ),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (!rejected || rejected.status !== "rejected")
      throw new Error("one concurrent create should have been rejected");
    const rejection: unknown = rejected.reason;
    expect(rejection).toMatchObject({ code: "DEMO_QUOTE_ALREADY_ACCEPTED" });
    await expect(acceptance.createdOrders()).resolves.toHaveLength(1);
  });

  it("drops quote-consumption and idempotency state on demo reset", async () => {
    const first = command({ orderId: orderId("0021") });
    const firstExecution = await acceptance.execute({
      session,
      action: "prepare_artifact",
      command: first,
      idempotencyKey: "demo-reset-command-0001",
      requestHash: "c".repeat(64),
      now,
    });
    const documentId = firstExecution.result.data.orderFormDocumentId;
    if (!documentId) throw new Error("prepare did not return a document");
    await acceptance.create(
      session,
      { ...first, orderFormDocumentId: documentId },
      now,
    );

    await store.replace(createPristineDemoAdapterState());

    const afterReset = await acceptance.execute({
      session,
      action: "prepare_artifact",
      command: first,
      idempotencyKey: "demo-reset-command-0001",
      requestHash: "c".repeat(64),
      now,
    });
    expect(afterReset.replayed).toBe(false);
    await expect(acceptance.createdOrders()).resolves.toEqual([]);
    await expect(
      new ExplicitDemoProjectionSource(store).find({
        session,
        audience: "customer",
        channel: "quotes",
        accountId: demoAccountIds.direct,
        recordKey: renewalQuoteKey(),
        now,
      }),
    ).resolves.toMatchObject({
      data: { status: "open", allowedActions: ["accept", "expire"] },
    });

    const second = command({ orderId: orderId("0022") });
    const secondForm = await acceptance.prepare(session, second, now);
    await expect(
      acceptance.create(
        session,
        { ...second, orderFormDocumentId: secondForm.documentId },
        now,
      ),
    ).resolves.toMatchObject({ id: orderId("0022") });
  });

  /**
   * The five-way match `assertCommercialArtifactBinding` makes. An entry edited
   * after the prepare changes the definition, so the hash changes, so the
   * stored request no longer describes this command -- and the create pass has
   * to be refused, or the order would be created against paper nobody saw.
   */
  it("refuses a create pass whose entries no longer match the prepared form", async () => {
    const first = command();
    const prepared = await acceptance.prepare(session, first, now);

    await expect(
      acceptance.create(
        session,
        {
          ...first,
          poNumber: "PO-DEMO-9999",
          orderFormDocumentId: prepared.documentId,
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "COMMERCIAL_ARTIFACT_BINDING_INVALID" });
  });

  it("refuses a create pass quoting a document nothing prepared", async () => {
    await expect(
      acceptance.create(
        session,
        {
          ...command(),
          orderFormDocumentId: "80000000-0000-4000-8000-0000000000ff",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "COMMERCIAL_ARTIFACT_BINDING_INVALID" });
  });

  it("answers the prepared-form lookup only for the order the pass named", async () => {
    const prepared = await acceptance.prepare(session, command(), now);

    await expect(
      acceptance.preparedOrderForm(orderId("0001")),
    ).resolves.toEqual({
      documentId: prepared.documentId,
      orderId: orderId("0001"),
      artifactId: prepared.id,
    });
    await expect(
      acceptance.preparedOrderForm(orderId("0002")),
    ).resolves.toBeNull();
  });
});

/**
 * The rules are the product's, not this file's. Each of these refusals is
 * raised inside `acceptOrder` and only surfaced here, which is the property
 * that keeps the demo from teaching a prospect a looser product than they will
 * buy.
 */
describe("the refusals come from the domain", () => {
  it("refuses an acceptance with no binding authority attested", async () => {
    await expect(
      acceptance.prepare(session, command({ authorityTitle: "   " }), now),
    ).rejects.toThrowError(/authority/u);
  });

  it("refuses a service end before the service start", async () => {
    await expect(
      acceptance.prepare(
        session,
        command({ serviceStartsOn: "2027-06-01", serviceEndsOn: "2027-01-01" }),
        now,
      ),
    ).rejects.toThrowError(/Service end precedes service start/u);
  });

  /**
   * `procurementReadiness` requires a purchase order for this account, and the
   * refusal names the missing field. The surface validates the same thing
   * first; this is what holds when a client skips that.
   */
  it("refuses an acceptance with no purchase order", async () => {
    const { poNumber, ...rest } = command();
    void poNumber;
    await expect(acceptance.prepare(session, rest, now)).rejects.toThrowError(
      /purchase_order_number/u,
    );
  });

  it("refuses an acceptance signed by anyone but the acting user", async () => {
    await expect(
      acceptance.prepare(
        session,
        command({ signerUserId: demoPersonas.endClient.userId }),
        now,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses an acceptance against an account the quote does not belong to", async () => {
    await expect(
      acceptance.prepare(
        session,
        command({ accountId: demoAccountIds.endClient }),
        now,
      ),
    ).rejects.toMatchObject({ code: "DEMO_QUOTE_ACCOUNT_MISMATCH" });
  });

  /**
   * The scripted boundary. A quote the demo does not carry an acceptance
   * context for is refused by name, with copy that tells the reader where the
   * ceremony does run -- not with a generic fault.
   */
  it("refuses a quote outside the acceptance book by name", async () => {
    const rejection = await acceptance
      .prepare(
        session,
        command({ quoteId: "50000000-0000-4000-8000-000000009999" }),
        now,
      )
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ExperienceProblem);
    expect(rejection).toMatchObject({ code: "DEMO_QUOTE_NOT_ACCEPTABLE" });
    expect(String((rejection as ExperienceProblem).message)).toContain(
      "quotes ledger",
    );
  });
});

describe("the order form the prepare pass produced", () => {
  it("renders from the shared definition mapping and reproduces its own hash", async () => {
    const prepared = await acceptance.prepare(session, command(), now);

    // The very translation the persisted download runs over a stored request
    // row. It verifies the resolved source on the way out, so reaching this
    // line at all is the assertion that the demo's request is well formed.
    const source = commercialArtifactSource({
      subjectType: prepared.subjectType,
      subjectId: prepared.subjectId,
      audienceAccountId: prepared.audienceAccountId,
      audience: "customer",
      kind: prepared.documentKind,
      definition: prepared.definition,
      sourceHash: prepared.sourceHash,
      retainUntil: prepared.retainUntil,
      issuer: demoPlatformIssuer,
    });

    expect(source.kind).toBe("order_form");
    expect(source.input.verification.recordHash).toBe(source.sourceHash);
  });

  it("prints the entries the prospect typed", async () => {
    const prepared = await acceptance.prepare(session, command(), now);
    const definition = prepared.definition;
    if (definition.kind !== "order_form")
      throw new Error("the prepared definition is not an order form");

    expect(definition.purchaseOrderNumber).toBe("PO-DEMO-4417");
    expect(definition.servicePeriod).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-12-31",
    });
    expect(definition.signer.title).toBe("Operations Director");
    expect(definition.signer.name).toBe(persona.displayName);
    expect(definition.signer.acceptedAt).toBe(acceptedAt);
    expect(definition.recipient.legalName).toBe("Meridian Archive Labs, Inc.");
  });

  /**
   * One money source. The quote card says `$184,800.00` because the priced
   * lines say so, and the order form's total is those same lines summed -- a
   * second statement of the figure is exactly the drift the demo's tax work
   * already refused to introduce.
   */
  it("totals the same money the quotes ledger shows", async () => {
    const prepared = await acceptance.prepare(session, command(), now);
    if (prepared.definition.kind !== "order_form")
      throw new Error("the prepared definition is not an order form");

    expect(
      formatMoney(
        prepared.definition.totals.total.minorUnits,
        prepared.definition.totals.total.currency,
      ),
    ).toBe("$184,800.00");
  });
});

describe("the created order", () => {
  it("reaches the orders channel as a record a reader can open", async () => {
    const { created } = await walk();
    const record = demoCreatedOrderRecord(created);

    expect(record.channel).toBe("orders");
    expect(record.accountId).toBe(demoAccountIds.direct);
    expect(record.key).toBe(`order-${created.id}`);
    expect(record.data.value).toBe("$184,800.00");
    // The evidence travels with the record, so the detail page can offer the
    // order form the acceptance was bound by.
    expect(record.data.artifacts).toEqual([
      expect.objectContaining({
        kind: "order_form",
        id: created.artifactRequestId,
      }),
    ]);
  });

  it("is listed for its own account and nobody else's", async () => {
    const { created } = await walk();

    expect(demoCreatedOrderRecord(created).accountId).not.toBe(
      demoAccountIds.endClient,
    );
  });

  it("atomically consumes the source quote projection", async () => {
    const source = new ExplicitDemoProjectionSource(store);
    const recordKey = renewalQuoteKey();
    const initial = await source.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: demoAccountIds.direct,
      recordKey,
      now,
    });

    const { created } = await walk();
    const accepted = await source.find({
      session,
      audience: "customer",
      channel: "quotes",
      accountId: demoAccountIds.direct,
      recordKey,
      now,
    });

    expect(accepted.version).toBe(initial.version + 1);
    expect(accepted.data).toMatchObject({
      status: "accepted",
      statusLabel: "Accepted · order created",
      tone: "success",
      nextAction: `Track order ${created.id}`,
      allowedActions: [],
    });
    await expect(
      source.action({
        session,
        projectionId: accepted.id,
        recordKey: accepted.recordKey,
        audience: accepted.audience,
        channel: accepted.channel,
        accountId: demoAccountIds.direct,
        action: "accept",
        expectedVersion: accepted.version,
        idempotencyKey: "demo-repeat-acceptance-0001",
        payload: {},
        requestId: "demo-repeat-acceptance-request",
      }),
    ).rejects.toMatchObject({ code: "ACTION_FORBIDDEN", status: 403 });
  });
});

/**
 * Every entry has to be reachable, or the book is describing a ceremony the
 * ledger cannot start.
 */
describe("the acceptance book", () => {
  it("projects the guided renewal's commercial identity beside its row identity", () => {
    const projected = demoAdditionalRecords.find(
      (record) =>
        record.channel === "quotes" && record.key === "quote-direct-renewal-v2",
    );

    expect(projected).toMatchObject({
      key: "quote-direct-renewal-v2",
      version: 1,
      data: {
        reference: "Q-2026-0312",
        authoritative: { revision: 2 },
      },
    });
  });

  it("names only quotes the demo projection actually serves", () => {
    for (const quote of demoAcceptanceQuoteBook)
      expect(
        demoProjectionRecordId("customer", "quotes", quote.recordKey),
      ).toBeTypeOf("string");
  });
});
