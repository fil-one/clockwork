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
    supersedes,
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
  expect((await repo.get(first.id)).cancelReason).toBe("superseded");
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
    (await repo.exportRows({ q: tag, mine: true }, mine)).map((r) => r.id),
  ).toEqual([replacement.id]);

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
    { state: "canceled", cancelReason: "Wrong entity" },
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
