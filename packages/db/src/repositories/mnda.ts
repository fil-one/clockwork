import { createHash, randomUUID } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  MndaInputSchema,
  MndaRegisterQuerySchema,
  MndaSettingsSchema,
  MndaSignerSchema,
  mndaExportLimit,
  mndaStates,
  type Actor,
  type ContractStatus,
  type ContractType,
  type MndaCancelCode,
  type MndaRecord,
  type MndaRegisterPage,
  type MndaRegisterQuery,
  type MndaSettings,
  type MndaSigner,
  type MndaState,
  type MndaStateCounts,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import {
  mndaSigners,
  mndaRequests,
  mndaArtifacts,
  mndaSettings,
} from "../schema/mnda";
import { commerceContracts } from "../schema/contracts";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

type Row = typeof mndaRequests.$inferSelect;
const view = (r: Row): MndaRecord => ({
  id: r.id,
  input: r.input,
  countersigner: r.countersigner,
  noticeEmail: r.noticeEmail,
  ownerId: r.ownerId,
  ownerName: r.ownerName,
  ownerEmail: r.ownerEmail,
  correctedSignerEmail: r.correctedSignerEmail,
  pendingSignerEmail: r.pendingSignerEmail,
  state: r.state,
  providerId: r.providerId,
  testMode: r.testMode,
  templateHash: r.templateHash,
  error: r.error,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  sentAt: r.sentAt?.toISOString() ?? null,
  remindedAt: r.remindedAt?.toISOString() ?? null,
  completedAt: r.completedAt?.toISOString() ?? null,
  cancelCode: r.cancelCode,
  cancelReason: r.cancelReason,
});
export const terminalMndaStates: readonly MndaState[] = [
  "completed",
  "declined",
  "expired",
  "canceled",
];
/** States reached only after the partner received the request. */
const deliveredStates: readonly MndaState[] = [
  "sent",
  "viewed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
];
/** Audit aggregate for the single settings row. */
const settingsAggregateId = "019a44ac-0000-7000-8000-000000001442";

function emptyCounts(): MndaStateCounts {
  return Object.fromEntries(mndaStates.map((s) => [s, 0])) as MndaStateCounts;
}
/** `%` and `_` in a search are literal text, not wildcards. */
function contains(value: string) {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface MndaRegisterMatch {
  id: string;
  company: string;
  state: MndaState;
  createdAt: string;
  completedAt: string | null;
  ownerName: string;
}
/** A contract register row for the same company. */
export interface MndaContractMatch {
  id: string;
  counterpartyName: string;
  contractType: ContractType;
  status: ContractStatus;
  effectiveDate: string | null;
  ownerName: string;
}
export interface MndaOwner {
  id: string;
  name: string;
  email: string;
}
export interface MndaUpdatePatch {
  state?: MndaState;
  providerId?: string;
  error?: string | null;
  correctedSignerEmail?: string | null;
  pendingSignerEmail?: string | null;
  cancelCode?: MndaCancelCode;
  cancelReason?: string;
  remindedAt?: Date;
}
export interface MndaCreateOptions {
  /** Unsent drafts this one replaces. */
  supersedes?: readonly string[];
  /** Signatory managers may replace a colleague's draft. */
  manageAll?: boolean;
}
export interface MndaAuditNote {
  /** Overrides the default `mnda.<state>` event name. */
  eventType?: string;
  before?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}

export class MndaRepository {
  constructor(private readonly db: RuntimeDatabase) {}
  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }
  private registerFilter(query: MndaRegisterQuery, viewerId: string) {
    const filters: SQL[] = [];
    if (query.status.length)
      filters.push(inArray(mndaRequests.state, query.status));
    // Superseded and discarded drafts never reached the partner; they are
    // noise in the default view but stay reachable through the closed filter.
    else
      filters.push(
        not(
          and(
            eq(mndaRequests.state, "canceled"),
            isNull(mndaRequests.providerId),
          ) as SQL,
        ),
      );
    if (query.mine) filters.push(eq(mndaRequests.ownerId, viewerId));
    if (query.q) {
      const pattern = contains(query.q);
      filters.push(
        or(
          ilike(sql`${mndaRequests.input}->>'company'`, pattern),
          ilike(sql`${mndaRequests.input}->>'signerName'`, pattern),
          ilike(sql`${mndaRequests.input}->>'signerEmail'`, pattern),
          ilike(mndaRequests.correctedSignerEmail, pattern),
          ilike(mndaRequests.ownerName, pattern),
        ) as SQL,
      );
    }
    return and(...filters);
  }
  /** One page of the register, newest first. */
  list(raw: Partial<MndaRegisterQuery>, viewerId: string) {
    const query = MndaRegisterQuerySchema.parse(raw);
    return this.tx(async (tx): Promise<MndaRegisterPage> => {
      const where = this.registerFilter(query, viewerId);
      const [total] = await tx
        .select({ value: count() })
        .from(mndaRequests)
        .where(where);
      const records = await tx
        .select()
        .from(mndaRequests)
        .where(where)
        .orderBy(desc(mndaRequests.createdAt), desc(mndaRequests.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return {
        records: records.map(view),
        total: total?.value ?? 0,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  /** Rows matching the register filters, for export, newest first. */
  exportRows(raw: Partial<MndaRegisterQuery>, viewerId: string) {
    const query = MndaRegisterQuerySchema.parse(raw);
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(mndaRequests)
        .where(this.registerFilter(query, viewerId))
        .orderBy(desc(mndaRequests.createdAt), desc(mndaRequests.id))
        .limit(mndaExportLimit + 1);
      return {
        records: rows.slice(0, mndaExportLimit).map(view),
        truncated: rows.length > mndaExportLimit,
      };
    });
  }
  /**
   * Records who downloaded a PDF or exported the register. Each access is its
   * own audit aggregate, so it never competes with a request's version chain.
   */
  recordAccess(
    actor: Actor,
    event:
      | { kind: "pdf"; requestId: string; artifact: "original" | "executed" }
      | {
          kind: "export";
          filters: MndaRegisterQuery;
          rows: number;
          truncated: boolean;
        },
  ) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: event.kind === "pdf" ? "document" : "report_export",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType:
          event.kind === "pdf"
            ? "mnda.pdf_downloaded"
            : "mnda.register_exported",
        actor,
        requestId: randomUUID(),
        after:
          event.kind === "pdf"
            ? { mndaId: event.requestId, artifact: event.artifact }
            : {
                filters: event.filters,
                rows: event.rows,
                truncated: event.truncated,
              },
      }),
    );
  }
  /** Request counts by state, for everyone and for one owner. */
  countByState(ownerId?: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          state: mndaRequests.state,
          mine: mndaRequests.ownerId,
          value: count(),
        })
        .from(mndaRequests)
        .groupBy(mndaRequests.state, mndaRequests.ownerId);
      const byState = emptyCounts();
      const mine = emptyCounts();
      for (const row of rows) {
        if (!(row.state in byState)) continue;
        byState[row.state] += row.value;
        if (ownerId && row.mine === ownerId) mine[row.state] += row.value;
      }
      return { byState, mine };
    });
  }
  /** Existing, non-canceled requests whose normalized legal name matches.
   * Stored and searched names share one database normalizer. */
  duplicates(company: string, excludeId?: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          id: mndaRequests.id,
          company: sql<string>`${mndaRequests.input}->>'company'`,
          state: mndaRequests.state,
          createdAt: mndaRequests.createdAt,
          completedAt: mndaRequests.completedAt,
          ownerName: mndaRequests.ownerName,
        })
        .from(mndaRequests)
        .where(
          and(
            ne(mndaRequests.state, "canceled"),
            sql`${mndaRequests.normalizedCompany} <> ''`,
            eq(
              mndaRequests.normalizedCompany,
              sql`public.commerce_mnda_normalize_company(${company})`,
            ),
            excludeId ? ne(mndaRequests.id, excludeId) : undefined,
          ),
        )
        .orderBy(desc(mndaRequests.createdAt))
        .limit(5);
      return rows.map((r): MndaRegisterMatch => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      }));
    });
  }
  /**
   * Contract register rows for the same company, with the MNDA normalizer
   * applied to both sides. Read only. A draft whose signing request was
   * voided never became an agreement and is left out. The register is small
   * and hand-kept, so the comparison runs in the query; an expression index
   * on the same call can be added later without changing it.
   */
  contractDuplicates(company: string) {
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          id: commerceContracts.id,
          counterpartyName: commerceContracts.counterpartyName,
          contractType: commerceContracts.contractType,
          status: commerceContracts.status,
          effectiveDate: commerceContracts.effectiveDate,
          ownerName: commerceContracts.ownerName,
        })
        .from(commerceContracts)
        .where(
          and(
            sql`public.commerce_mnda_normalize_company(${company}) <> ''`,
            sql`public.commerce_mnda_normalize_company(${commerceContracts.counterpartyName}) = public.commerce_mnda_normalize_company(${company})`,
            sql`not (${commerceContracts.status} = 'draft' and exists (
              select 1 from public.commerce_contract_signing s
              where s.contract_id = ${commerceContracts.id} and s.state = 'canceled'))`,
          ),
        )
        .orderBy(desc(commerceContracts.updatedAt))
        .limit(5);
      return rows satisfies MndaContractMatch[];
    });
  }
  signers() {
    return this.tx((tx) =>
      tx.select().from(mndaSigners).orderBy(mndaSigners.name),
    );
  }
  settings() {
    return this.tx(async (tx): Promise<MndaSettings> => {
      const [row] = await tx.select().from(mndaSettings);
      if (!row) throw new Error("MNDA_SETTINGS_MISSING");
      return {
        noticeEmail: row.noticeEmail,
        version: row.version,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      };
    });
  }
  /** `expectedVersion` rejects a save made against a stale copy of the form. */
  saveSettings(raw: unknown, expectedVersion: number, actor: Actor) {
    const input = MndaSettingsSchema.parse(raw);
    return this.tx(async (tx) => {
      const [previous] = await tx.select().from(mndaSettings).for("update");
      if (!previous) throw new Error("MNDA_SETTINGS_MISSING");
      if (previous.version !== expectedVersion)
        throw new Error("MNDA_SETTINGS_CONFLICT");
      if (previous.noticeEmail === input.noticeEmail) return;
      const version = previous.version + 1;
      await tx
        .update(mndaSettings)
        .set({
          noticeEmail: input.noticeEmail,
          version,
          updatedAt: new Date(),
          updatedBy: actor.kind === "user" ? actor.id : null,
        })
        .where(eq(mndaSettings.singleton, true));
      await appendAuditAndOutbox(tx, {
        aggregateType: "agreement_template",
        aggregateId: settingsAggregateId,
        aggregateVersion: version,
        eventType: "mnda.settings_changed",
        actor,
        requestId: randomUUID(),
        before: { noticeEmail: previous.noticeEmail },
        after: { noticeEmail: input.noticeEmail },
      });
    });
  }
  get(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, id));
      if (!r) throw new Error("MNDA_NOT_FOUND");
      return view(r);
    });
  }
  byProvider(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.providerId, id));
      return r ? view(r) : null;
    });
  }
  async saveSigner(raw: unknown, actor: Actor) {
    const input = MndaSignerSchema.parse(raw);
    if (input.isDefault && !input.active)
      throw new Error("MNDA_DEFAULT_MUST_BE_ACTIVE");
    return this.tx(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1439,1)`);
      if (input.isDefault)
        await tx
          .update(mndaSigners)
          .set({ isDefault: false })
          .where(eq(mndaSigners.isDefault, true));
      const [previous] = await tx
        .select()
        .from(mndaSigners)
        .where(eq(mndaSigners.id, input.id));
      const version = (previous?.version ?? 0) + 1;
      await tx
        .insert(mndaSigners)
        .values({ ...input, version })
        .onConflictDoUpdate({
          target: mndaSigners.id,
          set: { ...input, version },
        });
      await appendAuditAndOutbox(tx, {
        aggregateType: "agreement_template",
        aggregateId: input.id,
        aggregateVersion: version,
        eventType: "mnda.signer_configured",
        actor,
        requestId: randomUUID(),
        after: {
          name: input.name,
          email: input.email,
          title: input.title,
          active: input.active,
          isDefault: input.isDefault,
        },
      });
    });
  }
  /**
   * Stores a rendered draft. `supersedes` names the same owner's unsent draft
   * this one corrects; it is canceled in the same transaction so a re-preview
   * never leaves an orphan in the register.
   */
  async create(
    raw: unknown,
    owner: MndaOwner,
    templateHash: string,
    testMode: boolean,
    pdf: Uint8Array,
    signer: MndaSigner,
    noticeEmail: string,
    options: MndaCreateOptions = {},
  ) {
    const input = MndaInputSchema.parse(raw);
    const notice = MndaSettingsSchema.parse({ noticeEmail }).noticeEmail;
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.id}))`,
      );
      const [existing] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, input.id));
      if (existing) {
        if (
          JSON.stringify(MndaInputSchema.parse(existing.input)) !==
            JSON.stringify(input) ||
          existing.ownerId !== owner.id
        )
          throw new Error("MNDA_IDEMPOTENCY_CONFLICT");
        return view(existing);
      }
      const [activeSigner] = await tx
        .select()
        .from(mndaSigners)
        .where(
          and(eq(mndaSigners.id, signer.id), eq(mndaSigners.active, true)),
        );
      if (
        !activeSigner ||
        activeSigner.name !== signer.name ||
        activeSigner.title !== signer.title ||
        activeSigner.email !== signer.email
      )
        throw new Error("MNDA_SIGNER_CHANGED");
      const [settings] = await tx.select().from(mndaSettings);
      if (settings?.noticeEmail !== notice)
        throw new Error("MNDA_SETTINGS_CHANGED");
      const actor: Actor = { kind: "user", id: owner.id, display: owner.name };
      for (const id of new Set(options.supersedes ?? [])) {
        if (id === input.id) continue;
        const [old] = await tx
          .select()
          .from(mndaRequests)
          .where(eq(mndaRequests.id, id))
          .for("update");
        if (!old || terminalMndaStates.includes(old.state)) continue;
        if (old.ownerId !== owner.id && !options.manageAll)
          throw new Error("MNDA_NOT_OWNER");
        // Only a draft that never reached SignWell is replaced in place.
        if (old.providerId) throw new Error("MNDA_IDEMPOTENCY_CONFLICT");
        if (old.leaseUntil && old.leaseUntil > new Date())
          throw new Error("MNDA_BUSY");
        const [canceled] = await tx
          .update(mndaRequests)
          .set({
            state: "canceled",
            cancelCode: "superseded",
            version: old.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(mndaRequests.id, old.id))
          .returning();
        if (canceled)
          await this.audit(tx, canceled, actor, "mnda.canceled", {
            detail: { cancelCode: "superseded", replacement: input.id },
          });
      }
      const [r] = await tx
        .insert(mndaRequests)
        .values({
          id: input.id,
          input,
          countersigner: signer,
          noticeEmail: notice,
          ownerId: owner.id,
          ownerName: owner.name,
          ownerEmail: owner.email.toLowerCase(),
          templateHash,
          testMode,
        })
        .returning();
      if (!r) throw new Error("MNDA_CREATE_FAILED");
      await this.artifact(tx, input.id, "original", pdf);
      await this.audit(tx, r, actor, "mnda.drafted");
      return view(r);
    });
  }
  private artifact(
    tx: RuntimeTransaction,
    id: string,
    kind: "original" | "executed",
    bytes: Uint8Array,
  ) {
    if (
      bytes.length > 12_000_000 ||
      Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-"
    )
      throw new Error("MNDA_INVALID_PDF");
    return tx.insert(mndaArtifacts).values({
      id: randomUUID(),
      requestId: id,
      kind,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      base64: Buffer.from(bytes).toString("base64"),
    });
  }
  readArtifact(id: string, kind: "original" | "executed") {
    return this.tx(async (tx) => {
      const [a] = await tx
        .select()
        .from(mndaArtifacts)
        .where(
          and(eq(mndaArtifacts.requestId, id), eq(mndaArtifacts.kind, kind)),
        );
      if (!a) throw new Error("MNDA_ARTIFACT_NOT_FOUND");
      const bytes = Buffer.from(a.base64, "base64");
      if (createHash("sha256").update(bytes).digest("hex") !== a.sha256)
        throw new Error("MNDA_ARTIFACT_INTEGRITY");
      return bytes;
    });
  }
  /** Lease spans provider I/O without holding a database transaction open. */
  claim(id: string) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(eq(mndaRequests.id, id))
        .for("update");
      if (!r) throw new Error("MNDA_NOT_FOUND");
      if (r.leaseUntil && r.leaseUntil > new Date())
        throw new Error("MNDA_BUSY");
      const token = randomUUID();
      await tx
        .update(mndaRequests)
        .set({ leaseToken: token, leaseUntil: new Date(Date.now() + 120_000) })
        .where(eq(mndaRequests.id, id));
      return { record: view(r), token };
    });
  }
  release(id: string, token: string) {
    return this.tx(async (tx) => {
      await tx
        .update(mndaRequests)
        .set({ leaseToken: null, leaseUntil: null })
        .where(
          and(eq(mndaRequests.id, id), eq(mndaRequests.leaseToken, token)),
        );
    });
  }
  update(
    id: string,
    token: string,
    patch: MndaUpdatePatch,
    actor: Actor,
    executed?: Uint8Array,
    note?: MndaAuditNote,
  ) {
    return this.tx(async (tx) => {
      const [r] = await tx
        .select()
        .from(mndaRequests)
        .where(and(eq(mndaRequests.id, id), eq(mndaRequests.leaseToken, token)))
        .for("update");
      if (!r) throw new Error("MNDA_LEASE_LOST");
      if (terminalMndaStates.includes(r.state)) return view(r);
      if (executed) await this.artifact(tx, id, "executed", executed);
      const now = new Date();
      const [next] = await tx
        .update(mndaRequests)
        .set({
          ...patch,
          leaseUntil: new Date(Date.now() + 120_000),
          version: r.version + 1,
          updatedAt: now,
          ...(patch.state === "completed" ? { completedAt: now } : {}),
          ...(patch.state && deliveredStates.includes(patch.state) && !r.sentAt
            ? { sentAt: now }
            : {}),
        })
        .where(eq(mndaRequests.id, id))
        .returning();
      if (!next) throw new Error("MNDA_UPDATE_FAILED");
      await this.audit(
        tx,
        next,
        actor,
        note?.eventType ?? `mnda.${next.state}`,
        note,
      );
      return view(next);
    });
  }
  private audit(
    tx: RuntimeTransaction,
    r: Row,
    actor: Actor,
    eventType: string,
    note?: MndaAuditNote,
  ) {
    return appendAuditAndOutbox(tx, {
      aggregateType: "agreement",
      aggregateId: r.id,
      aggregateVersion: r.version,
      eventType,
      actor,
      requestId: randomUUID(),
      ...(note?.before ? { before: note.before } : {}),
      after: {
        state: r.state,
        providerId: r.providerId,
        templateHash: r.templateHash,
        testMode: r.testMode,
        ...note?.detail,
      },
    });
  }
}
