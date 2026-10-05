import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  assertContractPdf,
  contractDocumentContentType,
  type ContractDocumentStore,
  type StoredDocument,
} from "@clockwork/contracts";
import type { RuntimeDatabase } from "../client";
import { storedDocuments } from "../schema/contracts";
import { withInternalTransaction } from "../transaction";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** The same bytes as a Buffer, without copying them. */
export const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * Database-backed document store (backend `postgres`). Bytes sit in the
 * backed-up PostgreSQL database, as ADR 0011 already accepts for MNDAs; a Fil
 * One S3-compatible store implements the same interface under another
 * backend name, and existing rows keep resolving through this one.
 *
 * Deleting a document that a contract file or sales library item still
 * references is refused by the database, so a cleanup that cannot tell
 * whether its own transaction committed never removes live evidence.
 */
export class PostgresContractDocumentStore implements ContractDocumentStore {
  readonly backend = "postgres";
  constructor(private readonly db: RuntimeDatabase) {}

  async put(
    bytes: Uint8Array,
    options: { purpose: "contract" | "collateral"; contentType: string },
  ): Promise<StoredDocument> {
    if (options.contentType !== contractDocumentContentType)
      throw new Error("DOCUMENT_NOT_PDF");
    assertContractPdf(bytes);
    const document: StoredDocument = {
      backend: this.backend,
      key: randomUUID(),
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      contentType: contractDocumentContentType,
    };
    await withInternalTransaction(this.db, randomUUID(), (tx) =>
      tx.insert(storedDocuments).values({
        id: document.key,
        purpose: options.purpose,
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
        bytes: asBuffer(bytes),
      }),
    );
    return document;
  }

  async get(key: string) {
    const row = await withInternalTransaction(
      this.db,
      randomUUID(),
      async (tx) =>
        (
          await tx
            .select()
            .from(storedDocuments)
            .where(eq(storedDocuments.id, key))
        )[0],
    );
    if (!row) throw new Error("DOCUMENT_NOT_FOUND");
    const bytes = row.bytes;
    if (
      bytes.length !== row.sizeBytes ||
      sha256(bytes) !== row.sha256 ||
      bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
    )
      throw new Error("DOCUMENT_INTEGRITY");
    return {
      bytes,
      document: {
        backend: this.backend,
        key: row.id,
        sha256: row.sha256,
        sizeBytes: row.sizeBytes,
        contentType: row.contentType,
      },
    };
  }

  async delete(key: string) {
    await withInternalTransaction(this.db, randomUUID(), (tx) =>
      tx.delete(storedDocuments).where(eq(storedDocuments.id, key)),
    );
  }
}

/**
 * Resolves the store a stored file names. Writes go to `primary`; reads and
 * deletes follow each row's recorded backend, so files written before a
 * storage move stay readable.
 */
export class ContractDocumentStores {
  private readonly byBackend: ReadonlyMap<string, ContractDocumentStore>;
  constructor(
    readonly primary: ContractDocumentStore,
    others: readonly ContractDocumentStore[] = [],
  ) {
    this.byBackend = new Map(
      [primary, ...others].map((store) => [store.backend, store]),
    );
  }
  for(backend: string) {
    const store = this.byBackend.get(backend);
    if (!store) throw new Error("DOCUMENT_BACKEND_UNAVAILABLE");
    return store;
  }
  /** Reads a stored file and checks it against the hash its row recorded. */
  async read(file: {
    storageBackend: string;
    storageKey: string;
    sha256: string;
  }): Promise<Buffer> {
    const { bytes, document } = await this.for(file.storageBackend).get(
      file.storageKey,
    );
    if (document.sha256 !== file.sha256 || sha256(bytes) !== file.sha256)
      throw new Error("DOCUMENT_INTEGRITY");
    return asBuffer(bytes);
  }
}

/** Stores, or a function that builds them when first needed, so code that
 * never touches a document (a webhook lookup) never configures a store. */
export type DocumentStoresSource =
  ContractDocumentStores | (() => ContractDocumentStores);

export function lazyDocumentStores(source: DocumentStoresSource) {
  let resolved: ContractDocumentStores | undefined;
  return () => (resolved ??= typeof source === "function" ? source() : source);
}
