import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  ContractListQuerySchema,
  contractDocumentMaxBytes,
  type ContractInput,
} from "@clockwork/contracts";
import { contractTermSchedule } from "@clockwork/domain";
import { createRuntimeDatabase } from "../client";
import {
  ContractDocumentStores,
  PostgresContractDocumentStore,
} from "./contract-documents";
import { ContractRepository, ContractSigningRepository } from "./contracts";
import { SalesLibraryRepository } from "./sales-library";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const store = new PostgresContractDocumentStore(db);
const stores = new ContractDocumentStores(store);
const repo = new ContractRepository(db, stores);
const signing = new ContractSigningRepository(db, stores);
const library = new SalesLibraryRepository(db, stores);
const actor = {
  kind: "user" as const,
  id: randomUUID(),
  display: "Revenue lead",
};
const approver = {
  kind: "user" as const,
  id: randomUUID(),
  display: "Head of Revenue",
};
const pdf = (text = randomUUID()) => Buffer.from(`%PDF-1.7\n${text}\n%%EOF`);
const query = (patch: Record<string, unknown>) =>
  ContractListQuerySchema.parse(patch);
afterAll(() => client.end());

// Each test names its rows with a fresh marker so the shared database's
// other records never satisfy a search.
const contract = (
  marker: string,
  patch: Partial<ContractInput> = {},
): ContractInput => ({
  id: randomUUID(),
  counterpartyName: `Bluefin Data ${marker}`,
  title: "",
  contractType: "customer_msa",
  paper: "theirs",
  status: "executed",
  effectiveDate: "2026-01-01",
  initialTermMonths: 12,
  autoRenew: true,
  renewalTermMonths: 12,
  noticePeriodDays: 60,
  valueMinor: 1_200_000,
  currency: "USD",
  pricingNotes: "",
  ownerName: "R.W. Holleman",
  internalNotes: "",
  tags: [],
  ...patch,
});

describe("document store", () => {
  it("returns stored bytes only while they match their hash", async () => {
    const bytes = pdf();
    const stored = await store.put(bytes, {
      purpose: "contract",
      contentType: "application/pdf",
    });
    expect(stored).toMatchObject({
      backend: "postgres",
      sizeBytes: bytes.length,
    });
    expect(Buffer.from((await store.get(stored.key)).bytes)).toEqual(bytes);
    await client`update commerce_stored_documents set bytes = ${pdf("tampered")}, size_bytes = ${pdf("tampered").length} where id = ${stored.key}`;
    await expect(store.get(stored.key)).rejects.toThrow("DOCUMENT_INTEGRITY");
    await store.delete(stored.key);
    await expect(store.get(stored.key)).rejects.toThrow("DOCUMENT_NOT_FOUND");
  });

  it("rejects files that are not PDFs or exceed 25 MiB, in code and in the database", async () => {
    const put = (bytes: Uint8Array, contentType = "application/pdf") =>
      store.put(bytes, { purpose: "contract", contentType });
    await expect(put(Buffer.from("PK\u0003\u0004docx"))).rejects.toThrow(
      "DOCUMENT_NOT_PDF",
    );
    await expect(put(pdf(), "image/png")).rejects.toThrow("DOCUMENT_NOT_PDF");
    await expect(put(new Uint8Array())).rejects.toThrow("DOCUMENT_EMPTY");
    const large = Buffer.alloc(contractDocumentMaxBytes + 1, 0x20);
    large.write("%PDF-");
    await expect(put(large)).rejects.toThrow("DOCUMENT_TOO_LARGE");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`insert into commerce_stored_documents (id, purpose, content_type, size_bytes, sha256, bytes)
          values (${randomUUID()}, 'contract', 'application/pdf', 9, ${"a".repeat(64)}, ${Buffer.from("not a pdf")})`;
      }),
    ).rejects.toThrow("check constraint");
  });
});

describe("contract register", () => {
  it("records, retries and edits a contract with an audit trail of each change", async () => {
    const marker = randomUUID();
    const input = contract(marker, {
      tags: ["Enterprise", "enterprise", "EU"],
    });
    await repo.create(input, actor);
    await repo.create(input, actor);
    await expect(
      repo.create({ ...input, ownerName: "Someone else" }, actor),
    ).rejects.toThrow("CONTRACT_IDEMPOTENCY_CONFLICT");
    const created = await repo.get(input.id, "2026-10-04");
    expect(created.contract).toMatchObject({
      tags: ["enterprise", "eu"],
      version: 1,
      termEndDate: "2026-12-31",
      renewalDate: "2027-01-01",
      noticeDeadline: "2026-11-01",
    });
    const version = await repo.update(
      input.id,
      1,
      { ...input, status: "terminated", noticePeriodDays: 30 },
      approver,
    );
    expect(version).toBe(2);
    await expect(
      repo.update(input.id, 1, { ...input, title: "Stale edit" }, actor),
    ).rejects.toThrow("CONTRACT_VERSION_CONFLICT");
    const { activity } = await repo.get(input.id, "2026-10-04");
    expect(activity.map((a) => a.eventType)).toEqual([
      "contract.updated",
      "contract.created",
    ]);
    expect(activity[0]).toMatchObject({
      actorName: "Head of Revenue",
      changes: {
        status: { from: "executed", to: "terminated" },
        noticePeriodDays: { from: 60, to: 30 },
      },
    });
    const audit = await client<{ event_type: string }[]>`
      select event_type from audit_events where aggregate_id = ${input.id} order by occurred_at`;
    expect(audit.map((r) => r.event_type)).toEqual([
      "contract.created",
      "contract.updated",
    ]);
  });

  it("searches counterparty, owner and tags, filters, sorts and pages", async () => {
    const marker = randomUUID().slice(0, 8);
    const rows = [
      contract(marker, {
        counterpartyName: `Acme ${marker}`,
        tags: ["priority"],
      }),
      contract(marker, {
        counterpartyName: `Zenith ${marker}`,
        contractType: "dpa",
        status: "in_negotiation",
        ownerName: `Owner ${marker}`,
      }),
      contract(marker, {
        counterpartyName: `Mid 50% ${marker}`,
        contractType: "sow",
        tags: [`tag-${marker}`],
      }),
    ];
    for (const row of rows) await repo.create(row, actor);
    const search = async (patch: Record<string, unknown>) =>
      repo.list(query(patch), "2026-10-04");
    expect((await search({ q: marker })).total).toBe(3);
    expect(
      (await search({ q: `Owner ${marker}` })).rows.map(
        (r) => r.counterpartyName,
      ),
    ).toEqual([`Zenith ${marker}`]);
    expect((await search({ q: `tag-${marker}` })).rows).toHaveLength(1);
    // LIKE wildcards in a search are literal text.
    expect((await search({ q: `50% ${marker}` })).rows).toHaveLength(1);
    expect((await search({ q: `5_% ${marker}` })).rows).toHaveLength(0);
    expect(
      (await search({ q: marker, type: "dpa" })).rows.map(
        (r) => r.contractType,
      ),
    ).toEqual(["dpa"]);
    expect((await search({ q: marker, status: "in_negotiation" })).total).toBe(
      1,
    );
    expect(
      (await search({ q: marker, sort: "counterparty" })).rows.map(
        (r) => r.counterpartyName.split(" ")[0],
      ),
    ).toEqual(["Acme", "Mid", "Zenith"]);
    expect(
      (await search({ q: marker, sort: "counterparty", direction: "desc" }))
        .rows[0]?.counterpartyName,
    ).toBe(`Zenith ${marker}`);
    for (let i = 0; i < 24; i++)
      await repo.create(
        contract(marker, { counterpartyName: `Bulk ${i} ${marker}` }),
        actor,
      );
    const second = await search({ q: marker, page: 2, sort: "counterparty" });
    expect(second.total).toBe(27);
    expect(second.rows).toHaveLength(2);
    expect(
      await repo.exportRows(query({ q: marker }), "2026-10-04"),
    ).toHaveLength(27);
  }, 60_000);

  it("computes term dates in SQL exactly as the domain rules do", async () => {
    const marker = randomUUID();
    const cases: Partial<ContractInput>[] = [
      {
        effectiveDate: "2024-01-31",
        initialTermMonths: 1,
        renewalTermMonths: 1,
        noticePeriodDays: 10,
      },
      {
        effectiveDate: "2024-02-29",
        initialTermMonths: 12,
        renewalTermMonths: 12,
        noticePeriodDays: 30,
      },
      {
        effectiveDate: "2023-03-31",
        initialTermMonths: 12,
        renewalTermMonths: 12,
        noticePeriodDays: 30,
      },
      {
        effectiveDate: "2023-07-01",
        initialTermMonths: 36,
        renewalTermMonths: 12,
        noticePeriodDays: 90,
      },
      {
        effectiveDate: "2025-08-31",
        initialTermMonths: 6,
        autoRenew: false,
        renewalTermMonths: null,
        noticePeriodDays: null,
      },
      {
        effectiveDate: "2026-05-15",
        initialTermMonths: null,
        autoRenew: false,
        renewalTermMonths: null,
        noticePeriodDays: null,
      },
      {
        effectiveDate: "2025-12-31",
        initialTermMonths: 2,
        renewalTermMonths: 1,
        noticePeriodDays: 0,
      },
    ];
    const inputs = cases.map((patch) => contract(marker, patch));
    for (const input of inputs) await repo.create(input, actor);
    for (const asOf of [
      "2024-02-28",
      "2024-02-29",
      "2025-02-28",
      "2026-10-04",
      "2028-02-29",
      "2031-01-31",
    ]) {
      const listed = await repo.exportRows(query({ q: marker }), asOf);
      for (const input of inputs) {
        const row = listed.find((r) => r.id === input.id);
        const expected = contractTermSchedule(input, asOf);
        expect({ asOf, id: input.effectiveDate, ...pick(row) }).toEqual({
          asOf,
          id: input.effectiveDate,
          ...expected,
        });
        const detail = await repo.get(input.id, asOf);
        expect(pick(detail.contract)).toEqual(expected);
      }
    }
  }, 60_000);

  it("lists notices due within a window and leaves out unsigned contracts", async () => {
    const marker = randomUUID();
    const due = contract(marker, {
      effectiveDate: "2025-12-01",
      noticePeriodDays: 30,
    }); // term ends 2026-11-30, notice by 2026-10-31
    const later = contract(marker, {
      effectiveDate: "2026-02-01",
      noticePeriodDays: 30,
    }); // notice by 2026-12-31
    const unsigned = contract(marker, {
      effectiveDate: "2025-12-01",
      noticePeriodDays: 30,
      status: "in_negotiation",
    });
    for (const input of [due, later, unsigned]) await repo.create(input, actor);
    const ids = async (days: number) =>
      (await repo.renewalsDue("2026-10-04", days))
        .filter((r) => r.counterpartyName.endsWith(marker))
        .map((r) => r.id);
    expect(await ids(30)).toEqual([due.id]);
    expect(await ids(90)).toEqual([due.id, later.id]);
    const summary = await repo.renewalSummary("2026-10-04");
    expect(summary.within90).toBeGreaterThanOrEqual(2);
    expect(summary.within30).toBeLessThanOrEqual(summary.within60);
    expect(
      (await repo.list(query({ q: marker, window: 60 }), "2026-10-04")).rows
        .map((r) => r.id)
        .sort(),
    ).toEqual([due.id, unsigned.id].sort());
  });

  it("includes completed MNDAs as read-only rows and nothing else from the MNDA register", async () => {
    const marker = randomUUID();
    const completed = randomUUID();
    const pending = randomUUID();
    const input = (company: string) => ({
      company,
      effectiveDate: "2026-09-28",
      signerEmail: "alex@example.com",
    });
    await client`insert into commerce_mnda_requests (id, input, countersigner, owner_id, owner_name, state, template_hash, test_mode, completed_at)
      values (${completed}, ${JSON.stringify(input(`Signed NDA ${marker}`))}::jsonb, '{"name":"James Kurz"}'::jsonb, ${actor.id}, 'R.W. Holleman', 'completed', ${"a".repeat(64)}, true, now()),
             (${pending}, ${JSON.stringify(input(`Pending NDA ${marker}`))}::jsonb, '{"name":"James Kurz"}'::jsonb, ${actor.id}, 'R.W. Holleman', 'sent', ${"a".repeat(64)}, true, null)`;
    const { rows } = await repo.list(query({ q: marker }), "2026-10-04");
    expect(rows).toEqual([
      expect.objectContaining({
        id: completed,
        source: "mnda",
        contractType: "mnda",
        status: "executed",
        effectiveDate: "2026-09-28",
        ownerName: "R.W. Holleman",
        termEndDate: null,
        noticeDeadline: null,
      }),
    ]);
    expect(
      (await repo.list(query({ q: marker, type: "mnda" }), "2026-10-04")).total,
    ).toBe(1);
    expect(
      (await repo.list(query({ q: marker, type: "dpa" }), "2026-10-04")).total,
    ).toBe(0);
    await expect(repo.get(completed, "2026-10-04")).rejects.toThrow(
      "CONTRACT_NOT_FOUND",
    );
  });
});

describe("contract documents", () => {
  it("attaches, verifies and removes uploads, and keeps an executed contract's documents", async () => {
    const marker = randomUUID();
    const input = contract(marker, { status: "in_negotiation" });
    await repo.create(input, actor);
    const draft = await repo.addFile(
      input.id,
      {
        kind: "counterparty_draft",
        fileName: "Their MSA v1.pdf",
        bytes: pdf(),
      },
      actor,
    );
    const signed = await repo.addFile(
      input.id,
      { kind: "main", fileName: "a/b:signed.pdf", bytes: pdf("signed") },
      actor,
    );
    expect(signed.fileName).toBe("a-b-signed.pdf");
    expect(
      (await repo.readFile(input.id, signed.id)).bytes.toString(),
    ).toContain("signed");
    await expect(
      repo.addFile(
        input.id,
        { kind: "executed", fileName: "x.pdf", bytes: pdf() },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_FILE_KIND_NOT_UPLOADABLE");
    await expect(
      repo.addFile(
        input.id,
        { kind: "main", fileName: "notes.txt", bytes: Buffer.from("hello") },
        actor,
      ),
    ).rejects.toThrow("DOCUMENT_NOT_PDF");
    await repo.removeFile(input.id, draft.id, actor);
    const [{ key }] = await client<{ key: string }[]>`
      select storage_key as key from commerce_contract_files where id = ${signed.id}`;
    await client`update commerce_stored_documents set bytes = ${pdf("swapped")}, size_bytes = ${pdf("swapped").length}, sha256 = encode(sha256(${pdf("swapped")}), 'hex') where id = ${key}`;
    await expect(repo.readFile(input.id, signed.id)).rejects.toThrow(
      "DOCUMENT_INTEGRITY",
    );
    const {
      contract: current,
      activity,
      files,
    } = await repo.get(input.id, "2026-10-04");
    expect(files.map((f) => f.kind)).toEqual(["main"]);
    expect(activity.map((a) => a.eventType)).toEqual([
      "contract.document_removed",
      "contract.document_added",
      "contract.document_added",
      "contract.created",
    ]);
    await repo.update(
      input.id,
      current.version,
      { ...input, status: "executed" },
      actor,
    );
    await expect(repo.removeFile(input.id, signed.id, actor)).rejects.toThrow(
      "CONTRACT_FILE_PERMANENT",
    );
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`delete from commerce_contract_files where id = ${signed.id}`;
      }),
    ).rejects.toThrow("Documents on an executed contract are permanent");
  });

  it("gives application roles only the grants they need", async () => {
    for (const table of [
      "commerce_contracts",
      "commerce_contract_files",
      "commerce_stored_documents",
      "commerce_sales_collateral",
    ])
      await expect(
        client.begin(async (tx) => {
          await tx`set local role clockwork_runtime`;
          await tx`select * from ${client(table)} limit 1`;
        }),
      ).rejects.toThrow("permission denied");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`update commerce_contract_events set actor_name = 'x'`;
      }),
    ).rejects.toThrow("permission denied");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`delete from commerce_contracts`;
      }),
    ).rejects.toThrow("permission denied");
  });
});

describe("template signing persistence", () => {
  const prepare = async (approvalRequired: boolean) => {
    const marker = randomUUID();
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    const input = contract(marker, {
      paper: "ours",
      status: "draft",
      contractType: "other",
    });
    const result = await signing.prepare(
      {
        contract: input,
        signing: {
          templateId: "test-fixture",
          templateVersion: "1",
          templateHash: "b".repeat(64),
          documentName: `Fil One Engine Test Fixture: Bluefin ${marker}`,
          input: { partner_name: `Bluefin ${marker}` },
          counterpartySigner: {
            name: "Alex Example",
            email: `alex-${marker}@example.com`,
            title: "CEO",
          },
          countersignerId: countersigner.id,
          approvalRequired,
          testMode: true,
        },
        pdf: pdf("prepared"),
        fileName: "Prepared.pdf",
      },
      actor,
    );
    return { input, result };
  };

  it("enforces the two-person approval rule before anything can be sent", async () => {
    const { input, result } = await prepare(true);
    expect(result.record).toMatchObject({
      approvalState: "pending",
      state: "draft",
    });
    const lease = await signing.claim(input.id);
    await expect(
      signing.update(input.id, lease.token, { state: "preparing" }, actor),
    ).rejects.toMatchObject({
      cause: { message: "Contract requires approval before sending" },
    });
    await signing.release(input.id, lease.token);
    await expect(
      signing.decide(input.id, { approve: true }, actor),
    ).rejects.toThrow("CONTRACT_APPROVER_IS_PREPARER");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id, approver_name = 'x', decided_at = now() where contract_id = ${input.id}`;
      }),
    ).rejects.toThrow("check constraint");
    const approved = await signing.decide(
      input.id,
      { approve: true },
      approver,
    );
    expect(approved).toMatchObject({
      approvalState: "approved",
      approverName: "Head of Revenue",
    });
    await expect(
      signing.decide(input.id, { approve: false, reason: "late" }, approver),
    ).rejects.toThrow("CONTRACT_APPROVAL_NOT_PENDING");
  });

  it("records a rejection with its reason", async () => {
    const { input } = await prepare(true);
    await expect(
      signing.decide(input.id, { approve: false, reason: "  " }, approver),
    ).rejects.toThrow("CONTRACT_REJECTION_REASON_REQUIRED");
    const rejected = await signing.decide(
      input.id,
      { approve: false, reason: "Discount above policy" },
      approver,
    );
    expect(rejected.rejectionReason).toBe("Discount above policy");
    const { activity } = await repo.get(input.id, "2026-10-04");
    expect(activity[0]).toMatchObject({
      eventType: "contract.rejected",
      changes: { reason: "Discount above policy" },
    });
  });

  it("archives the executed PDF and marks the register row executed in one step", async () => {
    const { input, result } = await prepare(false);
    expect(result.record.approvalState).toBe("not_required");
    expect(
      Buffer.from(await signing.generatedPdf(input.id)).toString(),
    ).toContain("prepared");
    const lease = await signing.claim(input.id);
    await signing.update(
      input.id,
      lease.token,
      { state: "sent", providerId: randomUUID() },
      actor,
    );
    expect((await repo.get(input.id, "2026-10-04")).contract.status).toBe(
      "out_for_signature",
    );
    await expect(
      signing.update(input.id, lease.token, { state: "completed" }, actor),
    ).rejects.toMatchObject({
      cause: { message: "Contract completion requires archived evidence" },
    });
    await signing.update(
      input.id,
      lease.token,
      { state: "completed" },
      { kind: "provider", id: "signwell" },
      { bytes: pdf("executed with audit pages"), fileName: "Executed.pdf" },
    );
    await signing.release(input.id, lease.token);
    const detail = await repo.get(input.id, "2026-10-04");
    expect(detail.contract.status).toBe("executed");
    expect(detail.signing?.state).toBe("completed");
    expect(detail.files.map((f) => f.kind).sort()).toEqual([
      "executed",
      "generated",
    ]);
    expect(detail.activity[0]).toMatchObject({
      eventType: "contract.signing_completed",
      actorName: "SignWell",
    });
    const executed = detail.files.find((f) => f.kind === "executed");
    expect(
      (await repo.readFile(input.id, executed?.id ?? "")).bytes.toString(),
    ).toContain("audit pages");
  });
});

describe("sales library", () => {
  it("stores either a link or a PDF and replaces a PDF in place", async () => {
    const base = {
      title: "Fil One overview deck",
      description: "",
      kind: "pitch_deck",
      audience: "customer",
      status: "current",
      contentUpdatedOn: "2026-10-01",
    };
    const link = await library.create(
      { ...base, id: randomUUID(), linkUrl: "https://example.com/deck" },
      null,
      actor,
    );
    expect(link.file).toBeNull();
    await expect(
      library.create(
        { ...base, id: randomUUID(), linkUrl: "http://example.com/deck" },
        null,
        actor,
      ),
    ).rejects.toThrow();
    await expect(
      library.create(
        { ...base, id: randomUUID(), linkUrl: "https://example.com" },
        { fileName: "deck.pdf", bytes: pdf() },
        actor,
      ),
    ).rejects.toThrow("COLLATERAL_LINK_OR_FILE");
    const id = randomUUID();
    const file = await library.create(
      { ...base, id },
      { fileName: "One pager.pdf", bytes: pdf("v1") },
      actor,
    );
    const updated = await library.update(
      id,
      file.version,
      { ...base, id, status: "archived" },
      { fileName: "One pager v2.pdf", bytes: pdf("v2") },
      approver,
    );
    expect(updated).toMatchObject({
      status: "archived",
      updatedByName: "Head of Revenue",
      file: { fileName: "One pager v2.pdf" },
    });
    expect((await library.readFile(id)).bytes.toString()).toContain("v2");
    await expect(
      library.update(id, file.version, { ...base, id }, null, actor),
    ).rejects.toThrow("COLLATERAL_VERSION_CONFLICT");
  });
});

function pick(
  row:
    | {
        termEndDate: string | null;
        renewalDate: string | null;
        noticeDeadline: string | null;
      }
    | undefined,
) {
  return {
    termEndDate: row?.termEndDate ?? null,
    renewalDate: row?.renewalDate ?? null,
    noticeDeadline: row?.noticeDeadline ?? null,
  };
}
