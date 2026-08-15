import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createRuntimeDatabase } from "../../client";
import { accounts } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCrmAccountRecordStore } from "./crm-projection";

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
const store = new DatabaseCrmAccountRecordStore(db);

async function seedAccount(): Promise<{ id: string; rowVersion: number }> {
  return withInternalTransaction(db, `crm-seed-${suffix}`, async (tx) => {
    const [row] = await tx
      .insert(accounts)
      .values({
        legalName: `CRM Projection Target ${randomUUID()}`,
        relationshipRoles: ["direct_client"],
        registeredAddress: {
          line1: "1 Projection Way",
          city: "Boston",
          postalCode: "02108",
          country: "US",
        },
        billingContact: { name: "Dana Direct", email: "billing@crm.test" },
        apContact: { name: "Alex AP", email: "ap@crm.test" },
        invoiceDeliveryEmail: "ap@crm.test",
        domain: `crm-${randomUUID()}.test`,
        country: "US",
        currency: "USD",
      })
      .returning({ id: accounts.id, rowVersion: accounts.rowVersion });
    if (!row) throw new Error("account insert expected");
    return row;
  });
}

function read(accountId: string) {
  return withInternalTransaction(db, `crm-read-${suffix}`, (tx) =>
    tx.query.accounts.findFirst({
      columns: { crmRecordId: true, rowVersion: true },
      where: eq(accounts.id, accountId),
    }),
  );
}

afterAll(async () => {
  await client.end();
});

// P0-44: `crm_record_id` had exactly four references in the tree -- the DDL, the
// Drizzle column, a nullable contract field and a redaction-test regex. No
// insert or update ever assigned it.
describe.sequential("CRM account record binding", () => {
  it("writes the provider record onto the commerce account", async () => {
    const account = await seedAccount();
    await store.bindAccountRecord({
      accountId: account.id,
      crmRecordId: "crm_record_first",
      requestId: `crm-bind-${suffix}`,
    });
    const bound = await read(account.id);
    expect(bound?.crmRecordId).toBe("crm_record_first");
    // `touch_versioned_row` fires on every accounts update, so the bind is a
    // versioned write like any other; the replay case below is what keeps a
    // redelivery from turning into a second version bump.
    expect(bound?.rowVersion).toBe(account.rowVersion + 1);
  });

  it("treats a redelivered binding of the same record as a no-op", async () => {
    const account = await seedAccount();
    await store.bindAccountRecord({
      accountId: account.id,
      crmRecordId: "crm_record_replay",
      requestId: `crm-replay-a-${suffix}`,
    });
    const first = await read(account.id);
    await store.bindAccountRecord({
      accountId: account.id,
      crmRecordId: "crm_record_replay",
      requestId: `crm-replay-b-${suffix}`,
    });
    const second = await read(account.id);
    expect(second?.crmRecordId).toBe("crm_record_replay");
    // At-least-once delivery must not churn the account row on every redelivery.
    expect(second?.rowVersion).toBe(first?.rowVersion);
  });

  it("refuses to repoint an account at a different provider record", async () => {
    const account = await seedAccount();
    await store.bindAccountRecord({
      accountId: account.id,
      crmRecordId: "crm_record_bound",
      requestId: `crm-conflict-a-${suffix}`,
    });
    await expect(
      store.bindAccountRecord({
        accountId: account.id,
        crmRecordId: "crm_record_other",
        requestId: `crm-conflict-b-${suffix}`,
      }),
    ).rejects.toThrow("CRM_ACCOUNT_RECORD_CONFLICT");
    expect((await read(account.id))?.crmRecordId).toBe("crm_record_bound");
  });

  it("separates an unknown account from a conflicting one", async () => {
    await expect(
      store.bindAccountRecord({
        accountId: randomUUID(),
        crmRecordId: "crm_record_missing",
        requestId: `crm-missing-${suffix}`,
      }),
    ).rejects.toThrow("CRM_ACCOUNT_NOT_FOUND");
  });
});
