/* eslint-disable @typescript-eslint/require-await -- synchronous in-memory implementations model the async provider and repository contracts. */
/**
 * One harness over each signing workflow, so the scenarios in `scenarios.ts`
 * run the same lifecycle against MNDAs and template contracts. The fakes model
 * the repositories' rules that the workflows rely on (the lease token, frozen
 * terminal rows, history written per update) and SignWell's document API.
 */
import { randomUUID } from "node:crypto";
import { vi, type Mock } from "vitest";
import {
  contractSigning,
  counterpartyPaperSigning,
  mndaSigning,
  mndaSigningFields,
  type Actor,
  type ContractSigningRecord,
  type SigningDocumentType,
} from "@clockwork/contracts";
import type {
  ContractSigningNote,
  ContractSigningRepository,
  MndaAuditNote,
  MndaRepository,
} from "@clockwork/db";
import type { MndaSigningProvider } from "@clockwork/integrations";
import { fixtureSigningRecord } from "../../../contracts/src/contract-fixture";
import { fixtureRecord } from "../../../contracts/src/mnda-fixture";
import {
  ContractSigningWorkflow,
  type ContractSigningClient,
} from "../contracts";
import { MndaWorkflow } from "../mnda";

export type SigningKind = "mnda" | "contract" | "counterparty_paper";

/**
 * Where the two types still differ because a table has no column for the
 * value. A scenario that reaches one asks `differs(name)`. Every behavior is
 * shared; what a type declares (approval, copying the sender, correctable
 * signers) is read from its declaration in `declares`.
 */
export const expectedDifferences: Record<
  SigningKind,
  Readonly<Record<string, string>>
> = {
  mnda: {},
  contract: {
    no_sent_at: "The contract table records no first-sent time.",
  },
  counterparty_paper: {
    no_sent_at: "The contract table records no first-sent time.",
  },
};

/** The fields every scenario reads, whichever record type carries them. */
export interface SigningRow {
  id: string;
  state: string;
  error: string | null;
  providerId: string | null;
  remindedAt: string | null;
  sentAt?: string | null;
  cancelCode?: string | null;
  cancelReason?: string | null;
  correctedSignerEmail?: string | null;
  pendingSignerEmail?: string | null;
  partnerDetails?: Readonly<Record<string, string>> | null;
  version: number;
}

export interface SigningEvent {
  aggregateId: string;
  eventType: string;
  detail?: Record<string, unknown>;
}

interface Recipient {
  id: string;
  email: string;
  name: string;
  status?: string | null;
  bounced?: boolean | null;
}
export interface FakeDocument {
  id: string;
  status: string;
  test_mode: boolean;
  metadata: Record<string, string>;
  apply_signing_order: boolean;
  copied_contacts?: { email: string }[] | null;
  recipients: Recipient[];
  fields: {
    recipient_id: string;
    type: string;
    required: boolean;
    api_id?: string;
    value?: string | null;
  }[][];
}

export interface SigningHarness {
  kind: SigningKind;
  /** The workflow's error code: `MNDA_<name>` or `CONTRACT_<name>`. */
  code(name: string): string;
  declares: SigningDocumentType<never>;
  /** The operator log label, as the workflow writes it. */
  log: { label: string; idKey: string };
  differs(name: string): boolean;
  actor: Actor;
  send(): Promise<SigningRow>;
  sync(): Promise<SigningRow>;
  remind(): Promise<SigningRow>;
  cancel(): Promise<SigningRow>;
  void(
    why: { reason: string } | { code: "signer_change" },
  ): Promise<SigningRow>;
  correctSigner?: (email: string) => Promise<SigningRow>;
  /** Where the type captures fields: leaves details for the first signer to
   * complete, places their fields in SignWell's copy and returns their ids. */
  askPartner?: () => string[];
  doc: FakeDocument;
  provider: {
    createDraft: Mock;
    get: Mock;
    send: Mock;
    remind: Mock;
    cancel: Mock;
    completedPdf: Mock;
    updateRecipient?: Mock;
  };
  wait: Mock;
  extendLease: Mock;
  decide?: Mock;
  record(): SigningRow;
  setRecord(patch: Partial<SigningRow> & Record<string, unknown>): void;
  /** The lease expired and someone else claimed the request. */
  loseLease(): void;
  updates: Record<string, unknown>[];
  events: SigningEvent[];
  archived(): Uint8Array | undefined;
  partner(): Recipient;
  filOne(): Recipient;
}

const used: Record<SigningKind, Set<string>> = {
  mnda: new Set(),
  contract: new Set(),
  counterparty_paper: new Set(),
};
/** Expected differences no scenario consulted: stale entries. */
export function unusedDifferences(kind: SigningKind) {
  return Object.keys(expectedDifferences[kind]).filter(
    (name) => !used[kind].has(name),
  );
}
function differs(kind: SigningKind) {
  return (name: string) => {
    used[kind].add(name);
    return name in expectedDifferences[kind];
  };
}

function signWellDocument(
  bindingKey: string,
  bindingId: string,
  templateHash: string,
  partnerEmail: string,
  filOneEmail: string,
): FakeDocument {
  return {
    id: "019a44ac-0000-7000-8000-000000000005",
    status: "Draft",
    test_mode: true,
    metadata: { [bindingKey]: bindingId, template_sha256: templateHash },
    apply_signing_order: true,
    recipients: [
      { id: "counterparty", email: partnerEmail, name: "Alex" },
      { id: "fil-one", email: filOneEmail, name: "James" },
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
}

function signWell(doc: FakeDocument) {
  const read = () => structuredClone(doc);
  return {
    createDraft: vi.fn(async () => read()),
    get: vi.fn(async () => read()),
    send: vi.fn(async () => {
      doc.status = "Sent";
    }),
    remind: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    completedPdf: vi.fn(async () => Buffer.from("%PDF-completed-with-audit")),
  };
}

const terminal = ["completed", "declined", "expired", "canceled"];
/** States reached only after the partner received the request. */
const delivered = [
  "sent",
  "viewed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
];

export function mndaHarness(): SigningHarness {
  let record = structuredClone(fixtureRecord);
  let lease: ReturnType<typeof randomUUID> | undefined;
  let archived: Uint8Array | undefined;
  const updates: Record<string, unknown>[] = [];
  const events: SigningEvent[] = [];
  const doc = signWellDocument(
    "commerce_mnda_id",
    record.id,
    record.templateHash,
    record.input.signerEmail,
    record.countersigner.email,
  );
  doc.copied_contacts = [{ email: "seller@example.com" }];
  const extendLease = vi.fn(async (_id: string, token: string) => {
    if (token !== lease) throw new Error("MNDA_LEASE_LOST");
  });
  const repo: Pick<
    MndaRepository,
    "claim" | "extendLease" | "release" | "update" | "get" | "readArtifact"
  > = {
    async claim() {
      if (lease) throw new Error("MNDA_BUSY");
      lease = randomUUID();
      return { record: structuredClone(record), token: lease };
    },
    extendLease,
    async release(_id, token) {
      if (token === lease) lease = undefined;
    },
    async get() {
      return structuredClone(record);
    },
    async readArtifact() {
      return Buffer.from("%PDF-original");
    },
    async update(id, token, patch, _actor, pdf, note?: MndaAuditNote) {
      if (token !== lease) throw new Error("MNDA_LEASE_LOST");
      if (terminal.includes(record.state)) return structuredClone(record);
      if (pdf) archived = pdf;
      updates.push({ ...patch });
      const { remindedAt, ...rest } = patch;
      const now = new Date().toISOString();
      record = {
        ...record,
        ...rest,
        ...(remindedAt ? { remindedAt: remindedAt.toISOString() } : {}),
        ...(patch.state && delivered.includes(patch.state) && !record.sentAt
          ? { sentAt: now }
          : {}),
        // A follow-up event takes the next version, as in the repository.
        version: record.version + (note?.followUp ? 2 : 1),
      };
      // The MNDA repository audits every update on the request itself.
      events.push({
        aggregateId: id,
        eventType: note?.eventType ?? `mnda.${record.state}`,
        ...(note?.detail ? { detail: note.detail } : {}),
      });
      if (note?.followUp)
        events.push({
          aggregateId: id,
          eventType: note.followUp.eventType,
          ...(note.followUp.detail ? { detail: note.followUp.detail } : {}),
        });
      return structuredClone(record);
    },
  };
  const calls = signWell(doc);
  const provider = {
    ...calls,
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
  };
  const wait = vi.fn(async () => {});
  const workflow = new MndaWorkflow(
    repo,
    provider as unknown as MndaSigningProvider,
    wait,
  );
  const actor: Actor = { kind: "user", id: record.ownerId };
  return {
    kind: "mnda",
    code: (name) => `MNDA_${name}`,
    declares: mndaSigning,
    log: { label: "MNDA", idKey: "mndaId" },
    differs: differs("mnda"),
    actor,
    send: () => workflow.send(record.id, actor),
    sync: () => workflow.sync(record.id, actor),
    remind: () => workflow.remind(record.id, actor),
    cancel: () => workflow.cancel(record.id, actor),
    void: (why) => workflow.void(record.id, actor, why),
    correctSigner: (email) => workflow.correctSigner(record.id, actor, email),
    askPartner: () => {
      record = {
        ...record,
        input: {
          ...record.input,
          detailsMode: "mixed",
          entityDescription: "",
          signerTitle: "",
        },
      };
      const ids = mndaSigningFields(record.input).map(({ id }) => id);
      doc.fields[0]?.push(
        ...ids.map((api_id) => ({
          recipient_id: "counterparty",
          type: "text",
          required: true,
          api_id,
        })),
      );
      return ids;
    },
    doc,
    provider,
    wait,
    extendLease,
    record: () => record,
    setRecord: (patch) => {
      record = { ...record, ...patch } as typeof record;
    },
    loseLease: () => {
      lease = randomUUID();
    },
    updates,
    events,
    archived: () => archived,
    partner: () => recipient(doc, "counterparty"),
    filOne: () => recipient(doc, "fil-one"),
  };
}

/** Counterparty paper the counterparty signs in SignWell too: the same table
 * and store as template contracts, on its own declaration. */
export const counterpartyPaperHarness = () =>
  contractHarness("counterparty_paper");

export function contractHarness(
  type: "contract" | "counterparty_paper" = "contract",
): SigningHarness {
  let record: ContractSigningRecord = {
    ...structuredClone(fixtureSigningRecord),
    ...(type === "counterparty_paper"
      ? {
          documentType: "counterparty_paper" as const,
          templateId: "counterparty-paper",
        }
      : {}),
  };
  let lease: ReturnType<typeof randomUUID> | undefined;
  let archived: Uint8Array | undefined;
  const updates: Record<string, unknown>[] = [];
  const events: SigningEvent[] = [];
  const doc = signWellDocument(
    "commerce_contract_id",
    record.contractId,
    record.templateHash,
    record.counterpartySigner.email,
    record.countersigner.email,
  );
  const extendLease = vi.fn(async (_id: string, token: string) => {
    if (token !== lease) throw new Error("CONTRACT_LEASE_LOST");
  });
  const decide = vi.fn();
  const repo = {
    async claim() {
      if (lease) throw new Error("CONTRACT_BUSY");
      lease = randomUUID();
      return { record: structuredClone(record), token: lease };
    },
    extendLease,
    async release(_id: string, token: string) {
      if (token === lease) lease = undefined;
    },
    async get() {
      return structuredClone(record);
    },
    async generatedPdf() {
      return Buffer.from("%PDF-prepared");
    },
    decide,
    async update(
      id: string,
      token: string,
      patch: Parameters<ContractSigningRepository["update"]>[2],
      _actor: Actor,
      executed?: { bytes: Uint8Array; fileName: string },
      note?: ContractSigningNote,
    ) {
      if (token !== lease) throw new Error("CONTRACT_LEASE_LOST");
      if (terminal.includes(record.state)) return structuredClone(record);
      if (executed) archived = executed.bytes;
      updates.push({ ...patch });
      const before = record.state;
      const { remindedAt, ...rest } = patch;
      record = {
        ...record,
        ...rest,
        ...(remindedAt ? { remindedAt: remindedAt.toISOString() } : {}),
        version: record.version + 1,
      };
      // The contract repository writes history for a state change or a note.
      const changed = patch.state && patch.state !== before;
      if (changed || note)
        events.push({
          aggregateId: id,
          eventType: note?.eventType ?? `contract.signing_${record.state}`,
          ...(note?.detail ? { detail: note.detail } : {}),
        });
      return structuredClone(record);
    },
  };
  const provider = {
    ...signWell(doc),
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
  };
  const client = {
    createContractDraft: provider.createDraft,
    createCounterpartyPaperDraft: provider.createDraft,
    getContract: provider.get,
    send: provider.send,
    remind: provider.remind,
    cancel: provider.cancel,
    updateRecipient: provider.updateRecipient,
    completedPdf: provider.completedPdf,
  } as unknown as ContractSigningClient;
  const wait = vi.fn(async () => {});
  const workflow = new ContractSigningWorkflow(repo, client, wait);
  const actor: Actor = { kind: "user", id: randomUUID(), display: "Revenue" };
  const view = (r: ContractSigningRecord): SigningRow => ({
    ...r,
    id: r.contractId,
  });
  return {
    kind: "contract",
    // The contract signing panel names these two with existing codes.
    code: (name) =>
      ({
        SIGNED_IN_SIGNWELL: "CONTRACT_NOT_VOIDABLE",
        REMIND_NEEDS_ATTENTION: "CONTRACT_NEEDS_ATTENTION",
      })[name] ?? `CONTRACT_${name}`,
    declares:
      type === "counterparty_paper"
        ? counterpartyPaperSigning
        : contractSigning,
    log: { label: "CONTRACT", idKey: "contractId" },
    differs: differs(type),
    actor,
    send: async () => view(await workflow.send(record.contractId, actor)),
    sync: async () => view(await workflow.sync(record.contractId, actor)),
    remind: async () => view(await workflow.remind(record.contractId, actor)),
    cancel: async () => view(await workflow.cancel(record.contractId, actor)),
    void: async (why) =>
      view(await workflow.void(record.contractId, actor, why)),
    correctSigner: async (email) =>
      view(await workflow.correctSigner(record.contractId, actor, email)),
    doc,
    provider,
    wait,
    extendLease,
    decide,
    record: () => view(record),
    setRecord: (patch) => {
      record = { ...record, ...patch } as ContractSigningRecord;
    },
    loseLease: () => {
      lease = randomUUID();
    },
    updates,
    events,
    archived: () => archived,
    partner: () => recipient(doc, "counterparty"),
    filOne: () => recipient(doc, "fil-one"),
  };
}

function recipient(doc: FakeDocument, id: string) {
  const found = doc.recipients.find((r) => r.id === id);
  if (!found) throw new Error(`Expected recipient ${id}`);
  return found;
}
