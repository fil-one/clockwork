import { randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import {
  ContractFileNameSchema,
  SalesCollateralInputSchema,
  type Actor,
  type SalesCollateralRecord,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { salesCollateral } from "../schema/contracts";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import {
  lazyDocumentStores,
  type ContractDocumentStores,
  type DocumentStoresSource,
} from "./contract-documents";

type Row = typeof salesCollateral.$inferSelect;

const view = (r: Row): SalesCollateralRecord => ({
  id: r.id,
  title: r.title,
  description: r.description,
  kind: r.kind,
  audience: r.audience,
  status: r.status,
  contentUpdatedOn: r.contentUpdatedOn,
  linkUrl: r.linkUrl,
  file:
    r.fileName && r.sha256 && r.sizeBytes !== null
      ? { fileName: r.fileName, sizeBytes: r.sizeBytes, sha256: r.sha256 }
      : null,
  updatedByName: r.updatedByName,
  updatedAt: r.updatedAt.toISOString(),
  version: r.version,
});

const actorName = (actor: Actor) => actor.display ?? actor.id;

/** Sales collateral: pitch decks, one-pagers, pricing sheets, case studies.
 * Each item is either a stored PDF or an https link, never both. */
export class SalesLibraryRepository {
  constructor(
    private readonly db: RuntimeDatabase,
    stores: DocumentStoresSource,
  ) {
    this.documentStores = lazyDocumentStores(stores);
  }
  private readonly documentStores: () => ContractDocumentStores;
  private get stores() {
    return this.documentStores();
  }

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  list() {
    return this.tx(async (tx) =>
      (
        await tx
          .select()
          .from(salesCollateral)
          .orderBy(
            asc(salesCollateral.status),
            desc(salesCollateral.contentUpdatedOn),
            asc(salesCollateral.title),
          )
          .limit(500)
      ).map(view),
    );
  }

  /**
   * Adds an item with either a link or a PDF. A retried request with the
   * same id returns the stored item rather than adding a second one.
   */
  async create(
    raw: unknown,
    file: { fileName: string; bytes: Uint8Array } | null,
    actor: Actor & { kind: "user" },
  ) {
    const input = SalesCollateralInputSchema.parse(raw);
    if (Boolean(input.linkUrl) === Boolean(file))
      throw new Error("COLLATERAL_LINK_OR_FILE");
    const fileName = file ? ContractFileNameSchema.parse(file.fileName) : null;
    const stored = file
      ? await this.stores.primary.put(file.bytes, {
          purpose: "collateral",
          contentType: "application/pdf",
        })
      : null;
    try {
      return await this.tx(async (tx) => {
        const [existing] = await tx
          .select()
          .from(salesCollateral)
          .where(eq(salesCollateral.id, input.id));
        if (existing) {
          if (stored)
            await this.stores.primary.delete(stored.key).catch(() => {});
          if (existing.createdById !== actor.id)
            throw new Error("COLLATERAL_IDEMPOTENCY_CONFLICT");
          return view(existing);
        }
        const [row] = await tx
          .insert(salesCollateral)
          .values({
            id: input.id,
            title: input.title,
            description: input.description,
            kind: input.kind,
            audience: input.audience,
            status: input.status,
            contentUpdatedOn: input.contentUpdatedOn,
            linkUrl: input.linkUrl || null,
            fileName,
            storageBackend: stored?.backend ?? null,
            storageKey: stored?.key ?? null,
            sha256: stored?.sha256 ?? null,
            sizeBytes: stored?.sizeBytes ?? null,
            createdById: actor.id,
            createdByName: actorName(actor),
            updatedByName: actorName(actor),
          })
          .returning();
        if (!row) throw new Error("COLLATERAL_INSERT_FAILED");
        await this.audit(tx, row, actor, "sales_collateral.added");
        return view(row);
      });
    } catch (error) {
      if (stored) await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  /**
   * Updates details, optionally replacing the PDF. A link item stays a link
   * and a file item stays a file; the replaced PDF is removed after commit.
   */
  async update(
    id: string,
    expectedVersion: number,
    raw: unknown,
    file: { fileName: string; bytes: Uint8Array } | null,
    actor: Actor & { kind: "user" },
  ) {
    const input = SalesCollateralInputSchema.parse(raw);
    if (input.id !== id) throw new Error("COLLATERAL_ID_MISMATCH");
    const fileName = file ? ContractFileNameSchema.parse(file.fileName) : null;
    const stored = file
      ? await this.stores.primary.put(file.bytes, {
          purpose: "collateral",
          contentType: "application/pdf",
        })
      : null;
    try {
      const { record, replaced } = await this.tx(async (tx) => {
        const [current] = await tx
          .select()
          .from(salesCollateral)
          .where(eq(salesCollateral.id, id))
          .for("update");
        if (!current) throw new Error("COLLATERAL_NOT_FOUND");
        if (current.version !== expectedVersion)
          throw new Error("COLLATERAL_VERSION_CONFLICT");
        const isLink = current.linkUrl !== null;
        if (isLink ? Boolean(file) || !input.linkUrl : Boolean(input.linkUrl))
          throw new Error("COLLATERAL_LINK_OR_FILE");
        const [row] = await tx
          .update(salesCollateral)
          .set({
            title: input.title,
            description: input.description,
            kind: input.kind,
            audience: input.audience,
            status: input.status,
            contentUpdatedOn: input.contentUpdatedOn,
            linkUrl: isLink ? input.linkUrl : null,
            ...(stored
              ? {
                  fileName,
                  storageBackend: stored.backend,
                  storageKey: stored.key,
                  sha256: stored.sha256,
                  sizeBytes: stored.sizeBytes,
                }
              : {}),
            updatedByName: actorName(actor),
            updatedAt: new Date(),
            version: current.version + 1,
          })
          .where(eq(salesCollateral.id, id))
          .returning();
        if (!row) throw new Error("COLLATERAL_UPDATE_FAILED");
        await this.audit(tx, row, actor, "sales_collateral.updated");
        return { record: view(row), replaced: stored ? current : null };
      });
      if (replaced?.storageBackend && replaced.storageKey)
        await this.stores
          .for(replaced.storageBackend)
          .delete(replaced.storageKey)
          .catch(() => {});
      return record;
    } catch (error) {
      if (stored) await this.stores.primary.delete(stored.key).catch(() => {});
      throw error;
    }
  }

  async readFile(id: string) {
    const row = await this.tx(
      async (tx) =>
        (
          await tx
            .select()
            .from(salesCollateral)
            .where(eq(salesCollateral.id, id))
        )[0],
    );
    if (!row?.storageBackend || !row.storageKey || !row.sha256 || !row.fileName)
      throw new Error("COLLATERAL_FILE_NOT_FOUND");
    return {
      record: view(row),
      bytes: await this.stores.read({
        storageBackend: row.storageBackend,
        storageKey: row.storageKey,
        sha256: row.sha256,
      }),
    };
  }

  /** Records who downloaded an item's PDF, as its own audit aggregate. */
  recordDownload(actor: Actor, itemId: string) {
    return this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        aggregateType: "document",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "sales_collateral.downloaded",
        actor,
        requestId: randomUUID(),
        after: { itemId },
      }),
    );
  }

  private audit(
    tx: RuntimeTransaction,
    row: Row,
    actor: Actor,
    eventType: string,
  ) {
    return appendAuditAndOutbox(tx, {
      aggregateType: "document",
      aggregateId: row.id,
      aggregateVersion: row.version,
      eventType,
      actor,
      requestId: randomUUID(),
      after: {
        title: row.title,
        kind: row.kind,
        audience: row.audience,
        status: row.status,
        sha256: row.sha256,
      },
    });
  }
}
