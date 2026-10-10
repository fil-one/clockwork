import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  ContractFileNameSchema,
  ContractInputSchema,
  contractExportLimit,
  contractPageSize,
  counterpartyPaperFileKinds,
  contractResendableStates,
  counterpartyPaperRequiresApproval,
  terminalContractSigningStates,
  uploadableContractFileKinds,
  type Actor,
  type ContractActivity,
  type ContractCancelCode,
  type ContractFileKind,
  type ContractFileRecord,
  type ContractInput,
  type ContractListQuery,
  type ContractListRow,
  type ContractRecord,
  type ContractSigner,
  type ContractSigningHistoryEntry,
  type ContractSigningRecord,
  type ContractSigningState,
  type ContractStatus,
  type ContractType,
  type StoredDocument,
} from "@clockwork/contracts";
import {
  addContractDays,
  assertDistinctOrSelfApproved,
  contractTermSchedule,
  type SelfApproval,
} from "@clockwork/domain";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import {
  commerceContracts,
  contractEvents,
  contractFiles,
  contractSigning,
  contractSigningHistory,
} from "../schema/contracts";
import { mndaSigners } from "../schema/mnda";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import { checkedSelfApproval } from "./self-approval";
import {
  lazyDocumentStores,
  type ContractDocumentStores,
  type DocumentStoresSource,
} from "./contract-documents";

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
  executedAt: r.executedAt?.toISOString() ?? null,
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
  remindedAt: s.remindedAt?.toISOString() ?? null,
  correctedSignerEmail: s.correctedSignerEmail,
  pendingSignerEmail: s.pendingSignerEmail,
  cancelCode: s.cancelCode,
  cancelReason: s.cancelReason,
  documentType: s.documentType,
  counterpartySigns: s.counterpartySigns,
  requestNumber: s.requestNumber,
  preparerEmail: s.preparerEmail,
  version: s.version,
});

type HistoryRow = typeof contractSigningHistory.$inferSelect;

/** A replaced request, read from the row the archive trigger kept. */
const historyView = (h: HistoryRow): ContractSigningHistoryEntry => {
  const r = h.request;
  const optional = (key: string) => {
    const value = r[key];
    return typeof value === "string" ? value : null;
  };
  const text = (key: string) => optional(key) ?? "";
  const signer = (r.counterparty_signer ?? {}) as Partial<ContractSigner>;
  const countersigner = (r.countersigner ?? {}) as Partial<ContractSigner>;
  return {
    requestNumber: h.requestNumber,
    state: h.state,
    cancelCode: optional("cancel_code") as ContractCancelCode | null,
    cancelReason: optional("cancel_reason"),
    documentType:
      r.document_type === "counterparty_paper"
        ? "counterparty_paper"
        : "contract_template",
    counterpartySigns: r.counterparty_signs !== false,
    counterpartySigner: {
      name: signer.name ?? "",
      email: optional("corrected_signer_email") ?? signer.email ?? "",
      title: signer.title ?? "",
    },
    countersignerName: countersigner.name ?? "",
    preparerName: text("preparer_name"),
    createdAt: new Date(text("created_at")).toISOString(),
    updatedAt: new Date(text("updated_at")).toISOString(),
  };
};

const actorName = (actor: Actor) =>
  actor.display ?? (actor.kind === "provider" ? "SignWell" : actor.id);
const actorId = (actor: Actor) =>
  actor.kind === "user" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    actor.id,
  )
    ? actor.id
    : null;

/** Object keys sorted at every depth; arrays keep their order. jsonb returns
 * keys in its own order, so a submitted value and its stored copy compare
 * equal only once both are put in one order. */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object" && !(value instanceof Date)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              canonical((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null));

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

const terminalStates = sql.raw(
  terminalContractSigningStates.map((state) => `'${state}'`).join(", "),
);
/** A template contract waiting for an approval decision. Reads the signing
 * row as `s`. */
export const contractAwaitingApproval = sql`(s.approval_state = 'pending'
  and s.state not in (${terminalStates}))`;
/** A template contract that needs a person: SignWell reported a problem, a
 * provider call failed, or an approver sent it back. Reads the signing row
 * as `s`. */
export const contractNeedsAttention = sql`(s.state not in (${terminalStates})
  and (s.state = 'attention' or s.error is not null
    or s.approval_state = 'rejected'))`;

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
  signing_state: ContractSigningState | null;
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
  signingState: r.signing_state,
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
function scheduledRows(asOf: string, includeMndas: boolean) {
  const mndas = includeMndas
    ? sql`union all
      select m.id, 'mnda', m.input->>'company', '', 'mnda', 'ours',
        'executed', m.input->>'effectiveDate', false, null, null,
        m.owner_name, m.owner_id, '{}'::text[],
        coalesce(m.completed_at, m.updated_at),
        null::date, 1, null::text
      from public.commerce_mnda_requests m
      where m.state = 'completed'`
    : sql``;
  return sql`
    with register as (
      select c.id, c.source, c.counterparty_name, c.title, c.contract_type,
        c.paper, c.status, c.effective_date::text as effective_date,
        c.auto_renew, c.renewal_term_months, c.notice_period_days,
        c.owner_name, c.created_by_id, c.tags, c.updated_at,
        public.commerce_contract_term_boundary(c.effective_date,
          c.initial_term_months, c.auto_renew, c.renewal_term_months,
          ${asOf}::date) as boundary,
        (select count(*)::integer from public.commerce_contract_files f
          where f.contract_id = c.id) as document_count,
        (select s.state from public.commerce_contract_signing s
          where s.contract_id = c.id) as signing_state
      from public.commerce_contracts c
      ${mndas}
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

/** What a reader may see beyond the register itself. */
export interface ContractListScope {
  /** Signed MNDAs appear only to people who may open the MNDA register. */
  includeMndas: boolean;
  /** The reader, for "recorded by me": contracts they recorded or
   * prepared, and MNDAs they sent. */
  viewerId: string;
}

export class ContractRepository {
  private readonly documentStores: () => ContractDocumentStores;
  constructor(
    private readonly db: RuntimeDatabase,
    stores: DocumentStoresSource,
  ) {
    this.documentStores = lazyDocumentStores(stores);
  }
  private get stores() {
    return this.documentStores();
  }

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  private filters(
    query: Omit<ContractListQuery, "page">,
    asOf: string,
    viewerId: string,
  ) {
    const conditions: SQL[] = [sql`true`];
    if (query.mine) conditions.push(sql`created_by_id = ${viewerId}::uuid`);
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(sql`(counterparty_name ilike ${pattern}
        or title ilike ${pattern} or owner_name ilike ${pattern}
        or exists (select 1 from unnest(tags) tag where tag ilike ${pattern}))`);
    }
    if (query.type) conditions.push(sql`contract_type = ${query.type}`);
    if (query.status === "signing_approval")
      conditions.push(sql`exists (select 1 from public.commerce_contract_signing s
        where s.contract_id = scheduled.id and ${contractAwaitingApproval})`);
    else if (query.status === "signing_attention")
      conditions.push(sql`exists (select 1 from public.commerce_contract_signing s
        where s.contract_id = scheduled.id and ${contractNeedsAttention})`);
    else if (query.status?.startsWith("signing_"))
      conditions.push(
        sql`status = 'draft' and signing_state = ${query.status.slice("signing_".length)}`,
      );
    else if (query.status) conditions.push(sql`status = ${query.status}`);
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
  list(
    query: ContractListQuery,
    asOf: string,
    scope: ContractListScope,
  ): Promise<ContractListResult> {
    return this.tx(async (tx) => {
      const rows =
        await tx.execute<ListRow>(sql`${scheduledRows(asOf, scope.includeMndas)}
        select *, count(*) over () as total from scheduled
        where ${this.filters(query, asOf, scope.viewerId)}
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

  /** Rows matching the filters for export, up to `contractExportLimit`;
   * `truncated` says when more matched. */
  exportRows(
    query: Omit<ContractListQuery, "page">,
    asOf: string,
    scope: ContractListScope,
  ) {
    return this.tx(async (tx) => {
      const rows = [
        ...(await tx.execute<ListRow>(sql`${scheduledRows(asOf, scope.includeMndas)}
          select *, 0 as total from scheduled
          where ${this.filters(query, asOf, scope.viewerId)}
          order by ${this.order(query)} limit ${contractExportLimit + 1}`)),
      ].map(listRowView);
      return {
        rows: rows.slice(0, contractExportLimit),
        truncated: rows.length > contractExportLimit,
      };
    });
  }

  /**
   * Records who downloaded a contract file or exported the register. Each
   * access is its own audit aggregate, so it never competes with a contract's
   * version chain. An export says how many of its rows were signed MNDAs,
   * which it carries for readers of the MNDA register.
   */
  recordAccess(
    actor: Actor,
    event:
      | {
          kind: "file";
          contractId: string;
          fileId: string;
          fileKind: ContractFileKind;
        }
      | {
          kind: "export";
          filters: ContractListQuery;
          rows: number;
          mndaRows: number;
          truncated: boolean;
        },
  ) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: event.kind === "file" ? "document" : "report_export",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType:
          event.kind === "file"
            ? "contract.file_downloaded"
            : "contract.register_exported",
        actor,
        requestId: randomUUID(),
        after:
          event.kind === "file"
            ? {
                contractId: event.contractId,
                fileId: event.fileId,
                kind: event.fileKind,
              }
            : {
                filters: event.filters,
                rows: event.rows,
                mndaRows: event.mndaRows,
                truncated: event.truncated,
              },
      }),
    );
  }

  /** Executed contracts that renew automatically and whose notice deadline
   * for the next renewal has already passed. */
  noticesPassed(asOf: string) {
    return this.tx(async (tx) =>
      [
        ...(await tx.execute<ListRow>(sql`${scheduledRows(asOf, false)}
          select *, 0 as total from scheduled
          where status = 'executed' and notice_deadline::date < ${asOf}::date
          order by renewal_date asc, lower(counterparty_name) asc
          limit 500`)),
      ].map(listRowView),
    );
  }

  /** Executed contracts whose non-renewal notice is due within `days`. */
  renewalsDue(asOf: string, days: number) {
    return this.tx(async (tx) =>
      [
        ...(await tx.execute<ListRow>(sql`${scheduledRows(asOf, false)}
          select *, 0 as total from scheduled
          where status = 'executed'
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
        passed: number;
        next: string | null;
      }>(sql`${scheduledRows(asOf, false)}
        select
          count(*) filter (where notice_deadline::date between ${asOf}::date and ${addContractDays(asOf, 30)}::date)::integer as d30,
          count(*) filter (where notice_deadline::date between ${asOf}::date and ${addContractDays(asOf, 60)}::date)::integer as d60,
          count(*) filter (where notice_deadline::date between ${asOf}::date and ${addContractDays(asOf, 90)}::date)::integer as d90,
          count(*) filter (where notice_deadline::date < ${asOf}::date)::integer as passed,
          min(notice_deadline) filter (where notice_deadline::date >= ${asOf}::date) as next
        from scheduled
        where status = 'executed' and notice_deadline is not null`);
      return {
        within30: row?.d30 ?? 0,
        within60: row?.d60 ?? 0,
        within90: row?.d90 ?? 0,
        passed: row?.passed ?? 0,
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
      const earlier = await tx
        .select()
        .from(contractSigningHistory)
        .where(eq(contractSigningHistory.contractId, id))
        .orderBy(desc(contractSigningHistory.requestNumber));
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
        /** Requests that ended and were replaced, newest first. */
        previousSigning: earlier.map(historyView),
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
      // Executed is final for ordinary edits; it may only expire or end.
      if (
        current.executedAt &&
        !["executed", "expired", "terminated"].includes(input.status)
      )
        throw new Error("CONTRACT_EXECUTED_FINAL");
      // A contract out for signature, from a template or on the
      // counterparty's paper, keeps the status the signing provider reports.
      if (changes.status) {
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
          paper: commerceContracts.paper,
          title: commerceContracts.title,
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
        contract.executedAt !== null ||
        !(uploadableContractFileKinds as readonly string[]).includes(file.kind)
      )
        throw new Error("CONTRACT_FILE_PERMANENT");
      // The PDF an uploaded-PDF request was prepared from stays, including
      // one a later request replaced, as the database also enforces (001465).
      const [pinned] = await tx
        .select({ contractId: contractSigning.contractId })
        .from(contractSigning)
        .where(
          and(
            eq(contractSigning.contractId, contractId),
            eq(contractSigning.documentType, "counterparty_paper"),
            eq(contractSigning.templateHash, file.sha256),
          ),
        );
      const [replaced] = await tx
        .select({ contractId: contractSigningHistory.contractId })
        .from(contractSigningHistory)
        .where(
          and(
            eq(contractSigningHistory.contractId, contractId),
            sql`${contractSigningHistory.request}->>'document_type' = 'counterparty_paper'`,
            sql`${contractSigningHistory.request}->>'template_hash' = ${file.sha256}`,
          ),
        );
      if (pinned || replaced)
        throw new Error("CONTRACT_FILE_SENT_FOR_SIGNATURE");
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
  detail?: Record<string, unknown>,
  before?: Record<string, unknown>,
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
    ...(before ? { before } : {}),
    after: { eventType, fields: Object.keys(changes), ...detail },
  });
}

/** A signing change worth its own history entry, beyond a state change. */
export interface ContractSigningNote {
  /** Overrides the default `contract.signing_<state>` event name. */
  eventType: string;
  /** Recorded in the contract's history and its audit event. */
  detail?: Record<string, unknown>;
  /** What the change replaced, such as the signer email before a
   * correction: the audit event's before-image, and the `from` of the
   * history entry. */
  before?: Record<string, unknown>;
}

/** A note's values as the contract's history shows them: a value the change
 * replaced reads as `{ from, to }`, like an edit. The audit event keeps the
 * detail as its after-image and `before` as its before-image. */
function historyChanges(note: ContractSigningNote | undefined) {
  return Object.fromEntries(
    Object.entries(note?.detail ?? {}).map(([key, value]) => [
      key,
      note?.before && key in note.before
        ? { from: note.before[key], to: value }
        : value,
    ]),
  );
}

/** A recorded contract, on either party's paper, sent from one of its
 * uploaded PDFs with the Fil One signature page appended (`pdf`). */
export interface PrepareCounterpartyPaper {
  contractId: string;
  /** The uploaded PDF and the hash it was read with; the request is pinned
   * to that hash. */
  source: { fileId: string; sha256: string };
  documentName: string;
  /** The signature page's wording version. */
  signaturePageVersion: string;
  /** Null when the counterparty signed their paper already. */
  counterpartySigner: ContractSigner | null;
  countersignerId: string;
  testMode: boolean;
  /** Copied by SignWell on the completed document. */
  preparerEmail?: string | null;
  pdf: Uint8Array;
  fileName: string;
}

export interface PrepareContractSigning {
  contract: ContractInput;
  signing: {
    templateId: string;
    templateVersion: string;
    templateHash: string;
    documentName: string;
    input: ContractSigningRecord["input"];
    counterpartySigner: ContractSigner;
    countersignerId: string;
    approvalRequired: boolean;
    testMode: boolean;
    /** Copied by SignWell on the completed document. */
    preparerEmail?: string | null;
  };
  pdf: Uint8Array;
  fileName: string;
}

/** The address kept for the SignWell copy: lowercased, or none. */
const copyAddress = (email: string | null | undefined) =>
  email?.trim() ? email.trim().toLowerCase() : null;

/**
 * Replaces a contract's current request that ended without signatures, in
 * the caller's transaction: the database moves it to the signing history
 * as it stands (001465). Returns the next request's number.
 */
async function replaceEnded(tx: RuntimeTransaction, existing: SigningRow) {
  if (!contractResendableStates.includes(existing.state))
    throw new Error("CONTRACT_SIGNING_EXISTS");
  if (existing.leaseUntil && existing.leaseUntil > new Date())
    throw new Error("CONTRACT_BUSY");
  await tx
    .delete(contractSigning)
    .where(eq(contractSigning.contractId, existing.contractId));
  return existing.requestNumber + 1;
}

/**
 * Persistence for contracts prepared from a template and sent for signature.
 * The provider binding, lease and re-fetch rules match the MNDA workflow
 * (ADR 0011): a provider draft is bound before sending, callbacks only wake
 * a re-read, and completion archives the executed PDF in the same
 * transaction that marks the contract executed.
 */
export class ContractSigningRepository {
  private readonly documentStores: () => ContractDocumentStores;
  constructor(
    private readonly db: RuntimeDatabase,
    stores: DocumentStoresSource,
  ) {
    this.documentStores = lazyDocumentStores(stores);
  }
  private get stores() {
    return this.documentStores();
  }

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
      const result = await this.tx(async (tx) => {
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
            preparerEmail: copyAddress(prepared.signing.preparerEmail),
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
      // A retried preparation keeps the first PDF; the second copy goes.
      if (result.duplicate)
        await this.stores.primary.delete(stored.key).catch(() => {});
      return result;
    } catch (error) {
      await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  /**
   * Prepares one of a recorded contract's uploaded PDFs for signature, on
   * either party's paper: a signing request pinned to the PDF's hash, with
   * the PDF that goes to SignWell stored as the prepared document. It always
   * needs approval. A contract has one current request: a retry by the same
   * person from the same file returns it while it is open, and once it was
   * declined, expired or voided a new one replaces it.
   */
  async prepareCounterpartyPaper(
    prepared: PrepareCounterpartyPaper,
    preparer: Actor & { kind: "user" },
  ) {
    const fileName = ContractFileNameSchema.parse(prepared.fileName);
    const stored = await this.stores.primary.put(prepared.pdf, {
      purpose: "contract",
      contentType: "application/pdf",
    });
    try {
      const result = await this.tx(async (tx) => {
        const id = prepared.contractId;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`);
        const [contract] = await tx
          .select()
          .from(commerceContracts)
          .where(eq(commerceContracts.id, id))
          .for("update");
        if (!contract) throw new Error("CONTRACT_NOT_FOUND");
        const [existing] = await tx
          .select()
          .from(contractSigning)
          .where(eq(contractSigning.contractId, id))
          .for("update");
        // A retry returns the request still open; a completed one stays.
        if (existing && !contractResendableStates.includes(existing.state)) {
          if (
            terminalContractSigningStates.includes(existing.state) ||
            existing.documentType !== "counterparty_paper" ||
            existing.preparerId !== preparer.id ||
            existing.input.source_file_id !== prepared.source.fileId ||
            existing.counterpartySigns !==
              (prepared.counterpartySigner !== null) ||
            existing.countersigner.id !== prepared.countersignerId ||
            (prepared.counterpartySigner !== null &&
              !sameValue(
                existing.counterpartySigner,
                prepared.counterpartySigner,
              ))
          )
            throw new Error("CONTRACT_SIGNING_EXISTS");
          return { record: signingView(existing), duplicate: true };
        }
        if (
          contract.executedAt !== null ||
          !["draft", "in_negotiation"].includes(contract.status)
        )
          throw new Error("CONTRACT_PAPER_NOT_SENDABLE");
        const [file] = await tx
          .select()
          .from(contractFiles)
          .where(
            and(
              eq(contractFiles.id, prepared.source.fileId),
              eq(contractFiles.contractId, id),
            ),
          );
        if (
          !file ||
          !counterpartyPaperFileKinds.includes(file.kind) ||
          file.sha256 !== prepared.source.sha256
        )
          throw new Error("CONTRACT_FILE_NOT_FOUND");
        const [signer] = await tx
          .select()
          .from(mndaSigners)
          .where(
            and(
              eq(mndaSigners.id, prepared.countersignerId),
              eq(mndaSigners.active, true),
            ),
          );
        if (!signer) throw new Error("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
        if (
          prepared.counterpartySigner &&
          signer.email.toLowerCase() ===
            prepared.counterpartySigner.email.toLowerCase()
        )
          throw new Error("CONTRACT_DISTINCT_SIGNERS_REQUIRED");
        const requestNumber = existing ? await replaceEnded(tx, existing) : 1;
        const [row] = await tx
          .insert(contractSigning)
          .values({
            contractId: id,
            requestNumber,
            preparerEmail: copyAddress(prepared.preparerEmail),
            templateId: "counterparty-paper",
            templateVersion: prepared.signaturePageVersion,
            templateHash: file.sha256,
            documentName: prepared.documentName,
            input: { source_file_id: file.id },
            counterpartySigner: prepared.counterpartySigner ?? {
              name: "",
              email: "",
              title: "",
            },
            countersigner: {
              id: signer.id,
              name: signer.name,
              email: signer.email,
              title: signer.title,
            },
            preparerId: preparer.id,
            preparerName: actorName(preparer),
            approvalRequired: counterpartyPaperRequiresApproval,
            approvalState: counterpartyPaperRequiresApproval
              ? "pending"
              : "not_required",
            testMode: prepared.testMode,
            documentType: "counterparty_paper",
            counterpartySigns: prepared.counterpartySigner !== null,
          })
          .returning();
        if (!row) throw new Error("CONTRACT_SIGNING_INSERT_FAILED");
        await insertFile(tx, id, "generated", fileName, stored, preparer);
        await touchContract(tx, contract);
        await recordEvent(
          tx,
          id,
          contract.version + 1,
          preparer,
          "contract.prepared",
          {
            documentType: row.documentType,
            sourceFileName: file.fileName,
            sha256: file.sha256,
            counterpartySigns: row.counterpartySigns,
            approvalRequired: row.approvalRequired,
            testMode: row.testMode,
            ...(requestNumber > 1 ? { requestNumber } : {}),
          },
        );
        return { record: signingView(row), duplicate: false };
      });
      if (result.duplicate)
        await this.stores.primary.delete(stored.key).catch(() => {});
      return result;
    } catch (error) {
      await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  /**
   * Sends a contract again to the same people after its request
   * (`expectedRequest`) was declined, expired or voided: a new request with
   * that one's document, signers and prepared PDF replaces it, and the
   * database keeps the ended one in the signing history. The countersigner
   * must still be active. It needs approval again where the ended one did,
   * and is sent in the mode configured now. A retry by the same person
   * returns the new request.
   */
  resend(
    contractId: string,
    expectedRequest: number,
    options: { testMode: boolean; preparerEmail: string | null },
    preparer: Actor & { kind: "user" },
  ) {
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${contractId}))`,
      );
      const [contract] = await tx
        .select()
        .from(commerceContracts)
        .where(eq(commerceContracts.id, contractId))
        .for("update");
      if (!contract) throw new Error("CONTRACT_NOT_FOUND");
      const [existing] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId))
        .for("update");
      if (!existing) throw new Error("CONTRACT_SIGNING_NOT_FOUND");
      if (
        existing.requestNumber === expectedRequest + 1 &&
        existing.preparerId === preparer.id &&
        !terminalContractSigningStates.includes(existing.state)
      )
        return { record: signingView(existing), duplicate: true };
      if (existing.requestNumber !== expectedRequest)
        throw new Error("CONTRACT_SIGNING_EXISTS");
      if (
        contract.executedAt !== null ||
        !["draft", "in_negotiation"].includes(contract.status)
      )
        throw new Error("CONTRACT_PAPER_NOT_SENDABLE");
      // The signer's name is printed in the prepared PDF: a request voided
      // for a different signer is prepared again instead.
      if (existing.cancelCode === "signer_change")
        throw new Error("CONTRACT_RESEND_SIGNER_CHANGE");
      const [signer] = await tx
        .select()
        .from(mndaSigners)
        .where(
          and(
            eq(mndaSigners.id, existing.countersigner.id),
            eq(mndaSigners.active, true),
          ),
        );
      if (!signer) throw new Error("CONTRACT_COUNTERSIGNER_UNAVAILABLE");
      const counterpartyEmail =
        existing.correctedSignerEmail ?? existing.counterpartySigner.email;
      if (
        existing.counterpartySigns &&
        signer.email.toLowerCase() === counterpartyEmail.toLowerCase()
      )
        throw new Error("CONTRACT_DISTINCT_SIGNERS_REQUIRED");
      const requestNumber = await replaceEnded(tx, existing);
      const [row] = await tx
        .insert(contractSigning)
        .values({
          contractId,
          requestNumber,
          templateId: existing.templateId,
          templateVersion: existing.templateVersion,
          templateHash: existing.templateHash,
          documentName: existing.documentName,
          input: existing.input,
          // A confirmed email correction carries over; the name and title
          // are printed in the prepared PDF and stay.
          counterpartySigner: {
            ...existing.counterpartySigner,
            email: counterpartyEmail,
          },
          countersigner: { ...existing.countersigner, email: signer.email },
          preparerId: preparer.id,
          preparerName: actorName(preparer),
          preparerEmail: copyAddress(options.preparerEmail),
          approvalRequired: existing.approvalRequired,
          approvalState: existing.approvalRequired ? "pending" : "not_required",
          testMode: options.testMode,
          documentType: existing.documentType,
          counterpartySigns: existing.counterpartySigns,
        })
        .returning();
      if (!row) throw new Error("CONTRACT_SIGNING_INSERT_FAILED");
      await touchContract(tx, contract);
      await recordEvent(
        tx,
        contractId,
        contract.version + 1,
        preparer,
        "contract.prepared",
        {
          documentType: row.documentType,
          requestNumber,
          approvalRequired: row.approvalRequired,
          testMode: row.testMode,
        },
      );
      return { record: signingView(row), duplicate: false };
    });
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

  /** The current request's prepared PDF, verified against its recorded
   * hash. Each preparation adds one and a resend reuses the last, so the
   * latest is the current request's. */
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
        )
        .orderBy(desc(contractFiles.createdAt), desc(contractFiles.id))
        .limit(1);
      return row;
    });
    if (!file) throw new Error("CONTRACT_FILE_NOT_FOUND");
    return this.stores.read(file);
  }

  /**
   * Records an approval decision. Only a pending request can be decided, and
   * never by the person who prepared it unless they approve it under
   * `approval:self` with a reason; the database enforces all of it again and
   * writes the self-approval's audit event and notices (001457). With
   * `expectedRequest`, a decision made on a request since replaced is
   * refused rather than applied to the new one.
   */
  decide(
    contractId: string,
    decision:
      | { approve: true; selfApproval?: SelfApproval }
      | { approve: false; reason: string },
    approver: Actor & { kind: "user" },
    expectedRequest?: number,
  ) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractSigning)
        .where(eq(contractSigning.contractId, contractId))
        .for("update");
      if (!row) throw new Error("CONTRACT_SIGNING_NOT_FOUND");
      if (
        expectedRequest !== undefined &&
        row.requestNumber !== expectedRequest
      )
        throw new Error("CONTRACT_REQUEST_CHANGED");
      if (row.approvalState !== "pending")
        throw new Error("CONTRACT_APPROVAL_NOT_PENDING");
      const offered = decision.approve ? decision.selfApproval : undefined;
      const selfApproved = assertDistinctOrSelfApproved({
        deciderId: approver.id,
        requesterIds: [row.preparerId],
        selfApproval: offered,
        distinctError: "CONTRACT_APPROVER_IS_PREPARER",
      });
      if (terminalContractSigningStates.includes(row.state))
        throw new Error("CONTRACT_APPROVAL_NOT_PENDING");
      const selfApproval =
        selfApproved && offered
          ? await checkedSelfApproval(tx, approver.id, offered)
          : undefined;
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
          ...(selfApproval
            ? { selfApproved: true, selfApprovalReason: selfApproval.reason }
            : {}),
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
        selfApproval
          ? "contract.self_approved"
          : decision.approve
            ? "contract.approved"
            : "contract.rejected",
        selfApproval
          ? { reason: selfApproval.reason }
          : reason
            ? { reason }
            : {},
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

  /** Keeps a lease alive across a long provider call; fails if it was lost. */
  extendLease(contractId: string, token: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .update(contractSigning)
        .set({ leaseUntil: new Date(Date.now() + 120_000) })
        .where(
          and(
            eq(contractSigning.contractId, contractId),
            eq(contractSigning.leaseToken, token),
          ),
        )
        .returning({ contractId: contractSigning.contractId });
      if (!row) throw new Error("CONTRACT_LEASE_LOST");
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
   * the same transaction that marks the register row executed. A state
   * change, or a `note`, is recorded in the contract's history.
   */
  async update(
    contractId: string,
    token: string,
    patch: {
      state?: ContractSigningState;
      providerId?: string;
      error?: string | null;
      remindedAt?: Date;
      correctedSignerEmail?: string;
      pendingSignerEmail?: string | null;
      cancelCode?: ContractCancelCode;
      cancelReason?: string;
    },
    actor: Actor,
    executed?: { bytes: Uint8Array; fileName: string },
    note?: ContractSigningNote,
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
        const changedState =
          patch.state && patch.state !== row.state ? patch.state : undefined;
        if (changedState || note) {
          const [contract] = await tx
            .select()
            .from(commerceContracts)
            .where(eq(commerceContracts.id, contractId))
            .for("update");
          if (!contract) throw new Error("CONTRACT_NOT_FOUND");
          const status = changedState && registerStatusFor[changedState];
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
            note?.eventType ?? `contract.signing_${changedState}`,
            {
              ...(status && status !== contract.status
                ? { status: { from: contract.status, to: status } }
                : {}),
              ...historyChanges(note),
            },
            note?.detail,
            note?.before,
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
