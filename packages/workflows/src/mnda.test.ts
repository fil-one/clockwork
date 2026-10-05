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
    copied_contacts: [{ email: "seller@example.com" }],
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

const abort = () =>
  Object.assign(new Error("This operation was aborted"), {
    name: "AbortError",
  });
const missing = () => new Error("SIGNWELL_HTTP_404");
const partnerOf = (doc: SignWellDocument) => {
  const partner = doc.recipients[0];
  if (!partner) throw new Error("Expected partner");
  return partner;
};

it("voids a sent request in SignWell with an audited reason", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  const voided = await s.workflow.void(fixtureRecord.id, actor, {
    reason: "Wrong legal entity",
  });
  expect(s.provider.cancel).toHaveBeenCalledExactlyOnceWith(s.doc.id);
  expect(voided).toMatchObject({
    state: "canceled",
    cancelCode: "voided",
    cancelReason: "Wrong legal entity",
    error: null,
  });
  expect(s.events.at(-1)).toBe("mnda.voided");
});
it("records a signer change as a code, not as typed text", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  expect(
    await s.workflow.void(fixtureRecord.id, actor, { code: "signer_change" }),
  ).toMatchObject({ cancelCode: "signer_change", cancelReason: null });
});
it("never voids once the partner has signed, even when only SignWell knows it", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  partnerOf(s.doc).status = "signed";
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Too late" }),
  ).rejects.toThrow("NOT_VOIDABLE");
  expect(s.record().state).toBe("awaiting_countersignature");
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Too late" }),
  ).rejects.toThrow("NOT_VOIDABLE");
  expect(s.provider.cancel).not.toHaveBeenCalled();
});
it("keeps a request that completed before the void and deletes nothing", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  s.doc.status = "Completed";
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Changed our mind" }),
  ).rejects.toThrow("ALREADY_COMPLETED");
  expect(s.provider.cancel).not.toHaveBeenCalled();
  expect(s.record().state).toBe("completed");
  expect(Buffer.from(s.archived() ?? []).toString()).toContain("with-audit");
});
it("records the void when SignWell deleted the document but the response was lost", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.cancel).mockRejectedValueOnce(abort());
  vi.mocked(s.provider.get)
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(missing());
  expect(
    await s.workflow.void(fixtureRecord.id, actor, { reason: "Duplicate" }),
  ).toMatchObject({ state: "canceled", cancelReason: "Duplicate" });
});
it("does not record a void when SignWell still has the document after a failed delete", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.cancel).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_502"),
  );
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Duplicate" }),
  ).rejects.toThrow("502");
  expect(s.record().state).toBe("sent");
  vi.mocked(s.provider.cancel).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_403"),
  );
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Duplicate" }),
  ).rejects.toThrow("403");
  // Two reads while sending, one per void and one after the ambiguous delete.
  expect(s.provider.get).toHaveBeenCalledTimes(5);
});
it("voids an unsent draft locally and discards drafts without SignWell", async () => {
  const s = setup();
  expect(
    (await s.workflow.void(fixtureRecord.id, actor, { reason: "Duplicate" }))
      .state,
  ).toBe("canceled");
  expect(s.provider.cancel).not.toHaveBeenCalled();
  const t = setup();
  expect(await t.workflow.cancel(fixtureRecord.id, actor)).toMatchObject({
    state: "canceled",
    cancelCode: "discarded",
  });
});
it("flags a document deleted in SignWell for a person instead of closing it", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.get).mockRejectedValueOnce(missing());
  expect((await s.workflow.sync(fixtureRecord.id, actor)).state).toBe("sent");
  vi.mocked(s.provider.get)
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(missing());
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  vi.mocked(s.provider.get)
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(missing());
  expect(
    await s.workflow.void(fixtureRecord.id, actor, { reason: "Gone" }),
  ).toMatchObject({ state: "canceled", cancelReason: "Gone" });
  expect(s.provider.cancel).not.toHaveBeenCalled();
  const t = setup();
  await t.workflow.send(fixtureRecord.id, actor);
  vi.mocked(t.provider.get).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_503"),
  );
  await expect(t.workflow.sync(fixtureRecord.id, actor)).rejects.toThrow("503");
  expect(t.record().state).toBe("sent");
});
it("never closes a request waiting on Fil One when SignWell loses it", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  partnerOf(s.doc).status = "signed";
  await s.workflow.sync(fixtureRecord.id, actor);
  vi.mocked(s.provider.get)
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(missing());
  expect((await s.workflow.sync(fixtureRecord.id, actor)).state).toBe(
    "attention",
  );
});
it("explains a bounce and fixes the partner email in place", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  partnerOf(s.doc).bounced = true;
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
    pendingSignerEmail: null,
  });
  expect(s.events).toContain("mnda.signer_correction_requested");
  expect(s.events).toContain("mnda.signer_corrected");
  await expect(
    s.workflow.correctSigner(
      fixtureRecord.id,
      actor,
      fixtureRecord.countersigner.email,
    ),
  ).rejects.toThrow("DISTINCT_SIGNERS");
});
it("keeps a correction SignWell applied when its response was lost, and settles it on the next refresh", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.updateRecipient).mockImplementationOnce(async () => {
    partnerOf(s.doc).email = "right@example.com";
    // The read-back fails too, so nothing confirms the change yet.
    vi.mocked(s.provider.get).mockRejectedValueOnce(
      new Error("SIGNWELL_HTTP_503"),
    );
    throw abort();
  });
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("aborted");
  expect(s.record()).toMatchObject({
    pendingSignerEmail: "right@example.com",
    correctedSignerEmail: null,
  });
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "sent",
    correctedSignerEmail: "right@example.com",
    pendingSignerEmail: null,
  });
  expect(s.events.at(-1)).toBe("mnda.signer_corrected");
});
it("reads back an unanswered correction immediately when SignWell can be reached", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.updateRecipient).mockImplementationOnce(async () => {
    partnerOf(s.doc).email = "right@example.com";
    throw abort();
  });
  expect(
    await s.workflow.correctSigner(
      fixtureRecord.id,
      actor,
      "right@example.com",
    ),
  ).toMatchObject({ correctedSignerEmail: "right@example.com" });
  const t = setup();
  await t.workflow.send(fixtureRecord.id, actor);
  vi.mocked(t.provider.updateRecipient).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_500"),
  );
  await expect(
    t.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("500");
  expect(t.record()).toMatchObject({
    pendingSignerEmail: null,
    correctedSignerEmail: null,
  });
});
it("drops the new email only when SignWell refuses it, and refuses after the partner signed", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  vi.mocked(s.provider.updateRecipient).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_422"),
  );
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("SIGNER_STARTED");
  expect(s.record()).toMatchObject({
    pendingSignerEmail: null,
    correctedSignerEmail: null,
  });
  partnerOf(s.doc).status = "signed";
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("SIGNER_STARTED");
  expect(s.provider.updateRecipient).toHaveBeenCalledTimes(1);
});
it("sends with a logged warning when SignWell does not report copied contacts", async () => {
  const s = setup();
  delete s.doc.copied_contacts;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect((await s.workflow.send(fixtureRecord.id, actor)).state).toBe("sent");
  expect(s.provider.send).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(
    "MNDA copied contacts not reported by SignWell",
    { mndaId: fixtureRecord.id, providerId: s.doc.id },
  );
  expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
  warn.mockRestore();
});
it("refuses to send when the reported copies leave out the sender", async () => {
  const s = setup();
  s.doc.copied_contacts = [];
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "COPIED_CONTACTS",
  );
  expect(s.provider.send).not.toHaveBeenCalled();
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
