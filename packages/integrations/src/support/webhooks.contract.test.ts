import { ids, type WebhookVerifier } from "@clockwork/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  InMemorySupportWebhookBindingStore,
  SupportWebhookVerifier,
  signFakeSupportWebhook,
  type SupportWebhookBindingStore,
  type VerifiedSupportWebhookEvent,
} from "./webhooks";

const provider = "zendesk";
const secret = "support_contract_secret_310";
const timestamp = 1_785_584_400;
const accountId = ids.account.parse("10000000-0000-4000-8000-000000000310");
const otherAccountId = ids.account.parse(
  "10000000-0000-4000-8000-000000000311",
);

describe("support webhook provider contract", () => {
  it("verifies deterministically and emits only account-bound safe metadata", async () => {
    const verifier: WebhookVerifier<VerifiedSupportWebhookEvent> =
      supportVerifier();
    const rawBody = encode({
      ...supportEvent(),
      summary: "Customer database name must not persist",
      body: "A ticket body containing customer-provided text",
      text: "Free-form provider text",
      requesterEmail: "private@example.test",
      requester: { name: "Private Person", email: "private@example.test" },
    });
    const signature = signFakeSupportWebhook({
      secret,
      timestamp,
      rawBody,
    });

    const first = await verifier.verify({ rawBody, signature });
    const replay = await verifier.verify({ rawBody, signature });

    expect(replay).toEqual(first);
    expect(first).toEqual({
      eventId: "support-event-310",
      occurredAt: "2026-08-01T12:00:00.000Z",
      payload: {
        type: "support.signal.updated",
        eventId: "support-event-310",
        provider,
        accountId,
        externalSignalId: "ticket-310",
        sequence: 17,
        severity: "high",
        category: "provisioning",
        status: "open",
        occurredAt: "2026-08-01T12:00:00.000Z",
      },
    });
    const safePayload = JSON.stringify(first.payload);
    for (const sensitive of [
      "summary",
      "body",
      "text",
      "requester",
      "private@example.test",
      "Private Person",
      "Customer database name",
    ])
      expect(safePayload).not.toContain(sensitive);
  });

  it("rejects altered and stale raw bodies before binding resolution", async () => {
    const find = vi.fn<SupportWebhookBindingStore["find"]>();
    const verifier = new SupportWebhookVerifier(
      provider,
      secret,
      { find },
      () => timestamp,
    );
    const rawBody = encode(supportEvent());
    const signature = signFakeSupportWebhook({
      secret,
      timestamp,
      rawBody,
    });

    await expect(
      verifier.verify({
        rawBody: encode({ ...supportEvent(), severity: "critical" }),
        signature,
      }),
    ).rejects.toThrow("signature");
    expect(find).not.toHaveBeenCalled();

    const stale = new SupportWebhookVerifier(
      provider,
      secret,
      { find },
      () => timestamp + 301,
    );
    await expect(stale.verify({ rawBody, signature })).rejects.toThrow(
      "outside tolerance",
    );
    expect(find).not.toHaveBeenCalled();
  });

  it("fails closed for unbound accounts and provider or binding mismatches", async () => {
    const verifier = supportVerifier();
    await expectSignedFailure(
      verifier,
      { ...supportEvent(), externalAccountId: "account-unbound" },
      "not bound",
    );
    await expectSignedFailure(
      verifier,
      { ...supportEvent(), provider: "freshdesk" },
      "provider binding mismatch",
    );

    const mismatchedStore: Pick<SupportWebhookBindingStore, "find"> = {
      find: () =>
        Promise.resolve({
          provider,
          externalAccountId: "account-other",
          accountId,
        }),
    };
    const mismatched = new SupportWebhookVerifier(
      provider,
      secret,
      mismatchedStore,
      () => timestamp,
    );
    await expectSignedFailure(
      mismatched,
      supportEvent(),
      "account binding mismatch",
    );
  });

  it("keeps external-account bindings immutable", async () => {
    const store = supportBindings();
    await expect(
      store.save({
        provider,
        externalAccountId: "account-310",
        accountId: otherAccountId,
      }),
    ).rejects.toThrow("binding conflict");
    await expect(
      store.save({ provider, externalAccountId: "account-310", accountId }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["nonpositive sequence", { sequence: 0 }, "sequence"],
    ["fractional sequence", { sequence: 1.5 }, "sequence"],
    ["unknown status", { status: "closed" }, "status"],
    ["unknown severity", { severity: "urgent" }, "severity"],
    [
      "non-UTC time",
      { occurredAt: "2026-08-01T08:00:00-04:00" },
      "UTC instant",
    ],
    ["unsafe category", { category: "Customer words" }, "category"],
  ])("rejects %s", async (_label, override, message) => {
    await expectSignedFailure(
      supportVerifier(),
      { ...supportEvent(), ...override },
      message,
    );
  });

  it.each(["Z", "A", "UPPERCASE", "has/slash", `a${"b".repeat(40)}`])(
    "rejects provider identifier %s",
    (invalidProvider) => {
      expect(
        () =>
          new SupportWebhookVerifier(
            invalidProvider,
            secret,
            supportBindings(),
            () => timestamp,
          ),
      ).toThrow("provider identifier");
    },
  );
});

function supportBindings(): InMemorySupportWebhookBindingStore {
  return new InMemorySupportWebhookBindingStore([
    { provider, externalAccountId: "account-310", accountId },
  ]);
}

function supportVerifier(): SupportWebhookVerifier {
  return new SupportWebhookVerifier(
    provider,
    secret,
    supportBindings(),
    () => timestamp,
  );
}

function supportEvent() {
  return {
    type: "support.signal.updated",
    eventId: "support-event-310",
    provider,
    externalAccountId: "account-310",
    externalSignalId: "ticket-310",
    sequence: 17,
    severity: "high",
    category: "provisioning",
    status: "open",
    occurredAt: "2026-08-01T12:00:00Z",
  };
}

async function expectSignedFailure(
  verifier: SupportWebhookVerifier,
  event: unknown,
  message: string,
): Promise<void> {
  const rawBody = encode(event);
  await expect(
    verifier.verify({
      rawBody,
      signature: signFakeSupportWebhook({ secret, timestamp, rawBody }),
    }),
  ).rejects.toThrow(message);
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
