import { describe, expect, it } from "vitest";

import {
  aggregateConfiguration,
  createCanonicalPortalProjectionDefinitions,
} from "./projection-definitions";

const accountId = "10000000-0000-4000-8000-000000000001";
const partnerAccountId = "20000000-0000-4000-8000-000000000002";
const quoteId = "60000000-0000-4000-8000-000000000001";

async function projectAggregate(input: {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  accountId: string | null;
  data: Readonly<Record<string, unknown>>;
}) {
  const definition = createCanonicalPortalProjectionDefinitions().find(
    (candidate) => candidate.topic === input.topic,
  );
  if (!definition) throw new Error(`Expected a ${input.topic} definition`);
  expect(definition.aggregateTypes).toEqual([input.aggregateType]);
  return definition.project({
    event: {
      eventId: "70000000-0000-4000-8000-000000000001",
      eventType: input.topic,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: 3,
      occurredAt: "2026-07-31T16:00:00.000Z",
      requestId: "projection-definition-test",
      actor: { kind: "system", id: "projection-test" },
      data: {},
    },
    state: {
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      accountId: input.accountId,
      version: 3,
      sourceHash: "a".repeat(64),
      sourceUpdatedAt: "2026-07-31T16:00:00.000Z",
      data: input.data,
    },
  });
}

function projectQuote(
  data: Readonly<Record<string, unknown>>,
  topic = "core.quotes.issue",
) {
  return projectAggregate({
    topic,
    aggregateType: "quote",
    aggregateId: quoteId,
    accountId,
    data,
  });
}

function channelsFor(
  projections: Awaited<ReturnType<typeof projectAggregate>>,
): readonly string[] {
  return projections
    .map((projection) => `${projection.audience}:${projection.channel}`)
    .sort();
}

describe("canonical portal projection definitions", () => {
  it("maps exact authoritative topics without recursive experience topics", () => {
    const definitions = createCanonicalPortalProjectionDefinitions();
    const topics = definitions.map(({ topic }) => topic);
    expect(new Set(topics).size).toBe(topics.length);
    expect(topics).toContain("core.quotes.expire");
    expect(topics).toContain("core.orders.create");
    expect(topics.some((topic) => topic.startsWith("experience."))).toBe(false);
    for (const definition of definitions)
      expect(definition.eventTypes).toEqual([definition.topic]);
  });

  it("registers at least one authoritative topic for every routed aggregate", () => {
    const covered = new Set(
      createCanonicalPortalProjectionDefinitions().flatMap(
        ({ aggregateTypes }) => aggregateTypes,
      ),
    );
    for (const aggregate of Object.keys(aggregateConfiguration))
      expect(
        covered.has(aggregate),
        `${aggregate} has no authoritative topic`,
      ).toBe(true);
  });

  it.each([
    ["submitted", "attention"],
    ["accepted", "accepted"],
    ["provisioning", "attention"],
    ["active", "active"],
    ["amended", "attention"],
    ["completed", "complete"],
    ["cancelled", "attention"],
    ["terminated", "attention"],
  ] as const)(
    "preserves authoritative order lifecycle status %s alongside public status %s",
    async (lifecycleStatus, expectedPublicStatus) => {
      const projections = await projectAggregate({
        topic: "core.orders.create",
        aggregateType: "order",
        aggregateId: "61000000-0000-4000-8000-000000000001",
        accountId,
        data: {
          status: lifecycleStatus,
          serviceStartsOn: "2026-08-01",
          serviceEndsOn: "2027-07-31",
        },
      });
      const customer = projections.find(
        (projection) => projection.audience === "customer",
      );

      expect(customer?.payload).toMatchObject({
        kind: "orders",
        status: expectedPublicStatus,
        authoritative: { status: lifecycleStatus },
      });
    },
  );

  it("leaves satellite-bound and duplicate-guard topics unregistered", () => {
    const topics = new Set(
      createCanonicalPortalProjectionDefinitions().map(({ topic }) => topic),
    );
    for (const topic of [
      "order.provisioning_requested",
      "order.provisioning_confirmed",
      "termination.deletion_certificate_requested",
      "agreement.envelope_created",
      "agreement.envelope_completed",
      "agreement.pass_through_terms_accepted",
      "system.exception_roster.assigned",
      "system.exception_roster.reassigned",
      "workflow.exception.opened",
    ])
      expect(topics.has(topic), `${topic} must stay unregistered`).toBe(false);
  });

  it("routes a termination to the operator provisioning lane and the account service view", async () => {
    const projections = await projectAggregate({
      topic: "termination.approved",
      aggregateType: "termination",
      aggregateId: "80000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "ready_for_teardown",
        teardownStatus: "ready_for_teardown",
        finalBillingStatus: "settled",
        effectiveAt: "2026-09-30T00:00:00.000Z",
      },
    });
    expect(channelsFor(projections)).toEqual([
      "customer:services",
      "internal:provisioning",
    ]);
    for (const projection of projections) {
      expect(projection.commandResource).toBeNull();
      expect(projection.payload.allowedActions).toEqual([]);
      expect(projection.recordKey).toBe(
        "termination-80000000-0000-4000-8000-000000000001",
      );
    }
  });

  it("keeps an exception case on the internal queue only", async () => {
    const projections = await projectAggregate({
      topic: "exception_case.opened",
      aggregateType: "exception_case",
      aggregateId: "81000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "open",
        queue: "billing_exception",
        objectType: "invoice",
        targetAt: "2026-08-02T16:00:00.000Z",
      },
    });
    expect(channelsFor(projections)).toEqual(["internal:queues"]);
    expect(projections[0]?.subjectAccountId).toBe(accountId);
    expect(projections[0]?.audienceAccountId).toBeNull();
  });

  it("keeps a provider operation on the internal provisioning lane with no account", async () => {
    const projections = await projectAggregate({
      topic: "lifecycle.effect.dead_lettered",
      aggregateType: "provider_operation",
      aggregateId: "82000000-0000-4000-8000-000000000001",
      accountId: null,
      data: {
        status: "failed",
        provider: "lifecycle-provisioning",
        operation: "provision",
        attemptCount: 4,
      },
    });
    expect(channelsFor(projections)).toEqual(["internal:provisioning"]);
    expect(projections[0]?.subjectAccountId).toBeNull();
  });

  it("routes a decided approval to the approver-gated approvals channel", async () => {
    const projections = await projectAggregate({
      topic: "approval.decided",
      aggregateType: "approval",
      aggregateId: "83000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "approved",
        action: "termination_teardown",
        objectType: "termination",
        requestedAt: "2026-07-30T16:00:00.000Z",
        decidedAt: "2026-07-31T16:00:00.000Z",
      },
    });
    expect(channelsFor(projections)).toEqual(["internal:approvals"]);
    expect(projections[0]?.payload.secondary).toBe("Decided");
  });

  it("shows a POC and an executed agreement on every audience that holds them", async () => {
    const poc = await projectAggregate({
      topic: "poc.expired",
      aggregateType: "poc",
      aggregateId: "84000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "expired",
        partnerAccountId,
        expiresAt: "2026-07-30T16:00:00.000Z",
        currency: "USD",
        costMinor: "125000",
      },
    });
    expect(channelsFor(poc)).toEqual([
      "customer:pocs",
      "internal:pocs",
      "partner:pocs",
    ]);
    const agreement = await projectAggregate({
      topic: "agreement.executed",
      aggregateType: "agreement",
      aggregateId: "85000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "active",
        paper: "ours",
        executionMode: "counter_signed",
        effectiveOn: "2026-07-31",
        renewalType: "expires",
      },
    });
    expect(channelsFor(agreement)).toEqual([
      "customer:agreements",
      "internal:agreements",
    ]);
  });

  it("grants the customer only the action that needs no further input", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
    });
    const customer = projections.find(
      (projection) => projection.audience === "customer",
    );
    expect(customer).toMatchObject({
      audienceAccountId: accountId,
      commandResource: "core:quotes",
    });
    // Acceptance is absent on purpose: it requires the signatory title and
    // attestation enforced on orders, so it belongs to the acceptance form.
    expect(customer?.payload.allowedActions).toEqual(["expire"]);
  });

  it("grants internal operators the actions the command executor supports", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
    });
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    expect(internal).toMatchObject({ commandResource: "core:quotes" });
    expect(internal?.payload.allowedActions).toEqual([
      "expire",
      "prepare_artifact",
    ]);
  });

  it("grants a named partner the partner-priced artifact action", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
      partnerAccountId,
    });
    const partner = projections.find(
      (projection) => projection.audience === "partner",
    );
    expect(partner).toMatchObject({
      audienceAccountId: partnerAccountId,
      subjectAccountId: accountId,
      channel: "quotes",
      commandResource: "core:quotes",
    });
    expect(partner?.payload.allowedActions).toEqual(["prepare_artifact"]);
  });

  it("withholds a command resource when no action is offered", async () => {
    const projections = await projectQuote({
      status: "expired",
      totalMinor: "12500",
      currency: "USD",
    });
    for (const projection of projections) {
      expect(projection.payload.allowedActions).toEqual([]);
      expect(projection.commandResource).toBeNull();
    }
  });

  it("renders real record content rather than placeholder labels", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "1250000",
      currency: "USD",
      revision: 3,
      expiresAt: "2026-08-14T00:00:00.000Z",
      marginFloorResult: "pass",
    });
    const customer = projections.find(
      (projection) => projection.audience === "customer",
    );
    const payload = customer?.payload as Record<string, unknown>;
    expect(payload.value).toBe("$12,500.00");
    expect(payload.valueLabel).toBe("Total USD");
    expect(payload.title).toContain("rev 3");
    expect(payload.kind).toBe("quotes");
    expect(payload.owner).not.toBe("Clockwork");
    expect(payload.term).not.toBe("Authoritative");
    expect(payload.description).not.toBe(
      "Current authoritative commerce state",
    );
    expect(Array.isArray(payload.context)).toBe(true);
  });

  it("offers a draft quote only the transition the repository implements", async () => {
    const projections = await projectQuote(
      { status: "draft", totalMinor: "12500", currency: "USD" },
      "core.quotes.create",
    );
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    // `price` used to lead this list, so the headline action on every draft
    // quote was a command no branch implements. Revision needs a whole quote
    // configuration and belongs to the builder, not a button.
    expect(internal?.payload.allowedActions).toEqual(["issue"]);
  });

  it("offers an open invoice only the action that does not write provider truth", async () => {
    const projections = await projectAggregate({
      topic: "core.invoices.evaluate_dunning",
      aggregateType: "invoice",
      aggregateId: "83000000-0000-4000-8000-000000000001",
      accountId,
      data: {
        status: "open",
        amountMinor: "12500",
        currency: "USD",
        dueAt: "2026-09-30T00:00:00.000Z",
      },
    });
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    // Void and mark-uncollectible are Stripe's, and a local write of either
    // would make the projection refuse the provider's later truth.
    expect(internal?.payload.allowedActions).toEqual(["evaluate_dunning"]);
  });

  it("offers a draft amendment nothing but its artifact", async () => {
    const projections = await projectAggregate({
      topic: "core.amendments.create",
      aggregateType: "amendment",
      aggregateId: "84000000-0000-4000-8000-000000000001",
      accountId,
      data: { status: "draft", kind: "upgrade", effectiveOn: "2026-09-01" },
    });
    const internal = projections.find(
      (projection) => projection.audience === "internal",
    );
    // `apply` is the create command: it writes the amendment money in the same
    // transaction that records the acceptance.
    expect(internal?.payload.allowedActions).toEqual(["prepare_artifact"]);
  });

  it("binds the payload kind to the channel each audience reads", async () => {
    const projections = await projectQuote({
      status: "issued",
      totalMinor: "12500",
      currency: "USD",
      partnerAccountId,
    });
    for (const projection of projections)
      expect((projection.payload as Record<string, unknown>).kind).toBe(
        projection.channel,
      );
  });
});
