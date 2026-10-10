import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  ContractListQuerySchema,
  contractDocumentMaxBytes,
  contractPdfFileName,
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
import { countSalesHomeContracts } from "./sales-home";

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
const pdf = (text: string = randomUUID()) =>
  Buffer.from(`%PDF-1.7\n${text}\n%%EOF`);
const all = { includeMndas: true, viewerId: actor.id };
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
      repo.list(query(patch), "2026-10-04", all);
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
      (await repo.exportRows(query({ q: marker }), "2026-10-04", all)).rows,
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
      const { rows: listed } = await repo.exportRows(
        query({ q: marker }),
        asOf,
        all,
      );
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
      (
        await repo.list(query({ q: marker, window: 60 }), "2026-10-04", all)
      ).rows
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
    const { rows } = await repo.list(query({ q: marker }), "2026-10-04", all);
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
      (await repo.list(query({ q: marker, type: "mnda" }), "2026-10-04", all))
        .total,
    ).toBe(1);
    expect(
      (await repo.list(query({ q: marker, type: "dpa" }), "2026-10-04", all))
        .total,
    ).toBe(0);
    await expect(repo.get(completed, "2026-10-04")).rejects.toThrow(
      "CONTRACT_NOT_FOUND",
    );
    // People who cannot open the MNDA register do not see its rows.
    expect(
      (
        await repo.list(query({ q: marker }), "2026-10-04", {
          ...all,
          includeMndas: false,
        })
      ).total,
    ).toBe(0);
  });

  it("keeps executed contracts executed, apart from expiry or termination", async () => {
    const marker = randomUUID();
    const input = contract(marker, { status: "in_negotiation" });
    await repo.create(input, actor);
    const file = await repo.addFile(
      input.id,
      { kind: "main", fileName: "Signed.pdf", bytes: pdf() },
      actor,
    );
    let version = await repo.update(
      input.id,
      2,
      { ...input, status: "executed" },
      actor,
    );
    const executed = await repo.get(input.id, "2026-10-04");
    expect(executed.contract.executedAt).not.toBeNull();
    await expect(
      repo.update(input.id, version, { ...input, status: "draft" }, actor),
    ).rejects.toThrow("CONTRACT_EXECUTED_FINAL");
    version = await repo.update(
      input.id,
      version,
      { ...input, status: "terminated" },
      actor,
    );
    const terminated = await repo.get(input.id, "2026-10-04");
    expect(terminated.contract.executedAt).toBe(executed.contract.executedAt);
    // Terminating does not make the signed copy removable again.
    await expect(repo.removeFile(input.id, file.id, actor)).rejects.toThrow(
      "CONTRACT_FILE_PERMANENT",
    );
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`delete from commerce_contract_files where id = ${file.id}`;
      }),
    ).rejects.toThrow("Documents on an executed contract are permanent");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`update commerce_contracts set status = 'in_negotiation', executed_at = null where id = ${input.id}`;
      }),
    ).rejects.toThrow("An executed contract can only expire or be terminated");
    expect(version).toBeGreaterThan(1);
  });

  it("lists signing outcomes beside the draft status and filters by them", async () => {
    const marker = randomUUID();
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    const input = contract(marker, {
      paper: "ours",
      status: "draft",
      contractType: "other",
    });
    await signing.prepare(
      {
        contract: input,
        signing: {
          templateId: "test-fixture",
          templateVersion: "1",
          templateHash: "b".repeat(64),
          documentName: `Doc ${marker}`,
          input: {},
          counterpartySigner: {
            name: "Alex",
            email: `alex-${marker}@example.com`,
            title: "CEO",
          },
          countersignerId: countersigner.id,
          approvalRequired: false,
          testMode: true,
        },
        pdf: pdf(),
        fileName: "Prepared.pdf",
      },
      actor,
    );
    const lease = await signing.claim(input.id);
    await signing.update(
      input.id,
      lease.token,
      { state: "sent", providerId: randomUUID() },
      actor,
    );
    await signing.update(input.id, lease.token, { state: "declined" }, actor);
    await signing.release(input.id, lease.token);
    const listed = await repo.list(query({ q: marker }), "2026-10-04", all);
    expect(listed.rows[0]).toMatchObject({
      status: "draft",
      signingState: "declined",
    });
    expect(
      (
        await repo.list(
          query({ q: marker, status: "signing_declined" }),
          "2026-10-04",
          all,
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await repo.list(
          query({ q: marker, status: "signing_expired" }),
          "2026-10-04",
          all,
        )
      ).total,
    ).toBe(0);
  });

  it("filters to the reader's own contracts and MNDAs with the counts the home page shows", async () => {
    const marker = randomUUID();
    const viewer = { ...actor, id: randomUUID(), display: "Mine filter" };
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    await repo.create(
      contract(marker, { status: "out_for_signature" }),
      viewer,
    );
    await repo.create(contract(marker, { status: "out_for_signature" }), actor);
    // A prepared contract an approver sent back needs its preparer.
    const rejected = contract(marker, {
      paper: "ours",
      status: "draft",
      contractType: "other",
    });
    await signing.prepare(
      {
        contract: rejected,
        signing: {
          templateId: "test-fixture",
          templateVersion: "1",
          templateHash: "b".repeat(64),
          documentName: `Doc ${marker}`,
          input: {},
          counterpartySigner: {
            name: "Alex",
            email: `alex-${marker}@example.com`,
            title: "CEO",
          },
          countersignerId: countersigner.id,
          approvalRequired: true,
          testMode: true,
        },
        pdf: pdf(),
        fileName: "Prepared.pdf",
      },
      viewer,
    );
    await signing.decide(
      rejected.id,
      { approve: false, reason: "Wrong entity" },
      approver,
    );
    const mnda = randomUUID();
    await client`insert into commerce_mnda_requests (id, input, countersigner, owner_id, owner_name, state, template_hash, test_mode, completed_at)
      values (${mnda}, ${JSON.stringify({ company: `Signed NDA ${marker}`, effectiveDate: "2026-09-28" })}::jsonb, '{"name":"James Kurz"}'::jsonb, ${viewer.id}, 'Mine filter', 'completed', ${"a".repeat(64)}, true, now())`;
    const scope = { includeMndas: true, viewerId: viewer.id };
    const mine = await repo.list(
      query({ q: marker, mine: "1" }),
      "2026-10-04",
      scope,
    );
    expect(mine.total).toBe(3);
    expect(mine.rows.map((row) => row.source).sort()).toEqual([
      "mnda",
      "register",
      "template",
    ]);
    expect(
      (await repo.list(query({ q: marker }), "2026-10-04", scope)).total,
    ).toBe(4);
    expect(
      (
        await repo.exportRows(
          query({ q: marker, mine: "1" }),
          "2026-10-04",
          scope,
        )
      ).rows,
    ).toHaveLength(3);
    // The home page's own counts for the same reader open the same rows.
    const home = await countSalesHomeContracts(db, { viewerId: viewer.id });
    for (const [status, count] of [
      ["out_for_signature", home.outForSignature.mine],
      ["signing_attention", home.needsAttention.mine],
    ] as const) {
      expect(count).toBe(1);
      expect(
        (await repo.list(query({ status, mine: "1" }), "2026-10-04", scope))
          .total,
      ).toBe(count);
    }
  });

  it("lists contracts whose notice deadline passed before they renew", async () => {
    const marker = randomUUID();
    // Term ends 2026-10-31, notice by 2026-10-01: passed on 2026-10-04.
    const passed = contract(marker, {
      effectiveDate: "2025-11-01",
      noticePeriodDays: 30,
    });
    await repo.create(passed, actor);
    const rows = (await repo.noticesPassed("2026-10-04")).filter((r) =>
      r.counterpartyName.endsWith(marker),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: passed.id,
        noticeDeadline: "2026-10-01",
        renewalDate: "2026-11-01",
      }),
    ]);
    expect(
      (await repo.renewalsDue("2026-10-04", 90)).some(
        (r) => r.id === passed.id,
      ),
    ).toBe(false);
    expect((await repo.renewalSummary("2026-10-04")).passed).toBeGreaterThan(0);
  });

  it("flags an export that stops at the row limit", async () => {
    const marker = randomUUID();
    await client`
      insert into commerce_contracts (id, counterparty_name, contract_type, paper, status, owner_name, created_by_id, created_by_name)
      select gen_random_uuid(), ${`Bulk ${marker}`} || ' ' || n, 'other', 'ours', 'draft', 'R.W.', ${actor.id}, 'R.W.'
      from generate_series(1, 5001) n`;
    const full = await repo.exportRows(query({ q: marker }), "2026-10-04", all);
    expect(full.rows).toHaveLength(5000);
    expect(full.truncated).toBe(true);
    const one = await repo.exportRows(
      query({ q: `${marker} 4999` }),
      "2026-10-04",
      all,
    );
    expect(one).toMatchObject({ truncated: false });
  }, 60_000);
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
    const [located] = await client<{ key: string }[]>`
      select storage_key as key from commerce_contract_files where id = ${signed.id}`;
    const swapped = pdf("swapped");
    // A row whose bytes and own hash were both replaced still fails, because
    // the contract file keeps the hash recorded at upload.
    await client`update commerce_stored_documents set bytes = ${swapped}, size_bytes = ${swapped.length}, sha256 = encode(sha256(${swapped}), 'hex') where id = ${located?.key ?? ""}`;
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
  const prepare = async (approvalRequired: boolean, preparer = actor) => {
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
          documentName: `Fil One Engine Test Fixture - Bluefin ${marker}`,
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
      preparer,
    );
    return { input, result };
  };

  /** A commerce administrator (approval:self, staff:manage) in the Fil One
   * staff organization, enrolled in MFA. */
  const commerceAdmin = async (display: string) => {
    const id = randomUUID();
    await client`insert into commerce_users (id, workos_user_id, email, name, is_internal_staff, mfa_enrolled)
      values (${id}, ${`it_1457_${id}`}, ${`admin-${id}@fil-one.test`}, ${display}, true, true)`;
    await client`insert into memberships (organization_id, user_id, role)
      values ('30000000-0000-4000-8000-000000000008', ${id}, 'commerce_admin')`;
    return { kind: "user" as const, id, display };
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

  it("lets a holder of approval:self approve a contract they prepared, with a reason", async () => {
    const admin = await commerceAdmin("Contract Admin");
    const colleague = await commerceAdmin("Other Admin");
    const reason = "Two-person team, colleague travelling";
    const own = await prepare(true, admin);
    await expect(
      signing.decide(own.input.id, { approve: true }, admin),
    ).rejects.toThrow("CONTRACT_APPROVER_IS_PREPARER");
    await expect(
      signing.decide(
        own.input.id,
        { approve: true, selfApproval: { reason: "short" } },
        admin,
      ),
    ).rejects.toThrow("SELF_APPROVAL_REASON_REQUIRED");
    const approved = await signing.decide(
      own.input.id,
      { approve: true, selfApproval: { reason: `  ${reason} ` } },
      admin,
    );
    expect(approved).toMatchObject({
      approvalState: "approved",
      approverName: "Contract Admin",
    });
    const [row] = await client<
      { self_approved: boolean; self_approval_reason: string | null }[]
    >`select self_approved, self_approval_reason from commerce_contract_signing where contract_id = ${own.input.id}`;
    expect(row).toEqual({ self_approved: true, self_approval_reason: reason });
    const { activity } = await repo.get(own.input.id, "2026-10-04");
    expect(activity[0]).toMatchObject({
      eventType: "contract.self_approved",
      changes: { reason },
    });
    const audit = await client<
      { id: string; after: Record<string, unknown> }[]
    >`
      select id, after from audit_events
      where event_type = 'approval.self_approved'
        and after->>'subjectId' = ${own.input.id}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      control: "contract_approval",
      subjectType: "contract",
      decision: "approved",
      reason,
      approverId: admin.id,
    });
    const notices = await client<{ recipient_user_id: string }[]>`
      select recipient_user_id from staff_notices
      where audit_event_id = ${audit[0]?.id ?? ""}`;
    const recipients = notices.map((notice) => notice.recipient_user_id);
    expect(recipients).toContain(colleague.id);
    expect(recipients).not.toContain(admin.id);
  });

  it("refuses a self-approval from anyone without approval:self, or on someone else's contract", async () => {
    const admin = await commerceAdmin("Contract Admin");
    const selfApproval = { reason: "Approving my own draft today" };
    const unheld = await prepare(true);
    await expect(
      signing.decide(unheld.input.id, { approve: true, selfApproval }, actor),
    ).rejects.toThrow("SELF_APPROVAL_NOT_PERMITTED");
    await expect(
      signing.decide(unheld.input.id, { approve: true, selfApproval }, admin),
    ).rejects.toThrow("SELF_APPROVAL_NOT_OWN_REQUEST");
    await expect(
      client.begin(async (tx) => {
        await tx`set local role clockwork_service`;
        await tx`update commerce_contract_signing set approval_state = 'approved', approver_id = preparer_id, approver_name = 'x', decided_at = now(), self_approved = true, self_approval_reason = 'Approving my own draft today' where contract_id = ${unheld.input.id}`;
      }),
    ).rejects.toThrow("SELF_APPROVAL_NOT_PERMITTED");
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
    // A 200-character document name still yields a valid file name.
    const longName = contractPdfFileName("N".repeat(200), " (executed)");
    await signing.extendLease(input.id, lease.token);
    await expect(signing.extendLease(input.id, randomUUID())).rejects.toThrow(
      "CONTRACT_LEASE_LOST",
    );
    await signing.update(
      input.id,
      lease.token,
      { state: "completed" },
      { kind: "provider", id: "signwell" },
      { bytes: pdf("executed with audit pages"), fileName: longName },
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
    expect(executed?.fileName).toBe(longName);
    expect(detail.contract.executedAt).not.toBeNull();
    expect(
      (await repo.readFile(input.id, executed?.id ?? "")).bytes.toString(),
    ).toContain("audit pages");
  });

  it("records reminders and voids in the history and the audit log", async () => {
    const { input } = await prepare(false);
    const lease = await signing.claim(input.id);
    await signing.update(
      input.id,
      lease.token,
      { state: "sent", providerId: randomUUID() },
      actor,
    );
    const remindedAt = new Date("2026-10-09T12:00:00.000Z");
    const reminded = await signing.update(
      input.id,
      lease.token,
      { error: null, remindedAt },
      actor,
      undefined,
      { eventType: "contract.reminded", detail: { recipient: "counterparty" } },
    );
    expect(reminded).toMatchObject({
      state: "sent",
      remindedAt: remindedAt.toISOString(),
    });
    // Without a note or a state change, nothing is added to the history.
    await signing.update(input.id, lease.token, { error: null }, actor);
    await signing.update(
      input.id,
      lease.token,
      { state: "canceled", error: null },
      actor,
      undefined,
      { eventType: "contract.voided", detail: { reason: "Wrong entity" } },
    );
    await signing.release(input.id, lease.token);
    const detail = await repo.get(input.id, "2026-10-09");
    expect(detail.contract.status).toBe("draft");
    expect(detail.activity.slice(0, 3)).toMatchObject([
      {
        eventType: "contract.voided",
        changes: {
          status: { from: "out_for_signature", to: "draft" },
          reason: "Wrong entity",
        },
      },
      {
        eventType: "contract.reminded",
        changes: { recipient: "counterparty" },
      },
      { eventType: "contract.signing_sent" },
    ]);
    const audit = await client<{ event_type: string; after: unknown }[]>`
      select event_type, after from audit_events
      where aggregate_id = ${input.id}
        and event_type in ('contract.reminded', 'contract.voided')
      order by aggregate_version`;
    expect(audit).toMatchObject([
      {
        event_type: "contract.reminded",
        after: { recipient: "counterparty" },
      },
      { event_type: "contract.voided", after: { reason: "Wrong entity" } },
    ]);
  });

  it("keeps a signer correction with its before-image, and the cancel code (001459)", async () => {
    const { input, result } = await prepare(false);
    const original = result.record.counterpartySigner.email;
    const lease = await signing.claim(input.id);
    await signing.update(
      input.id,
      lease.token,
      { state: "sent", providerId: randomUUID() },
      actor,
    );
    const note = (eventType: string) => ({
      eventType,
      before: { signerEmail: original },
      detail: { signerEmail: "right@example.com" },
    });
    await expect(
      signing.update(
        input.id,
        lease.token,
        { pendingSignerEmail: "right@example.com", error: null },
        actor,
        undefined,
        note("contract.signer_correction_requested"),
      ),
    ).resolves.toMatchObject({ pendingSignerEmail: "right@example.com" });
    await expect(
      signing.update(
        input.id,
        lease.token,
        { correctedSignerEmail: "right@example.com", pendingSignerEmail: null },
        actor,
        undefined,
        note("contract.signer_corrected"),
      ),
    ).resolves.toMatchObject({
      correctedSignerEmail: "right@example.com",
      pendingSignerEmail: null,
    });
    // The database writes a cancel code only with the cancellation.
    await expect(
      signing.update(
        input.id,
        lease.token,
        { cancelCode: "signer_change" },
        actor,
      ),
    ).rejects.toThrow();
    await expect(
      signing.update(
        input.id,
        lease.token,
        { state: "canceled", error: null, cancelCode: "signer_change" },
        actor,
        undefined,
        {
          eventType: "contract.voided",
          detail: { cancelCode: "signer_change" },
        },
      ),
    ).resolves.toMatchObject({
      state: "canceled",
      cancelCode: "signer_change",
      cancelReason: null,
    });
    await signing.release(input.id, lease.token);
    const audit = await client<
      { event_type: string; before: unknown; after: unknown }[]
    >`
      select event_type, before, after from audit_events
      where aggregate_id = ${input.id}
        and event_type like 'contract.signer_%'
      order by aggregate_version`;
    expect(audit).toMatchObject([
      {
        event_type: "contract.signer_correction_requested",
        before: { signerEmail: original },
        after: { signerEmail: "right@example.com" },
      },
      {
        event_type: "contract.signer_corrected",
        before: { signerEmail: original },
        after: { signerEmail: "right@example.com" },
      },
    ]);
  });
});

describe("counterparty paper for the Fil One signature (001460)", () => {
  /** A recorded contract on their paper with their signed PDF attached. */
  const recorded = async (patch: Partial<ContractInput> = {}) => {
    const input = contract(randomUUID(), {
      status: "in_negotiation",
      ...patch,
    });
    await repo.create(input, actor);
    const file = await repo.addFile(
      input.id,
      { kind: "counterparty_draft", fileName: "Their paper.pdf", bytes: pdf() },
      actor,
    );
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    const prepared = {
      contractId: input.id,
      source: { fileId: file.id, sha256: file.sha256 },
      documentName: `Fil One countersignature - ${input.counterpartyName}`,
      signaturePageVersion: "interim-2026-10-10",
      counterpartySigner: null,
      countersignerId: countersigner.id,
      testMode: true,
      pdf: pdf("their paper with the Fil One page"),
      fileName: "Countersignature.pdf",
    };
    return { input, file, prepared };
  };

  it("prepares their PDF pinned by its hash, needing approval, once per contract", async () => {
    const { input, file, prepared } = await recorded();
    const { record, duplicate } = await signing.prepareCounterpartyPaper(
      prepared,
      actor,
    );
    expect(duplicate).toBe(false);
    expect(record).toMatchObject({
      documentType: "counterparty_paper",
      counterpartySigns: false,
      templateId: "counterparty-paper",
      templateHash: file.sha256,
      input: { source_file_id: file.id },
      approvalRequired: true,
      approvalState: "pending",
      state: "draft",
    });
    // A retry is the same request; another choice of signers is not.
    await expect(
      signing.prepareCounterpartyPaper(prepared, actor),
    ).resolves.toMatchObject({ duplicate: true });
    await expect(
      signing.prepareCounterpartyPaper(
        {
          ...prepared,
          counterpartySigner: {
            name: "Alex",
            email: "alex@example.com",
            title: "CEO",
          },
        },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_SIGNING_EXISTS");
    const detail = await repo.get(input.id, "2026-10-10");
    expect(detail.files.map((f) => f.kind).sort()).toEqual([
      "counterparty_draft",
      "generated",
    ]);
    expect(detail.activity[0]).toMatchObject({
      eventType: "contract.prepared",
      changes: { documentType: "counterparty_paper", sha256: file.sha256 },
    });
    // Their PDF stays while it is the paper being signed.
    await expect(repo.removeFile(input.id, file.id, actor)).rejects.toThrow(
      "CONTRACT_FILE_SENT_FOR_SIGNATURE",
    );
    // While it is out for signature, its status follows SignWell.
    const lease = await signing.claim(input.id);
    await signing.decide(input.id, { approve: true }, approver);
    await signing.update(
      input.id,
      lease.token,
      { state: "sent", providerId: randomUUID() },
      actor,
    );
    await signing.release(input.id, lease.token);
    const sent = await repo.get(input.id, "2026-10-10");
    expect(sent.contract.status).toBe("out_for_signature");
    await expect(
      repo.update(
        input.id,
        sent.contract.version,
        { ...input, status: "executed" },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_STATUS_FOLLOWS_SIGNING");
  });

  it("treats a retry as the same request only for the same signers", async () => {
    const { prepared: base } = await recorded();
    const prepared = {
      ...base,
      counterpartySigner: {
        name: "Alex Example",
        email: "alex@example.com",
        title: "CEO",
      },
    };
    await signing.prepareCounterpartyPaper(prepared, actor);
    await expect(
      signing.prepareCounterpartyPaper(prepared, actor),
    ).resolves.toMatchObject({ duplicate: true });
    for (const changed of [
      {
        ...prepared,
        counterpartySigner: { ...prepared.counterpartySigner, name: "Sam" },
      },
      {
        ...prepared,
        counterpartySigner: {
          ...prepared.counterpartySigner,
          email: "sam@example.com",
        },
      },
      { ...prepared, countersignerId: randomUUID() },
    ])
      await expect(
        signing.prepareCounterpartyPaper(changed, actor),
      ).rejects.toThrow("CONTRACT_SIGNING_EXISTS");
  });

  it("does not return or replace a closed request when the same paper is sent again", async () => {
    const { input, prepared } = await recorded();
    await signing.prepareCounterpartyPaper(prepared, actor);
    const lease = await signing.claim(input.id);
    await signing.update(
      input.id,
      lease.token,
      { state: "canceled", error: null, cancelCode: "discarded" },
      actor,
    );
    await signing.release(input.id, lease.token);
    await expect(
      signing.prepareCounterpartyPaper(prepared, actor),
    ).rejects.toThrow("CONTRACT_SIGNING_EXISTS");
  });

  it("refuses our paper, an executed contract and a PDF it was not read from", async () => {
    const ours = await recorded({ paper: "ours" });
    await expect(
      signing.prepareCounterpartyPaper(ours.prepared, actor),
    ).rejects.toThrow("CONTRACT_PAPER_NOT_SENDABLE");
    const executed = await recorded({ status: "executed" });
    await expect(
      signing.prepareCounterpartyPaper(executed.prepared, actor),
    ).rejects.toThrow("CONTRACT_PAPER_NOT_SENDABLE");
    const changed = await recorded();
    await expect(
      signing.prepareCounterpartyPaper(
        {
          ...changed.prepared,
          source: { fileId: changed.file.id, sha256: "a".repeat(64) },
        },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_FILE_NOT_FOUND");
    // Nothing was kept from a refused preparation.
    expect((await repo.get(changed.input.id, "2026-10-10")).signing).toBeNull();
  });
});

describe("document lifetime", () => {
  it("refuses to delete stored bytes that a record still references", async () => {
    const marker = randomUUID();
    const input = contract(marker, { status: "in_negotiation" });
    await repo.create(input, actor);
    const file = await repo.addFile(
      input.id,
      { kind: "main", fileName: "Draft.pdf", bytes: pdf("kept") },
      actor,
    );
    const [located] = await client<{ key: string }[]>`
      select storage_key as key from commerce_contract_files where id = ${file.id}`;
    await expect(store.delete(located?.key ?? "")).rejects.toThrow();
    expect((await repo.readFile(input.id, file.id)).bytes.toString()).toContain(
      "kept",
    );
  });

  it("keeps the PDF when a commit succeeded but its acknowledgement was lost", async () => {
    const marker = randomUUID();
    const input = contract(marker, { status: "in_negotiation" });
    await repo.create(input, actor);
    // The transaction commits, then the caller sees a failure, as when the
    // connection drops before the commit is acknowledged. The repository's
    // cleanup then tries to delete the bytes it just stored.
    const flaky = new ContractRepository(db, stores);
    const internal = flaky as unknown as {
      tx: <T>(fn: (tx: never) => Promise<T>) => Promise<T>;
    };
    const commit = internal.tx.bind(flaky);
    internal.tx = async (fn) => {
      await commit(fn);
      throw new Error("connection reset");
    };
    await expect(
      flaky.addFile(
        input.id,
        { kind: "main", fileName: "Signed.pdf", bytes: pdf("survives") },
        actor,
      ),
    ).rejects.toThrow("connection reset");
    const { files } = await repo.get(input.id, "2026-10-04");
    expect(files).toHaveLength(1);
    expect(
      (await repo.readFile(input.id, files[0]?.id ?? "")).bytes.toString(),
    ).toContain("survives");
  });

  it("removes the second PDF when the same preparation is submitted twice", async () => {
    const marker = randomUUID();
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    const prepared = {
      contract: contract(marker, {
        paper: "ours",
        status: "draft",
        contractType: "other",
      }),
      signing: {
        templateId: "test-fixture",
        templateVersion: "1",
        templateHash: "b".repeat(64),
        documentName: `Doc ${marker}`,
        input: { a: "1" },
        counterpartySigner: {
          name: "Alex",
          email: `alex-${marker}@example.com`,
          title: "CEO",
        },
        countersignerId: countersigner.id,
        approvalRequired: false,
        testMode: true,
      },
      fileName: "Prepared.pdf",
    };
    const count = async () =>
      Number(
        (
          await client<{ n: number }[]>`
            select count(*)::integer as n from commerce_stored_documents
            where bytes = ${pdf(marker)}`
        )[0]?.n,
      );
    await signing.prepare({ ...prepared, pdf: pdf(marker) }, actor);
    expect(await count()).toBe(1);
    const again = await signing.prepare(
      { ...prepared, pdf: pdf(marker) },
      actor,
    );
    expect(again.duplicate).toBe(true);
    expect(await count()).toBe(1);
  });

  it("treats a retried preparation as the same request whatever order Postgres keeps its values in", async () => {
    const marker = randomUUID();
    const [countersigner] = await signing.countersigners();
    if (!countersigner) throw new Error("seed countersigner missing");
    // jsonb stores keys shorter-first, so it returns these in another order
    // than they were submitted.
    const input = {
      zeta_reference: "REF-7",
      a: "beta",
      nested_terms: JSON.stringify({ z: 1, a: [2, 1] }),
    };
    const prepared = {
      contract: contract(marker, {
        paper: "ours",
        status: "draft",
        contractType: "other",
      }),
      signing: {
        templateId: "test-fixture",
        templateVersion: "1",
        templateHash: "b".repeat(64),
        documentName: `Doc ${marker}`,
        input,
        counterpartySigner: {
          name: "Alex",
          email: `alex-${marker}@example.com`,
          title: "CEO",
        },
        countersignerId: countersigner.id,
        approvalRequired: false,
        testMode: true,
      },
      fileName: "Prepared.pdf",
    };
    const first = await signing.prepare(
      { ...prepared, pdf: pdf(marker) },
      actor,
    );
    expect(Object.keys(first.record.input)).not.toEqual(Object.keys(input));
    await expect(
      signing.prepare({ ...prepared, pdf: pdf(marker) }, actor),
    ).resolves.toMatchObject({ duplicate: true });
    // A different value is still a different request.
    await expect(
      signing.prepare(
        {
          ...prepared,
          signing: { ...prepared.signing, input: { ...input, a: "alpha" } },
          pdf: pdf(marker),
        },
        actor,
      ),
    ).rejects.toThrow("CONTRACT_IDEMPOTENCY_CONFLICT");
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

describe("access audit", () => {
  it("audits file downloads, register exports and library downloads without touching record versions", async () => {
    const reader = { kind: "user" as const, id: randomUUID(), display: "R" };
    const input = contract(randomUUID());
    await repo.create(input, actor);
    const fileId = randomUUID();
    await repo.recordAccess(reader, {
      kind: "file",
      contractId: input.id,
      fileId,
      fileKind: "main",
    });
    await repo.recordAccess(reader, {
      kind: "export",
      filters: query({ status: "executed" }),
      rows: 4,
      mndaRows: 1,
      truncated: false,
    });
    const itemId = randomUUID();
    await library.recordDownload(reader, itemId);
    const events = await client<{ event_type: string; after: unknown }[]>`
      select event_type, after from audit_events
      where actor->>'id' = ${reader.id} order by event_type`;
    expect(events).toHaveLength(3);
    expect(events).toMatchObject([
      {
        event_type: "contract.file_downloaded",
        after: { contractId: input.id, fileId, kind: "main" },
      },
      {
        event_type: "contract.register_exported",
        after: {
          rows: 4,
          mndaRows: 1,
          truncated: false,
          filters: { status: "executed" },
        },
      },
      { event_type: "sales_collateral.downloaded", after: { itemId } },
    ]);
    expect((await repo.get(input.id, "2026-10-09")).contract.version).toBe(1);
  });
});
