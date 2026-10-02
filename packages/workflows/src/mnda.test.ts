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
    async update(_id, _token, patch, _actor, pdf) {
      if (pdf) archived = pdf;
      record = { ...record, ...patch, version: record.version + 1 };
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
    completedPdf: vi.fn(async () => Buffer.from("%PDF-completed-with-audit")),
  };
  return {
    workflow: new MndaWorkflow(repo, provider),
    provider,
    doc,
    record: () => record,
    archived: () => archived,
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
    "CANCEL_IN_SIGNWELL",
  );
  expect(s.provider.cancel).not.toHaveBeenCalled();
});
