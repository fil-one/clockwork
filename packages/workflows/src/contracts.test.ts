/* eslint-disable @typescript-eslint/require-await -- synchronous in-memory implementations model the async provider and repository contracts; assertions inspect mocks, never unbound real methods. */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Actor, ContractSigningRecord } from "@clockwork/contracts";
import type { SignWellContractDocument } from "@clockwork/integrations";
import { fixtureSigningRecord } from "../../contracts/src/contract-fixture";
import type { ContractSigningNote } from "@clockwork/db";
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
    ].filter((r) => record.counterpartySigns || r.id === "fil-one"),
    fields: [
      (record.counterpartySigns
        ? ["counterparty", "fil-one"]
        : ["fil-one"]
      ).flatMap((recipient_id) =>
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
  const notes: (ContractSigningNote | undefined)[] = [];
  let deleted = false;
  const repo = {
    async claim() {
      if (leased) throw new Error("CONTRACT_BUSY");
      leased = true;
      return { record: structuredClone(record), token: randomUUID() };
    },
    async release() {
      leased = false;
    },
    extendLease: vi.fn(async () => {}),
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
      note?: ContractSigningNote,
    ) {
      updates.push(next);
      notes.push(note);
      if (executed) archived = executed;
      const { remindedAt, ...rest } = next;
      record = {
        ...record,
        ...rest,
        ...(remindedAt instanceof Date
          ? { remindedAt: remindedAt.toISOString() }
          : {}),
        version: record.version + 1,
      };
      return structuredClone(record);
    },
  };
  let reads = 0;
  const provider: ContractSigningClient = {
    createContractDraft: vi.fn(async () => structuredClone(doc)),
    createCounterpartyPaperDraft: vi.fn(async () => structuredClone(doc)),
    getContract: vi.fn(async () => {
      if (deleted) throw new Error("SIGNWELL_HTTP_404");
      // Field extraction finishes after the first read.
      if (++reads > 1 && doc.status === "Created") doc.status = "Draft";
      return structuredClone(doc);
    }),
    send: vi.fn(async () => {
      doc.status = "Sent";
    }),
    remind: vi.fn(async () => {}),
    cancel: vi.fn(async () => {
      deleted = true;
    }),
    updateRecipient: vi.fn(
      async (_id: string, recipient: { id: string; email: string }) => {
        const signer = doc.recipients.find((r) => r.id === recipient.id);
        if (signer) {
          signer.email = recipient.email;
          signer.bounced = false;
        }
        return structuredClone(doc);
      },
    ),
    completedPdf: vi.fn(async () => Buffer.from("%PDF-executed-with-audit")),
  };
  const wait = vi.fn(async () => {});
  return {
    repo,
    workflow: new ContractSigningWorkflow(repo, provider, wait),
    provider,
    doc,
    updates,
    notes,
    deleteInSignWell: () => {
      deleted = true;
    },
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
  const { workflow, provider, record, updates, wait, repo } = setup();
  const sent = await workflow.send(record().contractId, actor);
  expect(sent.state).toBe("sent");
  expect(provider.createContractDraft).toHaveBeenCalledOnce();
  expect(provider.send).toHaveBeenCalledExactlyOnceWith(
    "019a44ac-0000-7000-8000-0000000000d5",
    true,
  );
  expect(wait).toHaveBeenCalledOnce();
  // The lease is renewed in each polling round and before sending.
  expect(repo.extendLease).toHaveBeenCalledTimes(2);
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

it("reports a draft SignWell is still preparing instead of calling it sent", async () => {
  const { workflow, provider, doc, record, wait, repo } = setup();
  vi.mocked(provider.getContract).mockImplementation(async () =>
    structuredClone(doc),
  );
  await expect(workflow.send(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_STILL_PREPARING",
  );
  expect(wait).toHaveBeenCalledTimes(8);
  expect(repo.extendLease).toHaveBeenCalledTimes(9);
  expect(provider.send).not.toHaveBeenCalled();
  expect(record()).toMatchObject({
    state: "preparing",
    providerId: doc.id,
    error: null,
  });
  doc.status = "Draft";
  expect((await workflow.send(record().contractId, actor)).state).toBe("sent");
  expect(provider.createContractDraft).toHaveBeenCalledOnce();
  expect(provider.send).toHaveBeenCalledOnce();
});

it("returns the sent request when SignWell accepted the send but the read back failed", async () => {
  const { workflow, provider, doc, record } = setup();
  vi.mocked(provider.send).mockImplementationOnce(async () => {
    doc.status = "Sent";
    vi.mocked(provider.getContract).mockRejectedValueOnce(
      new Error("SIGNWELL_HTTP_500"),
    );
  });
  const sent = await workflow.send(record().contractId, actor);
  expect(sent).toMatchObject({ state: "sending", error: null });
  expect(record()).toMatchObject({ state: "sending", error: null });
  // The next refresh settles it; nothing is sent twice.
  expect((await workflow.sync(record().contractId, actor)).state).toBe("sent");
  expect(provider.send).toHaveBeenCalledOnce();
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
    fileName: "Fil One Engine Test Fixture - Bluefin Data Co. (executed).pdf",
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
    "CONTRACT_VOID_REQUIRED",
  );
});

const sent = {
  providerId: "019a44ac-0000-7000-8000-0000000000d5",
  state: "sent",
} as const;
const signwell: Actor = { kind: "provider", id: "signwell" };

it("marks a document deleted in SignWell for attention instead of failing every refresh", async () => {
  const { workflow, doc, record, provider, notes, deleteInSignWell } =
    setup(sent);
  doc.status = "Sent";
  deleteInSignWell();
  const first = await workflow.sync(record().contractId, signwell);
  expect(first).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  // One 404 is retried before the document is taken as gone.
  expect(provider.getContract).toHaveBeenCalledTimes(2);
  expect(notes).toEqual([{ eventType: "contract.deleted_in_signwell" }]);
  // Later wakeups change nothing and record nothing more.
  await workflow.sync(record().contractId, signwell);
  expect(notes).toHaveLength(1);
  await expect(workflow.remind(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_NOT_PENDING",
  );
});

it("retries a single 404 and carries on when SignWell answers", async () => {
  const { workflow, doc, record, provider } = setup(sent);
  doc.status = "Sent";
  vi.mocked(provider.getContract).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_404"),
  );
  await expect(
    workflow.sync(record().contractId, signwell),
  ).resolves.toMatchObject({ state: "sent", error: null });
});

it("spaces reminders by the last reminder, not by the last refresh", async () => {
  const { workflow, doc, record, provider, notes } = setup({
    ...sent,
    updatedAt: new Date().toISOString(),
  });
  doc.status = "Sent";
  const reminded = await workflow.remind(record().contractId, actor);
  expect(provider.remind).toHaveBeenCalledOnce();
  expect(reminded.remindedAt).not.toBeNull();
  expect(notes.at(-1)).toEqual({
    eventType: "contract.reminded",
    detail: { recipient: "counterparty" },
  });
  await expect(workflow.remind(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_REMINDER_TOO_SOON",
  );
  expect(provider.remind).toHaveBeenCalledOnce();
});

it("reminds the Fil One countersigner once the counterparty has signed", async () => {
  const { workflow, doc, record, notes } = setup({
    ...sent,
    remindedAt: new Date(Date.now() - 120_000).toISOString(),
  });
  doc.status = "Sent";
  const counterparty = doc.recipients[0];
  if (counterparty) counterparty.status = "signed";
  await workflow.remind(record().contractId, actor);
  expect(notes.at(-1)).toEqual({
    eventType: "contract.reminded",
    detail: { recipient: "fil-one" },
  });
});

it("voids a sent request: deletes the SignWell copy, then records the reason", async () => {
  const { workflow, doc, record, provider, notes } = setup(sent);
  doc.status = "Sent";
  const voided = await workflow.void(record().contractId, actor, {
    reason: "Wrong legal entity",
  });
  expect(voided.state).toBe("canceled");
  expect(provider.cancel).toHaveBeenCalledExactlyOnceWith(sent.providerId);
  expect(notes.at(-1)).toEqual({
    eventType: "contract.voided",
    detail: { reason: "Wrong legal entity" },
  });
});

it("closes a request whose document was deleted in SignWell without calling delete", async () => {
  const { workflow, record, provider, deleteInSignWell } = setup({
    ...sent,
    state: "attention",
    error: "deleted_in_signwell",
  });
  deleteInSignWell();
  await expect(
    workflow.void(record().contractId, actor, {
      reason: "Deleted in SignWell",
    }),
  ).resolves.toMatchObject({ state: "canceled", error: null });
  expect(provider.cancel).not.toHaveBeenCalled();
});

it("refuses to void once the counterparty has signed, and keeps a completed contract", async () => {
  const signed = setup(sent);
  signed.doc.status = "Sent";
  const counterparty = signed.doc.recipients[0];
  if (counterparty) counterparty.status = "signed";
  await expect(
    signed.workflow.void(signed.record().contractId, actor, {
      reason: "Too late",
    }),
  ).rejects.toThrow("CONTRACT_NOT_VOIDABLE");
  expect(signed.record().state).toBe("awaiting_countersignature");
  expect(signed.provider.cancel).not.toHaveBeenCalled();

  const completed = setup(sent);
  completed.doc.status = "Completed";
  await expect(
    completed.workflow.void(completed.record().contractId, actor, {
      reason: "Too late",
    }),
  ).rejects.toThrow("CONTRACT_ALREADY_COMPLETED");
  expect(completed.archived()).toBeDefined();
});

it("treats an unclear delete as done when a re-read finds the document gone", async () => {
  const { workflow, doc, record, provider, deleteInSignWell } = setup(sent);
  doc.status = "Sent";
  vi.mocked(provider.cancel).mockImplementationOnce(async () => {
    deleteInSignWell();
    throw new Error("SIGNWELL_HTTP_502");
  });
  await expect(
    workflow.void(record().contractId, actor, { reason: "Wrong legal entity" }),
  ).resolves.toMatchObject({ state: "canceled" });
});

it("keeps the request open when SignWell refuses the delete", async () => {
  const { workflow, doc, record, provider } = setup(sent);
  doc.status = "Sent";
  vi.mocked(provider.cancel).mockRejectedValueOnce(
    new Error("SIGNWELL_HTTP_422"),
  );
  await expect(
    workflow.void(record().contractId, actor, { reason: "Wrong legal entity" }),
  ).rejects.toThrow("SIGNWELL_HTTP_422");
  expect(record().state).toBe("sent");
});

it("names the executed copy within the file name limit", async () => {
  const documentName =
    `Fil One Engine Test Fixture - ${"Very Long Counterparty ".repeat(9)}`.slice(
      0,
      200,
    );
  const { workflow, doc, record, archived } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "sent",
    documentName,
  });
  doc.status = "Completed";
  await workflow.sync(record().contractId, {
    kind: "provider",
    id: "signwell",
  });
  const fileName = archived()?.fileName ?? "";
  expect(fileName.length).toBeLessThanOrEqual(200);
  expect(fileName.endsWith(" (executed).pdf")).toBe(true);
});

it("refuses to void when the counterparty signed and the countersigner's email bounced", async () => {
  const { workflow, doc, record, provider } = setup(sent);
  doc.status = "Sent";
  const [counterparty, filOne] = doc.recipients;
  if (!counterparty || !filOne) throw new Error("recipients missing");
  counterparty.status = "signed";
  filOne.bounced = true;
  await expect(
    workflow.void(record().contractId, actor, { reason: "Wrong legal entity" }),
  ).rejects.toThrow("CONTRACT_NOT_VOIDABLE");
  expect(record().state).toBe("attention");
  expect(provider.cancel).not.toHaveBeenCalled();
});

it("holds a contract whose SignWell copy names other signers, and answers the wakeup", async () => {
  const { workflow, doc, record, notes, provider } = setup(sent);
  doc.status = "Completed";
  const [counterparty] = doc.recipients;
  if (!counterparty) throw new Error("recipients missing");
  counterparty.email = "someone-else@example.com";
  await expect(
    workflow.sync(record().contractId, signwell),
  ).resolves.toMatchObject({
    state: "attention",
    error: "signwell_signed_mismatch",
  });
  // SignWell shows it completed, so it is held as signed in SignWell; nothing
  // from the mismatched copy is applied, not even its completion.
  expect(provider.completedPdf).not.toHaveBeenCalled();
  expect(notes).toEqual([
    {
      eventType: "contract.signwell_mismatch",
      detail: { reason: "signwell_signed_mismatch" },
    },
  ]);
  await workflow.sync(record().contractId, signwell);
  expect(notes).toHaveLength(1);
  await expect(workflow.remind(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_NOT_PENDING",
  );
});

it("records a binding mismatch found while sending and never sends", async () => {
  const { workflow, doc, record, provider } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "ready",
  });
  doc.status = "Draft";
  doc.metadata.commerce_contract_id = "019a44ac-0000-7000-8000-0000000000ee";
  await expect(workflow.send(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_NEEDS_ATTENTION",
  );
  expect(record()).toMatchObject({
    state: "attention",
    error: "signwell_binding_mismatch",
  });
  expect(provider.send).not.toHaveBeenCalled();
});

it("keeps deleted_in_signwell when a send finds the draft gone, and records it once", async () => {
  const { workflow, record, notes, deleteInSignWell } = setup({
    providerId: "019a44ac-0000-7000-8000-0000000000d5",
    state: "ready",
  });
  deleteInSignWell();
  await expect(workflow.send(record().contractId, actor)).rejects.toThrow(
    "CONTRACT_NEEDS_ATTENTION",
  );
  expect(record()).toMatchObject({
    state: "attention",
    error: "deleted_in_signwell",
  });
  await workflow.sync(record().contractId, signwell);
  expect(
    notes.filter((n) => n?.eventType === "contract.deleted_in_signwell"),
  ).toHaveLength(1);
});

it("voids a mismatched copy that nobody signed", async () => {
  const { workflow, doc, record, provider } = setup(sent);
  doc.status = "Sent";
  doc.metadata.template_sha256 = "f".repeat(64);
  await expect(
    workflow.void(record().contractId, actor, {
      reason: "SignWell copy changed",
    }),
  ).resolves.toMatchObject({ state: "canceled" });
  expect(provider.cancel).toHaveBeenCalledOnce();
});

it("corrects the counterparty email, keeping the replaced address as the before-image", async () => {
  const { workflow, doc, record, provider, updates, notes } = setup(sent);
  doc.status = "Sent";
  const corrected = await workflow.correctSigner(
    record().contractId,
    actor,
    "right@example.com",
  );
  expect(corrected).toMatchObject({
    correctedSignerEmail: "right@example.com",
    pendingSignerEmail: null,
  });
  expect(provider.updateRecipient).toHaveBeenCalledExactlyOnceWith(
    sent.providerId,
    { id: "counterparty", name: "Alex Example", email: "right@example.com" },
  );
  expect(updates).toContainEqual({
    pendingSignerEmail: "right@example.com",
    error: null,
  });
  expect(notes.filter(Boolean)).toEqual([
    {
      eventType: "contract.signer_correction_requested",
      before: { signerEmail: "alex@example.com" },
      detail: { signerEmail: "right@example.com" },
    },
    {
      eventType: "contract.signer_corrected",
      before: { signerEmail: "alex@example.com" },
      detail: { signerEmail: "right@example.com" },
    },
  ]);
});

it("voids for a different signer with the signer_change code and no reason", async () => {
  const { workflow, doc, record, updates, notes } = setup(sent);
  doc.status = "Sent";
  await expect(
    workflow.void(record().contractId, actor, { code: "signer_change" }),
  ).resolves.toMatchObject({ state: "canceled", cancelCode: "signer_change" });
  expect(updates.at(-1)).toEqual({
    state: "canceled",
    error: null,
    cancelCode: "signer_change",
  });
  expect(notes.at(-1)).toEqual({
    eventType: "contract.voided",
    detail: { cancelCode: "signer_change" },
  });
});

describe("counterparty paper the counterparty signed already", () => {
  const paper = {
    documentType: "counterparty_paper",
    counterpartySigns: false,
    approvalState: "approved",
  } as const;

  it("drafts it on its own declaration and sends it to the Fil One signer alone", async () => {
    const { workflow, provider, record } = setup(paper);
    await expect(
      workflow.send(record().contractId, actor),
    ).resolves.toMatchObject({ state: "sent" });
    expect(provider.createCounterpartyPaperDraft).toHaveBeenCalledOnce();
    expect(provider.createContractDraft).not.toHaveBeenCalled();
  });

  it("completes when the Fil One signer signs, never waiting for a countersignature", async () => {
    const { workflow, doc, record, archived } = setup({ ...paper, ...sent });
    const [filOne] = doc.recipients;
    if (!filOne) throw new Error("Expected the Fil One recipient");
    doc.status = "Sent";
    filOne.status = "signed";
    expect((await workflow.sync(record().contractId, signwell)).state).toBe(
      "sent",
    );
    doc.status = "Completed";
    expect((await workflow.sync(record().contractId, signwell)).state).toBe(
      "completed",
    );
    expect(archived()).toBeDefined();
  });

  it("reminds the Fil One signer and offers no email correction", async () => {
    const { workflow, doc, record, notes, provider } = setup({
      ...paper,
      ...sent,
    });
    doc.status = "Sent";
    await workflow.remind(record().contractId, actor);
    expect(notes.at(-1)).toEqual({
      eventType: "contract.reminded",
      detail: { recipient: "fil-one" },
    });
    await expect(
      workflow.correctSigner(record().contractId, actor, "right@example.com"),
    ).rejects.toThrow("CONTRACT_NOT_CORRECTABLE");
    expect(provider.updateRecipient).not.toHaveBeenCalled();
  });

  it("refuses SignWell's copy when it names a counterparty signer after all", async () => {
    const { workflow, doc, record } = setup({ ...paper, ...sent });
    doc.status = "Sent";
    doc.recipients.unshift({
      id: "counterparty",
      email: "alex@example.com",
      name: "Alex",
    });
    await expect(
      workflow.sync(record().contractId, signwell),
    ).resolves.toMatchObject({
      state: "attention",
      error: "signwell_signers_mismatch",
    });
  });
});
