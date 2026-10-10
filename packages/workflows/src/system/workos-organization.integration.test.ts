import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";

import {
  createRuntimeDatabase,
  OrganizationOnboardingRepository,
} from "@clockwork/db";
import { FakeWorkosIdentityAdapter } from "@clockwork/integrations";

import {
  createWorkosOrganizationOutboxHandler,
  type WorkosOrganizationProvisioningStore,
} from "./workos-organization";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});

afterAll(async () => {
  await client.end();
});

it("starts the WorkOS organization from the event staff set-up writes", async () => {
  const suffix = randomUUID().slice(0, 8);
  const created = await new OrganizationOnboardingRepository(db).create(
    {
      id: randomUUID(),
      legalName: `Outbox Payload ${suffix} Ltd`,
      side: "customer",
      country: "GB",
      currency: "GBP",
      domain: `outbox-${suffix}.test`,
      registeredAddress: {
        line1: "1 Archive Way",
        city: "London",
        postalCode: "EC1A 1AA",
      },
      billingContact: { name: "Ada", email: `ada@outbox-${suffix}.test` },
      invoiceDeliveryEmail: `ada@outbox-${suffix}.test`,
    },
    { kind: "user", id: randomUUID(), display: "Ops" },
  );
  // The message exactly as the outbox holds it for the worker.
  const [message] = await client<
    { id: string; event_id: string; topic: string; payload: unknown }[]
  >`select m.id, m.event_id, m.topic, m.payload
    from outbox_messages m join audit_events e on e.id = m.event_id
    where e.aggregate_type = 'organization' and e.aggregate_id = ${created.organizationId}
      and e.event_type = 'organization.created'`;
  if (!message) throw new Error("organization.created was not written");
  expect(message.topic).toBe("organization.created");

  const persist = vi.fn<WorkosOrganizationProvisioningStore["persist"]>(() =>
    Promise.resolve(),
  );
  const identity = new FakeWorkosIdentityAdapter();
  const createOrganization = vi.spyOn(identity, "createOrganization");
  await createWorkosOrganizationOutboxHandler({
    identity,
    store: {
      load: (organizationId) =>
        Promise.resolve({
          organizationId,
          accountId: created.accountId,
          legalName: created.legalName,
          completed: false,
        }),
      persist,
    },
  })({
    messageId: message.id,
    eventId: message.event_id,
    topic: message.topic,
    payload: message.payload,
    idempotencyKey: `outbox:${message.id}`,
  });
  expect(createOrganization).toHaveBeenCalledWith(
    expect.objectContaining({
      commerceOrganizationId: created.organizationId,
      legalName: created.legalName,
    }),
  );
  expect(persist).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: created.organizationId,
      accountId: created.accountId,
      mfaPolicy: "required",
    }),
  );
});
