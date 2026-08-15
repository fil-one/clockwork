import { createHash, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { accounts } from "../../schema";
import { accountContacts } from "../../schema/core/finance";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";
import { DatabaseNotificationTenantDirectory } from "./notification-branding";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});
const suffix = randomUUID().slice(0, 8);
const directory = new DatabaseNotificationTenantDirectory(db);

async function account(input: {
  roles: string[];
  agreementType?: string;
  parentPartnerId?: string;
}): Promise<string> {
  return withInternalTransaction(db, `branding-seed-${suffix}`, async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        legalName: `Branding ${randomUUID()}`,
        relationshipRoles: input.roles,
        registeredAddress: {
          line1: "1 Brand Way",
          city: "Boston",
          postalCode: "02108",
          country: "US",
        },
        billingContact: { name: "Contact", email: "billing@brand.test" },
        apContact: { name: "AP", email: "ap@brand.test" },
        invoiceDeliveryEmail: "ap@brand.test",
        domain: `brand-${randomUUID()}.test`,
        country: "US",
        currency: "USD",
        ...(input.agreementType
          ? { partnerAgreementType: input.agreementType }
          : {}),
        ...(input.parentPartnerId
          ? { parentPartnerId: input.parentPartnerId }
          : {}),
      })
      .returning({ id: accounts.id });
    if (!row) throw new Error("account insert expected");
    return row.id;
  });
}

async function contact(accountId: string, email: string): Promise<void> {
  await withInternalTransaction(db, `branding-contact-${suffix}`, (tx) =>
    tx.insert(accountContacts).values({
      accountId,
      kind: "commercial",
      name: "Commercial Contact",
      email,
    }),
  );
}

async function partnerBranding(input: {
  accountId: string;
  domain: string;
  brandName: string;
  communicationOwner: string;
}): Promise<void> {
  await withInternalTransaction(db, `branding-domain-${suffix}`, (tx) =>
    tx.insert(lifecyclePartnerDomains).values({
      accountId: input.accountId,
      domain: input.domain,
      verificationTokenHash: createHash("sha256")
        .update(input.domain)
        .digest("hex"),
      verifiedAt: new Date("2026-06-01T00:00:00.000Z"),
      brandName: input.brandName,
      primaryColor: "#123456",
      communicationOwner: input.communicationOwner,
    }),
  );
}

afterAll(async () => {
  await client.end();
});

// P0-46 white-label residue: `lifecycle_partner_domains` already held the brand
// name, colour, verified domain and communication owner, and no delivery path
// read any of it.
describe.sequential("notification tenant directory", () => {
  it("places a resold end client under its partner's verified branding", async () => {
    const partnerId = await account({
      roles: ["partner"],
      agreementType: "resale",
    });
    const domain = `partner-${suffix}-${randomUUID().slice(0, 6)}.test`;
    await partnerBranding({
      accountId: partnerId,
      domain,
      brandName: "Redwood Channel Group",
      communicationOwner: "partner",
    });
    const endClientId = await account({
      roles: ["end_client"],
      parentPartnerId: partnerId,
    });
    const email = `client-${suffix}@juniper.test`;
    await contact(endClientId, email);

    expect(await directory.resolve(email)).toMatchObject({
      accountId: endClientId,
      audience: "end_client",
      communicationOwner: "partner",
      brandingPolicy: {
        displayName: "Redwood Channel Group",
        customDomain: domain,
        customDomainVerified: true,
      },
    });
  });

  it("keeps a referral partner's client on the first-party sender", async () => {
    const partnerId = await account({
      roles: ["partner"],
      agreementType: "referral",
    });
    const clientId = await account({
      roles: ["end_client"],
      parentPartnerId: partnerId,
    });
    const email = `referred-${suffix}@example.test`;
    await contact(clientId, email);

    expect(await directory.resolve(email)).toMatchObject({
      audience: "end_client",
      communicationOwner: "fil_one",
    });
  });

  it("returns nothing for an address that is not an active commercial contact", async () => {
    expect(await directory.resolve(`unknown-${suffix}@example.test`)).toBe(
      undefined,
    );
  });

  it("resolves an address shared with a partner-owned account to the partner side", async () => {
    const partnerId = await account({
      roles: ["partner"],
      agreementType: "resale",
    });
    const directId = await account({ roles: ["direct_client"] });
    const sharedId = await account({
      roles: ["end_client"],
      parentPartnerId: partnerId,
    });
    const email = `shared-${suffix}@example.test`;
    await contact(directId, email);
    await contact(sharedId, email);

    expect(await directory.resolve(email)).toMatchObject({
      accountId: sharedId,
      audience: "end_client",
      communicationOwner: "partner",
    });
  });
});
