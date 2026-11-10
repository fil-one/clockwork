/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment -- assertions inspect mocks and Vitest asymmetric matchers */
import { randomUUID } from "node:crypto";
import { assert, expect, it, vi } from "vitest";
import type { SigningRecipient } from "@clockwork/contracts";
import type { SigningJourneyStore, SigningMailJob } from "@clockwork/db";
import type { SignWellSigningDocument } from "@clockwork/integrations";
import { SigningJourneyService, type JourneySource } from "./service";

function setup() {
  const recipient: SigningRecipient = {
    id: randomUUID(),
    nonce: randomUUID(),
    kind: "mnda",
    requestId: randomUUID(),
    providerId: randomUUID(),
    slot: "counterparty",
    email: "alex@example.test",
    name: "Alex",
    title: "NDA",
    testMode: true,
    signed: false,
    nextToSign: true,
    revoked: false,
  };
  const source: JourneySource = {
    kind: "mnda",
    id: recipient.requestId,
    version: 4,
    providerId: recipient.providerId,
    title: recipient.title,
    templateHash: "a".repeat(64),
    testMode: true,
    state: "sent",
    pendingCorrection: false,
    signers: [
      { id: "counterparty", email: recipient.email, name: "Alex" },
      { id: "fil-one", email: "fil@example.test", name: "Fil" },
    ],
    copies: [{ email: "copy@example.test", name: "Copy" }],
    pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-archived-with-audit")),
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const doc: SignWellSigningDocument = {
    id: recipient.providerId,
    status: "sent",
    test_mode: true,
    metadata: {
      commerce_mnda_id: recipient.requestId,
      template_sha256: source.templateHash,
      commerce_signing_experience: "fil_one",
    },
    recipients: source.signers.map((s) => ({
      ...s,
      status: "sent",
      embedded_signing_url: `https://www.signwell.com/docs/${s.id}/`,
    })),
    fields: [],
    apply_signing_order: true,
  };
  const store: SigningJourneyStore = {
    recipient: vi.fn().mockResolvedValue(recipient),
    reserveProviderRead: vi.fn().mockResolvedValue(true),
    recordAccess: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    synchronize: vi.fn().mockResolvedValue(undefined),
    claim: vi.fn().mockResolvedValue(null),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const send = vi.fn().mockResolvedValue({ ok: true });
  const document = vi.fn().mockResolvedValue(doc);
  const service = new SigningJourneyService({
    store,
    source: () => Promise.resolve(source),
    document,
    email: { send },
    origin: "https://commerce.example.test",
    linkSecret: "test-secret-for-signing-at-least-thirty-two-characters",
    testRecipients: new Set([recipient.email]),
  });
  const job: SigningMailJob = {
    id: randomUUID(),
    recipientId: recipient.id,
    recipientNonce: recipient.nonce,
    purpose: "invite",
    leaseToken: randomUUID(),
    attempts: 1,
  };
  const queue = () => vi.mocked(store.claim).mockResolvedValueOnce(job);
  return { recipient, source, doc, store, send, service, document, job, queue };
}

it("launches only the current signer; order, binding, copies and replacements fail closed", async () => {
  const s = setup();
  expect(await s.service.launch(s.recipient)).toContain("/counterparty/");
  await expect(
    s.service.launch({
      ...s.recipient,
      slot: "fil-one",
      email: "fil@example.test",
    }),
  ).rejects.toThrow("NOT_READY");
  await expect(
    s.service.launch({
      ...s.recipient,
      slot: "copy:copy@example.test",
      email: "copy@example.test",
    }),
  ).rejects.toThrow("NOT_READY");
  s.doc.recipients.reverse();
  await expect(s.service.launch(s.recipient)).rejects.toThrow("NOT_READY");
  s.source.providerId = randomUUID();
  await expect(s.service.launch(s.recipient)).rejects.toThrow("ACCESS_INVALID");
});
it("queues the countersigner only after the engine confirms the first signature", async () => {
  const s = setup();
  assert(s.doc.recipients[0]);
  s.doc.recipients[0].status = "signed";
  await s.service.synchronize("mnda", s.source.id);
  expect(s.store.synchronize).not.toHaveBeenCalled();
  s.source.state = "awaiting_countersignature";
  await s.service.synchronize("mnda", s.source.id);
  expect(s.store.synchronize).toHaveBeenCalledWith(
    expect.objectContaining({ nextSlot: "fil-one", sourceVersion: 4 }),
    undefined,
  );
  expect(
    await s.service.launch({
      ...s.recipient,
      slot: "fil-one",
      email: "fil@example.test",
    }),
  ).toContain("/fil-one/");
});
it("supports a Fil One-only signer without inventing a countersignature", async () => {
  const s = setup();
  s.source.signers = s.source.signers.slice(1);
  s.doc.recipients = s.doc.recipients.slice(1);
  const recipient = {
    ...s.recipient,
    slot: "fil-one",
    email: "fil@example.test",
  };
  expect((await s.service.view(recipient)).state).toBe("ready");
  expect(await s.service.launch(recipient)).toContain("/fil-one/");
});
it("uses archived evidence and never accepts provider completion ahead of the engine", async () => {
  const s = setup();
  s.doc.status = "completed";
  await s.service.synchronize("mnda", s.source.id);
  expect(s.store.synchronize).not.toHaveBeenCalled();
  await expect(s.service.download(s.recipient)).rejects.toThrow(
    "NOT_COMPLETED",
  );
  s.source.state = "completed";
  await s.service.synchronize("mnda", s.source.id);
  expect(s.store.synchronize).toHaveBeenCalledWith(
    expect.objectContaining({
      state: "completed",
      nextSlot: null,
      recipients: expect.arrayContaining([
        expect.objectContaining({ slot: "copy:copy@example.test" }),
      ]),
    }),
    undefined,
  );
  expect(Buffer.from(await s.service.download(s.recipient)).toString()).toBe(
    "%PDF-archived-with-audit",
  );
  vi.mocked(s.source.pdf).mockResolvedValue(new Uint8Array());
  await expect(s.service.download(s.recipient)).rejects.toThrow(
    "EVIDENCE_UNAVAILABLE",
  );
});
it("defers an invitation during correction or attention and sends when recovered", async () => {
  const s = setup();
  s.source.pendingCorrection = true;
  s.queue();
  await s.service.deliver();
  expect(s.store.finish).toHaveBeenLastCalledWith(
    s.job,
    "deferred",
    "CORRECTION_PENDING",
  );
  s.source.pendingCorrection = false;
  s.source.state = "attention";
  s.queue();
  await s.service.deliver();
  expect(s.store.finish).toHaveBeenLastCalledWith(
    s.job,
    "deferred",
    "NO_LONGER_APPLICABLE",
  );
  s.source.state = "sent";
  s.queue();
  await s.service.deliver();
  expect(s.send).toHaveBeenCalledOnce();
  expect(s.send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: "alex@example.test",
      text: expect.stringContaining(`/sign/${s.recipient.id}#`),
    }),
  );
  expect(s.store.finish).toHaveBeenLastCalledWith(s.job, "sent", undefined);
});
it("discards old-address jobs and late reminders without mailing anyone", async () => {
  const s = setup();
  s.recipient.nonce = randomUUID();
  s.queue();
  await s.service.deliver();
  expect(s.store.finish).toHaveBeenLastCalledWith(
    s.job,
    "skipped",
    "RECIPIENT_CHANGED",
  );
  await s.service.synchronize("mnda", s.source.id, randomUUID(), randomUUID());
  expect(s.document).not.toHaveBeenCalled();
  expect(s.send).not.toHaveBeenCalled();
});
it("blocks unapproved test recipients and retries transient email failures", async () => {
  const s = setup();
  s.source.signers = [
    { id: "counterparty", name: "Wrong", email: "wrong@example.test" },
  ];
  s.recipient.email = "wrong@example.test";
  s.queue();
  await s.service.deliver();
  expect(s.store.finish).toHaveBeenLastCalledWith(
    s.job,
    "failed",
    "TEST_RECIPIENT_NOT_ALLOWED",
  );
  expect(s.send).not.toHaveBeenCalled();
  s.recipient.email = "alex@example.test";
  s.source.signers = [
    { id: "counterparty", name: "Alex", email: s.recipient.email },
  ];
  s.send.mockResolvedValue({ ok: false, kind: "transient", code: "TIMEOUT" });
  s.queue();
  await s.service.deliver();
  expect(s.store.finish).toHaveBeenLastCalledWith(s.job, "pending", "TIMEOUT");
});
