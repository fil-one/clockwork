import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  AccountDocumentInputSchema,
  AccountDocumentTargetSchema,
  ContractFileNameSchema,
  assertContractPdf,
  type AccountDocumentRecord,
  type AccountDocumentTarget,
  type Actor,
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
});

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
          .where(scope(target))
          .orderBy(desc(accountDocuments.createdAt), desc(accountDocuments.id))
      ).map(view);
    });
  }
  async add(
    rawTarget: AccountDocumentTarget,
    rawInput: unknown,
    upload: { fileName: string; bytes: Uint8Array },
    actor: Actor & { kind: "user" },
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
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`attachment:${target.type}:${target.id}`}, 0))`,
        );
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
            retry.uploadedById !== actor.id
          )
            throw new Error("ATTACHMENT_RETRY_CONFLICT");
          return { row: retry, reused: true };
        }
        const [duplicate] = await tx
          .select({ id: accountDocuments.id })
          .from(accountDocuments)
          .where(and(scope(target), eq(accountDocuments.sha256, hash)));
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
            provenance: "external_upload",
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
        .where(and(scope(target), eq(accountDocuments.id, id)));
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
