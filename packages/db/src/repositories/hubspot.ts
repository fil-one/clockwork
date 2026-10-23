import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  HubSpotConnectionInputSchema,
  PartnerInputSchema,
  hubspotAudience,
  hubspotImportStatus,
  partnerContactLimit,
  withPartnerContactIds,
  type Actor,
  type HubSpotConnectionRecord,
  type HubSpotFieldHistory,
  type HubSpotHandoffPlan,
  type HubSpotImportItem,
  type HubSpotImportRecord,
  type HubSpotLinkRecord,
  type HubSpotPartnerField,
  type HubSpotSourceSnapshot,
  type PartnerContact,
  type PartnerInput,
  type PartnerRecord,
} from "@clockwork/contracts";

import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { accountDocuments } from "../schema/account-documents";
import {
  commerceExternalLinks,
  commerceHubSpotConnections,
  commerceHubSpotImportItems,
  commerceHubSpotImports,
} from "../schema/hubspot";
import { commercePartners } from "../schema/partners";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import {
  insertPartnerRow,
  partnerInputOf,
  partnerRecordOf,
  resolveOwner,
  staffOwners,
  updatePartnerRow,
} from "./partners";

type UserActor = Actor & { kind: "user" };
type ConnectionRow = typeof commerceHubSpotConnections.$inferSelect;
type ImportRow = typeof commerceHubSpotImports.$inferSelect;
type ItemRow = typeof commerceHubSpotImportItems.$inferSelect;
interface ItemChange {
  values: Partial<typeof commerceHubSpotImportItems.$inferInsert>;
  event: string;
  detail: Record<string, unknown>;
}

const connectionView = (row: ConnectionRow): HubSpotConnectionRecord => ({
  id: row.id,
  portalId: row.portalId,
  uiDomain: row.uiDomain,
  status: row.status,
  audience: row.audience,
  approvedById: row.approvedById,
  approvedByName: row.approvedByName,
  approvedAt: row.approvedAt.toISOString(),
  // Rows written before pipelines were part of the scope read as none.
  scope: { ...row.scope, pipelines: row.scope.pipelines ?? [] },
  defaultPipelineId: row.defaultPipelineId,
  ownerMappings: row.ownerMappings,
  updatedAt: row.updatedAt.toISOString(),
  version: row.version,
});

const itemView = (
  row: ItemRow,
  documents: ReadonlyMap<string, { title: string; removed: boolean }>,
): HubSpotImportItem => ({
  id: row.id,
  importId: row.importId,
  fileId: row.fileId,
  noteId: row.noteId,
  fileName: row.fileName,
  title: row.title,
  documentKind: row.documentKind,
  status: row.status,
  errorCode: row.errorCode,
  attachmentId: row.attachmentId,
  // An identical PDF that was since removed is no longer there to reuse.
  existingAttachment:
    row.existingAttachmentId &&
    !documents.get(row.existingAttachmentId)?.removed
      ? {
          id: row.existingAttachmentId,
          title: documents.get(row.existingAttachmentId)?.title ?? "",
        }
      : null,
  attachmentRemoved: row.attachmentId
    ? (documents.get(row.attachmentId)?.removed ?? false)
    : false,
  excludedReason: row.excludedReason,
  attempts: row.attempts,
  updatedAt: row.updatedAt.toISOString(),
});

const importView = (
  row: ImportRow,
  items: readonly HubSpotImportItem[],
): HubSpotImportRecord => ({
  id: row.id,
  partnerId: row.partnerId,
  portalId: row.portalId,
  companyId: row.companyId,
  dealId: row.dealId,
  status: row.status,
  createdPartner: row.createdPartner,
  plan: row.plan,
  snapshot: row.snapshot,
  items,
  createdById: row.createdById,
  createdByName: row.createdByName,
  createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
});

/**
 * Codes the database or this repository refuses with; Drizzle wraps driver
 * errors, so the code is looked for on the error and its causes.
 */
function refusal(error: unknown): string | undefined {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 5;
    current = current.cause, depth += 1
  ) {
    // Codes this module and the partner helpers throw are the whole message.
    if (/^(?:HUBSPOT|PARTNER)_[A-Z_]+$/.test(current.message))
      return current.message;
    const driver = current as Error & {
      code?: unknown;
      constraint_name?: unknown;
    };
    // Trigger refusals (001466, 001483) raise P0001 with the code as message.
    if (driver.code === "P0001") {
      const match = /^((?:HUBSPOT|PARTNER)_[A-Z_]+)$/.exec(current.message);
      if (match) return match[1];
    }
    // A unique violation on a link is a concurrent handoff that lost.
    if (
      driver.code === "23505" &&
      typeof driver.constraint_name === "string" &&
      driver.constraint_name.startsWith("commerce_external_links_")
    )
      return "HUBSPOT_ALREADY_LINKED";
  }
  return undefined;
}

export interface HubSpotCommitInput {
  plan: HubSpotHandoffPlan;
  snapshot: HubSpotSourceSnapshot;
  /** sha256 of the request as sent, so a retry is recognised. */
  requestDigest: string;
  connection: { id: string; version: number };
  companyId: string;
  dealId: string | null;
}

export type HubSpotCommitResult =
  | {
      kind: "committed" | "replayed";
      importId: string;
      partnerId: string;
      createdPartner: boolean;
    }
  /** Someone else's handoff already linked this company: open theirs. */
  | { kind: "already_linked"; partnerId: string; partnerName: string };

export type HubSpotItemOutcome =
  | { status: "attached"; attachmentId: string }
  | { status: "failed"; errorCode: string }
  | { status: "duplicate"; existingAttachmentId: string };

/**
 * The HubSpot connection, company links and reviewed imports (001483). The
 * web layer checks the reader's permission first: `staff:manage` for the
 * connection, `sales:read` to read links and imports, `contract:write` to
 * import. Every change writes an audit event in the same transaction.
 */
export class HubSpotRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private async tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    try {
      return await withInternalTransaction(this.db, randomUUID(), fn);
    } catch (error) {
      const code = refusal(error);
      if (code) throw new Error(code, { cause: error });
      throw error;
    }
  }

  /** The active connection, and the most recent one for history. */
  connection(): Promise<{
    active: HubSpotConnectionRecord | null;
    latest: HubSpotConnectionRecord | null;
  }> {
    return this.tx(async (tx) => {
      const [latest] = await tx
        .select()
        .from(commerceHubSpotConnections)
        .orderBy(desc(commerceHubSpotConnections.createdAt))
        .limit(1);
      const [active] = await tx
        .select()
        .from(commerceHubSpotConnections)
        .where(eq(commerceHubSpotConnections.status, "active"));
      return {
        active: active ? connectionView(active) : null,
        latest: latest ? connectionView(latest) : null,
      };
    });
  }

  /**
   * Activates the connection for the portal the token reaches, or changes
   * the scope of the active one. Activation names the audience; changing the
   * portal requires disconnecting first, so IDs from two portals never mix.
   */
  saveConnection(
    raw: unknown,
    portal: { portalId: string; uiDomain: string },
    actor: UserActor,
  ): Promise<HubSpotConnectionRecord> {
    const input = HubSpotConnectionInputSchema.parse(raw);
    if (input.portalId !== portal.portalId)
      throw new Error("HUBSPOT_PORTAL_MISMATCH");
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('hubspot:connection', 0))`,
      );
      const staffIds = [
        ...new Set(input.ownerMappings.map((row) => row.staffId)),
      ];
      const staff = staffIds.length ? await staffOwners(tx, staffIds) : [];
      const names = new Map(staff.map((member) => [member.id, member.name]));
      if (staff.length !== staffIds.length)
        throw new Error("HUBSPOT_OWNER_NOT_STAFF");
      const ownerMappings = input.ownerMappings.map((row) => ({
        ...row,
        staffName: names.get(row.staffId) ?? "",
      }));
      const [active] = await tx
        .select()
        .from(commerceHubSpotConnections)
        .where(eq(commerceHubSpotConnections.status, "active"))
        .for("update");
      const values = {
        uiDomain: portal.uiDomain,
        audience: hubspotAudience,
        approvedById: actor.id,
        approvedByName: actor.display ?? actor.id,
        approvedAt: new Date(),
        scope: input.scope,
        defaultPipelineId: input.defaultPipelineId,
        ownerMappings,
      };
      if (active) {
        if (input.expectedVersion !== active.version)
          throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
        if (active.portalId !== input.portalId)
          throw new Error("HUBSPOT_PORTAL_MISMATCH");
        const [updated] = await tx
          .update(commerceHubSpotConnections)
          .set({
            ...values,
            updatedAt: sql`now()`,
            version: active.version + 1,
          })
          .where(eq(commerceHubSpotConnections.id, active.id))
          .returning();
        if (!updated) throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
        await appendAuditAndOutbox(tx, {
          aggregateType: "hubspot_connection",
          aggregateId: updated.id,
          aggregateVersion: updated.version,
          eventType: "hubspot.connection_updated",
          actor,
          requestId: randomUUID(),
          before: {
            scope: active.scope,
            defaultPipelineId: active.defaultPipelineId,
            ownerMappings: active.ownerMappings.length,
          },
          after: {
            scope: updated.scope,
            defaultPipelineId: updated.defaultPipelineId,
            ownerMappings: updated.ownerMappings.length,
          },
        });
        return connectionView(updated);
      }
      if (input.expectedVersion !== undefined)
        throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
      const [inserted] = await tx
        .insert(commerceHubSpotConnections)
        .values({
          id: randomUUID(),
          portalId: input.portalId,
          status: "active",
          ...values,
        })
        .returning();
      if (!inserted) throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
      await appendAuditAndOutbox(tx, {
        aggregateType: "hubspot_connection",
        aggregateId: inserted.id,
        aggregateVersion: inserted.version,
        eventType: "hubspot.connection_activated",
        actor,
        requestId: randomUUID(),
        after: {
          portalId: inserted.portalId,
          audience: inserted.audience,
          scope: inserted.scope,
          defaultPipelineId: inserted.defaultPipelineId,
          ownerMappings: inserted.ownerMappings.length,
        },
      });
      return connectionView(inserted);
    });
  }

  /**
   * Stops all live reads. Imported Commerce facts, retained documents,
   * source identifiers and history stay; pending reviews no longer commit
   * because their connection is no longer active.
   */
  disconnect(expectedVersion: number, actor: UserActor) {
    return this.tx(async (tx) => {
      const [active] = await tx
        .select()
        .from(commerceHubSpotConnections)
        .where(eq(commerceHubSpotConnections.status, "active"))
        .for("update");
      if (!active) throw new Error("HUBSPOT_NOT_CONNECTED");
      if (active.version !== expectedVersion)
        throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
      const [updated] = await tx
        .update(commerceHubSpotConnections)
        .set({
          status: "disconnected",
          disconnectedAt: new Date(),
          disconnectedByName: actor.display ?? actor.id,
          updatedAt: sql`now()`,
          version: active.version + 1,
        })
        .where(eq(commerceHubSpotConnections.id, active.id))
        .returning();
      if (!updated) throw new Error("HUBSPOT_CONNECTION_VERSION_CONFLICT");
      await appendAuditAndOutbox(tx, {
        aggregateType: "hubspot_connection",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        eventType: "hubspot.connection_disconnected",
        actor,
        requestId: randomUUID(),
        after: { portalId: updated.portalId },
      });
      return connectionView(updated);
    });
  }

  /** The partner each company became, for companies that have one. */
  partnersForCompanies(
    portalId: string,
    companyIds: readonly string[],
  ): Promise<ReadonlyMap<string, { id: string; name: string }>> {
    const ids = [...new Set(companyIds)];
    if (!ids.length) return Promise.resolve(new Map());
    return this.tx(async (tx) => {
      const rows = await tx
        .select({
          companyId: commerceExternalLinks.objectId,
          partnerId: commercePartners.id,
          partnerName: commercePartners.name,
        })
        .from(commerceExternalLinks)
        .innerJoin(
          commercePartners,
          eq(commercePartners.id, commerceExternalLinks.partnerId),
        )
        .where(
          and(
            eq(commerceExternalLinks.provider, "hubspot"),
            eq(commerceExternalLinks.portalId, portalId),
            eq(commerceExternalLinks.objectType, "company"),
            eq(commerceExternalLinks.destinationType, "partner"),
            inArray(commerceExternalLinks.objectId, ids),
          ),
        );
      return new Map(
        rows.map((row) => [
          row.companyId,
          { id: row.partnerId, name: row.partnerName },
        ]),
      );
    });
  }

  /** The HubSpot company a partner is linked to in a portal, if any. */
  linkForPartner(
    partnerId: string,
    portalId?: string,
  ): Promise<HubSpotLinkRecord | null> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({
          link: commerceExternalLinks,
          partnerName: commercePartners.name,
        })
        .from(commerceExternalLinks)
        .innerJoin(
          commercePartners,
          eq(commercePartners.id, commerceExternalLinks.partnerId),
        )
        .where(
          and(
            eq(commerceExternalLinks.partnerId, partnerId),
            portalId ? eq(commerceExternalLinks.portalId, portalId) : undefined,
          ),
        )
        .orderBy(desc(commerceExternalLinks.createdAt))
        .limit(1);
      if (!row) return null;
      return {
        id: row.link.id,
        portalId: row.link.portalId,
        companyId: row.link.objectId,
        partnerId,
        partnerName: row.partnerName,
        companyName: row.link.companyName,
        createdByName: row.link.createdByName,
        createdAt: row.link.createdAt.toISOString(),
      };
    });
  }

  /**
   * Partners that look like a company, by the MNDA company normalizer or the
   * website's host. Suggestions only: a person inspects them, nothing merges.
   */
  similarPartners(input: { name: string; host: string | null }): Promise<
    {
      id: string;
      name: string;
      website: string;
      reason: "name" | "website";
      linkedCompanyId: string | null;
    }[]
  > {
    // The host as a literal pattern: "northstar.example" also matches
    // "https://www.northstar.example/anything".
    const host = input.host
      ?.toLowerCase()
      .replace(/^www\./, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.tx(async (tx) => {
      const rows = await tx.execute<{
        id: string;
        name: string;
        website: string;
        same_name: boolean;
        linked_company_id: string | null;
      }>(sql`
        select p.id, p.name, p.website,
          p.normalized_name = public.commerce_mnda_normalize_company(${input.name}) as same_name,
          (select l.object_id from public.commerce_external_links l
            where l.partner_id = p.id order by l.created_at desc limit 1) as linked_company_id
        from public.commerce_partners p
        where p.normalized_name = public.commerce_mnda_normalize_company(${input.name})
          ${host ? sql`or lower(p.website) ~ ${`^https?://(www\\.)?${host}(/|$)`}` : sql``}
        order by p.updated_at desc
        limit 5`);
      return [...rows].map((row) => ({
        id: row.id,
        name: row.name,
        website: row.website,
        reason: row.same_name ? ("name" as const) : ("website" as const),
        linkedCompanyId: row.linked_company_id,
      }));
    });
  }

  /** Each field's HubSpot value and stored result at the latest import. */
  fieldHistory(partnerId: string): Promise<HubSpotFieldHistory> {
    return this.tx(async (tx) => {
      const [latest] = await tx
        .select({ plan: commerceHubSpotImports.plan })
        .from(commerceHubSpotImports)
        .where(eq(commerceHubSpotImports.partnerId, partnerId))
        .orderBy(
          desc(commerceHubSpotImports.createdAt),
          desc(commerceHubSpotImports.id),
        )
        .limit(1);
      const history: HubSpotFieldHistory = {};
      for (const field of latest?.plan.fields ?? [])
        history[field.field] = {
          lastSource: field.hubspot,
          lastResult: field.result,
        };
      return history;
    });
  }

  /**
   * Commits a reviewed handoff in one transaction: the partner created or
   * changed, the company link, the import with its plan and snapshot, a
   * pending row per selected document, and the audit trail. A retry of the
   * same operation returns the first result; a concurrent handoff of the same
   * company resolves to whichever partner won.
   */
  commit(
    input: HubSpotCommitInput,
    actor: UserActor,
  ): Promise<HubSpotCommitResult> {
    const { plan, snapshot } = input;
    return this.tx(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`hubspot:company:${snapshot.portalId}:${input.companyId}`}, 0))`,
      );
      const [prior] = await tx
        .select()
        .from(commerceHubSpotImports)
        .where(eq(commerceHubSpotImports.id, plan.operationId));
      if (prior) {
        if (
          prior.requestDigest !== input.requestDigest ||
          prior.createdById !== actor.id
        )
          throw new Error("HUBSPOT_OPERATION_CONFLICT");
        return {
          kind: "replayed",
          importId: prior.id,
          partnerId: prior.partnerId,
          createdPartner: prior.createdPartner,
        };
      }
      const [connection] = await tx
        .select()
        .from(commerceHubSpotConnections)
        .where(eq(commerceHubSpotConnections.id, input.connection.id))
        .for("share");
      if (
        !connection ||
        connection.status !== "active" ||
        connection.version !== input.connection.version ||
        connection.portalId !== snapshot.portalId
      )
        throw new Error("HUBSPOT_CONNECTION_CHANGED");
      const [existingLink] = await tx
        .select()
        .from(commerceExternalLinks)
        .where(
          and(
            eq(commerceExternalLinks.provider, "hubspot"),
            eq(commerceExternalLinks.portalId, snapshot.portalId),
            eq(commerceExternalLinks.objectType, "company"),
            eq(commerceExternalLinks.objectId, input.companyId),
            eq(commerceExternalLinks.destinationType, "partner"),
          ),
        );
      const destination = plan.destination;
      if (
        existingLink?.partnerId &&
        (destination.kind === "new_partner" ||
          existingLink.partnerId !== destination.partnerId)
      ) {
        const [winner] = await tx
          .select({ name: commercePartners.name })
          .from(commercePartners)
          .where(eq(commercePartners.id, existingLink.partnerId));
        return {
          kind: "already_linked",
          partnerId: existingLink.partnerId,
          partnerName: winner?.name ?? "",
        };
      }
      const source = {
        provider: "hubspot",
        importId: plan.operationId,
        portalId: snapshot.portalId,
        companyId: input.companyId,
        dealId: input.dealId,
      };
      let partner: PartnerRecord;
      if (destination.kind === "new_partner") {
        const field = (name: HubSpotPartnerField) =>
          plan.fields.find((change) => change.field === name)?.result ?? "";
        const partnerInput: PartnerInput = PartnerInputSchema.parse({
          id: destination.partnerId,
          name: field("name"),
          website: field("website"),
          region: field("region"),
          status: destination.status,
          ownerId: destination.ownerId,
          models: destination.models,
          contacts: mergeContacts([], plan, snapshot.portalId),
        });
        const [taken] = await tx
          .select({ id: commercePartners.id })
          .from(commercePartners)
          .where(eq(commercePartners.id, destination.partnerId));
        if (taken) throw new Error("HUBSPOT_OPERATION_CONFLICT");
        partner = await insertPartnerRow(
          tx,
          partnerInput,
          await resolveOwner(tx, partnerInput.ownerId),
          actor,
          source,
        );
      } else {
        const [current] = await tx
          .select()
          .from(commercePartners)
          .where(eq(commercePartners.id, destination.partnerId))
          .for("update");
        if (!current) throw new Error("PARTNER_NOT_FOUND");
        if (current.version !== destination.expectedVersion)
          throw new Error("PARTNER_VERSION_CONFLICT");
        const before = partnerRecordOf(current, null);
        const result = (name: HubSpotPartnerField, fallback: string) =>
          plan.fields.find((change) => change.field === name)?.result ??
          fallback;
        const partnerInput: PartnerInput = PartnerInputSchema.parse({
          ...partnerInputOf(before),
          name: result("name", before.name),
          website: result("website", before.website),
          region: result("region", before.region),
          contacts: mergeContacts(
            withPartnerContactIds(before.id, before.contacts),
            plan,
            snapshot.portalId,
          ),
        });
        // Owner, status and models are never changed by an update import.
        partner = await updatePartnerRow(
          tx,
          current,
          partnerInput,
          current.ownerName,
          actor,
          source,
        );
      }
      if (!existingLink) {
        // A partner links to one company per portal.
        const [elsewhere] = await tx
          .select({ objectId: commerceExternalLinks.objectId })
          .from(commerceExternalLinks)
          .where(
            and(
              eq(commerceExternalLinks.provider, "hubspot"),
              eq(commerceExternalLinks.portalId, snapshot.portalId),
              eq(commerceExternalLinks.partnerId, partner.id),
            ),
          );
        if (elsewhere) throw new Error("HUBSPOT_PARTNER_LINKED_ELSEWHERE");
      }
      const linkId = existingLink?.id ?? randomUUID();
      if (!existingLink)
        await tx.insert(commerceExternalLinks).values({
          id: linkId,
          provider: "hubspot",
          portalId: snapshot.portalId,
          objectType: "company",
          objectId: input.companyId,
          destinationType: "partner",
          partnerId: partner.id,
          companyName: snapshot.company.name.slice(0, 200) || input.companyId,
          createdById: actor.id,
          createdByName: actor.display ?? actor.id,
        });
      const items = plan.documents.map((document) => ({
        id: randomUUID(),
        importId: plan.operationId,
        fileId: document.fileId,
        noteId: document.noteId,
        fileName: document.fileName.slice(0, 255),
        title: document.title,
        documentKind: document.kind,
        fileUpdatedAt: document.updatedAt,
        fileSize: document.size,
        status: "pending" as const,
      }));
      const status = hubspotImportStatus(items);
      await tx.insert(commerceHubSpotImports).values({
        id: plan.operationId,
        linkId,
        partnerId: partner.id,
        connectionId: connection.id,
        portalId: snapshot.portalId,
        companyId: input.companyId,
        dealId: input.dealId,
        createdPartner: destination.kind === "new_partner",
        status,
        plan,
        snapshot,
        requestDigest: input.requestDigest,
        createdById: actor.id,
        createdByName: actor.display ?? actor.id,
        completedAt: status === "needs_attention" ? null : new Date(),
      });
      if (items.length)
        await tx.insert(commerceHubSpotImportItems).values(items);
      await appendAuditAndOutbox(tx, {
        aggregateType: "hubspot_import",
        aggregateId: plan.operationId,
        aggregateVersion: 1,
        eventType: "hubspot.imported",
        actor,
        requestId: randomUUID(),
        after: {
          partnerId: partner.id,
          portalId: snapshot.portalId,
          companyId: input.companyId,
          dealId: input.dealId,
          createdPartner: destination.kind === "new_partner",
          linked: !existingLink,
          fields: plan.fields
            .filter((field) => field.action !== "keep")
            .map((field) => ({ field: field.field, action: field.action })),
          contacts: plan.contacts.length,
          notes: plan.notes.length,
          references: plan.references.map(
            (value) => `${value.objectType}:${value.property}`,
          ),
          documents: items.map((item) => item.fileId),
          dismissedSuggestions: plan.dismissedSuggestions,
          status,
        },
      });
      return {
        kind: "committed",
        importId: plan.operationId,
        partnerId: partner.id,
        createdPartner: destination.kind === "new_partner",
      };
    });
  }

  /**
   * A committed operation, so a handoff whose answer was lost resolves to
   * its import without reading HubSpot again.
   */
  operation(importId: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({
          partnerId: commerceHubSpotImports.partnerId,
          createdPartner: commerceHubSpotImports.createdPartner,
          requestDigest: commerceHubSpotImports.requestDigest,
          createdById: commerceHubSpotImports.createdById,
        })
        .from(commerceHubSpotImports)
        .where(eq(commerceHubSpotImports.id, importId));
      return row ?? null;
    });
  }

  /** A partner's imports, newest first, with their document items. */
  imports(partnerId: string, limit = 20): Promise<HubSpotImportRecord[]> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(commerceHubSpotImports)
        .where(eq(commerceHubSpotImports.partnerId, partnerId))
        .orderBy(
          desc(commerceHubSpotImports.createdAt),
          desc(commerceHubSpotImports.id),
        )
        .limit(limit);
      return withItems(tx, rows);
    });
  }

  /** One import, scoped to its partner so an ID from another record fails. */
  import(partnerId: string, importId: string): Promise<HubSpotImportRecord> {
    return this.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(commerceHubSpotImports)
        .where(
          and(
            eq(commerceHubSpotImports.id, importId),
            eq(commerceHubSpotImports.partnerId, partnerId),
          ),
        );
      const [record] = await withItems(tx, rows);
      if (!record) throw new Error("HUBSPOT_IMPORT_NOT_FOUND");
      return record;
    });
  }

  /** An attachment by ID on a partner, so a retry after a lost answer
   * records the document it already attached. */
  attachmentOnPartner(partnerId: string, attachmentId: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ id: accountDocuments.id, title: accountDocuments.title })
        .from(accountDocuments)
        .where(
          and(
            eq(accountDocuments.id, attachmentId),
            eq(accountDocuments.partnerId, partnerId),
          ),
        );
      return row ?? null;
    });
  }

  /** The partner's attachment with the same bytes, if any. */
  attachmentByHash(partnerId: string, sha256: string) {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ id: accountDocuments.id, title: accountDocuments.title })
        .from(accountDocuments)
        .where(
          and(
            eq(accountDocuments.partnerId, partnerId),
            eq(accountDocuments.sha256, sha256),
            // A removed copy never stands in for a new one.
            isNull(accountDocuments.removedAt),
          ),
        );
      return row ?? null;
    });
  }

  /** Records one attempt at a document. Resolved items stay resolved. */
  recordItem(
    partnerId: string,
    importId: string,
    itemId: string,
    outcome: HubSpotItemOutcome,
    actor: UserActor,
  ): Promise<HubSpotImportRecord> {
    return this.changeItem(
      partnerId,
      importId,
      itemId,
      actor,
      (item) => {
        if (outcome.status === "attached")
          return {
            values: {
              status: "attached",
              attachmentId: outcome.attachmentId,
              errorCode: null,
              attempts: item.attempts + 1,
            },
            event: "hubspot.document_attached",
            detail: { attachmentId: outcome.attachmentId },
          };
        if (outcome.status === "duplicate")
          return {
            values: {
              status: "duplicate",
              existingAttachmentId: outcome.existingAttachmentId,
              errorCode: null,
              attempts: item.attempts + 1,
            },
            event: "hubspot.document_duplicate",
            detail: { existingAttachmentId: outcome.existingAttachmentId },
          };
        return {
          values: {
            status: "failed",
            errorCode: outcome.errorCode,
            attempts: item.attempts + 1,
          },
          event: "hubspot.document_failed",
          detail: { errorCode: outcome.errorCode },
        };
      },
      (item) =>
        outcome.status === "attached" &&
        item.attachmentId === outcome.attachmentId,
    );
  }

  /**
   * Uses the identical PDF already on the record instead of attaching a
   * second copy: a visible choice for a duplicate, never automatic.
   */
  reuseExisting(
    partnerId: string,
    importId: string,
    itemId: string,
    actor: UserActor,
  ) {
    return this.changeItem(
      partnerId,
      importId,
      itemId,
      actor,
      async (item, tx) => {
        if (item.status !== "duplicate" || !item.existingAttachmentId)
          throw new Error("HUBSPOT_ITEM_RESOLVED");
        // The identical copy must still be on the partner to be reused.
        const [existing] = await tx
          .select({ id: accountDocuments.id })
          .from(accountDocuments)
          .where(
            and(
              eq(accountDocuments.id, item.existingAttachmentId),
              eq(accountDocuments.partnerId, partnerId),
              isNull(accountDocuments.removedAt),
            ),
          );
        if (!existing) throw new Error("HUBSPOT_DOCUMENT_UNAVAILABLE");
        return {
          values: {
            status: "reused",
            attachmentId: item.existingAttachmentId,
            resolvedByName: actor.display ?? actor.id,
          },
          event: "hubspot.document_reused",
          detail: { attachmentId: item.existingAttachmentId },
        };
      },
    );
  }

  /**
   * Excludes a document from the handoff: an explicit, audited amendment to
   * the reviewed plan, never a silent drop. The receipt says so.
   */
  excludeItem(
    partnerId: string,
    importId: string,
    itemId: string,
    reason: string,
    actor: UserActor,
  ) {
    const text = reason.trim().slice(0, 500);
    if (!text) throw new Error("HUBSPOT_DECISION_REQUIRED");
    return this.changeItem(partnerId, importId, itemId, actor, () => ({
      values: {
        status: "excluded",
        excludedReason: text,
        resolvedByName: actor.display ?? actor.id,
      },
      event: "hubspot.document_excluded",
      detail: { reason: text },
    }));
  }

  private changeItem(
    partnerId: string,
    importId: string,
    itemId: string,
    actor: UserActor,
    change: (
      item: ItemRow,
      tx: RuntimeTransaction,
    ) => Promise<ItemChange> | ItemChange,
    attachedAgain?: (item: ItemRow) => boolean,
  ): Promise<HubSpotImportRecord> {
    return this.tx(async (tx) => {
      const [record] = await tx
        .select()
        .from(commerceHubSpotImports)
        .where(
          and(
            eq(commerceHubSpotImports.id, importId),
            eq(commerceHubSpotImports.partnerId, partnerId),
          ),
        )
        .for("update");
      if (!record) throw new Error("HUBSPOT_IMPORT_NOT_FOUND");
      const [item] = await tx
        .select()
        .from(commerceHubSpotImportItems)
        .where(
          and(
            eq(commerceHubSpotImportItems.id, itemId),
            eq(commerceHubSpotImportItems.importId, importId),
          ),
        )
        .for("update");
      if (!item) throw new Error("HUBSPOT_ITEM_NOT_FOUND");
      if (["attached", "reused", "excluded"].includes(item.status)) {
        // A second attempt that attached the same file (two tabs, or the
        // automatic start racing a click) is the same result, not an error.
        if (item.status === "attached" && attachedAgain?.(item)) {
          const [view] = await withItems(tx, [record]);
          if (view) return view;
        }
        throw new Error("HUBSPOT_ITEM_RESOLVED");
      }
      const { values, event, detail } = await change(item, tx);
      await tx
        .update(commerceHubSpotImportItems)
        .set({ ...values, updatedAt: sql`now()`, version: item.version + 1 })
        .where(eq(commerceHubSpotImportItems.id, item.id));
      const items = await tx
        .select({ status: commerceHubSpotImportItems.status })
        .from(commerceHubSpotImportItems)
        .where(eq(commerceHubSpotImportItems.importId, importId));
      const status = hubspotImportStatus(items);
      const [updated] = await tx
        .update(commerceHubSpotImports)
        .set({
          status,
          completedAt:
            status === "needs_attention"
              ? null
              : (record.completedAt ?? new Date()),
          updatedAt: sql`now()`,
          version: record.version + 1,
        })
        .where(eq(commerceHubSpotImports.id, importId))
        .returning();
      if (!updated) throw new Error("HUBSPOT_IMPORT_NOT_FOUND");
      await appendAuditAndOutbox(tx, {
        aggregateType: "hubspot_import",
        aggregateId: importId,
        aggregateVersion: updated.version,
        eventType: event,
        actor,
        requestId: randomUUID(),
        after: {
          partnerId,
          itemId,
          fileId: item.fileId,
          importStatus: status,
          ...detail,
        },
      });
      const [view] = await withItems(tx, [updated]);
      if (!view) throw new Error("HUBSPOT_IMPORT_NOT_FOUND");
      return view;
    });
  }
}

async function withItems(
  tx: RuntimeTransaction,
  rows: readonly ImportRow[],
): Promise<HubSpotImportRecord[]> {
  if (!rows.length) return [];
  const items = await tx
    .select()
    .from(commerceHubSpotImportItems)
    .where(
      inArray(
        commerceHubSpotImportItems.importId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(
      commerceHubSpotImportItems.fileName,
      commerceHubSpotImportItems.id,
    );
  const documentIds = items.flatMap((item) => [
    ...(item.existingAttachmentId ? [item.existingAttachmentId] : []),
    ...(item.attachmentId ? [item.attachmentId] : []),
  ]);
  const found = documentIds.length
    ? await tx
        .select({
          id: accountDocuments.id,
          title: accountDocuments.title,
          removedAt: accountDocuments.removedAt,
        })
        .from(accountDocuments)
        .where(inArray(accountDocuments.id, documentIds))
    : [];
  const existing = new Map(
    found.map((row) => [
      row.id,
      { title: row.title, removed: row.removedAt !== null },
    ]),
  );
  return rows.map((row) =>
    importView(
      row,
      items
        .filter((item) => item.importId === row.id)
        .map((item) => itemView(item, existing)),
    ),
  );
}

/**
 * The partner's contacts after a plan: unrelated contacts untouched, a
 * matched contact keeps its values and gains its HubSpot identity, new
 * people are appended with theirs, and a contact already carrying the same
 * HubSpot identity is never added twice.
 */
export function mergeContacts(
  current: readonly PartnerContact[],
  plan: Pick<HubSpotHandoffPlan, "contacts" | "primaryContactId">,
  portalId: string,
): PartnerContact[] {
  const contacts = current.map((contact) => ({ ...contact }));
  for (const planned of plan.contacts) {
    const source = {
      provider: "hubspot" as const,
      portalId,
      objectId: planned.hubspotId,
      labels: [...planned.labels].slice(0, 20),
    };
    const existing = contacts.find(
      (contact) =>
        contact.id === planned.id ||
        (contact.source?.portalId === portalId &&
          contact.source.objectId === planned.hubspotId),
    );
    if (existing) {
      existing.id ??= planned.id;
      existing.source = source;
      continue;
    }
    if (planned.matchedExisting) throw new Error("HUBSPOT_CONTACT_NOT_FOUND");
    contacts.push({
      id: planned.id,
      name: planned.name,
      email: planned.email,
      role: planned.role,
      source,
    });
  }
  if (contacts.length > partnerContactLimit)
    throw new Error("HUBSPOT_CONTACT_LIMIT");
  if (plan.primaryContactId !== null) {
    if (!contacts.some((contact) => contact.id === plan.primaryContactId))
      throw new Error("HUBSPOT_CONTACT_NOT_FOUND");
    for (const contact of contacts) {
      if (contact.id === plan.primaryContactId) contact.primary = true;
      else delete contact.primary;
    }
  }
  return contacts;
}
