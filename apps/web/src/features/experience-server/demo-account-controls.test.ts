import { describe, expect, it } from "vitest";

import type { SessionClaims } from "@clockwork/api";
import { createMemoryDemoStore } from "@clockwork/testing/demo-reset";

import {
  demoAccountRecord,
  demoMemberInvites,
  demoNotificationPreferences,
  demoProcurementProfile,
  handleDemoCustomerAccountControl,
} from "./demo-account-controls";

const accountId = "11000000-0000-4000-8000-000000000001";
const organizationId = "31000000-0000-4000-8000-000000000001";
const session: SessionClaims = {
  userId: "21000000-0000-4000-8000-000000000001",
  organizationId,
  accountIds: [accountId],
  roles: ["owner"],
  isInternalStaff: false,
  mfaVerified: true,
  recentAuthenticationVerified: true,
};

function mutation(
  path: string,
  method: "POST" | "PUT",
  body: unknown,
  key: string,
) {
  return new Request(`https://demo.test/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify(body),
  });
}

describe("demo customer account controls", () => {
  it("reads the exact core account version, updates it, and durably replays", async () => {
    const store = createMemoryDemoStore();
    const read = await handleDemoCustomerAccountControl(
      new Request(
        `https://demo.test/api/v1/core/records/accounts?accountId=${accountId}&limit=2`,
      ),
      session,
      store,
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      items: [{ id: accountId, rowVersion: 1 }],
      nextCursor: null,
    });

    const body = {
      id: accountId,
      accountId,
      action: "update",
      expectedVersion: 1,
      payload: {
        legalName: "Meridian Archive Labs LLC",
        invoiceDeliveryEmail: "invoices@meridian-archive.test",
        billingContact: {
          name: "Mara Voss",
          email: "mara.voss@meridian-archive.test",
        },
      },
    };
    const first = await handleDemoCustomerAccountControl(
      mutation(
        "/v1/core/commands/accounts",
        "POST",
        body,
        "account-update-key-0001",
      ),
      session,
      store,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotency-replayed")).toBe("false");
    expect(await first.json()).toMatchObject({
      record: { id: accountId, rowVersion: 2 },
    });

    const replay = await handleDemoCustomerAccountControl(
      mutation(
        "/v1/core/commands/accounts",
        "POST",
        body,
        "account-update-key-0001",
      ),
      session,
      store,
    );
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(demoAccountRecord(await store.read(), accountId)).toMatchObject({
      legalName: "Meridian Archive Labs LLC",
      rowVersion: 2,
    });

    const conflict = await handleDemoCustomerAccountControl(
      mutation(
        "/v1/core/commands/accounts",
        "POST",
        { ...body, expectedVersion: 2 },
        "account-update-key-0001",
      ),
      session,
      store,
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_CONFLICT",
    });
  });

  it("stores optional notification choices and refuses required-alert suppression", async () => {
    const store = createMemoryDemoStore();
    const saved = await handleDemoCustomerAccountControl(
      mutation(
        "/v1/notifications/preferences",
        "PUT",
        {
          accountId,
          alertKind: "renewal_term_window",
          channel: "email",
          enabled: false,
        },
        "notification-key-0001",
      ),
      session,
      store,
    );
    expect(saved.status).toBe(200);
    expect(demoNotificationPreferences(await store.read(), accountId)).toEqual([
      expect.objectContaining({
        alertKind: "renewal_term_window",
        enabled: false,
      }),
    ]);

    const required = await handleDemoCustomerAccountControl(
      mutation(
        "/v1/notifications/preferences",
        "PUT",
        {
          accountId,
          alertKind: "renewal_notice_window",
          channel: "email",
          enabled: false,
        },
        "notification-key-0002",
      ),
      session,
      store,
    );
    expect(required.status).toBe(422);
    expect(await required.json()).toMatchObject({
      code: "NOTIFICATION_ALERT_KIND_NOT_MANAGEABLE",
    });
  });

  it("persists a scoped pending invite and procurement profile", async () => {
    const store = createMemoryDemoStore();
    const invite = await handleDemoCustomerAccountControl(
      mutation(
        `/v1/lifecycle/organizations/${organizationId}/invites`,
        "POST",
        {
          accountId,
          email: "new.member@meridian-archive.test",
          role: "member",
          expiresAt: "2026-09-30T17:00:00.000Z",
        },
        "member-invite-key-0001",
      ),
      session,
      store,
    );
    expect(invite.status).toBe(201);
    expect(demoMemberInvites(await store.read(), accountId)).toEqual([
      expect.objectContaining({
        email: "new.member@meridian-archive.test",
        role: "member",
        status: "pending",
      }),
    ]);

    const procurement = await handleDemoCustomerAccountControl(
      mutation(
        `/v1/lifecycle/accounts/${accountId}/procurement-profile`,
        "PUT",
        {
          apContact: {
            name: "Mara Voss",
            email: "ap@meridian-archive.test",
          },
          invoiceDeliveryEmail: "invoices@meridian-archive.test",
          poRequired: true,
          exemptions: [],
          supplierDocuments: [],
          buyerPortalTasks: [],
        },
        "procurement-key-0001",
      ),
      session,
      store,
    );
    expect(procurement.status).toBe(200);
    expect(demoProcurementProfile(await store.read(), accountId)).toMatchObject(
      {
        poRequired: true,
        rowVersion: 2,
      },
    );
  });

  it("checks authority before consuming a mutation body", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("body consumed");
      },
    });
    const response = await handleDemoCustomerAccountControl(
      new Request("https://demo.test/api/v1/notifications/preferences", {
        method: "PUT",
        headers: { "idempotency-key": "notification-key-0003" },
        body,
        duplex: "half",
      } as RequestInit),
      { ...session, roles: ["member"] },
      createMemoryDemoStore(),
    );
    expect(response.status).toBe(403);
  });
});
