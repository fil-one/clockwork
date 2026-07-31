import { createHash } from "node:crypto";

import type { WebhookVerifier } from "@clockwork/contracts";
import { IdempotencyKeySchema, ids } from "@clockwork/contracts";
import { describe, expect, it } from "vitest";

import {
  type EnvelopeRecord,
  type EsignWebhookEvent,
  EsignWebhookVerifier,
  FakeEsignAdapter,
  InMemoryEsignEnvelopeStore,
  signFakeEsignWebhook,
} from "./index";

const accountId = ids.account.parse("10000000-0000-4000-8000-000000000302");
const documentId = ids.document.parse("40000000-0000-4000-8000-000000000302");

describe("e-sign provider contract", () => {
  it("falls back from embedded to redirect and ingests signed PDF plus certificate", async () => {
    const adapter = new FakeEsignAdapter({
      capabilities: { embedded: false, redirect: true },
    });
    const documentBytes = new TextEncoder().encode("immutable agreement v3");
    const documentSha256 = createHash("sha256")
      .update(documentBytes)
      .digest("hex");
    const result = await adapter.createEnvelope({
      envelopeId: "agreement-envelope-contract-302",
      accountId,
      documentId,
      documentBytes,
      documentSha256,
      signers: [
        {
          email: "buyer@example.test",
          name: "Buyer Signer",
          role: "customer",
          order: 1,
          authorityTitle: "CFO",
          authorityAttestation: "I am authorized to bind the legal entity.",
        },
        {
          email: "counter@example.test",
          name: "Fil One Signer",
          role: "fil_one",
          order: 2,
        },
      ],
      preferredMode: "embedded",
      redirectUrl: "https://commerce.example.test/agreements/complete",
      idempotencyKey: IdempotencyKeySchema.parse("esign:envelope:contract:302"),
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        envelopeId: "agreement-envelope-contract-302",
        signingMode: "redirect",
        state: "sent",
      },
    });
    if (!result.ok) throw new Error("expected envelope");
    expect(result.value.providerEnvelopeId).toMatch(/^env_fake_/);
    adapter.complete(result.value.envelopeId);
    const evidence = await adapter.retrieveCompletedEvidence(
      result.value.envelopeId,
    );
    expect(evidence).toMatchObject({
      ok: true,
      value: {
        envelopeId: result.value.envelopeId,
        completedAt: "2026-07-31T16:00:00.000Z",
      },
    });
    if (evidence.ok) {
      expect(evidence.value.signedPdfSha256).toHaveLength(64);
      expect(evidence.value.certificateSha256).toHaveLength(64);
    }
  });

  it("verifies and normalizes a bound envelope without claiming replay", async () => {
    const secret = "esign_contract_secret_302";
    const store = new InMemoryEsignEnvelopeStore();
    await store.save(envelopeBinding());
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        id: "esign_evt_contract_302",
        envelopeId: "env_contract_302",
        data: {
          envelopeId: "env_contract_302",
          externalReference: "agreement-envelope-contract-302",
        },
        type: "envelope.completed",
        state: "completed",
        occurredAt: "2026-07-31T16:00:00.000Z",
      }),
    );
    const timestamp = 1_775_059_200;
    const verifier = new EsignWebhookVerifier(secret, store, () => timestamp);
    const contract: WebhookVerifier<EsignWebhookEvent> = verifier;
    const signature = signFakeEsignWebhook({ secret, timestamp, rawBody });
    const first = await contract.verify({ rawBody, signature });
    expect(first).toEqual({
      eventId: "esign_evt_contract_302",
      occurredAt: "2026-07-31T16:00:00.000Z",
      payload: {
        providerEventId: "esign_evt_contract_302",
        envelopeId: "agreement-envelope-contract-302",
        providerEnvelopeId: "env_contract_302",
        accountId,
        documentId,
        type: "envelope.completed",
        state: "completed",
        occurredAt: "2026-07-31T16:00:00.000Z",
      },
    });
    await expect(verifier.verify({ rawBody, signature })).resolves.toEqual(
      first,
    );
  });

  it("rejects tampering, envelope aliasing, unbound resources, and stale signatures", async () => {
    const secret = "esign_contract_secret_302";
    const timestamp = 1_775_059_200;
    const store = new InMemoryEsignEnvelopeStore();
    await store.save(envelopeBinding());
    const event = {
      id: "esign_evt_contract_302",
      envelopeId: "env_contract_302",
      data: {
        envelopeId: "env_contract_302",
        externalReference: "agreement-envelope-contract-302",
      },
      type: "envelope.completed",
      state: "completed",
      occurredAt: "2026-07-31T16:00:00.000Z",
    };
    const rawBody = encode(event);
    const signature = signFakeEsignWebhook({ secret, timestamp, rawBody });
    const altered = new TextEncoder().encode(
      new TextDecoder().decode(rawBody).replace("completed", "declined"),
    );
    const verifier = new EsignWebhookVerifier(secret, store, () => timestamp);
    await expect(
      verifier.verify({ rawBody: altered, signature }),
    ).rejects.toThrow("signature");

    const alias = encode({
      ...event,
      data: { ...event.data, envelopeId: "env_other" },
    });
    await expect(
      verifier.verify({
        rawBody: alias,
        signature: signFakeEsignWebhook({ secret, timestamp, rawBody: alias }),
      }),
    ).rejects.toThrow("identity mismatch");

    const wrongReference = encode({
      ...event,
      data: { ...event.data, externalReference: "agreement-envelope-other" },
    });
    await expect(
      verifier.verify({
        rawBody: wrongReference,
        signature: signFakeEsignWebhook({
          secret,
          timestamp,
          rawBody: wrongReference,
        }),
      }),
    ).rejects.toThrow("external reference mismatch");

    const unbound = encode({
      ...event,
      envelopeId: "env_unbound",
      data: { envelopeId: "env_unbound", externalReference: "unknown" },
    });
    await expect(
      verifier.verify({
        rawBody: unbound,
        signature: signFakeEsignWebhook({
          secret,
          timestamp,
          rawBody: unbound,
        }),
      }),
    ).rejects.toThrow("not bound");

    await expect(
      verifier.verify({ rawBody, signature, toleranceSeconds: 0 }),
    ).resolves.toBeDefined();
    const staleVerifier = new EsignWebhookVerifier(
      secret,
      store,
      () => timestamp + 301,
    );
    await expect(staleVerifier.verify({ rawBody, signature })).rejects.toThrow(
      "outside tolerance",
    );
  });

  it("keeps provider and commerce envelope bindings immutable", async () => {
    const store = new InMemoryEsignEnvelopeStore();
    await store.save(envelopeBinding());
    await expect(
      store.save({
        ...envelopeBinding(),
        providerEnvelopeId: "env_rebound_302",
      }),
    ).rejects.toThrow("binding conflict");
    await expect(
      store.save({
        ...envelopeBinding(),
        envelopeId: "agreement-envelope-rebound-302",
      }),
    ).rejects.toThrow("provider envelope is rebound");
  });
});

function envelopeBinding(): EnvelopeRecord {
  return {
    envelopeId: "agreement-envelope-contract-302",
    providerEnvelopeId: "env_contract_302",
    accountId,
    documentId,
    state: "sent",
    signingMode: "redirect",
    signingUrl: "https://esign.example.test/env_contract_302",
    signers: [],
    createdAt: "2026-07-31T15:00:00.000Z",
  };
}

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
