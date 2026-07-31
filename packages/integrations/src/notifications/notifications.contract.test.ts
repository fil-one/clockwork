import { IdempotencyKeySchema } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import { FakeLifecycleNotificationAdapter } from "./index";

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
