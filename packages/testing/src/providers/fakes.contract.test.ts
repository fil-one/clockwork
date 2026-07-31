import { createHash } from "node:crypto";

import {
  EventEnvelopeSchema,
  IdempotencyKeySchema,
  ids,
  MoneySchema,
} from "@clockwork/contracts";
import { createFakeProviderPorts } from "@clockwork/integrations/fakes";
import { describe, expect, it } from "vitest";

import { billingProviderContract } from "./contract";

billingProviderContract("fake", () => createFakeProviderPorts().billing);

describe("all fake provider ports", () => {
  it("implements every port with stable successful behavior", async () => {
    const providers = createFakeProviderPorts();
    const accountId = ids.account.parse("10000000-0000-4000-8000-000000000001");
    const organizationId = ids.organization.parse(
      "30000000-0000-4000-8000-000000000001",
    );
    const orderId = ids.order.parse("80000000-0000-4000-8000-000000000001");
    const invoiceId = ids.invoice.parse("90000000-0000-4000-8000-000000000001");
    const documentId = ids.document.parse(
      "40000000-0000-4000-8000-000000000001",
    );
    const key = IdempotencyKeySchema.parse("providers:contract:0001");
    const money = MoneySchema.parse({ currency: "USD", minor: "1000" });
    const event = EventEnvelopeSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      specVersion: "1.0",
      eventVersion: 1,
      type: "account.updated",
      occurredAt: "2026-07-31T16:00:00.000Z",
      requestId: "provider-contract",
      aggregate: { type: "account", id: accountId, version: 1 },
      actor: { kind: "system", id: "provider-contract" },
      data: {},
    });
    const evidence = new TextEncoder().encode("immutable evidence");
    const contentHash = createHash("sha256").update(evidence).digest("hex");

    const results = await Promise.all([
      providers.billing.createCustomer({
        accountId,
        email: "billing@example.test",
        idempotencyKey: key,
      }),
      providers.signature.createEnvelope({
        accountId,
        documentId,
        signerEmail: "signer@example.test",
        idempotencyKey: key,
      }),
      providers.provisioning.provision({
        orderId,
        organizationId,
        entitlements: [
          { sku: "LOCKED-STORAGE-TB", quantity: "1", region: "us-east-2" },
        ],
        idempotencyKey: key,
      }),
      providers.crm.projectEvent(event),
      providers.accounting.postInvoice({
        invoiceId,
        mode: "accounts_receivable",
        idempotencyKey: key,
      }),
      providers.screening.screen({
        accountId,
        legalName: "Fictional Customer",
        country: "US",
        reason: "registration",
      }),
      providers.tax.calculate({
        accountId,
        lines: [{ taxCode: "txcd_demo", amount: money }],
      }),
      providers.evidence.putImmutable({
        kind: "agreement",
        bytes: evidence,
        contentHash,
        retainUntil: "2033-07-31T16:00:00.000Z",
      }),
      providers.notifications.send({
        template: "invoice-issued",
        recipients: ["recipient@example.test"],
        data: {},
        idempotencyKey: key,
      }),
      providers.support.listSignals({ accountId }),
      providers.usage.pullUsage({
        organizationId,
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-31T16:00:00.000Z",
      }),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(providers.kernel.calls).toHaveLength(11);
  });

  it("rejects evidence whose declared immutable hash is wrong", async () => {
    const result = await createFakeProviderPorts().evidence.putImmutable({
      kind: "agreement",
      bytes: new TextEncoder().encode("evidence"),
      contentHash: "0".repeat(64),
      retainUntil: "2033-07-31T16:00:00.000Z",
    });
    expect(result).toMatchObject({
      ok: false,
      kind: "permanent",
      code: "CONTENT_HASH_MISMATCH",
    });
  });
});
