import { randomUUID } from "node:crypto";
import { afterAll, assert, expect, it } from "vitest";
import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import type { SigningJourneySnapshot } from "@clockwork/contracts";
import { createRuntimeDatabase } from "../client";
import { MndaRepository } from "./mnda";
import { SigningJourneyRepository } from "./signing-journey";
const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const store = new SigningJourneyRepository(db),
  mndas = new MndaRepository(db);
const createdRequests: string[] = [];
afterAll(() => client.end());
async function snapshot(): Promise<SigningJourneySnapshot> {
  const actor = { kind: "user" as const, id: randomUUID() },
    signer = {
      ...fixtureSigner,
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      isDefault: false,
    };
  await mndas.saveSigner(signer, actor);
  const r = await mndas.create(
    { ...fixtureInput, id: randomUUID(), countersignerId: signer.id },
    { id: actor.id, name: "Owner", email: "owner@example.test" },
    "a".repeat(64),
    true,
    Buffer.from("%PDF-source"),
    signer,
    (await mndas.settings()).noticeEmail,
  );
  createdRequests.push(r.id);
  return {
    kind: "mnda",
    requestId: r.id,
    sourceVersion: r.version,
    providerId: randomUUID(),
    title: "NDA",
    testMode: true,
    state: "sent",
    nextSlot: "counterparty",
    recipients: [
      {
        slot: "counterparty",
        email: "alex@example.test",
        name: "Alex",
        signed: false,
      },
      {
        slot: "fil-one",
        email: signer.email,
        name: signer.name,
        signed: false,
      },
    ],
  };
}
it("deduplicates concurrent events, fences old source versions, rotates corrected capabilities and revokes removed parties", async () => {
  const s = await snapshot();
  await Promise.all([store.synchronize(s), store.synchronize(s)]);
  const rows = await client<
    { id: string; slot: string; nonce: string }[]
  >`select * from commerce_signing_recipients where request_id = ${s.requestId}`;
  expect(rows).toHaveLength(2);
  const first = rows.find((r) => r.slot === "counterparty");
  assert(first);
  expect(
    await client`select id from commerce_signing_mail where recipient_id = ${first.id}`,
  ).toHaveLength(1);
  await expect(
    store.synchronize({ ...s, sourceVersion: s.sourceVersion - 1 }),
  ).rejects.toThrow("SOURCE_CHANGED");
  assert(s.recipients[0]);
  const second = rows.find((r) => r.slot === "fil-one");
  assert(second);
  await store.synchronize({
    ...s,
    recipients: [{ ...s.recipients[0], email: "corrected@example.test" }],
  });
  const corrected = await store.recipient(String(first.id));
  expect(corrected?.email).toBe("corrected@example.test");
  expect(corrected?.nonce).not.toBe(first.nonce);
  expect((await store.recipient(String(second.id)))?.revoked).toBe(true);
  expect(await store.reserveProviderRead(String(first.id))).toBe(true);
  expect(await store.reserveProviderRead(String(first.id))).toBe(false);
});
it("leases jobs exclusively, rejects a stale worker, defers without spending retries, and recovers final-attempt crashes", async () => {
  // Earlier cases can leave queued rows. Mark only this test suite's unclaimed
  // rows skipped before exercising the globally shared queue.
  await client`update commerce_signing_mail set state = 'skipped' where state = 'pending' and recipient_id in (select id from commerce_signing_recipients where request_id = any(${createdRequests}::uuid[]))`;
  const s = await snapshot();
  await store.synchronize(s);
  const jobs = await Promise.all([store.claim(), store.claim()]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  const job = jobs.find(Boolean);
  assert(job);
  await store.finish({ ...job, leaseToken: randomUUID() }, "sent");
  expect(
    (
      await client`select state from commerce_signing_mail where id = ${job.id}`
    )[0]?.state,
  ).toBe("sending");
  await store.finish(job, "deferred", "CORRECTION_PENDING");
  expect(
    (
      await client`select state, attempts from commerce_signing_mail where id = ${job.id}`
    )[0],
  ).toMatchObject({ state: "pending", attempts: 0 });
  await client`update commerce_signing_mail set state = 'sending', attempts = 6, lease_token = ${randomUUID()}, lease_until = now() - interval '1 second' where id = ${job.id}`;
  expect(await store.claim()).toBeNull();
  expect(
    (
      await client`select state, provider_code from commerce_signing_mail where id = ${job.id}`
    )[0],
  ).toMatchObject({ state: "failed", provider_code: "LEASE_EXHAUSTED" });
});
it("denies tenant and browser roles access to recipient capabilities and mail", async () => {
  for (const role of ["clockwork_runtime", "authenticated", "anon"]) {
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from commerce_signing_recipients`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from commerce_signing_mail`;
      }),
    ).rejects.toThrow(/permission denied/);
  }
});
