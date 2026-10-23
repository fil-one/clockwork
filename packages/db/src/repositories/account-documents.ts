import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  AccountDocumentInputSchema,
  AccountDocumentRemovalSchema,
  AccountDocumentRestoreSchema,
  AccountDocumentTargetSchema,
  ContractFileNameSchema,
  assertContractPdf,
  type AccountDocumentRecord,
  type AccountDocumentTarget,
  type Actor,
  type RemovedAccountDocumentRecord,
} from "@clockwork/contracts";
import type { RuntimeDatabase, RuntimeTransaction } from "../client";
import { accounts } from "../schema";
import { accountDocuments } from "../schema/account-documents";
import { commercePartners } from "../schema/partners";
import { withInternalTransaction } from "../transaction";
import { appendAuditAndOutbox } from "./audit-outbox";
import {
  lazyDocumentStores,
  type DocumentStoresSource,
} from "./contract-documents";

type Row = typeof accountDocuments.$inferSelect;
const scope = (target: AccountDocumentTarget) =>
  target.type === "partner"
    ? eq(accountDocuments.partnerId, target.id)
    : eq(accountDocuments.accountId, target.id);
const view = (row: Row): AccountDocumentRecord => ({
  id: row.id,
  title: row.title,
  kind: row.kind,
  signedOn: row.signedOn,
  fileName: row.fileName,
  sizeBytes: row.sizeBytes,
  uploadedByName: row.uploadedByName,
  createdAt: row.createdAt.toISOString(),
  version: row.version,
});
const removedView = (row: Row): RemovedAccountDocumentRecord => ({
  ...view(row),
  removedAt: row.removedAt?.toISOString() ?? "",
  removedByName: row.removedByName ?? "",
  removalReason: row.removalReason ?? "",
});
const lockRecord = (tx: RuntimeTransaction, target: AccountDocumentTarget) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`attachment:${target.type}:${target.id}`}, 0))`,
  );

/** An identical PDF still on the record makes a restore a duplicate. */
function duplicateRefusal(error: unknown): never {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 4;
    current = current.cause, depth += 1
  ) {
    const driver = current as Error & { code?: unknown };
    if (driver.code === "23505") throw new Error("ATTACHMENT_ALREADY_EXISTS");
  }
  throw error;
}

async function requireTarget(
  tx: RuntimeTransaction,
  target: AccountDocumentTarget,
) {
  const table = target.type === "partner" ? commercePartners : accounts;
  const [record] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, target.id));
  if (!record) throw new Error("ATTACHMENT_TARGET_NOT_FOUND");
}

/** Staff-only evidence. The web boundary checks staff, MFA and the target's
 * read permission before every operation, plus contract:write for uploads. */
export class AccountDocumentRepository {
  private readonly stores;
  constructor(
    private readonly db: RuntimeDatabase,
    source: DocumentStoresSource,
  ) {
    this.stores = lazyDocumentStores(source);
  }
  private tx<T>(operation: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), operation);
  }
  list(rawTarget: AccountDocumentTarget) {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    return this.tx(async (tx) => {
      await requireTarget(tx, target);
      return (
        await tx
          .select()
          .from(accountDocuments)
          .where(and(scope(target), isNull(accountDocuments.removedAt)))
          .orderBy(desc(accountDocuments.createdAt), desc(accountDocuments.id))
      ).map(view);
    });
  }
  /** Documents removed from the record, most recently removed first. */
  removed(rawTarget: AccountDocumentTarget) {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    return this.tx(async (tx) => {
      await requireTarget(tx, target);
      return (
        await tx
          .select()
          .from(accountDocuments)
          .where(and(scope(target), isNotNull(accountDocuments.removedAt)))
          .orderBy(desc(accountDocuments.removedAt), desc(accountDocuments.id))
          .limit(500)
      ).map(removedView);
    });
  }
  /**
   * Takes a document off its record: attached by mistake, to the wrong
   * record, or superseded by a corrected copy. The row, its original details
   * and the retained bytes stay for audit; the document can no longer be
   * opened and no longer blocks attaching the same PDF again. A retry by the
   * same person with the same reason returns the removed document.
   */
  remove(
    rawTarget: AccountDocumentTarget,
    raw: unknown,
    actor: Actor & { kind: "user" },
  ): Promise<RemovedAccountDocumentRecord> {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    const input = AccountDocumentRemovalSchema.parse(raw);
    return this.tx(async (tx) => {
      await lockRecord(tx, target);
      const [row] = await tx
        .select()
        .from(accountDocuments)
        .where(and(scope(target), eq(accountDocuments.id, input.id)))
        .for("update");
      if (!row) throw new Error("ATTACHMENT_NOT_FOUND");
      if (row.removedAt) {
        if (
          row.removedById === actor.id &&
          row.removalReason === input.reason &&
          row.version === input.expectedVersion + 1
        )
          return removedView(row);
        throw new Error("ATTACHMENT_VERSION_CONFLICT");
      }
      if (row.version !== input.expectedVersion)
        throw new Error("ATTACHMENT_VERSION_CONFLICT");
      const [updated] = await tx
        .update(accountDocuments)
        .set({
          removedAt: new Date(),
          removedById: actor.id,
          // The database keeps a 1–200 character name; an empty or very
          // long profile name never blocks a removal.
          removedByName: (actor.display ?? "").trim().slice(0, 200) || actor.id,
          removalReason: input.reason,
          version: row.version + 1,
        })
        .where(eq(accountDocuments.id, row.id))
        .returning();
      if (!updated) throw new Error("ATTACHMENT_NOT_FOUND");
      await appendAuditAndOutbox(tx, {
        ...(target.type === "account" ? { accountId: target.id } : {}),
        aggregateType: "document",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        eventType: "account.document_removed",
        actor,
        requestId: randomUUID(),
        before: { removed: false },
        after: {
          target,
          title: updated.title,
          fileName: updated.fileName,
          sha256: updated.sha256,
          reason: input.reason,
        },
      });
      return removedView(updated);
    });
  }
  /** Puts a removed document back, unless an identical PDF is now there. */
  restore(
    rawTarget: AccountDocumentTarget,
    raw: unknown,
    actor: Actor & { kind: "user" },
  ): Promise<AccountDocumentRecord> {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    const input = AccountDocumentRestoreSchema.parse(raw);
    return this.tx(async (tx) => {
      await lockRecord(tx, target);
      const [row] = await tx
        .select()
        .from(accountDocuments)
        .where(and(scope(target), eq(accountDocuments.id, input.id)))
        .for("update");
      if (!row) throw new Error("ATTACHMENT_NOT_FOUND");
      if (!row.removedAt) {
        if (row.version === input.expectedVersion + 1) return view(row);
        throw new Error("ATTACHMENT_VERSION_CONFLICT");
      }
      if (row.version !== input.expectedVersion)
        throw new Error("ATTACHMENT_VERSION_CONFLICT");
      const [twin] = await tx
        .select({ id: accountDocuments.id })
        .from(accountDocuments)
        .where(
          and(
            scope(target),
            eq(accountDocuments.sha256, row.sha256),
            isNull(accountDocuments.removedAt),
          ),
        );
      if (twin) throw new Error("ATTACHMENT_ALREADY_EXISTS");
      const [updated] = await tx
        .update(accountDocuments)
        .set({
          removedAt: null,
          removedById: null,
          removedByName: null,
          removalReason: null,
          version: row.version + 1,
        })
        .where(eq(accountDocuments.id, row.id))
        .returning()
        .catch(duplicateRefusal);
      if (!updated) throw new Error("ATTACHMENT_NOT_FOUND");
      await appendAuditAndOutbox(tx, {
        ...(target.type === "account" ? { accountId: target.id } : {}),
        aggregateType: "document",
        aggregateId: updated.id,
        aggregateVersion: updated.version,
        eventType: "account.document_restored",
        actor,
        requestId: randomUUID(),
        before: { removed: true, reason: row.removalReason },
        after: { target, title: updated.title },
      });
      return view(updated);
    });
  }
  async add(
    rawTarget: AccountDocumentTarget,
    rawInput: unknown,
    upload: { fileName: string; bytes: Uint8Array },
    actor: Actor & { kind: "user" },
    /** Where the PDF came from when not uploaded by hand, such as a HubSpot
     * file brought in by a reviewed import. */
    provenance:
      Record<string, string | null> | "external_upload" = "external_upload",
  ) {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    const input = AccountDocumentInputSchema.parse(rawInput);
    const fileName = ContractFileNameSchema.parse(upload.fileName);
    assertContractPdf(upload.bytes);
    const hash = createHash("sha256").update(upload.bytes).digest("hex");
    // Reject a missing target before writing bytes to the store.
    await this.tx((tx) => requireTarget(tx, target));
    const store = this.stores().primary;
    const stored = await store.put(upload.bytes, {
      purpose: "account_attachment",
      contentType: "application/pdf",
    });
    try {
      const result = await this.tx(async (tx) => {
        // Serializes uploads and content duplicates for this one record.
        await lockRecord(tx, target);
        await requireTarget(tx, target);
        const [retry] = await tx
          .select()
          .from(accountDocuments)
          .where(eq(accountDocuments.id, input.id));
        if (retry) {
          if (
            (target.type === "partner" ? retry.partnerId : retry.accountId) !==
              target.id ||
            retry.sha256 !== hash ||
            retry.title !== input.title ||
            retry.kind !== input.kind ||
            retry.signedOn !== input.signedOn ||
            retry.fileName !== fileName ||
            retry.uploadedById !== actor.id ||
            retry.removedAt !== null
          )
            throw new Error("ATTACHMENT_RETRY_CONFLICT");
          return { row: retry, reused: true };
        }
        const [duplicate] = await tx
          .select({ id: accountDocuments.id })
          .from(accountDocuments)
          .where(
            and(
              scope(target),
              eq(accountDocuments.sha256, hash),
              isNull(accountDocuments.removedAt),
            ),
          );
        if (duplicate) throw new Error("ATTACHMENT_ALREADY_EXISTS");
        const [row] = await tx
          .insert(accountDocuments)
          .values({
            ...input,
            partnerId: target.type === "partner" ? target.id : null,
            accountId: target.type === "account" ? target.id : null,
            fileName,
            storageBackend: stored.backend,
            storageKey: stored.key,
            sha256: stored.sha256,
            sizeBytes: stored.sizeBytes,
            contentType: stored.contentType,
            uploadedById: actor.id,
            uploadedByName: actor.display ?? actor.id,
          })
          .returning();
        if (!row) throw new Error("ATTACHMENT_UNAVAILABLE");
        await appendAuditAndOutbox(tx, {
          ...(target.type === "account" ? { accountId: target.id } : {}),
          aggregateType: "document",
          aggregateId: row.id,
          aggregateVersion: 1,
          eventType: "account.document_attached",
          actor,
          requestId: randomUUID(),
          after: {
            target,
            title: row.title,
            kind: row.kind,
            signedOn: row.signedOn,
            fileName,
            sha256: row.sha256,
            provenance,
          },
        });
        return { row, reused: false };
      });
      if (result.reused) await store.delete(stored.key).catch(() => {});
      return view(result.row);
    } catch (error) {
      // The storage guard preserves evidence even if COMMIT succeeded but its
      // response was lost. Only unreferenced bytes can be cleaned up here.
      await store.delete(stored.key).catch(() => {});
      throw error;
    }
  }
  async read(rawTarget: AccountDocumentTarget, id: string, actor: Actor) {
    const target = AccountDocumentTargetSchema.parse(rawTarget);
    const row = await this.tx(async (tx) => {
      const [file] = await tx
        .select()
        .from(accountDocuments)
        .where(
          and(
            scope(target),
            eq(accountDocuments.id, id),
            isNull(accountDocuments.removedAt),
          ),
        );
      if (!file) throw new Error("ATTACHMENT_NOT_FOUND");
      return file;
    });
    const bytes = await this.stores().read(row);
    await this.tx((tx) =>
      appendAuditAndOutbox(tx, {
        ...(target.type === "account" ? { accountId: target.id } : {}),
        aggregateType: "document",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        eventType: "account.document_downloaded",
        actor,
        requestId: randomUUID(),
        after: { target, documentId: row.id },
      }),
    );
    return { file: view(row), bytes };
  }
}
