/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- synchronous in-memory implementations model the async provider and repository contracts; assertions inspect mocks, never unbound real methods. */
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Actor, ContractSigningRecord } from "@clockwork/contracts";
import type { SignWellContractDocument } from "@clockwork/integrations";
import { fixtureSigningRecord } from "../../contracts/src/contract-fixture";
import {
  ContractSigningWorkflow,
  type ContractSigningClient,
} from "./contracts";

const actor: Actor = { kind: "user", id: randomUUID(), display: "Revenue" };

function setup(patch: Partial<ContractSigningRecord> = {}) {
  let record: ContractSigningRecord = {
    ...structuredClone(fixtureSigningRecord),
    ...patch,
  };
  let leased = false;
  const doc: SignWellContractDocument = {
    id: "019a44ac-0000-7000-8000-0000000000d5",
    status: "Created",
    test_mode: true,
    metadata: {
      commerce_contract_id: record.contractId,
      template_sha256: record.templateHash,
    },
    apply_signing_order: true,
    recipients: [
      {
        id: "counterparty",
        email: record.counterpartySigner.email,
        name: "Alex",
      },
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
  let archived: { bytes: Uint8Array; fileName: string } | undefined;
  const updates: Record<string, unknown>[] = [];
  const repo = {
    async claim() {
      if (leased) throw new Error("CONTRACT_BUSY");
      leased = true;
      return { record: structuredClone(record), token: randomUUID() };
    },
    async release() {
      leased = false;
    },
    async get() {
      return structuredClone(record);
    },
    async generatedPdf() {
      return Buffer.from("%PDF-prepared");
    },
    decide: vi.fn(),
    async update(
      _id: string,
      _token: string,
      next: Record<string, unknown>,
      _actor: Actor,
      executed?: { bytes: Uint8Array; fileName: string },
    ) {
      updates.push(next);
      if (executed) archived = executed;
      record = { ...record, ...next, version: record.version + 1 };
      return structuredClone(record);
    },
  };
  let reads = 0;
  const provider: ContractSigningClient = {
    createContractDraft: vi.fn(async () => structuredClone(doc)),
    getContract: vi.fn(async () => {
      // Field extraction finishes after the first read.
      if (++reads > 1 && doc.status === "Created") doc.status = "Draft";
      return structuredClone(doc);
    }),
    send: vi.fn(async () => {
      doc.status = "Sent";
    }),
    remind: vi.fn(async () => {}),
    completedPdf: vi.fn(async () => Buffer.from("%PDF-executed-with-audit")),
  };
  const wait = vi.fn(async () => {});
  return {
    workflow: new ContractSigningWorkflow(
      repo as unknown as ConstructorParameters<
        typeof ContractSigningWorkflow
      >[0],
      provider,
      wait,
    ),
    provider,
    doc,
    updates,
    record: () => record,
    archived: () => archived,
    wait,
  };
}

it("refuses to send a request that still needs approval, before calling SignWell", async () => {
  const { workflow, provider, record } = setup({ approvalState: "pending" });
  await expect(workflow.send(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_APPROVAL_REQUIRED",
  );
  expect(provider.createContractDraft).not.toHaveBeenCalled();
  expect(record().error).toBeNull();
});

it("binds the unsent draft before sending, waits for field extraction, then sends once", async () => {
  const { workflow, provider, record, updates, wait } = setup();
  const sent = await workflow.send(record().contractId, actor);
  expect(sent.state).toBe("sent");
  expect(provider.createContractDraft).toHaveBeenCalledOnce();
  expect(provider.send).toHaveBeenCalledExactlyOnceWith(
    "019a44ac-0000-7000-8000-0000000000d5",
    true,
  );
  expect(wait).toHaveBeenCalledOnce();
  expect(updates.map((u) => u.state ?? u.providerId)).toEqual([
    "preparing",
    "ready",
    "sending",
    "sent",
  ]);
  // The binding commits before the send call.
  const bindIndex = updates.findIndex((u) => u.providerId);
  expect(bindIndex).toBeLessThan(
    updates.findIndex((u) => u.state === "sending"),
  );
});

it("retries against the same provider document instead of creating another", async () => {
  const { workflow, provider, doc, record } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "ready",
  });
  doc.status = "Draft";
  await workflow.send(record().contractId, actor);
  expect(provider.createContractDraft).not.toHaveBeenCalled();
  expect(provider.send).toHaveBeenCalledOnce();
});

it("archives the executed PDF when a wakeup finds the document completed", async () => {
  const { workflow, doc, record, archived } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "sent",
  });
  doc.status = "Completed";
  const done = await workflow.sync(record().contractId, {
    kind: "provider",
    id: "signwell",
  });
  expect(done.state).toBe("completed");
  expect(archived()).toEqual({
    bytes: Buffer.from("%PDF-executed-with-audit"),
    fileName: "Fil One Engine Test Fixture: Bluefin Data Co. (executed).pdf",
  });
});

it("records a provider failure without its response and releases the lease", async () => {
  const { workflow, provider, record } = setup();
  vi.mocked(provider.createContractDraft).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_500"),
  );
  await expect(workflow.send(record().contractId, actor)).rejects.toThrow(
    "SIGNWELL_HTTP_500",
  );
  expect(record().error).toBe("provider_unavailable");
  await expect(
    workflow.cancel(record().contractId, actor),
  ).resolves.toMatchObject({
    state: "canceled",
  });
});

it("only cancels drafts that were never sent", async () => {
  const { workflow, record } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "sent",
  });
  await expect(workflow.cancel(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_CANCEL_IN_SIGNWELL",
  );
});
