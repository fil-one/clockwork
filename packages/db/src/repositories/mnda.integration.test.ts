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
it("serializes duplicate draft creation, preserves signer snapshots and locks concurrent sends", async () => {
  const signer = {
    ...fixtureSigner,
    id: randomUUID(),
    email: `${randomUUID()}@example.com`,
    isDefault: false,
  };
  await repo.saveSigner(signer, actor);
  const input = {
    ...fixtureInput,
    id: randomUUID(),
    countersignerId: signer.id,
  };
  const create = () =>
    repo.create(
      input,
      { id: actor.id, name: "Revenue operator" },
      "a".repeat(64),
      true,
      Buffer.from("%PDF-original"),
      signer,
    );
  const [a, b] = await Promise.all([create(), create()]);
  expect(a.id).toBe(b.id);
  expect(a).not.toHaveProperty("leaseToken");
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
      await tx`set local role clockwork_service`;
      await tx`delete from commerce_mnda_artifacts where request_id=${a.id}`;
    }),
  ).rejects.toThrow("permission denied");
}, 30000);
