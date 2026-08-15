import { IdempotencyKeySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  FakeLifecycleNotificationAdapter,
  TenantBrandedNotificationClient,
  type NotificationProviderClient,
  type NotificationRecipientContext,
  type NotificationTenantDirectory,
  type ResolvedBrand,
  type TenantBrandingPolicy,
} from "./index";

describe("lifecycle notification provider contract", () => {
  it("routes branded end-client invitations without partner commercial data", async () => {
    const adapter = new FakeLifecycleNotificationAdapter();
    const input = {
      template: "end-client-invitation" as const,
      recipients: [
        {
          email: "end-client@example.test",
          audience: "end_client" as const,
          accountId: "end-client-account",
        },
      ],
      data: {
        organizationName: "End Client Organization",
        activationUrl: "https://partner.example.test/activate",
        transferPrice: "4000",
        permittedData: "non-regulated",
        seeminglySafeButUnapproved: "partner margin hidden here",
      },
      communicationOwner: "partner" as const,
      brandingPolicy: {
        policyId: "brand-partner-307",
        displayName: "Trusted Partner",
        customDomain: "notify.partner.example",
        customDomainVerified: true,
      },
      idempotencyKey: IdempotencyKeySchema.parse(
        "notifications:end-client:contract:307",
      ),
    };
    const sent = await adapter.send(input);
    const replay = await adapter.send(input);
    expect(sent).toMatchObject({
      ok: true,
      value: { brand: "partner", fromDomain: "notify.partner.example" },
    });
    expect(replay.ok && replay.duplicate).toBe(true);
    expect(adapter.deliveries).toHaveLength(1);
    expect(adapter.deliveries[0]?.data).not.toHaveProperty("transferPrice");
    expect(adapter.deliveries[0]?.data).toMatchObject({
      permittedData: "non-regulated",
    });
    expect(adapter.deliveries[0]?.data).not.toHaveProperty(
      "seeminglySafeButUnapproved",
    );
  });

  it("uses a safe sender fallback until a partner custom domain is verified", async () => {
    const adapter = new FakeLifecycleNotificationAdapter();
    await expect(
      adapter.send({
        template: "end-client-invitation",
        recipients: [
          {
            email: "end-client@example.test",
            audience: "end_client",
            accountId: "end-client-account",
          },
        ],
        data: { organizationName: "Safe Default Client" },
        communicationOwner: "partner",
        brandingPolicy: {
          policyId: "unverified-brand-307",
          displayName: "Unverified Partner",
          customDomain: "unverified.partner.example",
          customDomainVerified: false,
        },
        idempotencyKey: IdempotencyKeySchema.parse(
          "notifications:safe-default:contract:307",
        ),
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        brand: "safe_default",
        fromDomain: "notifications.filone.example",
      },
    });
    expect(adapter.deliveries[0]?.brand.displayName).toBe("Commerce Services");
  });

  it("forbids partner commercial templates from targeting end clients", async () => {
    const adapter = new FakeLifecycleNotificationAdapter();
    await expect(
      adapter.send({
        template: "renewal-reminder",
        recipients: [
          {
            email: "end-client@example.test",
            audience: "end_client",
            accountId: "end-client-account",
          },
        ],
        data: { organizationName: "End Client", renewalDate: "2027-01-01" },
        communicationOwner: "partner",
        idempotencyKey: IdempotencyKeySchema.parse(
          "notifications:commercial-template:contract:307",
        ),
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "END_CLIENT_TEMPLATE_FORBIDDEN",
    });
  });
});

/**
 * The delivery boundary the production composition actually uses.
 *
 * `LifecycleNotificationAdapter` above has no importer outside this file:
 * production composes `CoreNotificationAdapter`, which hard-codes the
 * first-party brand and never redacts. These cover the decorator that closes
 * that, against the template names production really sends.
 */
describe("tenant-branded notification delivery", () => {
  const partnerPolicy: TenantBrandingPolicy = {
    policyId: "policy-1",
    displayName: "Redwood Channel Group",
    primaryColor: "#123456",
    customDomain: "redwood.test",
    customDomainVerified: true,
  };

  function client(
    contexts: Readonly<Record<string, NotificationRecipientContext>>,
  ) {
    const sent: {
      recipient: string;
      brand: ResolvedBrand;
      data: Readonly<Record<string, unknown>>;
    }[] = [];
    const inner: NotificationProviderClient = {
      send(input) {
        sent.push({
          recipient: input.recipient,
          brand: input.brand,
          data: input.data,
        });
        return Promise.resolve({ messageId: `msg_${sent.length}` });
      },
    };
    const directory: NotificationTenantDirectory = {
      resolve: (recipient) => Promise.resolve(contexts[recipient]),
    };
    return {
      sent,
      branded: new TenantBrandedNotificationClient(inner, () => directory),
    };
  }

  const firstParty: ResolvedBrand = {
    kind: "fil_one",
    displayName: "Fil One",
    fromDomain: "notifications.fil.one",
  };

  function message(recipient: string) {
    return {
      template: "renewals.term_end.v1",
      recipient,
      data: {
        subjectId: "8f2c0d3e-0000-4000-8000-00000000000a",
        window: "service_end",
        boundaryAt: "2027-01-01T00:00:00.000Z",
        transferPriceMinor: 125_000,
      },
      brand: firstParty,
      idempotencyKey: "notifications:branding:contract:0001",
    };
  }

  it("sends a resold end client under the partner brand, not ours", async () => {
    const { sent, branded } = client({
      "client@juniper.test": {
        accountId: "end-client-account",
        audience: "end_client",
        communicationOwner: "partner",
        brandingPolicy: partnerPolicy,
      },
    });
    await branded.send(message("client@juniper.test"));
    expect(sent[0]?.brand).toMatchObject({
      kind: "partner",
      displayName: "Redwood Channel Group",
      fromDomain: "redwood.test",
    });
  });

  it("redacts commercial data from the payload an end client receives", async () => {
    const { sent, branded } = client({
      "client@juniper.test": {
        accountId: "end-client-account",
        audience: "end_client",
        communicationOwner: "partner",
        brandingPolicy: partnerPolicy,
      },
    });
    await branded.send(message("client@juniper.test"));
    expect(sent[0]?.data).toEqual({
      subjectId: "8f2c0d3e-0000-4000-8000-00000000000a",
      window: "service_end",
      boundaryAt: "2027-01-01T00:00:00.000Z",
    });
    expect(sent[0]?.data).not.toHaveProperty("transferPriceMinor");
  });

  it("falls back to the neutral sender when a partner-owned tenant has no verified branding", async () => {
    const { sent, branded } = client({
      "client@juniper.test": {
        accountId: "end-client-account",
        audience: "end_client",
        communicationOwner: "partner",
      },
    });
    await branded.send(message("client@juniper.test"));
    expect(sent[0]?.brand.kind).toBe("safe_default");
    expect(sent[0]?.brand.displayName).not.toBe("Fil One");
  });

  it("leaves a direct customer on the first-party sender with its payload intact", async () => {
    const { sent, branded } = client({
      "billing@northstar.test": {
        accountId: "direct-account",
        audience: "customer",
        communicationOwner: "fil_one",
      },
    });
    await branded.send(message("billing@northstar.test"));
    expect(sent[0]?.brand.kind).toBe("fil_one");
    expect(sent[0]?.data).toHaveProperty("transferPriceMinor");
  });

  it("narrows an unregistered template for an end client rather than leaking it", async () => {
    const { sent, branded } = client({
      "client@juniper.test": {
        accountId: "end-client-account",
        audience: "end_client",
        communicationOwner: "partner",
        brandingPolicy: partnerPolicy,
      },
    });
    await branded.send({
      ...message("client@juniper.test"),
      template: "collections.final_notice.v1",
      data: { organizationName: "Juniper", outstandingMinor: 900_000 },
    });
    expect(sent[0]?.data).toEqual({ organizationName: "Juniper" });
  });

  it("refuses to deliver before the runtime directory is bound", async () => {
    const inner: NotificationProviderClient = {
      send: () => Promise.resolve({ messageId: "msg_unreachable" }),
    };
    const unbound = new TenantBrandedNotificationClient(inner, () => undefined);
    await expect(unbound.send(message("client@juniper.test"))).rejects.toThrow(
      "NOTIFICATION_TENANT_DIRECTORY_UNBOUND",
    );
  });
});
