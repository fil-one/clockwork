/* eslint-disable @typescript-eslint/require-await -- in-memory fakes model async SignWell calls. */
/**
 * The signing lifecycle as one table of scenarios. `scenarios.test.ts` runs
 * every row against each workflow through `harness.ts`. Every behavior is
 * shared. A row covering something a type declares (approval, copying the
 * sender, a correctable signer) reads the declaration; where a table has no
 * column for a value, the row asks `differs(name)`, listed with its reason in
 * `expectedDifferences`.
 */
import { expect, vi } from "vitest";
import type { SigningHarness } from "./harness";

export interface SigningScenario {
  name: string;
  run(make: () => SigningHarness): Promise<void>;
}

const missing = () => new Error("SIGNWELL_HTTP_404");
const abort = () =>
  Object.assign(new Error("This operation was aborted"), {
    name: "AbortError",
  });
const quietly = () => vi.spyOn(console, "warn").mockImplementation(() => {});
/** Sends, then lets the test change SignWell's copy. */
async function sent(make: () => SigningHarness) {
  const h = make();
  await h.send();
  return h;
}

export const signingScenarios: readonly SigningScenario[] = [
  {
    name: "binds the provider document before sending, then sends once",
    async run(make) {
      const h = make();
      const result = await h.send();
      expect(result.state).toBe("sent");
      expect(h.provider.createDraft).toHaveBeenCalledOnce();
      expect(h.provider.send).toHaveBeenCalledExactlyOnceWith(h.doc.id, true);
      const bind = h.updates.findIndex((u) => u.providerId);
      expect(bind).toBeGreaterThan(-1);
      expect(bind).toBeLessThan(
        h.updates.findIndex((u) => u.state === "sending"),
      );
      expect(h.updates.map((u) => u.state ?? u.providerId)).toEqual([
        "preparing",
        "ready",
        "sending",
        "sent",
      ]);
    },
  },
  {
    name: "retries a lost send response against the same document",
    async run(make) {
      const h = make();
      h.provider.send.mockImplementationOnce(async (id: string) => {
        expect(h.record().providerId).toBe(id);
        h.doc.status = "Sent";
        throw new Error("timeout");
      });
      await expect(h.send()).rejects.toThrow("timeout");
      expect(h.record().providerId).toBe(h.doc.id);
      expect((await h.send()).state).toBe("sent");
      expect(h.provider.createDraft).toHaveBeenCalledOnce();
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "never sends an unbound draft and records the failure without its response",
    async run(make) {
      const h = make();
      h.provider.createDraft.mockRejectedValueOnce(
        new Error("SIGNWELL_HTTP_500"),
      );
      await expect(h.send()).rejects.toThrow("SIGNWELL_HTTP_500");
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(h.record()).toMatchObject({
        providerId: null,
        error: "provider_unavailable",
      });
      expect((await h.send()).state).toBe("sent");
    },
  },
  {
    name: "says a draft SignWell is still preparing was not sent",
    async run(make) {
      const h = make();
      h.doc.status = "Created";
      await expect(h.send()).rejects.toThrow(h.code("STILL_PREPARING"));
      expect(h.wait).toHaveBeenCalledTimes(8);
      expect(h.extendLease).toHaveBeenCalledTimes(9);
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(h.record()).toMatchObject({
        state: "preparing",
        providerId: h.doc.id,
        error: null,
      });
      h.doc.status = "Draft";
      expect((await h.send()).state).toBe("sent");
      expect(h.provider.createDraft).toHaveBeenCalledOnce();
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "renews the lease in each waiting round and before sending",
    async run(make) {
      const h = make();
      h.doc.status = "Created";
      let reads = 0;
      h.provider.get.mockImplementation(async () => {
        if (++reads > 1 && h.doc.status === "Created") h.doc.status = "Draft";
        return structuredClone(h.doc);
      });
      expect((await h.send()).state).toBe("sent");
      expect(h.wait).toHaveBeenCalledOnce();
      expect(h.extendLease).toHaveBeenCalledTimes(2);
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "stops when the lease is lost while waiting, recording no false failure",
    async run(make) {
      const h = make();
      h.doc.status = "Created";
      h.wait.mockImplementationOnce(async () => h.loseLease());
      const warn = quietly();
      await expect(h.send()).rejects.toThrow(h.code("LEASE_LOST"));
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `${h.log.label} send failure not recorded`,
        { [h.log.idKey]: h.record().id, error: h.code("LEASE_LOST") },
      );
      warn.mockRestore();
      expect(h.wait).toHaveBeenCalledOnce();
      expect(h.provider.send).not.toHaveBeenCalled();
      expect(h.record()).toMatchObject({ state: "ready", error: null });
    },
  },
  {
    name: "returns sending when SignWell accepted the send but the read back failed",
    async run(make) {
      const h = make();
      h.provider.send.mockImplementationOnce(async () => {
        h.doc.status = "Sent";
        h.provider.get.mockRejectedValueOnce(abort());
      });
      const warn = quietly();
      expect(await h.send()).toMatchObject({ state: "sending", error: null });
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `${h.log.label} state not read after send`,
        { [h.log.idKey]: h.record().id, error: "This operation was aborted" },
      );
      warn.mockRestore();
      expect(h.record()).toMatchObject({ state: "sending", error: null });
      expect((await h.sync()).state).toBe("sent");
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "flags a document deleted in SignWell right after it accepted the send",
    async run(make) {
      const h = make();
      h.provider.send.mockImplementationOnce(async () => {
        h.doc.status = "Sent";
        h.provider.get
          .mockRejectedValueOnce(missing())
          .mockRejectedValueOnce(missing());
      });
      await expect(h.send()).rejects.toThrow(h.code("NEEDS_ATTENTION"));
      expect(h.record()).toMatchObject({
        state: "attention",
        error: "deleted_in_signwell",
      });
      expect(h.events.at(-1)?.eventType).toBe(`${h.kind}.deleted_in_signwell`);
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "flags a draft deleted in SignWell before sending, and retries a single 404",
    async run(make) {
      const h = make();
      h.setRecord({ providerId: h.doc.id, state: "ready" });
      h.provider.get
        .mockRejectedValueOnce(missing())
        .mockRejectedValueOnce(missing());
      await expect(h.send()).rejects.toThrow(h.code("NEEDS_ATTENTION"));
      expect(h.record()).toMatchObject({
        state: "attention",
        error: "deleted_in_signwell",
      });
      expect(h.provider.send).not.toHaveBeenCalled();
      const once = await sent(make);
      once.provider.get.mockRejectedValueOnce(missing());
      expect(await once.sync()).toMatchObject({ state: "sent", error: null });
      // Later wakeups record nothing more.
      const gone = await sent(make);
      gone.provider.get.mockRejectedValue(missing());
      await gone.sync();
      const recorded = gone.events.length;
      await gone.sync();
      expect(gone.events).toHaveLength(recorded);
    },
  },
  {
    name: "records why a request needs attention: bounced or stopped",
    async run(make) {
      const bounced = await sent(make);
      bounced.partner().bounced = true;
      const stopped = await sent(make);
      stopped.doc.status = "Error";
      expect(await bounced.sync()).toMatchObject({
        state: "attention",
        error: "recipient_bounced",
      });
      expect(await stopped.sync()).toMatchObject({
        state: "attention",
        error: "provider_stopped",
      });
    },
  },
  {
    name: "holds a copy naming other signers or another binding, applying nothing from it",
    async run(make) {
      const h = await sent(make);
      h.filOne().email = "someone-else@example.com";
      h.doc.status = "Completed";
      const result = await h.sync();
      expect(result).toMatchObject({
        state: "attention",
        error: "signwell_signed_mismatch",
      });
      expect(h.provider.completedPdf).not.toHaveBeenCalled();
      expect(h.events.at(-1)).toMatchObject({
        eventType: `${h.kind}.signwell_mismatch`,
      });
      const recorded = h.events.length;
      await h.sync();
      expect(h.events).toHaveLength(recorded);
      await expect(h.void({ reason: "Wrong signer" })).rejects.toThrow(
        h.code("SIGNED_IN_SIGNWELL"),
      );
      await expect(h.remind()).rejects.toThrow(h.code("NOT_PENDING"));
      expect(h.provider.cancel).not.toHaveBeenCalled();

      const unsigned = await sent(make);
      unsigned.filOne().email = "someone-else@example.com";
      expect(await unsigned.sync()).toMatchObject({
        state: "attention",
        error: "signwell_signers_mismatch",
      });

      const binding = await sent(make);
      binding.doc.test_mode = false;
      expect(await binding.sync()).toMatchObject({
        state: "attention",
        error: "signwell_binding_mismatch",
      });
      binding.doc.test_mode = true;
      expect(await binding.sync()).toMatchObject({
        state: "sent",
        error: null,
      });
      binding.doc.test_mode = false;
      await binding.sync();
      expect(await binding.void({ reason: "Resend" })).toMatchObject({
        state: "canceled",
      });
      expect(binding.provider.cancel).toHaveBeenCalledExactlyOnceWith(
        binding.doc.id,
      );
    },
  },
  {
    name: "stops a send whose draft names other signers",
    async run(make) {
      const h = make();
      h.setRecord({ providerId: h.doc.id, state: "ready" });
      h.filOne().email = "someone-else@example.com";
      await expect(h.send()).rejects.toThrow(h.code("NEEDS_ATTENTION"));
      expect(h.record()).toMatchObject({
        state: "attention",
        error: "signwell_signers_mismatch",
      });
      expect(h.provider.send).not.toHaveBeenCalled();
    },
  },
  {
    name: "keeps a signed mismatched copy held as signed when a send finds it",
    async run(make) {
      const h = await sent(make);
      h.filOne().email = "someone-else@example.com";
      h.partner().status = "signed";
      await h.sync();
      const recorded = h.events.length;
      await expect(h.send()).rejects.toThrow(h.code("NEEDS_ATTENTION"));
      expect(h.record()).toMatchObject({
        state: "attention",
        error: "signwell_signed_mismatch",
      });
      // Not flipped to a plain signer mismatch and back, one event each time.
      expect(h.events).toHaveLength(recorded);
      expect(h.provider.send).toHaveBeenCalledOnce();
    },
  },
  {
    name: "writes nothing when SignWell's state and the error are unchanged",
    async run(make) {
      const h = await sent(make);
      const quiet = h.updates.length;
      await h.sync();
      expect(h.updates).toHaveLength(quiet);
      h.partner().bounced = true;
      await h.sync();
      const once = h.updates.length;
      await h.sync();
      expect(h.updates).toHaveLength(once);
      // The same state with another error is not unchanged.
      const failed = make();
      failed.doc.status = "Sent";
      failed.setRecord({
        providerId: failed.doc.id,
        state: "sent",
        error: "provider_unavailable",
      });
      expect(await failed.sync()).toMatchObject({ state: "sent", error: null });
      expect(failed.updates).toHaveLength(1);
    },
  },
  {
    name: "says why a send found nothing to send",
    async run(make) {
      const declined = make();
      declined.setRecord({ providerId: declined.doc.id, state: "ready" });
      declined.doc.status = "Declined";
      const bounced = make();
      bounced.setRecord({ providerId: bounced.doc.id, state: "ready" });
      bounced.partner().bounced = true;
      const canceled = make();
      canceled.setRecord({ state: "canceled" });
      await expect(declined.send()).rejects.toThrow(
        declined.code("NOT_PENDING"),
      );
      await expect(bounced.send()).rejects.toThrow(
        bounced.code("NEEDS_ATTENTION"),
      );
      await expect(canceled.send()).rejects.toThrow(
        canceled.code("NOT_PENDING"),
      );
      expect(declined.record()).toMatchObject({
        state: "declined",
        error: null,
      });
      expect(bounced.record().state).toBe("attention");
      expect(canceled.provider.get).not.toHaveBeenCalled();
      for (const h of [declined, bounced, canceled])
        expect(h.provider.send).not.toHaveBeenCalled();
    },
  },
  {
    name: "rejects missing signing fields, and keeps bound evidence from a discard",
    async run(make) {
      const h = make();
      h.doc.fields = [];
      await expect(h.send()).rejects.toThrow("SIGNING_FIELDS");
      expect(h.provider.send).not.toHaveBeenCalled();
      await expect(h.cancel()).rejects.toThrow(h.code("VOID_REQUIRED"));
      expect(h.provider.cancel).not.toHaveBeenCalled();
    },
  },
  {
    name: "stores the executed PDF with completion, and completion is final",
    async run(make) {
      const h = await sent(make);
      h.doc.status = "Completed";
      h.provider.completedPdf.mockRejectedValueOnce(
        new Error("archive unavailable"),
      );
      await expect(h.sync()).rejects.toThrow("archive unavailable");
      expect(h.record().state).toBe("sent");
      expect((await h.sync()).state).toBe("completed");
      expect(Buffer.from(h.archived() ?? []).toString()).toContain(
        "with-audit",
      );
      h.doc.status = "Sent";
      expect((await h.sync()).state).toBe("completed");
      expect(h.provider.completedPdf).toHaveBeenCalledTimes(2);
    },
  },
  {
    name: "reads SignWell before a void and never deletes what anyone signed",
    async run(make) {
      const signed = await sent(make);
      signed.partner().status = "signed";
      await expect(signed.void({ reason: "Too late" })).rejects.toThrow(
        signed.code("NOT_VOIDABLE"),
      );
      expect(signed.record().state).toBe("awaiting_countersignature");
      await expect(signed.void({ reason: "Too late" })).rejects.toThrow(
        signed.code("NOT_VOIDABLE"),
      );

      const completed = await sent(make);
      completed.doc.status = "Completed";
      await expect(completed.void({ reason: "Changed" })).rejects.toThrow(
        completed.code("ALREADY_COMPLETED"),
      );
      expect(completed.record().state).toBe("completed");
      expect(completed.archived()).toBeDefined();

      // A bounce outranks the signature in the applied state.
      const bounced = await sent(make);
      bounced.partner().status = "signed";
      bounced.filOne().bounced = true;
      await expect(bounced.void({ reason: "Bounced" })).rejects.toThrow(
        bounced.code("NOT_VOIDABLE"),
      );
      expect(bounced.record().state).toBe("attention");
      for (const h of [signed, completed, bounced])
        expect(h.provider.cancel).not.toHaveBeenCalled();
    },
  },
  {
    name: "voids with a typed reason or code, recorded on the request",
    async run(make) {
      const h = await sent(make);
      const voided = await h.void({ reason: "Wrong legal entity" });
      expect(voided).toMatchObject({ state: "canceled", error: null });
      expect(h.provider.cancel).toHaveBeenCalledExactlyOnceWith(h.doc.id);
      expect(h.events.at(-1)).toMatchObject({
        eventType: `${h.kind}.voided`,
        detail: { reason: "Wrong legal entity" },
      });
      const unsent = make();
      expect((await unsent.cancel()).state).toBe("canceled");
      if (h.differs("no_cancel_code")) return;
      expect(voided).toMatchObject({
        cancelCode: "voided",
        cancelReason: "Wrong legal entity",
      });
      expect(unsent.record().cancelCode).toBe("discarded");
      const changed = await sent(make);
      expect(await changed.void({ code: "signer_change" })).toMatchObject({
        cancelCode: "signer_change",
        cancelReason: null,
      });
      expect(changed.events.at(-1)?.detail).toEqual({
        cancelCode: "signer_change",
      });
    },
  },
  {
    name: "decides an unanswered delete by reading SignWell again",
    async run(make) {
      const deleted = await sent(make);
      deleted.provider.cancel.mockRejectedValueOnce(abort());
      deleted.provider.get
        .mockRejectedValueOnce(missing())
        .mockRejectedValueOnce(missing());
      expect((await deleted.void({ reason: "Duplicate" })).state).toBe(
        "canceled",
      );
      const kept = await sent(make);
      kept.provider.cancel.mockRejectedValueOnce(
        new Error("SIGNWELL_HTTP_502"),
      );
      await expect(kept.void({ reason: "Duplicate" })).rejects.toThrow("502");
      expect(kept.record().state).toBe("sent");
      kept.provider.cancel.mockRejectedValueOnce(
        new Error("SIGNWELL_HTTP_422"),
      );
      const reads = kept.provider.get.mock.calls.length;
      await expect(kept.void({ reason: "Duplicate" })).rejects.toThrow("422");
      // A refusal changed nothing, so only the void's own read happens.
      expect(kept.provider.get).toHaveBeenCalledTimes(reads + 1);
      expect(kept.record().state).toBe("sent");
    },
  },
  {
    name: "closes a request deleted in SignWell without calling delete",
    async run(make) {
      const h = await sent(make);
      h.provider.get.mockRejectedValue(missing());
      expect(await h.sync()).toMatchObject({
        state: "attention",
        error: "deleted_in_signwell",
      });
      expect(await h.void({ reason: "Gone" })).toMatchObject({
        state: "canceled",
        error: null,
      });
      expect(h.provider.cancel).not.toHaveBeenCalled();
    },
  },
  {
    name: "reminds whoever signs next, spaced from the last reminder",
    async run(make) {
      const h = await sent(make);
      await h.remind();
      expect(h.events.at(-1)).toMatchObject({
        eventType: `${h.kind}.reminded`,
        detail: { recipient: "counterparty" },
      });
      await expect(h.remind()).rejects.toThrow(h.code("REMINDER_TOO_SOON"));
      h.setRecord({ remindedAt: new Date(Date.now() - 120_000).toISOString() });
      h.partner().status = "signed";
      expect((await h.remind()).state).toBe("awaiting_countersignature");
      expect(h.events.at(-1)).toMatchObject({
        detail: { recipient: "fil-one" },
      });
      expect(h.provider.remind).toHaveBeenCalledTimes(2);
    },
  },
  {
    name: "refuses to remind a request that is not waiting or needs attention",
    async run(make) {
      const completed = await sent(make);
      completed.doc.status = "Completed";
      const bounced = await sent(make);
      bounced.partner().bounced = true;
      await expect(completed.remind()).rejects.toThrow(
        completed.code("NOT_PENDING"),
      );
      await expect(bounced.remind()).rejects.toThrow(
        bounced.code("REMIND_NEEDS_ATTENTION"),
      );
      expect(completed.record().state).toBe("completed");
      expect(bounced.record().state).toBe("attention");
      const unsent = make();
      await expect(unsent.remind()).rejects.toThrow(unsent.code("NOT_PENDING"));
      const gone = await sent(make);
      gone.provider.get.mockRejectedValue(missing());
      await expect(gone.remind()).rejects.toThrow(gone.code("NOT_PENDING"));
      for (const h of [completed, bounced, unsent, gone])
        expect(h.provider.remind).not.toHaveBeenCalled();
    },
  },
  {
    name: "corrects a bounced signer: pending, then confirmed by SignWell",
    async run(make) {
      const h = await sent(make);
      if (!h.declares.slots.some((slot) => slot.correctable)) {
        expect(h.correctSigner).toBeUndefined();
        return;
      }
      const correct = (email: string) => {
        if (!h.correctSigner) throw new Error("Expected correctSigner");
        return h.correctSigner(email);
      };
      h.partner().bounced = true;
      await h.sync();
      expect(await correct("right@example.com")).toMatchObject({
        state: "sent",
        error: null,
        correctedSignerEmail: "right@example.com",
        pendingSignerEmail: null,
      });
      expect(h.provider.updateRecipient).toHaveBeenCalledExactlyOnceWith(
        h.doc.id,
        expect.objectContaining({
          id: "counterparty",
          email: "right@example.com",
        }),
      );
      expect(h.events.map((e) => e.eventType)).toEqual(
        expect.arrayContaining([
          `${h.kind}.signer_correction_requested`,
          `${h.kind}.signer_corrected`,
        ]),
      );
      await expect(correct(h.filOne().email)).rejects.toThrow(
        h.code("DISTINCT_SIGNERS_REQUIRED"),
      );
    },
  },
  {
    name: "settles a correction SignWell refused or answered unclearly",
    async run(make) {
      const refused = await sent(make);
      if (!refused.declares.slots.some((slot) => slot.correctable)) return;
      const correct = (h: SigningHarness, email: string) => {
        if (!h.correctSigner) throw new Error("Expected correctSigner");
        return h.correctSigner(email);
      };
      refused.provider.updateRecipient?.mockRejectedValueOnce(
        new Error("SIGNWELL_HTTP_422"),
      );
      await expect(correct(refused, "right@example.com")).rejects.toThrow(
        refused.code("SIGNER_STARTED"),
      );
      expect(refused.record()).toMatchObject({
        pendingSignerEmail: null,
        correctedSignerEmail: null,
      });

      // Unknown outcome: SignWell applied it, and the read back shows it.
      const unclear = await sent(make);
      unclear.provider.updateRecipient?.mockImplementationOnce(async () => {
        unclear.partner().email = "right@example.com";
        throw abort();
      });
      expect(await correct(unclear, "right@example.com")).toMatchObject({
        correctedSignerEmail: "right@example.com",
      });

      // Unknown outcome and an unreadable SignWell: the next read settles it.
      const later = await sent(make);
      later.provider.updateRecipient?.mockImplementationOnce(async () => {
        later.partner().email = "right@example.com";
        later.provider.get.mockRejectedValueOnce(
          new Error("SIGNWELL_HTTP_503"),
        );
        throw abort();
      });
      await expect(correct(later, "right@example.com")).rejects.toThrow(
        "aborted",
      );
      expect(later.record()).toMatchObject({
        pendingSignerEmail: "right@example.com",
        correctedSignerEmail: null,
      });
      expect(await later.sync()).toMatchObject({
        state: "sent",
        correctedSignerEmail: "right@example.com",
        pendingSignerEmail: null,
      });
    },
  },
  {
    name: "requires approval before any SignWell call where the type declares it",
    async run(make) {
      const h = make();
      if (h.declares.approval === "none") return;
      h.setRecord({ approvalState: "pending" });
      await expect(h.send()).rejects.toThrow(h.code("APPROVAL_REQUIRED"));
      expect(h.provider.createDraft).not.toHaveBeenCalled();
      expect(h.provider.get).not.toHaveBeenCalled();
      expect(h.record().error).toBeNull();
    },
  },
  {
    name: "checks the sender is copied where the type copies the sender",
    async run(make) {
      const h = make();
      if (!h.declares.copySender) return;
      delete h.doc.copied_contacts;
      const warn = quietly();
      expect((await h.send()).state).toBe("sent");
      expect(warn).toHaveBeenCalledWith(
        `${h.log.label} copied contacts not reported by SignWell`,
        { [h.log.idKey]: h.record().id, providerId: h.doc.id },
      );
      warn.mockRestore();
      const refused = make();
      refused.doc.copied_contacts = [];
      await expect(refused.send()).rejects.toThrow("COPIED_CONTACTS");
      expect(refused.provider.send).not.toHaveBeenCalled();
    },
  },
  {
    // The fakes model the repositories here; the repository integration
    // tests prove the repositories themselves.
    name: "fake model check: history goes to the request's own aggregate",
    async run(make) {
      const h = await sent(make);
      await h.remind();
      await h.void({ reason: "Duplicate" });
      expect(h.events.length).toBeGreaterThan(0);
      for (const event of h.events) {
        expect(event.aggregateId).toBe(h.record().id);
        expect(event.eventType.startsWith(`${h.kind}.`)).toBe(true);
      }
    },
  },
  {
    name: "fake model check: the first-sent time is set once",
    async run(make) {
      const h = make();
      await h.send();
      if (h.differs("no_sent_at")) {
        expect(h.record().sentAt).toBeUndefined();
        return;
      }
      const first = h.record().sentAt;
      expect(first).toEqual(expect.any(String));
      h.doc.status = "Viewed";
      await h.sync();
      expect(h.record().sentAt).toBe(first);
    },
  },
];
