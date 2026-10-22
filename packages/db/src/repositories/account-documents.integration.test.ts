import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AccountDocumentTarget } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import { AccountDocumentRepository } from "./account-documents";
import {
  ContractDocumentStores,
  PostgresContractDocumentStore,
} from "./contract-documents";
import { PartnerRepository } from "./partners";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const store = new PostgresContractDocumentStore(db);
const repo = new AccountDocumentRepository(
  db,
  new ContractDocumentStores(store),
);
const actor = {
  kind: "user" as const,
  id: "20000000-0000-4000-8000-000000000001",
  display: "Iris Operator",
};
const account: AccountDocumentTarget = {
  type: "account",
  id: "10000000-0000-4000-8000-000000000001",
};
const otherAccount: AccountDocumentTarget = {
  type: "account",
  id: "10000000-0000-4000-8000-000000000002",
};
const input = () => ({
  id: randomUUID(),
  title: "External MNDA",
  kind: "mnda",
  signedOn: "2026-10-15",
});
const upload = () => ({
  fileName: "Signed MNDA.pdf",
  bytes: Buffer.from(`%PDF-1.7\n${randomUUID()}\n%%EOF`),
});
afterAll(() => client.end());

const documentCount = async () => {
  const [row] = await client<
    { count: number }[]
  >`select count(*)::int as count from commerce_stored_documents where purpose = 'account_attachment'`;
  return row?.count;
};

describe("staff account attachments", () => {
  it("persists an externally signed MNDA on a standalone partner and audits its upload and download", async () => {
    const partner = await new PartnerRepository(db).save(
      { id: randomUUID(), name: `Attachment Partner ${randomUUID()}` },
      actor,
    );
    const target: AccountDocumentTarget = { type: "partner", id: partner.id };
    const details = input();
    const pdf = upload();
    const file = await repo.add(target, details, pdf, actor);
    expect(file).toMatchObject({
      ...details,
      fileName: pdf.fileName,
      uploadedByName: actor.display,
    });
    expect(await repo.list(target)).toEqual([file]);
    expect((await repo.read(target, file.id, actor)).bytes).toEqual(pdf.bytes);
    const events = await client<
      { event_type: string; after: Record<string, unknown> }[]
    >`
      select event_type, after from audit_events where aggregate_id = ${file.id}
      or after->>'documentId' = ${file.id}`;
    expect(events.map((e) => e.event_type).sort()).toEqual([
      "account.document_attached",
      "account.document_downloaded",
    ]);
    expect(
      events.find((e) => e.event_type === "account.document_attached")?.after,
    ).toMatchObject({ target, provenance: "external_upload" });
    const outbox =
      await client`select id from outbox_messages where payload->>'aggregateId' = ${file.id}`;
    expect(outbox).toHaveLength(1);
  });

  it("attaches to a customer account and rejects document IDs requested through another record", async () => {
    const file = await repo.add(account, input(), upload(), actor);
    expect(await repo.list(account)).toEqual(expect.arrayContaining([file]));
    await expect(repo.read(otherAccount, file.id, actor)).rejects.toThrow(
      "ATTACHMENT_NOT_FOUND",
    );
    await expect(
      repo.read({ type: "partner", id: account.id }, file.id, actor),
    ).rejects.toThrow("ATTACHMENT_NOT_FOUND");
  });

  it("makes concurrent retries idempotent, with one attachment, stored PDF and audit event", async () => {
    const before = await documentCount();
    const details = input();
    const pdf = upload();
    const files = await Promise.all([
      repo.add(account, details, pdf, actor),
      repo.add(account, details, pdf, actor),
    ]);
    expect(files[0]).toEqual(files[1]);
    expect(await documentCount()).toBe((before ?? 0) + 1);
    const events =
      await client`select id from audit_events where aggregate_id = ${details.id}`;
    expect(events).toHaveLength(1);
    await expect(
      repo.add(
        account,
        { ...details, title: "Changed after retry" },
        pdf,
        actor,
      ),
    ).rejects.toThrow("ATTACHMENT_RETRY_CONFLICT");
    await expect(repo.add(otherAccount, details, pdf, actor)).rejects.toThrow(
      "ATTACHMENT_RETRY_CONFLICT",
    );
    expect(await documentCount()).toBe((before ?? 0) + 1);
  });

  it("rejects duplicate content on one record but allows the same agreement on a different account", async () => {
    const pdf = upload();
    const first = await repo.add(account, input(), pdf, actor);
    const before = await documentCount();
    await expect(repo.add(account, input(), pdf, actor)).rejects.toThrow(
      "ATTACHMENT_ALREADY_EXISTS",
    );
    expect(await documentCount()).toBe(before);
    const second = await repo.add(otherAccount, input(), pdf, actor);
    expect(second.id).not.toBe(first.id);
    expect((await repo.read(otherAccount, second.id, actor)).bytes).toEqual(
      pdf.bytes,
    );
  });

  it("leaves no bytes behind for missing targets, malformed files or failed inserts", async () => {
    const before = await documentCount();
    await expect(
      repo.add({ type: "account", id: randomUUID() }, input(), upload(), actor),
    ).rejects.toThrow("ATTACHMENT_TARGET_NOT_FOUND");
    await expect(
      repo.add(
        account,
        input(),
        { fileName: "fake.pdf", bytes: Buffer.from("not a PDF") },
        actor,
      ),
    ).rejects.toThrow("DOCUMENT_NOT_PDF");
    await expect(
      repo.add(account, input(), upload(), { ...actor, id: "invalid-uuid" }),
    ).rejects.toThrow();
    expect(await documentCount()).toBe(before);
  });

  it("retains referenced bytes when cleanup runs after an ambiguous commit", async () => {
    const file = await repo.add(account, input(), upload(), actor);
    const [row] = await client<
      { storage_key: string }[]
    >`select storage_key from commerce_account_documents where id = ${file.id}`;
    if (!row) throw new Error("Attachment was not persisted");
    await expect(store.delete(row.storage_key)).rejects.toMatchObject({
      cause: { message: "Stored document is still referenced" },
    });
    expect((await repo.read(account, file.id, actor)).file.id).toBe(file.id);
  });
});
