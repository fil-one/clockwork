import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import { createRuntimeDatabase } from "../client";
import { MndaRepository } from "./mnda";
const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const repo = new MndaRepository(db);
const actor = { kind: "user" as const, id: randomUUID() };
afterAll(() => client.end());

async function newSigner() {
  const signer = {
    ...fixtureSigner,
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    isDefault: false,
  };
  await repo.saveSigner(signer, actor);
  return signer;
}
async function noticeEmail() {
  return (await repo.settings()).noticeEmail;
}
function owner(id = actor.id) {
  return { id, name: "Revenue operator", email: "Seller@Example.com" };
}
async function draft(
  signer: Awaited<ReturnType<typeof newSigner>>,
  patch: Partial<typeof fixtureInput> = {},
  ownerId = actor.id,
  supersedes?: string,
  manageAll = false,
) {
  return repo.create(
    {
      ...fixtureInput,
      id: randomUUID(),
      countersignerId: signer.id,
      ...patch,
    },
    owner(ownerId),
    "a".repeat(64),
    true,
    Buffer.from("%PDF-original"),
    signer,
    await noticeEmail(),
    { ...(supersedes ? { supersedes: [supersedes] } : {}), manageAll },
  );
}

it("serializes duplicate draft creation, preserves signer snapshots and locks concurrent sends", async () => {
  const signer = await newSigner();
  const input = {
    ...fixtureInput,
    id: randomUUID(),
    countersignerId: signer.id,
  };
  const notice = await noticeEmail();
  const create = () =>
    repo.create(
      input,
      owner(),
      "a".repeat(64),
      true,
      Buffer.from("%PDF-original"),
      signer,
      notice,
    );
  const [a, b] = await Promise.all([create(), create()]);
  expect(a.id).toBe(b.id);
  expect(a).not.toHaveProperty("leaseToken");
  expect(a).toMatchObject({
    noticeEmail: notice,
    ownerEmail: "seller@example.com",
    sentAt: null,
  });
  await repo.saveSigner({ ...signer, name: "Updated signer" }, actor);
  expect((await repo.get(a.id)).countersigner.name).toBe(signer.name);
  const lease = await repo.claim(a.id);
  await expect(repo.claim(a.id)).rejects.toThrow("BUSY");
  await expect(
    repo.update(a.id, randomUUID(), { state: "sent" }, actor),
  ).rejects.toThrow("LEASE_LOST");
  await expect(
    repo.update(a.id, lease.token, { state: "completed" }, actor),
  ).rejects.toMatchObject({
    cause: { message: "MNDA completion requires archived evidence" },
  });
  expect((await repo.get(a.id)).state).toBe("draft");
  await repo.update(
    a.id,
    lease.token,
    { state: "completed" },
    actor,
    Buffer.from("%PDF-executed-with-audit"),
  );
  expect((await repo.readArtifact(a.id, "executed")).toString()).toContain(
    "with-audit",
  );
  expect(
    (await repo.update(a.id, lease.token, { state: "sent" }, actor)).state,
  ).toBe("completed");
  await repo.release(a.id, lease.token);
  const audit = await client<
    { event_type: string }[]
  >`select event_type from audit_events where aggregate_id=${a.id} order by occurred_at`;
  expect(audit.map((r) => r.event_type)).toEqual([
    "mnda.drafted",
    "mnda.completed",
  ]);
  await expect(
    client.begin(async (tx) => {
      await tx`set local role clockwork_runtime`;
      await tx`select * from commerce_mnda_requests`;
    }),
  ).rejects.toThrow("permission denied");
  await expect(
    client.begin(async (tx) => {
      await tx`set local role clockwork_runtime`;
      await tx`select * from commerce_mnda_settings`;
    }),
  ).rejects.toThrow("permission denied");
  await expect(
    client.begin(async (tx) => {
      await tx`set local role clockwork_service`;
      await tx`delete from commerce_mnda_artifacts where request_id=${a.id}`;
    }),
  ).rejects.toThrow("permission denied");
}, 30000);

it("renews a held lease and refuses one that was lost or released", async () => {
  const record = await draft(await newSigner());
  const leaseUntil = async () => {
    const [row] = await client<
      { lease_until: string }[]
    >`select lease_until from commerce_mnda_requests where id=${record.id}`;
    return Date.parse(row?.lease_until ?? "");
  };
  const lease = await repo.claim(record.id);
  const claimed = await leaseUntil();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await repo.extendLease(record.id, lease.token);
  expect(await leaseUntil()).toBeGreaterThan(claimed);
  await expect(repo.extendLease(record.id, randomUUID())).rejects.toThrow(
    "MNDA_LEASE_LOST",
  );
  await repo.release(record.id, lease.token);
  await expect(repo.extendLease(record.id, lease.token)).rejects.toThrow(
    "MNDA_LEASE_LOST",
  );
});
it("versions and audits the notice email, snapshots it on drafts and refuses stale saves", async () => {
  const before = await repo.settings();
  const changed = `notices-${randomUUID().slice(0, 8)}@fil.one`;
  await expect(
    repo.saveSettings({ noticeEmail: changed }, before.version + 5, actor),
  ).rejects.toThrow("SETTINGS_CONFLICT");
  await repo.saveSettings(
    { noticeEmail: changed.toUpperCase() },
    before.version,
    actor,
  );
  const after = await repo.settings();
  expect(after).toMatchObject({
    noticeEmail: changed,
    version: before.version + 1,
    updatedBy: actor.id,
  });
  const [event] = await client<
    { before: unknown; after: unknown }[]
  >`select before, after from audit_events where event_type='mnda.settings_changed' and aggregate_version=${after.version} order by occurred_at desc limit 1`;
  expect(event).toMatchObject({
    before: { noticeEmail: before.noticeEmail },
    after: { noticeEmail: changed },
  });
  const signer = await newSigner();
  const record = await draft(signer);
  expect(record.noticeEmail).toBe(changed);
  // A draft rendered with an older notice email is refused, not stored.
  await expect(
    repo.create(
      { ...fixtureInput, id: randomUUID(), countersignerId: signer.id },
      owner(),
      "a".repeat(64),
      true,
      Buffer.from("%PDF-original"),
      signer,
      before.noticeEmail,
    ),
  ).rejects.toThrow("SETTINGS_CHANGED");
  await expect(
    client`update commerce_mnda_requests set notice_email='other@fil.one' where id=${record.id}`,
  ).rejects.toThrow("immutable");
  await repo.saveSettings(
    { noticeEmail: before.noticeEmail },
    after.version,
    actor,
  );
}, 30000);

it("filters, searches and pages the register, hiding replaced drafts by default", async () => {
  const signer = await newSigner();
  const tag = randomUUID().slice(0, 8);
  const mine = randomUUID();
  const other = randomUUID();
  const first = await draft(signer, { company: `Zephyr ${tag} Inc.` }, mine);
  const replacement = await draft(
    signer,
    { company: `Zephyr ${tag} Inc.`, signerName: `Signer ${tag}` },
    mine,
    first.id,
  );
  expect((await repo.get(first.id)).state).toBe("canceled");
  expect((await repo.get(first.id)).cancelCode).toBe("superseded");
  for (let i = 0; i < 3; i++)
    await draft(signer, { company: `Quasar ${tag} ${i} LLC` }, other);
  const sent = await draft(signer, { company: `Orbit ${tag} Ltd` }, other);
  const lease = await repo.claim(sent.id);
  const delivered = await repo.update(
    sent.id,
    lease.token,
    { state: "sent", providerId: randomUUID() },
    actor,
  );
  await repo.release(sent.id, lease.token);
  expect(delivered.sentAt).not.toBeNull();

  const search = await repo.list({ q: tag }, mine);
  expect(search.total).toBe(5);
  expect(search.records.map((r) => r.id)).not.toContain(first.id);
  expect((await repo.list({ q: tag, mine: true }, mine)).records).toEqual([
    expect.objectContaining({ id: replacement.id }),
  ]);
  expect(
    (await repo.list({ q: `signer ${tag}` }, mine)).records.map((r) => r.id),
  ).toEqual([replacement.id]);
  expect(
    (await repo.list({ q: tag, status: ["sent", "viewed"] }, mine)).records,
  ).toEqual([expect.objectContaining({ id: sent.id })]);
  expect(
    (await repo.list({ q: tag, status: ["canceled"] }, mine)).records.map(
      (r) => r.id,
    ),
  ).toEqual([first.id]);
  expect((await repo.list({ q: "100%_" }, mine)).total).toBe(0);

  const pageOne = await repo.list({ q: tag, pageSize: 25, page: 1 }, mine);
  expect(pageOne.records).toHaveLength(5);
  const pageTwo = await repo.list({ q: tag, pageSize: 25, page: 2 }, mine);
  expect(pageTwo).toMatchObject({ total: 5, records: [] });
  expect(
    (await repo.exportRows({ q: tag, mine: true }, mine)).records.map(
      (r) => r.id,
    ),
  ).toEqual([replacement.id]);
  expect((await repo.exportRows({ q: tag }, mine)).truncated).toBe(false);

  const counts = await repo.countByState(mine);
  expect(counts.mine.draft).toBe(1);
  expect(counts.mine.canceled).toBe(1);
  expect(counts.byState.sent).toBeGreaterThanOrEqual(1);
}, 30000);

it("pages past the old 200-row cap", async () => {
  const signer = await newSigner();
  const tag = randomUUID().slice(0, 8);
  const ownerId = randomUUID();
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      draft(signer, { company: `Paging ${tag} ${i}` }, ownerId),
    ),
  );
  const first = await repo.list({ q: tag, pageSize: 25 }, ownerId);
  const second = await repo.list({ q: tag, pageSize: 25, page: 2 }, ownerId);
  expect(first.total).toBe(30);
  expect(first.records).toHaveLength(25);
  expect(second.records).toHaveLength(5);
  expect(
    new Set([...first.records, ...second.records].map((r) => r.id)).size,
  ).toBe(30);
}, 60000);

it("warns about existing MNDAs with the same normalized company, ignoring canceled ones", async () => {
  const signer = await newSigner();
  const tag = randomUUID().slice(0, 8);
  const existing = await draft(signer, { company: `Bluefin ${tag}, Inc.` });
  const canceled = await draft(signer, { company: `BLUEFIN ${tag} LLC` });
  const lease = await repo.claim(canceled.id);
  await repo.update(canceled.id, lease.token, { state: "canceled" }, actor);
  await repo.release(canceled.id, lease.token);
  const matches = await repo.duplicates(`bluefin ${tag} inc`);
  expect(matches).toEqual([
    expect.objectContaining({ id: existing.id, state: "draft" }),
  ]);
  expect(await repo.duplicates(`Bluefin ${tag}`, existing.id)).toEqual([]);
  expect(await repo.duplicates(`Bluefin ${tag} Labs`)).toEqual([]);
}, 30000);

it("finds register contracts for the same company with the MNDA normalizer, leaving out voided drafts", async () => {
  const tag = randomUUID().slice(0, 8);
  const contract = async (
    name: string,
    contractType: string,
    status: string,
    effectiveDate: string | null = null,
  ) => {
    const id = randomUUID();
    await client`insert into commerce_contracts (id, counterparty_name,
      contract_type, paper, status, effective_date, owner_name, created_by_id,
      created_by_name) values (${id}, ${name}, ${contractType}, 'theirs',
      ${status}, ${effectiveDate}, 'R.W. Holleman', ${actor.id}, 'R.W. Holleman')`;
    return id;
  };
  const nda = await contract(
    `ACME ${tag}, Inc.`,
    "mnda",
    "executed",
    "2026-03-01",
  );
  const msa = await contract(
    `Acme ${tag} Corporation`,
    "customer_msa",
    "terminated",
  );
  const draftOnly = await contract(`acme ${tag} llc`, "nda_one_way", "draft");
  const voided = await contract(`Acme ${tag}`, "nda_one_way", "draft");
  await contract(`Acme ${tag} Labs`, "mnda", "executed");
  await client`insert into commerce_contract_signing (contract_id, template_id,
    template_version, template_hash, document_name, input, counterparty_signer,
    countersigner, preparer_id, preparer_name, approval_required,
    approval_state, test_mode) values (${voided}, 'nda-one-way', '1',
    ${"c".repeat(64)}, 'NDA', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    ${actor.id}, 'R.W. Holleman', false, 'not_required', true)`;
  await client`update commerce_contract_signing set state = 'canceled' where contract_id = ${voided}`;
  const matches = await repo.contractDuplicates(`Acme ${tag} Corp`);
  expect(matches.map((m) => m.id).sort()).toEqual([nda, msa, draftOnly].sort());
  expect(matches.find((m) => m.id === nda)).toEqual({
    id: nda,
    counterpartyName: `ACME ${tag}, Inc.`,
    contractType: "mnda",
    status: "executed",
    effectiveDate: "2026-03-01",
    ownerName: "R.W. Holleman",
  });
  expect(await repo.contractDuplicates(" , ")).toEqual([]);
}, 30000);

it("records corrections and void reasons, and freezes them once closed", async () => {
  const signer = await newSigner();
  const record = await draft(signer);
  const lease = await repo.claim(record.id);
  await repo.update(
    record.id,
    lease.token,
    { state: "sent", providerId: randomUUID() },
    actor,
  );
  const corrected = await repo.update(
    record.id,
    lease.token,
    { correctedSignerEmail: "right@example.com" },
    actor,
    undefined,
    {
      eventType: "mnda.signer_corrected",
      before: { signerEmail: record.input.signerEmail },
      detail: { signerEmail: "right@example.com" },
    },
  );
  expect(corrected.correctedSignerEmail).toBe("right@example.com");
  const voided = await repo.update(
    record.id,
    lease.token,
    { state: "canceled", cancelCode: "voided", cancelReason: "Wrong entity" },
    actor,
    undefined,
    { eventType: "mnda.voided", detail: { reason: "Wrong entity" } },
  );
  await repo.release(record.id, lease.token);
  expect(voided).toMatchObject({
    state: "canceled",
    cancelReason: "Wrong entity",
  });
  const audit = await client<
    { event_type: string; after: { reason?: string } }[]
  >`select event_type, after from audit_events where aggregate_id=${record.id} order by aggregate_version`;
  expect(audit.map((r) => r.event_type)).toEqual([
    "mnda.drafted",
    "mnda.sent",
    "mnda.signer_corrected",
    "mnda.voided",
  ]);
  expect(audit.at(-1)?.after.reason).toBe("Wrong entity");
  await expect(
    client`update commerce_mnda_requests set cancel_reason='edited' where id=${record.id}`,
  ).rejects.toThrow("immutable");
}, 30000);

it("replaces only the preparer's own drafts unless a signatory manager edits", async () => {
  const signer = await newSigner();
  const alice = randomUUID();
  const bob = randomUUID();
  const draftA = await draft(signer, {}, alice);
  await expect(draft(signer, {}, bob, draftA.id)).rejects.toThrow("NOT_OWNER");
  expect((await repo.get(draftA.id)).state).toBe("draft");
  const byAdmin = await draft(signer, {}, bob, draftA.id, true);
  expect((await repo.get(draftA.id)).cancelCode).toBe("superseded");
  expect(byAdmin.state).toBe("draft");
}, 30000);

it("normalizes legal names in the database for duplicate lookups", async () => {
  const rows = await client<{ name: string; key: string }[]>`
    select name, public.commerce_mnda_normalize_company(name) as key
    from unnest(${["Acme, Inc.", "ACME Inc", "Acme L.L.C.", "Société Générale SA", "Inc", "Acme Labs"]}::text[]) as name`;
  expect(Object.fromEntries(rows.map((r) => [r.name, r.key]))).toEqual({
    "Acme, Inc.": "acme",
    "ACME Inc": "acme",
    "Acme L.L.C.": "acme",
    "Société Générale SA": "societe generale",
    Inc: "inc",
    "Acme Labs": "acme labs",
  });
  const signer = await newSigner();
  const tag = randomUUID().slice(0, 8);
  const record = await draft(signer, { company: `Ünïcode ${tag} GmbH` });
  const [stored] = await client<{ normalized_company: string }[]>`
    select normalized_company from commerce_mnda_requests where id=${record.id}`;
  expect(stored?.normalized_company).toBe(`unicode ${tag}`);
  expect(
    (await repo.duplicates(`UNICODE ${tag}, gmbh`)).map((m) => m.id),
  ).toEqual([record.id]);
}, 30000);

it("keeps what the partner entered with completion, finds it by search and duplicate check, and never changes it", async () => {
  const signer = await newSigner();
  const tag = randomUUID().slice(0, 8);
  // A partner-completes draft: the company field is an internal reference.
  const record = await draft(signer, {
    detailsMode: "recipient",
    company: `Ref ${tag}`,
  });
  expect(record.partnerDetails).toBeNull();
  const lease = await repo.claim(record.id);
  await repo.update(
    record.id,
    lease.token,
    { state: "sent", providerId: randomUUID() },
    actor,
  );
  await expect(
    repo.update(
      record.id,
      lease.token,
      { partnerDetails: { entity: "Delaware corporation" } },
      actor,
    ),
  ).rejects.toMatchObject({
    cause: {
      message: "MNDA partner details are recorded only with completion",
    },
  });
  const details = {
    company_sign: `Harbor ${tag} Holdings, LLC`,
    entity: `Delaware ${tag} limited liability company`,
    signer_name: `Robin ${tag}`,
  };
  const completed = await repo.update(
    record.id,
    lease.token,
    { state: "completed", partnerDetails: details },
    actor,
    Buffer.from("%PDF-executed"),
    {
      followUp: {
        eventType: "mnda.fields_unreported",
        detail: { fields: ["signer_title"] },
      },
    },
  );
  await repo.release(record.id, lease.token);
  expect(completed).toMatchObject({
    state: "completed",
    partnerDetails: details,
    version: 4,
  });
  expect((await repo.get(record.id)).partnerDetails).toEqual(details);
  const audit = await client<
    { event_type: string; aggregate_version: number; after: unknown }[]
  >`select event_type, aggregate_version, after from audit_events
    where aggregate_id=${record.id} order by aggregate_version`;
  expect(audit.map((r) => [r.event_type, r.aggregate_version])).toEqual([
    ["mnda.drafted", 1],
    ["mnda.sent", 2],
    ["mnda.completed", 3],
    ["mnda.fields_unreported", 4],
  ]);
  expect(audit[3]?.after).toMatchObject({
    state: "completed",
    fields: ["signer_title"],
  });

  for (const q of [`harbor ${tag} holdings`, `Delaware ${tag}`, `robin ${tag}`])
    expect((await repo.list({ q }, actor.id)).records.map((r) => r.id)).toEqual(
      [record.id],
    );
  expect(
    (await repo.exportRows({ q: `Harbor ${tag}` }, actor.id)).records,
  ).toEqual([expect.objectContaining({ id: record.id })]);
  expect(await repo.duplicates(`HARBOR ${tag} HOLDINGS LLC`)).toEqual([
    expect.objectContaining({
      id: record.id,
      company: `Harbor ${tag} Holdings, LLC`,
    }),
  ]);
  expect(
    (await repo.duplicates(`Ref ${tag}`)).map((m) => [m.id, m.company]),
  ).toEqual([[record.id, `Harbor ${tag} Holdings, LLC`]]);

  await expect(
    client`update commerce_mnda_requests set partner_details = '{}'::jsonb where id=${record.id}`,
  ).rejects.toThrow("MNDA partner details are recorded only with completion");
  const again = await repo.claim(record.id);
  expect(
    (
      await repo.update(
        record.id,
        again.token,
        { partnerDetails: { company_sign: "Other Inc." } },
        actor,
      )
    ).partnerDetails,
  ).toEqual(details);
  await repo.release(record.id, again.token);
}, 30000);

it("audits PDF downloads and register exports without touching the request's versions", async () => {
  const signer = await newSigner();
  const record = await draft(signer);
  await repo.recordAccess(actor, {
    kind: "pdf",
    requestId: record.id,
    artifact: "original",
  });
  await repo.recordAccess(actor, {
    kind: "pdf",
    requestId: record.id,
    artifact: "original",
  });
  await repo.recordAccess(actor, {
    kind: "export",
    filters: { status: ["sent"], mine: true, q: "", page: 1, pageSize: 25 },
    rows: 3,
    truncated: false,
  });
  const events = await client<{ event_type: string; after: unknown }[]>`
    select event_type, after from audit_events
    where actor->>'id' = ${actor.id}
      and event_type in ('mnda.pdf_downloaded', 'mnda.register_exported')
      and (after->>'mndaId' = ${record.id} or event_type = 'mnda.register_exported')`;
  expect(
    events.filter((e) => e.event_type === "mnda.pdf_downloaded"),
  ).toHaveLength(2);
  expect(
    events.find((e) => e.event_type === "mnda.register_exported")?.after,
  ).toMatchObject({ rows: 3, truncated: false, filters: { status: ["sent"] } });
  expect((await repo.get(record.id)).version).toBe(record.version);
}, 30000);
