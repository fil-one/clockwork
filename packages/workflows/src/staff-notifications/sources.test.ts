import { describe, expect, it } from "vitest";

import {
  staffNotificationKindList,
  staffNotificationKinds,
} from "@clockwork/contracts";

import {
  staffNotificationSources,
  type StaffNotificationEvent,
  type StaffNotificationLookups,
} from "./sources";

const ids = {
  seller: "00000000-0000-4000-8000-0000000000a1",
  legal: "00000000-0000-4000-8000-0000000000a2",
  admin: "00000000-0000-4000-8000-0000000000a3",
  operator: "00000000-0000-4000-8000-0000000000a4",
  finance: "00000000-0000-4000-8000-0000000000a5",
};

/** Who holds what, as the database would answer. */
const holdings: Record<string, readonly string[]> = {
  [ids.seller]: ["mnda:send", "contract:read", "contract:write"],
  [ids.legal]: [
    "mnda:send",
    "contract:read",
    "contract:approve",
    "operations:read",
    "agreement:approve",
  ],
  [ids.admin]: [
    "mnda:send",
    "contract:read",
    "contract:approve",
    "operations:read",
    "operations:write",
    "quote:approve",
    "agreement:approve",
    "approval:self",
  ],
  [ids.operator]: ["contract:read", "operations:read", "operations:write"],
  [ids.finance]: [
    "contract:read",
    "contract:approve",
    "operations:read",
    "quote:approve",
  ],
};

function lookups(
  overrides: Partial<StaffNotificationLookups> = {},
): StaffNotificationLookups {
  return {
    holders: (permissions) =>
      Promise.resolve(
        Object.entries(holdings)
          .filter(([, held]) => permissions.every((p) => held.includes(p)))
          .map(([id]) => ({ id, email: `${id}@test`, name: id })),
      ),
    staffIdByEmail: (email) =>
      Promise.resolve(email === "admin@fil.one" ? ids.admin : null),
    canSelfApprove: (id) =>
      Promise.resolve(holdings[id]?.includes("approval:self") ?? false),
    mnda: (id) =>
      Promise.resolve({
        id,
        company: "Acme & Co",
        ownerId: ids.seller,
        countersignerEmail: "admin@fil.one",
        error: null,
      }),
    contract: (id) =>
      Promise.resolve({
        id,
        counterpartyName: "Acme",
        documentName: "Order form",
        createdById: ids.seller,
        preparerId: ids.seller,
        approvalRequired: true,
        approvalState: "pending",
        rejectionReason: "Fix the term",
        error: null,
      }),
    handoff: (id) =>
      Promise.resolve({
        id,
        counterpartyLegalName: "Acme, Inc.",
        requestedById: ids.seller,
        contractIds: ["c0000000-0000-4000-8000-000000000001"],
        decisionNote: "Wrong entity",
      }),
    capabilityRequest: (id) =>
      Promise.resolve({
        id,
        capabilityKey: "legal",
        requestedBy: ids.admin,
        status: "pending",
        decisionReason: "Not yet",
      }),
    priceBook: (id) =>
      Promise.resolve({ id, name: "List", currency: "USD", version: 4 }),
    approvalRequester: () => Promise.resolve(ids.finance),
    ...overrides,
  };
}

const event = (
  eventType: string,
  data: Record<string, unknown> = {},
): StaffNotificationEvent => ({
  eventId: "e0000000-0000-4000-8000-000000000001",
  eventType,
  aggregateType: "agreement",
  aggregateId: "a0000000-0000-4000-8000-000000000001",
  occurredAt: new Date().toISOString(),
  actor: { kind: "system", id: "test" },
  data,
});

async function resolve(
  eventType: string,
  data?: Record<string, unknown>,
  overrides?: Partial<StaffNotificationLookups>,
) {
  const source = staffNotificationSources[eventType];
  if (!source) throw new Error(`no source for ${eventType}`);
  return source(event(eventType, data), lookups(overrides));
}

describe("staff notification sources", () => {
  it("map every event to a declared kind", async () => {
    for (const eventType of Object.keys(staffNotificationSources)) {
      const resolution = await resolve(eventType, {
        activationRequestedBy: ids.finance,
        rejectedApprovalId: "ap000000-0000-4000-8000-000000000001",
      });
      if (!resolution) continue;
      expect(staffNotificationKindList).toContain(resolution.kind);
      expect(resolution.href.startsWith("/internal")).toBe(true);
    }
  });

  it("tell the MNDA sender and the Fil One countersigner when the partner signs", async () => {
    const r = await resolve("mnda.awaiting_countersignature");
    expect(r).toMatchObject({
      kind: "mnda.counterparty_signed",
      recipients: [ids.seller, ids.admin],
      href: "/internal/mndas?q=Acme%20%26%20Co",
      subject: "Acme & Co",
    });
  });

  it("tell only the sender about completion, attention, decline and expiry", async () => {
    for (const [eventType, kind] of [
      ["mnda.completed", "mnda.completed"],
      ["mnda.attention", "mnda.attention"],
      ["mnda.deleted_in_signwell", "mnda.attention"],
      ["mnda.signwell_mismatch", "mnda.attention"],
      ["mnda.declined", "mnda.declined"],
      ["mnda.expired", "mnda.expired"],
    ] as const)
      expect(await resolve(eventType)).toMatchObject({
        kind,
        recipients: [ids.seller],
      });
  });

  it("ask every contract approver except a preparer who cannot approve their own", async () => {
    const r = await resolve(
      "contract.prepared",
      {},
      {
        contract: (id) =>
          Promise.resolve({
            id,
            counterpartyName: "Acme",
            documentName: "Order form",
            createdById: ids.legal,
            preparerId: ids.legal,
            approvalRequired: true,
            approvalState: "pending",
            rejectionReason: null,
            error: null,
          }),
      },
    );
    expect(r?.kind).toBe("contract.approval_requested");
    expect([...(r?.recipients ?? [])].sort()).toEqual(
      [ids.admin, ids.finance].sort(),
    );
  });

  it("keep a preparer who may approve their own request among the approvers", async () => {
    const r = await resolve(
      "contract.prepared",
      {},
      {
        contract: (id) =>
          Promise.resolve({
            id,
            counterpartyName: "Acme",
            documentName: "Order form",
            createdById: ids.admin,
            preparerId: ids.admin,
            approvalRequired: true,
            approvalState: "pending",
            rejectionReason: null,
            error: null,
          }),
      },
    );
    expect(r?.recipients).toContain(ids.admin);
  });

  it("ask nobody when a prepared contract needs no approval", async () => {
    const r = await resolve(
      "contract.prepared",
      {},
      {
        contract: (id) =>
          Promise.resolve({
            id,
            counterpartyName: "Acme",
            documentName: "Order form",
            createdById: ids.seller,
            preparerId: ids.seller,
            approvalRequired: false,
            approvalState: "not_required",
            rejectionReason: null,
            error: null,
          }),
      },
    );
    expect(r).toBeNull();
  });

  it("tell the preparer about decisions and signing, with the note on a send-back", async () => {
    expect(await resolve("contract.rejected")).toMatchObject({
      kind: "contract.sent_back",
      recipients: [ids.seller],
      detail: "Fix the term",
    });
    for (const [eventType, kind] of [
      ["contract.approved", "contract.approved"],
      [
        "contract.signing_awaiting_countersignature",
        "contract.counterparty_signed",
      ],
      ["contract.signing_completed", "contract.executed"],
      ["contract.signing_attention", "contract.attention"],
      ["contract.signing_declined", "contract.declined"],
      ["contract.signing_expired", "contract.expired"],
    ] as const)
      expect(await resolve(eventType)).toMatchObject({
        kind,
        recipients: [ids.seller],
        detail: null,
      });
  });

  it("send a new handoff to operations and its progress to the requester", async () => {
    const requested = await resolve("handoff.requested");
    expect(requested?.kind).toBe("handoff.requested");
    expect([...(requested?.recipients ?? [])].sort()).toEqual(
      [ids.admin, ids.operator].sort(),
    );
    expect(requested?.href).toBe(
      `/internal/handoffs/${event("x").aggregateId}`,
    );
    const declined = await resolve("handoff.declined");
    expect(declined).toMatchObject({
      kind: "handoff.declined",
      recipients: [ids.seller],
      recordType: "contract",
      href: "/internal/contracts/c0000000-0000-4000-8000-000000000001",
      detail: "Wrong entity",
    });
  });

  it("ask a capability's own approvers and tell the requester the decision", async () => {
    const requested = await resolve("system.capability.activation_proposed");
    // Legal capabilities are approved under agreement:approve.
    expect(requested?.permissions).toEqual([
      "operations:read",
      "agreement:approve",
    ]);
    expect([...(requested?.recipients ?? [])].sort()).toEqual(
      [ids.admin, ids.legal].sort(),
    );
    expect(
      await resolve("system.capability.activation_rejected"),
    ).toMatchObject({
      kind: "capability.rejected",
      recipients: [ids.admin],
      detail: "Not yet",
    });
  });

  it("ask price-book approvers but the requester, and tell the requester the decision", async () => {
    const requested = await resolve("core.price_books.request_activation", {
      activationRequestedBy: ids.finance,
    });
    expect(requested).toMatchObject({
      kind: "price_book.approval_requested",
      subject: "List (USD v4)",
      recipients: [ids.admin],
    });
    expect(
      await resolve("core.price_books.activate", {
        activationRequestedBy: ids.finance,
      }),
    ).toMatchObject({ kind: "price_book.approved", recipients: [ids.finance] });
    expect(
      await resolve("core.price_books.reject_activation", {
        rejectedApprovalId: "ap000000-0000-4000-8000-000000000001",
        reason: "Discount too deep",
      }),
    ).toMatchObject({
      kind: "price_book.rejected",
      recipients: [ids.finance],
      detail: "Discount too deep",
    });
  });

  it("declare permissions for every kind", () => {
    for (const kind of staffNotificationKindList)
      expect(staffNotificationKinds[kind].permissions.length).toBeGreaterThan(
        0,
      );
  });
});
