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
    // The token holding the lease; writes with any other fail, as in the
    // repository.
    lease: ReturnType<typeof randomUUID> | undefined;
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
    "claim" | "extendLease" | "release" | "update" | "get" | "readArtifact"
  > = {
    async claim() {
      if (lease) throw new Error("MNDA_BUSY");
      lease = randomUUID();
      return { record: structuredClone(record), token: lease };
    },
    extendLease: vi.fn(async (_id: string, token: string) => {
      if (token !== lease) throw new Error("MNDA_LEASE_LOST");
    }),
    async release(_id, token) {
      if (token === lease) lease = undefined;
    },
    async get() {
      return structuredClone(record);
    },
    async readArtifact() {
      return Buffer.from("%PDF-original");
    },
    async update(_id, token, patch, _actor, pdf, note) {
      if (token !== lease) throw new Error("MNDA_LEASE_LOST");
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
  const wait = vi.fn(async () => {});
  return {
    workflow: new MndaWorkflow(repo, provider, wait),
    repo,
    provider,
    wait,
    doc,
    record: () => record,
    archived: () => archived,
    events,
    setRecord: (patch: Partial<typeof fixtureRecord>) => {
      record = { ...record, ...patch };
    },
    /** The lease expired and someone else claimed the request. */
    loseLease: () => {
      lease = randomUUID();
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
it("renews the lease while SignWell prepares the draft, then sends once", async () => {
  const s = setup();
  s.doc.status = "Created";
  let reads = 0;
  vi.mocked(s.provider.get).mockImplementation(async () => {
    // Field extraction finishes after the first read.
    if (++reads > 1 && s.doc.status === "Created") s.doc.status = "Draft";
    return structuredClone(s.doc);
  });
  expect((await s.workflow.send(fixtureRecord.id, actor)).state).toBe("sent");
  expect(s.wait).toHaveBeenCalledOnce();
  // The lease is renewed in each polling round and before sending.
  expect(s.repo.extendLease).toHaveBeenCalledTimes(2);
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it("reports a draft SignWell is still preparing instead of calling it sent", async () => {
  const s = setup();
  s.doc.status = "Created";
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_STILL_PREPARING",
  );
  expect(s.wait).toHaveBeenCalledTimes(8);
  expect(s.repo.extendLease).toHaveBeenCalledTimes(9);
  expect(s.provider.send).not.toHaveBeenCalled();
  // Bound and waiting under Drafts, not recorded as a SignWell failure.
  expect(s.record()).toMatchObject({
    state: "preparing",
    providerId: s.doc.id,
    error: null,
  });
  s.doc.status = "Draft";
  expect((await s.workflow.send(fixtureRecord.id, actor)).state).toBe("sent");
  expect(s.provider.createDraft).toHaveBeenCalledOnce();
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it("stops waiting when the lease is lost while SignWell prepares the draft", async () => {
  const s = setup();
  s.doc.status = "Created";
  s.wait.mockImplementationOnce(async () => s.loseLease());
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // MNDA_LEASE_LOST is shown as "busy"; recording a provider failure under
  // the lost lease fails too, so the request keeps no false SignWell error.
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_LEASE_LOST",
  );
  expect(warn).toHaveBeenCalledWith("MNDA send failure not recorded", {
    mndaId: fixtureRecord.id,
    error: "MNDA_LEASE_LOST",
  });
  warn.mockRestore();
  expect(s.wait).toHaveBeenCalledOnce();
  expect(s.provider.send).not.toHaveBeenCalled();
  expect(s.record()).toMatchObject({ state: "ready", error: null });
});
it("reports a request SignWell shows needs attention before sending as not sent", async () => {
  const s = setup();
  s.setRecord({ providerId: s.doc.id, state: "ready" });
  partnerOf(s.doc).bounced = true;
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
  );
  expect(s.record()).toMatchObject({
    state: "attention",
    error: "recipient_bounced",
  });
  expect(s.provider.send).not.toHaveBeenCalled();
});
it("reports a request nobody signs next as not pending instead of sent", async () => {
  const declined = setup();
  declined.setRecord({ providerId: declined.doc.id, state: "ready" });
  declined.doc.status = "Declined";
  await expect(declined.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NOT_PENDING",
  );
  expect(declined.record()).toMatchObject({ state: "declined", error: null });
  const canceled = setup();
  canceled.setRecord({ state: "canceled" });
  await expect(canceled.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NOT_PENDING",
  );
  expect(canceled.record().error).toBeNull();
  expect(canceled.provider.get).not.toHaveBeenCalled();
  expect(declined.provider.send).not.toHaveBeenCalled();
});
it("flags a document deleted in SignWell right after it accepted the send", async () => {
  const s = setup();
  vi.mocked(s.provider.send).mockImplementationOnce(async () => {
    s.doc.status = "Sent";
    vi.mocked(s.provider.get)
      .mockRejectedValueOnce(missing())
      .mockRejectedValueOnce(missing());
  });
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
  );
  expect(s.record()).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  expect(s.events.at(-1)).toBe("mnda.deleted_in_signwell");
  expect(s.provider.send).toHaveBeenCalledOnce();
});
it("returns the sent request when SignWell accepted the send but the read back failed", async () => {
  const s = setup();
  vi.mocked(s.provider.send).mockImplementationOnce(async () => {
    s.doc.status = "Sent";
    vi.mocked(s.provider.get).mockRejectedValueOnce(abort());
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const sent = await s.workflow.send(fixtureRecord.id, actor);
  expect(warn).toHaveBeenCalledWith("MNDA state not read after send", {
    mndaId: fixtureRecord.id,
    error: "This operation was aborted",
  });
  warn.mockRestore();
  expect(sent).toMatchObject({ state: "sending", error: null });
  expect(s.record()).toMatchObject({ state: "sending", error: null });
  // The next refresh settles it; nothing is sent twice.
  expect((await s.workflow.sync(fixtureRecord.id, actor)).state).toBe("sent");
  expect(s.provider.send).toHaveBeenCalledOnce();
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
  // Held for a person to void, rather than retried as a provider failure.
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
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
it("holds a draft whose reported copies leave out the sender, sending nothing", async () => {
  const s = setup();
  s.doc.copied_contacts = [];
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
  );
  expect(s.record()).toMatchObject({
    state: "attention",
    error: "signwell_copied_contacts_mismatch",
  });
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
it("refuses to remind a request SignWell shows is no longer waiting, keeping its new state", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  s.doc.status = "Completed";
  await expect(s.workflow.remind(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NOT_PENDING",
  );
  expect(s.record().state).toBe("completed");
  const bounced = setup();
  await bounced.workflow.send(fixtureRecord.id, actor);
  partnerOf(bounced.doc).bounced = true;
  await expect(
    bounced.workflow.remind(fixtureRecord.id, actor),
  ).rejects.toThrow("MNDA_REMIND_NEEDS_ATTENTION");
  expect(bounced.record().state).toBe("attention");
  expect(s.provider.remind).not.toHaveBeenCalled();
  expect(bounced.provider.remind).not.toHaveBeenCalled();
});
it("reminds the Fil One countersigner once the partner has signed", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  partnerOf(s.doc).status = "signed";
  const reminded = await s.workflow.remind(fixtureRecord.id, actor);
  expect(reminded.state).toBe("awaiting_countersignature");
  expect(s.provider.remind).toHaveBeenCalledOnce();
});
it("flags a document deleted in SignWell when sending, instead of reporting an outage", async () => {
  const s = setup();
  s.setRecord({ providerId: s.doc.id, state: "ready" });
  vi.mocked(s.provider.get)
    .mockRejectedValueOnce(missing())
    .mockRejectedValueOnce(missing());
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
  );
  expect(s.record()).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  expect(s.events.at(-1)).toBe("mnda.deleted_in_signwell");
  expect(s.provider.send).not.toHaveBeenCalled();
});
it("reports the original send failure when the lease was lost before it could be recorded", async () => {
  const s = setup();
  const update = vi.spyOn(s.repo, "update");
  vi.mocked(s.provider.createDraft).mockImplementationOnce(async () => {
    update.mockRejectedValue(new Error("MNDA_LEASE_LOST"));
    throw new Error("SIGNWELL_HTTP_502");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "SIGNWELL_HTTP_502",
  );
  expect(warn).toHaveBeenCalledWith("MNDA send failure not recorded", {
    mndaId: fixtureRecord.id,
    error: "MNDA_LEASE_LOST",
  });
  warn.mockRestore();
});
it("holds a request whose SignWell signers changed for a person, applying nothing from SignWell's copy", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  const filOne = s.doc.recipients[1];
  if (!filOne) throw new Error("Expected countersigner");
  filOne.email = "someone-else@example.com";
  // Resolves, so the SignWell callback is acknowledged instead of retried.
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "signwell_signers_mismatch",
  });
  expect(s.events.at(-1)).toBe("mnda.signwell_mismatch");
  partnerOf(s.doc).status = "signed";
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "signwell_signed_mismatch",
  });
  const recorded = s.events.length;
  await s.workflow.sync(fixtureRecord.id, actor);
  expect(s.events).toHaveLength(recorded);
  // SignWell's copy says the partner signed: never voided, never edited.
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Wrong signer" }),
  ).rejects.toThrow("MNDA_SIGNED_IN_SIGNWELL");
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("NOT_CORRECTABLE");
  // Not even with the address SignWell shows for the person who signed.
  await expect(
    s.workflow.correctSigner(
      fixtureRecord.id,
      actor,
      partnerOf(s.doc).email.toLowerCase(),
    ),
  ).rejects.toThrow("NOT_CORRECTABLE");
  expect(s.events).not.toContain("mnda.signer_corrected");
  await expect(s.workflow.remind(fixtureRecord.id, actor)).rejects.toThrow(
    "NOT_PENDING",
  );
  expect(s.provider.cancel).not.toHaveBeenCalled();
  expect(s.provider.updateRecipient).not.toHaveBeenCalled();
  expect(s.provider.remind).not.toHaveBeenCalled();
  expect(s.provider.completedPdf).not.toHaveBeenCalled();
});
it("voids a mismatched request nobody signed, and resumes when SignWell matches again", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  s.doc.test_mode = false;
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "signwell_binding_mismatch",
  });
  s.doc.test_mode = true;
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "sent",
    error: null,
  });
  s.doc.test_mode = false;
  await s.workflow.sync(fixtureRecord.id, actor);
  expect(
    await s.workflow.void(fixtureRecord.id, actor, { reason: "Resend" }),
  ).toMatchObject({ state: "canceled", cancelReason: "Resend" });
  expect(s.provider.cancel).toHaveBeenCalledExactlyOnceWith(s.doc.id);
});
it("stops a send when SignWell's draft names a different countersigner", async () => {
  const s = setup();
  s.setRecord({ providerId: s.doc.id, state: "ready" });
  const filOne = s.doc.recipients[1];
  if (!filOne) throw new Error("Expected countersigner");
  filOne.email = "someone-else@example.com";
  await expect(s.workflow.send(fixtureRecord.id, actor)).rejects.toThrow(
    "MNDA_NEEDS_ATTENTION",
  );
  expect(s.record()).toMatchObject({
    state: "attention",
    error: "signwell_signers_mismatch",
  });
  expect(s.provider.send).not.toHaveBeenCalled();
});
it("settles a correction SignWell applied late instead of refusing it as a signer mismatch", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  // The update times out and SignWell still shows the old email on read-back,
  // so the pending correction is dropped.
  vi.mocked(s.provider.updateRecipient).mockRejectedValueOnce(abort());
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "right@example.com"),
  ).rejects.toThrow("aborted");
  expect(s.record()).toMatchObject({
    pendingSignerEmail: null,
    correctedSignerEmail: null,
  });
  // SignWell applies it afterwards.
  partnerOf(s.doc).email = "right@example.com";
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "signwell_signers_mismatch",
  });
  expect(
    await s.workflow.correctSigner(
      fixtureRecord.id,
      actor,
      "right@example.com",
    ),
  ).toMatchObject({
    state: "sent",
    error: null,
    correctedSignerEmail: "right@example.com",
  });
  expect(s.events).toContain("mnda.signer_corrected");
  expect(s.provider.updateRecipient).toHaveBeenCalledTimes(1);
  // Any other email on a mismatched row is still refused.
  partnerOf(s.doc).email = "third@example.com";
  await s.workflow.sync(fixtureRecord.id, actor);
  await expect(
    s.workflow.correctSigner(fixtureRecord.id, actor, "fourth@example.com"),
  ).rejects.toThrow("NOT_CORRECTABLE");
  expect(s.provider.updateRecipient).toHaveBeenCalledTimes(1);
});
it("never voids a document the partner signed while the countersigner's email bounced", async () => {
  const s = setup();
  await s.workflow.send(fixtureRecord.id, actor);
  partnerOf(s.doc).status = "signed";
  const filOne = s.doc.recipients[1];
  if (!filOne) throw new Error("Expected countersigner");
  filOne.bounced = true;
  // A bounce outranks the signature in the applied state.
  expect(await s.workflow.sync(fixtureRecord.id, actor)).toMatchObject({
    state: "attention",
    error: "recipient_bounced",
  });
  await expect(
    s.workflow.void(fixtureRecord.id, actor, { reason: "Bounced" }),
  ).rejects.toThrow("MNDA_NOT_VOIDABLE");
  expect(s.provider.cancel).not.toHaveBeenCalled();
  expect(s.record().state).toBe("attention");
});
