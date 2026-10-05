/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- synchronous in-memory implementations model the async provider and repository contracts; assertions inspect mocks, never unbound real methods. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Actor } from "@clockwork/contracts";
import type { MndaRepository } from "@clockwork/db";
import type {
  MndaSigningProvider,
  SignWellDocument,
} from "@clockwork/integrations";
import { fixtureRecord } from "../../contracts/src/mnda-fixture";
import { MndaWorkflow } from "./mnda";
const actor: Actor = { kind: "user", id: fixtureRecord.ownerId };
function setup() {
  let record = structuredClone(fixtureRecord),
    leased = false;
  const doc: SignWellDocument = {
    id: "019a44ac-0000-7000-8000-000000000005",
    status: "Draft",
    test_mode: true,
    metadata: {
      commerce_mnda_id: record.id,
      template_sha256: record.templateHash,
    },
    apply_signing_order: true,
    recipients: [
      { id: "counterparty", email: record.input.signerEmail, name: "Alex" },
      { id: "fil-one", email: record.countersigner.email, name: "James" },
    ],
    fields: [
      ["counterparty", "fil-one"].flatMap((recipient_id) =>
        ["signature", "autofill_date_signed"].map((type) => ({
          recipient_id,
          type,
          required: true,
        })),
      ),
    ],
  };
  let archived: Uint8Array | undefined;
  const events: string[] = [];
  const repo: Pick<
    MndaRepository,
    "claim" | "release" | "update" | "get" | "readArtifact"
  > = {
    async claim() {
      if (leased) throw new Error("MNDA_BUSY");
      leased = true;
      return { record: structuredClone(record), token: randomUUID() };
    },
    async release() {
      leased = false;
    },
    async get() {
      return structuredClone(record);
    },
    async readArtifact() {
      return Buffer.from("%PDF-original");
    },
    async update(_id, _token, patch, _actor, pdf, note) {
      if (pdf) archived = pdf;
      const { remindedAt, ...rest } = patch;
      record = {
        ...record,
        ...rest,
        ...(remindedAt ? { remindedAt: remindedAt.toISOString() } : {}),
        version: record.version + 1,
      };
      events.push(note?.eventType ?? `mnda.${record.state}`);
      return structuredClone(record);
    },
  };
  const provider: MndaSigningProvider = {
    createDraft: vi.fn(async () => structuredClone(doc)),
    get: vi.fn(async () => structuredClone(doc)),
    send: vi.fn(async () => {
      doc.status = "Sent";
    }),
    remind: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    updateRecipient: vi.fn(
      async (_id: string, recipient: { id: string; email: string }) => {
        const partner = doc.recipients.find((r) => r.id === recipient.id);
        if (partner) {
          partner.email = recipient.email;
          partner.bounced = false;
        }
        return structuredClone(doc);
      },
    ),
    completedPdf: vi.fn(async () => Buffer.from("%PDF-completed-with-audit")),
  };
  return {
    workflow: new MndaWorkflow(repo, provider),
    provider,
    doc,
    record: () => record,
    archived: () => archived,
    events,
    setRecord: (patch: Partial<typeof fixtureRecord>) => {
      record = { ...record, ...patch };
    },
  };
}
it("persists the binding before sending and retries a lost send response without a second send", async () => {
  const s = setup();
  vi.mocked(s.provider.send).mockImplementationOnce(async (id) => {
    expect(s.record().providerId).toBe(id);
    s.doc.status = "Sent";
    throw new Error("timeout");
  });
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "timeout",
  );
  expect(s.record().providerId).toBe(s.doc.id);
  expect((await s.workflow.send(fixtureRecord.id, actor)).state).toBe("sent");
  expect(s.provider.createDraft).toHaveBeenCalledTimes(1);
  expect(s.provider.send).toHaveBeenCalledTimes(1);
});
it("never sends an unbound draft when creation fails", async () => {
  const s = setup();
  vi.mocked(s.provider.createDraft).mockRejectedValueOnce(
    new Error("lost response"),
  );
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow();
  expect(s.provider.send).not.toHaveBeenCalled();
  expect(s.record().providerId).toBeNull();
  await s.workflow.send(fixtureRecord.id, actor);
  expect(s.provider.send).toHaveBeenCalledTimes(1);
});
it("archives executed evidence before completion, and repeated callbacks cannot regress completion", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  s.doc.status = "Completed";
  vi.mocked(s.provider.completedPdf).mockRejectedValueOnce(
    new Error("archive unavailable"),
  );
  await expect(s.workflow.sync(fixtureRecord.id, actor)).rejects.toThrow();
  expect(s.record().state).toBe("sent");
  expect((await s.workflow.sync(fixtureRecord.id, actor)).state).toBe(
    "completed",
  );
  expect(Buffer.from(s.archived() ?? []).toString()).toContain("with-audit");
  s.doc.status = "Sent";
  await s.workflow.sync(fixtureRecord.id, actor);
  expect(s.record().state).toBe("completed");
  expect(s.provider.completedPdf).toHaveBeenCalledTimes(2);
});
it("rejects missing signing fields and never deletes bound provider evidence", async () => {
  const s = setup();
  s.doc.fields = [];
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "SIGNING_FIELDS",
  );
  expect(s.provider.send).not.toHaveBeenCalled();
  await expect(s.workflow.cancel(fixtureRecord.id, actor)).rejects.toThrow(
    "VOID_REQUIRED",
  );
  expect(s.provider.cancel).not.toHaveBeenCalled();
});

it("voids a sent request in SignWell with an audited reason", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  const voided = await s.workflow.void(
    fixtureRecord.id,
    actor,
    "Wrong legal entity",
  );
  expect(s.provider.cancel).toHaveBeenCalledExactlyOnceWith(s.doc.id);
  expect(voided).toMatchObject({
    state: "canceled",
    cancelReason: "Wrong legal entity",
    error: null,
  });
  expect(s.events.at(-1)).toBe("mnda.voided");
});
it("keeps a request that completed before the void and deletes nothing", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  s.doc.status = "Completed";
  await expect(
    s.workflow.void(fixtureRecord.id, actor, "Changed our mind"),
  ).rejects.toThrow("ALREADY_COMPLETED");
  expect(s.provider.cancel).not.toHaveBeenCalled();
  expect(s.record().state).toBe("completed");
  expect(Buffer.from(s.archived() ?? []).toString()).toContain("with-audit");
});
it("voids an unsent draft locally and discards drafts without SignWell", async () => {
  const s = setup();
  expect(
    (await s.workflow.void(fixtureRecord.id, actor, "Duplicate request")).state,
  ).toBe("canceled");
  expect(s.provider.cancel).not.toHaveBeenCalled();
  const t = setup();
  expect(await t.workflow.cancel(fixtureRecord.id, actor)).toMatchObject({
    state: "canceled",
    cancelReason: "discarded",
  });
});
it("closes a request deleted in SignWell instead of retrying forever", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.get).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_404"),
  );
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "canceled",
    error: "deleted_in_signwell",
  });
  const t = setup();
  await t.workflow.send(fixtureRecord.id, actor);
  vi.mocked(t.provider.get).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_503"),
  );
  await expect(t.workflow.sync(fixtureRecord.id, actor)).rejects.toThrow("503");
  expect(t.record().state).toBe("sent");
});
it("explains a bounce and fixes the partner email in place", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  const partner = s.doc.recipients[0];
  if (!partner) throw new Error("Expected partner");
  partner.bounced = true;
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "recipient_bounced",
  });
  const fixed = await s.workflow.correctSigner(
    fixtureRecord.id,
    actor,
    "right@example.com",
  );
  expect(s.provider.updateRecipient).toHaveBeenCalledExactlyOnceWith(s.doc.id, {
    id: "counterparty",
    name: fixtureRecord.input.signerName,
    email: "right@example.com",
  });
  expect(fixed).toMatchObject({
    state: "sent",
    error: null,
    correctedSignerEmail: "right@example.com",
  });
  expect(s.events).toContain("mnda.signer_corrected");
  await expect(
    s.workflow.correctSigner(
      fixtureRecord.id,
      actor,
      fixtureRecord.countersigner.email,
    ),
  ).rejects.toThrow("DISTINCT_SIGNERS");
});
it("refuses to change the email once the partner signed, and restores it when SignWell refuses", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.updateRecipient).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_422"),
  );
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("SIGNER_STARTED");
  expect(s.record().correctedSignerEmail).toBe(fixtureRecord.input.signerEmail);
  const partner = s.doc.recipients[0];
  if (partner) partner.status = "signed";
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("SIGNER_STARTED");
  expect(s.provider.updateRecipient).toHaveBeenCalledTimes(1);
});
it("spaces manual reminders from the last reminder, not from any update", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  await s.workflow.remind(fixtureRecord.id, actor);
  expect(s.events.at(-1)).toBe("mnda.reminded");
  await expect(s.workflow.remind(fixtureRecord.id, actor)).rejects.toThrow(
    "REMINDER_TOO_SOON",
  );
  s.setRecord({ remindedAt: new Date(Date.now() - 120_000).toISOString() });
  await s.workflow.remind(fixtureRecord.id, actor);
  expect(s.provider.remind).toHaveBeenCalledTimes(2);
});
