import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  ContractFileNameSchema,
  ContractInputSchema,
  contractPageSize,
  terminalContractSigningStates,
  uploadableContractFileKinds,
  type Actor,
  type ContractActivity,
  type ContractFileKind,
  type ContractFileRecord,
  type ContractInput,
  type ContractListQuery,
  type ContractListRow,
  type ContractRecord,
  type ContractSigner,
  type ContractSigningRecord,
  type ContractSigningState,
  type ContractStatus,
  type ContractType,
  type StoredDocument,
} from "@clockwork/contracts";
import { addContractDays, contractTermSchedule } from "@clockwork/domain";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import {
  commerceContracts,
  contractEvents,
  contractFiles,
  contractSigning,
} from "../schema/contracts";
import { mndaSigners } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import type { ContractDocumentStores } from "./contract-documents";

type ContractRow = typeof commerceContracts.$inferSelect;
type FileRow = typeof contractFiles.$inferSelect;
type SigningRow = typeof contractSigning.$inferSelect;

/** The fields a person edits; every change to one is recorded with its old
 * and new value. */
const editableFields = [
  "counterpartyName",
  "title",
  "contractType",
  "paper",
  "status",
  "effectiveDate",
  "initialTermMonths",
  "autoRenew",
  "renewalTermMonths",
  "noticePeriodDays",
  "valueMinor",
  "currency",
  "pricingNotes",
  "ownerName",
  "internalNotes",
  "tags",
] as const satisfies readonly (keyof ContractInput & keyof ContractRow)[];

const contractView = (r: ContractRow, asOf: string): ContractRecord => ({
  id: r.id,
  source: r.source,
  counterpartyName: r.counterpartyName,
  title: r.title,
  contractType: r.contractType,
  paper: r.paper,
  status: r.status,
  effectiveDate: r.effectiveDate,
  initialTermMonths: r.initialTermMonths,
  autoRenew: r.autoRenew,
  renewalTermMonths: r.renewalTermMonths,
  noticePeriodDays: r.noticePeriodDays,
  valueMinor: r.valueMinor,
  currency: r.currency,
  pricingNotes: r.pricingNotes,
  ownerName: r.ownerName,
  internalNotes: r.internalNotes,
  tags: r.tags,
  createdByName: r.createdByName,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
  ...contractTermSchedule(r, asOf),
});

const fileView = (f: FileRow): ContractFileRecord => ({
  id: f.id,
  kind: f.kind,
  fileName: f.fileName,
  sha256: f.sha256,
  sizeBytes: f.sizeBytes,
  contentType: f.contentType,
  uploadedByName: f.uploadedByName,
  createdAt: f.createdAt.toISOString(),
});

const signingView = (s: SigningRow): ContractSigningRecord => ({
  contractId: s.contractId,
  templateId: s.templateId,
  templateVersion: s.templateVersion,
  templateHash: s.templateHash,
  documentName: s.documentName,
  input: s.input,
  counterpartySigner: s.counterpartySigner,
  countersigner: s.countersigner,
  preparerId: s.preparerId,
  preparerName: s.preparerName,
  approvalRequired: s.approvalRequired,
  approvalState: s.approvalState,
  approverName: s.approverName,
  decidedAt: s.decidedAt?.toISOString() ?? null,
  rejectionReason: s.rejectionReason,
  state: s.state,
  providerId: s.providerId,
  testMode: s.testMode,
  error: s.error,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
  completedAt: s.completedAt?.toISOString() ?? null,
  version: s.version,
});

const actorName = (actor: Actor) =>
  actor.display ?? (actor.kind === "provider" ? "SignWell" : actor.id);
const actorId = (actor: Actor) =>
  actor.kind === "user" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    actor.id,
  )
    ? actor.id
    : null;

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Escapes LIKE wildcards so a search for "50%" means the text "50%". */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const sortExpressions = {
  counterparty: "lower(counterparty_name)",
  type: "contract_type",
  status: "status",
  effective: "effective_date",
  renewal: "coalesce(renewal_date, term_end_date)",
  notice: "notice_deadline",
  updated: "updated_at",
} as const satisfies Record<ContractListQuery["sort"], string>;

/** Signing progress as the register reports it. */
const registerStatusFor: Partial<Record<ContractSigningState, ContractStatus>> =
  {
    sending: "out_for_signature",
    sent: "out_for_signature",
    viewed: "out_for_signature",
    awaiting_countersignature: "out_for_signature",
    completed: "executed",
    declined: "draft",
    expired: "draft",
    canceled: "draft",
  };

type ListRow = {
  id: string;
  source: ContractListRow["source"];
  counterparty_name: string;
  title: string;
  contract_type: ContractType;
  paper: ContractListRow["paper"];
  status: ContractStatus;
  effective_date: string | null;
  auto_renew: boolean;
  notice_period_days: number | null;
  owner_name: string;
  tags: string[];
  document_count: number;
  updated_at: Date | string;
  term_end_date: string | null;
  renewal_date: string | null;
  notice_deadline: string | null;
  total: string | number;
};

const listRowView = (r: ListRow): ContractListRow => ({
  id: r.id,
  source: r.source,
  counterpartyName: r.counterparty_name,
  title: r.title,
  contractType: r.contract_type,
  paper: r.paper,
  status: r.status,
  effectiveDate: r.effective_date,
  autoRenew: r.auto_renew,
  noticePeriodDays: r.notice_period_days,
  ownerName: r.owner_name,
  tags: r.tags,
  documentCount: Number(r.document_count),
  updatedAt: new Date(r.updated_at).toISOString(),
  termEndDate: r.term_end_date,
  renewalDate: r.renewal_date,
  noticeDeadline: r.notice_deadline,
});

/**
 * The register rows, plus every completed MNDA as a read-only row. MNDA
 * tables are read, never written, so the MNDA workflow stays the only owner
 * of its records.
 */
function scheduledRows(asOf: string) {
  return sql`
    with register as (
      select c.id, c.source, c.counterparty_name, c.title, c.contract_type,
        c.paper, c.status, c.effective_date::text as effective_date,
        c.auto_renew, c.renewal_term_months, c.notice_period_days,
        c.owner_name, c.tags, c.updated_at,
        public.commerce_contract_term_boundary(c.effective_date,
          c.initial_term_months, c.auto_renew, c.renewal_term_months,
          ${asOf}::date) as boundary,
        (select count(*)::integer from public.commerce_contract_files f
          where f.contract_id = c.id) as document_count
      from public.commerce_contracts c
      union all
      select m.id, 'mnda', m.input->>'company', '', 'mnda', 'ours',
        'executed', m.input->>'effectiveDate', false, null, null,
        m.owner_name, '{}'::text[], coalesce(m.completed_at, m.updated_at),
        null::date, 1
      from public.commerce_mnda_requests m
      where m.state = 'completed'
    ), scheduled as (
      select register.*,
        (boundary - 1)::text as term_end_date,
        case when auto_renew and renewal_term_months is not null
          then boundary::text end as renewal_date,
        case when auto_renew and renewal_term_months is not null
          and notice_period_days is not null
          then (boundary - 1 - notice_period_days)::text end as notice_deadline
      from register
    )`;
}

export interface ContractListResult {
  rows: ContractListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export class ContractRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly stores: ContractDocumentStores,
  ) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  private filters(query: Omit<ContractListQuery, "page">, asOf: string) {
    const conditions: SQL[] = [sql`true`];
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(sql`(counterparty_name ilike ${pattern}
        or title ilike ${pattern} or owner_name ilike ${pattern}
        or exists (select 1 from unnest(tags) tag where tag ilike ${pattern}))`);
    }
    if (query.type) conditions.push(sql`contract_type = ${query.type}`);
    if (query.status) conditions.push(sql`status = ${query.status}`);
    if (query.window)
      conditions.push(
        sql`coalesce(renewal_date, term_end_date)::date between ${asOf}::date and ${addContractDays(asOf, query.window)}::date`,
      );
    return sql.join(conditions, sql` and `);
  }

  private order(query: Pick<ContractListQuery, "sort" | "direction">) {
    const direction =
      (query.direction ?? (query.sort === "updated" ? "desc" : "asc")) ===
      "desc"
        ? "desc"
        : "asc";
    return sql.raw(
      `${sortExpressions[query.sort]} ${direction} nulls last, id asc`,
    );
  }

  /** One page of the register, newest activity first unless sorted. */
  list(query: ContractListQuery, asOf: string): Promise<ContractListResult> {
    return this.tx(async (tx) => {
      const rows = await tx.execute<ListRow>(sql`${scheduledRows(asOf)}
        select *, count(*) over () as total from scheduled
        where ${this.filters(query, asOf)}
        order by ${this.order(query)}
        limit ${contractPageSize} offset ${(query.page - 1) * contractPageSize}`);
      const list = [...rows];
      return {
        rows: list.map(listRowView),
        total: Number(list[0]?.total ?? 0),
        page: query.page,
        pageSize: contractPageSize,
      };
    });
  }

  /** Every row matching the filters, for export; capped well above use. */
  exportRows(query: Omit<ContractListQuery, "page">, asOf: string) {
    return this.tx(async (tx) =>
      [
        ...(await tx.execute<ListRow>(sql`${scheduledRows(asOf)}
          select *, 0 as total from scheduled
          where ${this.filters(query, asOf)}
          order by ${this.order(query)} limit 5000`)),
      ].map(listRowView),
    );
  }

  /** Executed contracts whose non-renewal notice is due within `days`. */
  renewalsDue(asOf: string, days: number) {
    return this.tx(async (tx) =>
      [
        ...(await tx.execute<ListRow>(sql`${scheduledRows(asOf)}
          select *, 0 as total from scheduled
          where source <> 'mnda' and status = 'executed'
            and notice_deadline::date between ${asOf}::date
              and ${addContractDays(asOf, days)}::date
          order by notice_deadline asc, lower(counterparty_name) asc
          limit 500`)),
      ].map(listRowView),
    );
  }

  /** Counts of notices due within 30, 60 and 90 days, for summary cards. */
  renewalSummary(asOf: string) {
    return this.tx(async (tx) => {
      const [row] = await tx.execute<{
        d30: number;
        d60: number;
        d90: number;
        next: string | null;
      }>(sql`${scheduledRows(asOf)}
        select
          count(*) filter (where notice_deadline::date <= ${addContractDays(asOf, 30)}::date)::integer as d30,
          count(*) filter (where notice_deadline::date <= ${addContractDays(asOf, 60)}::date)::integer as d60,
          count(*)::integer as d90,
          min(notice_deadline) as next
        from scheduled
        where source <> 'mnda' and status = 'executed'
          and notice_deadline::date between ${asOf}::date
            and ${addContractDays(asOf, 90)}::date`);
      return {
        within30: row?.d30 ?? 0,
        within60: row?.d60 ?? 0,
        within90: row?.d90 ?? 0,
        nextDeadline: row?.next ?? null,
      };
    });
  }

  get(id: string, asOf: string) {
    return this.tx(async (tx) => {
      const [contract] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, id));
      if (!contract) throw new Error("CONTRACT_NOT_FOUND");
      const files = await tx
        .select()
        .from(contractFiles)
        .where(eq(contractFiles.contractId, id))
        .orderBy(asc(contractFiles.createdAt));
      const events = await tx
        .select()
        .from(contractEvents)
        .where(eq(contractEvents.contractId, id))
        .orderBy(desc(contractEvents.occurredAt), desc(contractEvents.id));
      const [signing] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, id));
      return {
        contract: contractView(contract, asOf),
        files: files.map(fileView),
        activity: events.map((e): ContractActivity => ({
          id: e.id,
          eventType: e.eventType,
          actorName: e.actorName,
          changes: e.changes,
          occurredAt: e.occurredAt.toISOString(),
        })),
        signing: signing ? signingView(signing) : null,
      };
    });
  }

  /** Records a contract. Retrying with the same id and content is harmless. */
  create(raw: unknown, actor: Actor & { kind: "user" }) {
    const input = ContractInputSchema.parse(raw);
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.id}))`,
      );
      const [existing] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, input.id));
      if (existing) {
        if (
          existing.createdById !== actor.id ||
          editableFields.some((f) => !sameValue(existing[f], input[f]))
        )
          throw new Error("CONTRACT_IDEMPOTENCY_CONFLICT");
        return existing.id;
      }
      await insertContract(tx, input, "register", actor);
      return input.id;
    });
  }

  /** Applies an edit made against `expectedVersion` and records each change. */
  update(
    id: string,
    expectedVersion: number,
    raw: unknown,
    actor: Actor & { kind: "user" },
  ) {
    const input = ContractInputSchema.parse(raw);
    if (input.id !== id) throw new Error("CONTRACT_ID_MISMATCH");
    return this.tx(async (tx) => {
      const [current] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, id))
        .for("update");
      if (!current) throw new Error("CONTRACT_NOT_FOUND");
      if (current.version !== expectedVersion)
        throw new Error("CONTRACT_VERSION_CONFLICT");
      const changes = Object.fromEntries(
        editableFields
          .filter((f) => !sameValue(current[f], input[f]))
          .map((f) => [f, { from: current[f], to: input[f] }]),
      );
      if (Object.keys(changes).length === 0) return current.version;
      // A contract that is out for signature from a template keeps the
      // status the signing provider reports.
      if (changes.status && current.source === "template") {
        const [signing] = await tx
          .select({ state: contractSigning.state })
          .from(contractSigning)
          .where(eq(contractSigning.contractId, id));
        if (signing && !terminalContractSigningStates.includes(signing.state))
          throw new Error("CONTRACT_STATUS_FOLLOWS_SIGNING");
      }
      const version = current.version + 1;
      await tx
        .update(commerceContracts)
        .set({
          ...Object.fromEntries(editableFields.map((f) => [f, input[f]])),
          version,
          updatedAt: new Date(),
        })
        .where(eq(commerceContracts.id, id));
      await recordEvent(tx, id, version, actor, "contract.updated", changes);
      return version;
    });
  }

  /**
   * Stores a PDF and attaches it. The bytes are written first; if attaching
   * fails, they are removed again so no unreferenced document remains.
   */
  async addFile(
    contractId: string,
    upload: { kind: ContractFileKind; fileName: string; bytes: Uint8Array },
    actor: Actor & { kind: "user" },
  ) {
    if (
      !(uploadableContractFileKinds as readonly string[]).includes(upload.kind)
    )
      throw new Error("CONTRACT_FILE_KIND_NOT_UPLOADABLE");
    const fileName = ContractFileNameSchema.parse(upload.fileName);
    const stored = await this.stores.primary.put(upload.bytes, {
      purpose: "contract",
      contentType: "application/pdf",
    });
    try {
      return await this.tx(async (tx) => {
        const [contract] = await tx
          .select()
          .from(commerceContracts)
          .where(eq(commerceContracts.id, contractId))
          .for("update");
        if (!contract) throw new Error("CONTRACT_NOT_FOUND");
        const file = await insertFile(
          tx,
          contractId,
          upload.kind,
          fileName,
          stored,
          actor,
        );
        await touchContract(tx, contract);
        await recordEvent(
          tx,
          contractId,
          contract.version + 1,
          actor,
          "contract.document_added",
          { kind: upload.kind, fileName, sha256: stored.sha256 },
        );
        return fileView(file);
      });
    } catch (error) {
      await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  /** The file's bytes, checked against the hash recorded when it was stored. */
  readFile(contractId: string, fileId: string) {
    return this.tx(async (tx) => {
      const [file] = await tx
        .select()
        .from(contractFiles)
        .where(
          and(
            eq(contractFiles.id, fileId),
            eq(contractFiles.contractId, contractId),
          ),
        );
      if (!file) throw new Error("CONTRACT_FILE_NOT_FOUND");
      const [contract] = await tx
        .select({
          counterpartyName: commerceContracts.counterpartyName,
          contractType: commerceContracts.contractType,
        })
        .from(commerceContracts)
        .where(eq(commerceContracts.id, contractId));
      return { file: fileView(file), contract, row: file };
    }).then(async ({ file, contract, row }) => ({
      file,
      contract,
      bytes: await this.stores.read(row),
    }));
  }

  /** Removes an uploaded file from a contract that is not yet executed. */
  async removeFile(
    contractId: string,
    fileId: string,
    actor: Actor & { kind: "user" },
  ) {
    const removed = await this.tx(async (tx) => {
      const [contract] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, contractId))
        .for("update");
      if (!contract) throw new Error("CONTRACT_NOT_FOUND");
      const [file] = await tx
        .select()
        .from(contractFiles)
        .where(
          and(
            eq(contractFiles.id, fileId),
            eq(contractFiles.contractId, contractId),
          ),
        );
      if (!file) throw new Error("CONTRACT_FILE_NOT_FOUND");
      if (
        contract.status === "executed" ||
        !(uploadableContractFileKinds as readonly string[]).includes(file.kind)
      )
        throw new Error("CONTRACT_FILE_PERMANENT");
      await tx.delete(contractFiles).where(eq(contractFiles.id, fileId));
      await touchContract(tx, contract);
      await recordEvent(
        tx,
        contractId,
        contract.version + 1,
        actor,
        "contract.document_removed",
        { kind: file.kind, fileName: file.fileName, sha256: file.sha256 },
      );
      return file;
    });
    await this.stores
      .for(removed.storageBackend)
      .delete(removed.storageKey)
      .catch(() => {});
  }
}

async function insertContract(
  tx: RuntimeTransaction,
  input: ContractInput,
  source: "register" | "template",
  actor: Actor & { kind: "user" },
) {
  await tx.insert(commerceContracts).values({
    ...Object.fromEntries(editableFields.map((f) => [f, input[f]])),
    id: input.id,
    counterpartyName: input.counterpartyName,
    contractType: input.contractType,
    paper: input.paper,
    status: input.status,
    ownerName: input.ownerName,
    source,
    createdById: actor.id,
    createdByName: actorName(actor),
  });
  await recordEvent(tx, input.id, 1, actor, "contract.created", {
    counterpartyName: input.counterpartyName,
    contractType: input.contractType,
    status: input.status,
  });
}

async function insertFile(
  tx: RuntimeTransaction,
  contractId: string,
  kind: ContractFileKind,
  fileName: string,
  stored: StoredDocument,
  actor: Actor,
) {
  const [file] = await tx
    .insert(contractFiles)
    .values({
      id: randomUUID(),
      contractId,
      kind,
      fileName,
      storageBackend: stored.backend,
      storageKey: stored.key,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      contentType: stored.contentType,
      uploadedById: actorId(actor),
      uploadedByName: actorName(actor),
    })
    .returning();
  if (!file) throw new Error("CONTRACT_FILE_INSERT_FAILED");
  return file;
}

function touchContract(tx: RuntimeTransaction, contract: ContractRow) {
  return tx
    .update(commerceContracts)
    .set({ version: contract.version + 1, updatedAt: new Date() })
    .where(eq(commerceContracts.id, contract.id));
}

async function recordEvent(
  tx: RuntimeTransaction,
  contractId: string,
  version: number,
  actor: Actor,
  eventType: string,
  changes: Record<string, unknown>,
) {
  await tx.insert(contractEvents).values({
    id: randomUUID(),
    contractId,
    eventType,
    actorId: actorId(actor),
    actorName: actorName(actor),
    changes,
  });
  await appendAuditAndOutbox(tx, {
    aggregateType: "agreement",
    aggregateId: contractId,
    aggregateVersion: version,
    eventType,
    actor,
    requestId: randomUUID(),
    after: { eventType, fields: Object.keys(changes) },
  });
}

export interface PrepareContractSigning {
  contract: ContractInput;
  signing: {
    templateId: string;
    templateVersion: string;
    templateHash: string;
    documentName: string;
    input: Record<string, string>;
    counterpartySigner: ContractSigner;
    countersignerId: string;
    approvalRequired: boolean;
    testMode: boolean;
  };
  pdf: Uint8Array;
  fileName: string;
}

/**
 * Persistence for contracts prepared from a template and sent for signature.
 * The provider binding, lease and re-fetch rules match the MNDA workflow
 * (ADR 0011): a provider draft is bound before sending, callbacks only wake
 * a re-read, and completion archives the executed PDF in the same
 * transaction that marks the contract executed.
 */
export class ContractSigningRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    private readonly stores: ContractDocumentStores,
  ) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /** Active Fil One countersigners, read from the MNDA signer list. */
  countersigners() {
    return this.tx((tx) =>
      tx
        .select({
          id: mndaSigners.id,
          name: mndaSigners.name,
          email: mndaSigners.email,
          title: mndaSigners.title,
          isDefault: mndaSigners.isDefault,
        })
        .from(mndaSigners)
        .where(eq(mndaSigners.active, true))
        .orderBy(asc(mndaSigners.name)),
    );
  }

  async prepare(
    prepared: PrepareContractSigning,
    preparer: Actor & { kind: "user" },
  ) {
    const contract = ContractInputSchema.parse(prepared.contract);
    if (contract.status !== "draft" || contract.paper !== "ours")
      throw new Error("CONTRACT_PREPARED_MUST_BE_OUR_DRAFT");
    const fileName = ContractFileNameSchema.parse(prepared.fileName);
    const stored = await this.stores.primary.put(prepared.pdf, {
      purpose: "contract",
      contentType: "application/pdf",
    });
    try {
      return await this.tx(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${contract.id}))`,
        );
        const [existing] = await tx
          .select()
          .from(contractSigning)
          .where(eq(contractSigning.contractId, contract.id));
        if (existing) {
          if (
            existing.preparerId !== preparer.id ||
            !sameValue(existing.input, prepared.signing.input) ||
            existing.templateId !== prepared.signing.templateId
          )
            throw new Error("CONTRACT_IDEMPOTENCY_CONFLICT");
          return { record: signingView(existing), duplicate: true };
        }
        const [signer] = await tx
          .select()
          .from(mndaSigners)
          .where(
            and(
              eq(mndaSigners.id, prepared.signing.countersignerId),
              eq(mndaSigners.active, true),
            ),
          );
        if (!signer) throw new Error("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
        if (
          signer.email.toLowerCase() ===
          prepared.signing.counterpartySigner.email.toLowerCase()
        )
          throw new Error("CONTRACT_DISTINCT_SIGNERS_REQUIRED");
        await insertContract(tx, contract, "template", preparer);
        const [row] = await tx
          .insert(contractSigning)
          .values({
            contractId: contract.id,
            templateId: prepared.signing.templateId,
            templateVersion: prepared.signing.templateVersion,
            templateHash: prepared.signing.templateHash,
            documentName: prepared.signing.documentName,
            input: prepared.signing.input,
            counterpartySigner: prepared.signing.counterpartySigner,
            countersigner: {
              id: signer.id,
              name: signer.name,
              email: signer.email,
              title: signer.title,
            },
            preparerId: preparer.id,
            preparerName: actorName(preparer),
            approvalRequired: prepared.signing.approvalRequired,
            approvalState: prepared.signing.approvalRequired
              ? "pending"
              : "not_required",
            testMode: prepared.signing.testMode,
          })
          .returning();
        if (!row) throw new Error("CONTRACT_SIGNING_INSERT_FAILED");
        await insertFile(
          tx,
          contract.id,
          "generated",
          fileName,
          stored,
          preparer,
        );
        await tx
          .update(commerceContracts)
          .set({ version: 2 })
          .where(eq(commerceContracts.id, contract.id));
        await recordEvent(tx, contract.id, 2, preparer, "contract.prepared", {
          templateId: row.templateId,
          templateVersion: row.templateVersion,
          approvalRequired: row.approvalRequired,
          testMode: row.testMode,
        });
        return { record: signingView(row), duplicate: false };
      });
    } catch (error) {
      await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  get(contractId: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId));
      if (!row) throw new Error("CONTRACT_SIGNING_NOT_FOUND");
      return signingView(row);
    });
  }

  byProvider(providerId: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.providerId, providerId));
      return row ? signingView(row) : null;
    });
  }

  /** The prepared PDF, verified against its recorded hash. */
  async generatedPdf(contractId: string) {
    const file = await this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractFiles)
        .where(
          and(
            eq(contractFiles.contractId, contractId),
            eq(contractFiles.kind, "generated"),
          ),
        );
      return row;
    });
    if (!file) throw new Error("CONTRACT_FILE_NOT_FOUND");
    return this.stores.read(file);
  }

  /**
   * Records an approval decision. Only a pending request can be decided, and
   * never by the person who prepared it; the database enforces both again.
   */
  decide(
    contractId: string,
    decision: { approve: true } | { approve: false; reason: string },
    approver: Actor & { kind: "user" },
  ) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId))
        .for("update");
      if (!row) throw new Error("CONTRACT_SIGNING_NOT_FOUND");
      if (row.approvalState !== "pending")
        throw new Error("CONTRACT_APPROVAL_NOT_PENDING");
      if (row.preparerId === approver.id)
        throw new Error("CONTRACT_APPROVER_IS_PREPARER");
      if (terminalContractSigningStates.includes(row.state))
        throw new Error("CONTRACT_APPROVAL_NOT_PENDING");
      const reason = decision.approve ? null : decision.reason.trim();
      if (!decision.approve && !reason)
        throw new Error("CONTRACT_REJECTION_REASON_REQUIRED");
      const [next] = await tx
        .update(contractSigning)
        .set({
          approvalState: decision.approve ? "approved" : "rejected",
          approverId: approver.id,
          approverName: actorName(approver),
          decidedAt: new Date(),
          rejectionReason: reason,
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(contractSigning.contractId, contractId))
        .returning();
      if (!next) throw new Error("CONTRACT_SIGNING_UPDATE_FAILED");
      const [contract] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, contractId))
        .for("update");
      if (!contract) throw new Error("CONTRACT_NOT_FOUND");
      await touchContract(tx, contract);
      await recordEvent(
        tx,
        contractId,
        contract.version + 1,
        approver,
        decision.approve ? "contract.approved" : "contract.rejected",
        reason ? { reason } : {},
      );
      return signingView(next);
    });
  }

  /** Lease spans provider I/O without holding a database transaction open. */
  claim(contractId: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId))
        .for("update");
      if (!row) throw new Error("CONTRACT_SIGNING_NOT_FOUND");
      if (row.leaseUntil && row.leaseUntil > new Date())
        throw new Error("CONTRACT_BUSY");
      const token = randomUUID();
      await tx
        .update(contractSigning)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + 120_000) })
        .where(eq(contractSigning.contractId, contractId));
      return { record: signingView(row), token };
    });
  }

  release(contractId: string, token: string) {
    return this.tx(async (tx) => {
      await tx
        .update(contractSigning)
        .set({ leaseToken: null, leaseUntil: null })
        .where(
          and(
            eq(contractSigning.contractId, contractId),
            eq(contractSigning.leaseToken, token),
          ),
        );
    });
  }

  /**
   * Applies a signing transition under the caller's lease. Reaching
   * `completed` requires the executed PDF, which is stored and attached in
   * the same transaction that marks the register row executed.
   */
  async update(
    contractId: string,
    token: string,
    patch: {
      state?: ContractSigningState;
      providerId?: string;
      error?: string | null;
    },
    actor: Actor,
    executed?: { bytes: Uint8Array; fileName: string },
  ) {
    const stored = executed
      ? await this.stores.primary.put(executed.bytes, {
          purpose: "contract",
          contentType: "application/pdf",
        })
      : undefined;
    try {
      return await this.tx(async (tx) => {
        const [row] = await tx
          .select()
          .from(contractSigning)
          .where(
            and(
              eq(contractSigning.contractId, contractId),
              eq(contractSigning.leaseToken, token),
            ),
          )
          .for("update");
        if (!row) throw new Error("CONTRACT_LEASE_LOST");
        if (terminalContractSigningStates.includes(row.state)) {
          if (stored)
            await this.stores.primary.delete(stored.key).catch(() => {});
          return signingView(row);
        }
        if (stored && executed)
          await insertFile(
            tx,
            contractId,
            "executed",
            ContractFileNameSchema.parse(executed.fileName),
            stored,
            actor,
          );
        const [next] = await tx
          .update(contractSigning)
          .set({
            ...patch,
            leaseUntil: new Date(Date.now() + 120_000),
            version: row.version + 1,
            updatedAt: new Date(),
            ...(patch.state === "completed" ? { completedAt: new Date() } : {}),
          })
          .where(eq(contractSigning.contractId, contractId))
          .returning();
        if (!next) throw new Error("CONTRACT_SIGNING_UPDATE_FAILED");
        if (patch.state && patch.state !== row.state) {
          const [contract] = await tx
            .select()
            .from(commerceContracts)
            .where(eq(commerceContracts.id, contractId))
            .for("update");
          if (!contract) throw new Error("CONTRACT_NOT_FOUND");
          const status = registerStatusFor[patch.state];
          await tx
            .update(commerceContracts)
            .set({
              ...(status ? { status } : {}),
              version: contract.version + 1,
              updatedAt: new Date(),
            })
            .where(eq(commerceContracts.id, contractId));
          await recordEvent(
            tx,
            contractId,
            contract.version + 1,
            actor,
            `contract.signing_${patch.state}`,
            status && status !== contract.status
              ? { status: { from: contract.status, to: status } }
              : {},
          );
        }
        return signingView(next);
      });
    } catch (error) {
      if (stored) await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }
}
