import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  TemplateContentSchema,
  templateContentJson,
  templateVersionLabel,
  type Actor,
  type ContractTemplateVersionRecord,
  type ContractTemplateVersionSummary,
  type TemplateContent,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { contractSigning } from "../schema/contracts";
import { contractTemplates } from "../schema/contract-templates";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";

type Row = typeof contractTemplates.$inferSelect;
type User = Actor & { kind: "user" };

const actorName = (actor: User) => actor.display ?? actor.id;
const iso = (value: Date | null) => value?.toISOString() ?? null;

const summary = (row: Row): ContractTemplateVersionSummary => ({
  id: row.id,
  key: row.templateKey,
  version: row.version,
  versionLabel: templateVersionLabel(row.version),
  name: row.name,
  contractType: row.contractType,
  status: row.status,
  sourceNote: row.sourceNote,
  contentHash: row.contentHash,
  createdByName: row.createdByName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  activatedByName: row.activatedByName,
  activatedAt: iso(row.activatedAt),
  retiredByName: row.retiredByName,
  retiredAt: iso(row.retiredAt),
  revision: row.revision,
});

/** The stored content, validated again and checked against its hash. */
function content(row: Row): TemplateContent {
  const parsed = TemplateContentSchema.parse({
    id: row.templateKey,
    contractType: row.contractType,
    name: row.name,
    requiresApproval: row.requiresApproval,
    ...(row.sourceNote ? { sourceNote: row.sourceNote } : {}),
    fields: row.fields,
    sections: row.sections,
    derived: row.derived,
    document: row.document,
  });
  if (contentHash(parsed) !== row.contentHash)
    throw new Error("CONTRACT_TEMPLATE_INTEGRITY");
  return parsed;
}

const contentHash = (value: TemplateContent) =>
  createHash("sha256").update(templateContentJson(value)).digest("hex");

const columns = (value: TemplateContent) => ({
  name: value.name,
  contractType: value.contractType,
  requiresApproval: value.requiresApproval,
  fields: value.fields,
  sections: value.sections,
  derived: value.derived,
  document: value.document,
  sourceNote: value.sourceNote ?? "",
  contentHash: contentHash(value),
});

/** How a draft came to be, recorded on its audit event. */
export type ContractTemplateOrigin = "blank" | "import" | "duplicate";

/**
 * The template store: versioned contract templates that commerce
 * administrators draft, activate and retire, and that sellers prepare
 * contracts from. The database freezes a version once it is activated or
 * used (001475); every change here is audited.
 */
export class ContractTemplateRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /** Every version of every template, by template then newest first. */
  list() {
    return this.tx(async (tx) =>
      (
        await tx
          .select()
          .from(contractTemplates)
          .orderBy(
            asc(contractTemplates.templateKey),
            desc(contractTemplates.version),
          )
      ).map(summary),
    );
  }

  /** One version with its content and use count. */
  get(id: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.id, id));
      if (!row) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
      return this.record(tx, row);
    });
  }

  /** The version of each template in use. A version whose stored content
   * no longer validates or matches its hash is left out, and logged, so one
   * bad row never hides the others. */
  listActive() {
    return this.tx(async (tx) =>
      (
        await tx
          .select()
          .from(contractTemplates)
          .where(eq(contractTemplates.status, "active"))
          .orderBy(asc(contractTemplates.name))
      ).flatMap((row) => {
        try {
          return [{ ...summary(row), content: content(row) }];
        } catch (error) {
          console.error("contract templates: stored version unusable", {
            id: row.id,
            key: row.templateKey,
            error: error instanceof Error ? error.message : "invalid",
          });
          return [];
        }
      }),
    );
  }

  /** A template's version in use, or null. */
  active(key: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select()
        .from(contractTemplates)
        .where(
          and(
            eq(contractTemplates.templateKey, key),
            eq(contractTemplates.status, "active"),
          ),
        );
      return row ? { ...summary(row), content: content(row) } : null;
    });
  }

  /**
   * Saves content as a new draft: the next version of its template, or
   * version 1 of a new one. A retried call with the same id returns the
   * draft it saved.
   */
  async createDraft(
    raw: unknown,
    actor: User,
    origin: ContractTemplateOrigin,
    id: string = randomUUID(),
  ) {
    const value = TemplateContentSchema.parse(raw);
    return this.tx(async (tx) => {
      const [existing] = await tx
        .select()
        .from(contractTemplates)
        .where(eq(contractTemplates.id, id));
      if (existing) {
        if (existing.createdById !== actor.id)
          throw new Error("CONTRACT_TEMPLATE_IDEMPOTENCY_CONFLICT");
        return this.record(tx, existing);
      }
      await this.lock(tx, value.id);
      const [latest] = await tx
        .select({ version: contractTemplates.version })
        .from(contractTemplates)
        .where(eq(contractTemplates.templateKey, value.id))
        .orderBy(desc(contractTemplates.version))
        .limit(1);
      // A discarded draft's number is never given out again, so each
      // version label in the audit log names one content.
      const [discarded] = await tx.execute<{ version: number | null }>(sql`
        select max(substring(after->>'version' from 2)::int) as version
        from audit_events
        where event_type = 'contract_template.discarded'
          and after->>'templateKey' = ${value.id}`);
      const [row] = await tx
        .insert(contractTemplates)
        .values({
          id,
          templateKey: value.id,
          version: Math.max(latest?.version ?? 0, discarded?.version ?? 0) + 1,
          ...columns(value),
          createdById: actor.id,
          createdByName: actorName(actor),
        })
        .returning();
      if (!row) throw new Error("CONTRACT_TEMPLATE_INSERT_FAILED");
      await this.audit(tx, row, actor, "contract_template.created", { origin });
      return this.record(tx, row);
    });
  }

  /** Overwrites a draft's content. The template key cannot change. */
  async updateDraft(
    id: string,
    expectedRevision: number,
    raw: unknown,
    actor: User,
  ) {
    const value = TemplateContentSchema.parse(raw);
    return this.change(id, expectedRevision, async (tx, current) => {
      if (current.status !== "draft")
        throw new Error("CONTRACT_TEMPLATE_NOT_DRAFT");
      if (value.id !== current.templateKey)
        throw new Error("CONTRACT_TEMPLATE_KEY_CHANGED");
      const [row] = await tx
        .update(contractTemplates)
        .set({
          ...columns(value),
          updatedAt: sql`now()`,
          revision: current.revision + 1,
        })
        .where(eq(contractTemplates.id, id))
        .returning();
      if (!row) throw new Error("CONTRACT_TEMPLATE_UPDATE_FAILED");
      await this.audit(tx, row, actor, "contract_template.updated");
      return row;
    });
  }

  /**
   * Puts a draft or retired version into use, recording who activated it,
   * and retires the version that was in use. Its content is checked again
   * first, so a version that no longer validates is never activated.
   */
  activate(id: string, expectedRevision: number, actor: User) {
    return this.change(id, expectedRevision, async (tx, current) => {
      if (current.status === "active") return current;
      content(current);
      const [previous] = await tx
        .select()
        .from(contractTemplates)
        .where(
          and(
            eq(contractTemplates.templateKey, current.templateKey),
            eq(contractTemplates.status, "active"),
          ),
        )
        .for("update");
      if (previous) {
        const [retired] = await tx
          .update(contractTemplates)
          .set(this.retirement(previous, actor))
          .where(eq(contractTemplates.id, previous.id))
          .returning();
        if (retired)
          await this.audit(tx, retired, actor, "contract_template.retired", {
            replacedBy: templateVersionLabel(current.version),
          });
      }
      const [row] = await tx
        .update(contractTemplates)
        .set({
          status: "active",
          activatedById: actor.id,
          activatedByName: actorName(actor),
          activatedAt: sql`now()`,
          updatedAt: sql`now()`,
          revision: current.revision + 1,
        })
        .where(eq(contractTemplates.id, id))
        .returning();
      if (!row) throw new Error("CONTRACT_TEMPLATE_UPDATE_FAILED");
      await this.audit(tx, row, actor, "contract_template.activated", {
        replaced: previous ? templateVersionLabel(previous.version) : null,
      });
      return row;
    });
  }

  /** Takes the version out of use. Contracts already prepared keep it. */
  retire(id: string, expectedRevision: number, actor: User) {
    return this.change(id, expectedRevision, async (tx, current) => {
      if (current.status !== "active")
        throw new Error("CONTRACT_TEMPLATE_NOT_ACTIVE");
      const [row] = await tx
        .update(contractTemplates)
        .set(this.retirement(current, actor))
        .where(eq(contractTemplates.id, id))
        .returning();
      if (!row) throw new Error("CONTRACT_TEMPLATE_UPDATE_FAILED");
      await this.audit(tx, row, actor, "contract_template.retired");
      return row;
    });
  }

  /** Deletes a draft for good; the audit event keeps what it was. */
  discard(id: string, expectedRevision: number, actor: User) {
    return this.tx(async (tx) => {
      const current = await this.current(tx, id, expectedRevision);
      if (current.status !== "draft")
        throw new Error("CONTRACT_TEMPLATE_NOT_DRAFT");
      await tx.delete(contractTemplates).where(eq(contractTemplates.id, id));
      await this.audit(
        tx,
        { ...current, revision: current.revision + 1 },
        actor,
        "contract_template.discarded",
        {
          content: {
            requiresApproval: current.requiresApproval,
            contractType: current.contractType,
            fields: current.fields,
            sections: current.sections,
            derived: current.derived,
            document: current.document,
          },
        },
      );
    });
  }

  private retirement(row: Row, actor: User) {
    return {
      status: "retired" as const,
      retiredByName: actorName(actor),
      retiredAt: sql`now()`,
      updatedAt: sql`now()`,
      revision: row.revision + 1,
    };
  }

  private async change(
    id: string,
    expectedRevision: number,
    apply: (tx: RuntimeTransaction, current: Row) => Promise<Row>,
  ) {
    return this.tx(async (tx) => {
      const current = await this.current(tx, id, expectedRevision);
      return this.record(tx, await apply(tx, current));
    });
  }

  /**
   * The version, locked, at the revision the caller saw. The template's
   * lock is taken before any row lock, in every change, so two changes to
   * one template queue instead of deadlocking.
   */
  private async current(
    tx: RuntimeTransaction,
    id: string,
    expectedRevision: number,
  ) {
    const [found] = await tx
      .select({ key: contractTemplates.templateKey })
      .from(contractTemplates)
      .where(eq(contractTemplates.id, id));
    if (!found) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    await this.lock(tx, found.key);
    const [current] = await tx
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, id))
      .for("update");
    if (!current) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");
    if (current.revision !== expectedRevision)
      throw new Error("CONTRACT_TEMPLATE_REVISION_CONFLICT");
    return current;
  }

  /** Serializes version numbering and activation per template. */
  private lock(tx: RuntimeTransaction, key: string) {
    return tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`contract-template:${key}`}))`,
    );
  }

  private async record(
    tx: RuntimeTransaction,
    row: Row,
  ): Promise<ContractTemplateVersionRecord> {
    const [used] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractSigning)
      .where(
        and(
          eq(contractSigning.templateId, row.templateKey),
          eq(
            contractSigning.templateVersion,
            templateVersionLabel(row.version),
          ),
        ),
      );
    // Requests a later one replaced still count (001465).
    const [replaced] = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count from commerce_contract_signing_history
      where request->>'template_id' = ${row.templateKey}
        and request->>'template_version' = ${templateVersionLabel(row.version)}`);
    // A version whose content no longer validates or matches its hash is
    // still shown, with the problem, so an administrator can retire it.
    let checked: TemplateContent;
    let problem: ContractTemplateVersionRecord["problem"] = null;
    try {
      checked = content(row);
    } catch (error) {
      problem =
        error instanceof Error &&
        error.message === "CONTRACT_TEMPLATE_INTEGRITY"
          ? "CONTRACT_TEMPLATE_INTEGRITY"
          : "CONTRACT_TEMPLATE_INVALID";
      checked = {
        id: row.templateKey,
        contractType: row.contractType,
        name: row.name,
        requiresApproval: row.requiresApproval,
        fields: [],
        sections: [],
        derived: [],
        document: { title: row.name, blocks: [] },
      };
    }
    return {
      ...summary(row),
      content: checked,
      problem,
      usedBy: (used?.count ?? 0) + (replaced?.count ?? 0),
    };
  }

  private audit(
    tx: RuntimeTransaction,
    row: Row,
    actor: Actor,
    eventType: string,
    extra: Record<string, unknown> = {},
  ) {
    return appendAuditAndOutbox(tx, {
      aggregateType: "document",
      aggregateId: row.id,
      aggregateVersion: row.revision,
      eventType,
      actor,
      requestId: randomUUID(),
      after: {
        templateKey: row.templateKey,
        version: templateVersionLabel(row.version),
        name: row.name,
        status: row.status,
        contentHash: row.contentHash,
        sourceNote: row.sourceNote,
        ...extra,
      },
    });
  }
}
