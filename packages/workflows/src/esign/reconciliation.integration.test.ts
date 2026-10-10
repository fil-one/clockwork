/* eslint-disable @typescript-eslint/require-await -- the in-memory SignWell fake models the async provider contract. */
import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { MndaRecord, MndaState } from "@clockwork/contracts";
import {
  createRuntimeDatabase,
  ESignReconciliationRepository,
  MndaRepository,
} from "@clockwork/db";
import { mndaRequests } from "@clockwork/db/schema";
import type {
  MndaSigningProvider,
  SignWellDocument,
} from "@clockwork/integrations";
import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import { MndaWorkflow } from "../mnda";
import {
  reconcileESignatures,
  type ESignReconciliationSource,
} from "./reconciliation";

const { client, db } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable",
  role: "clockwork_service",
  ssl: false,
});
const repo = new MndaRepository(db);
const stale = new ESignReconciliationRepository(db);
const actor = { kind: "user" as const, id: randomUUID() };
afterAll(() => client.end());

/** What the SignWell fake reports for each bound document. */
const signWell = new Map<string, { record: MndaRecord; status: string }>();
function document(providerId: string): SignWellDocument {
  const bound = signWell.get(providerId);
  if (!bound) throw new Error("SIGNWELL_HTTP_404");
  const { record, status } = bound;
  return {
    id: providerId,
    status,
    test_mode: record.testMode,
    metadata: {
      commerce_mnda_id: record.id,
      template_sha256: record.templateHash,
    },
    apply_signing_order: true,
    recipients: [
      { id: "counterparty", email: record.input.signerEmail, name: "Alex" },
      { id: "fil-one", email: record.countersigner.email, name: "James" },
    ],
    fields: [],
  };
}
const get = vi.fn(async (id: string) => document(id));
const provider: MndaSigningProvider = {
  createDraft: vi.fn(async () => {
    throw new Error("unexpected");
  }),
  get,
  send: vi.fn(async () => {}),
  remind: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  updateRecipient: vi.fn(async (id: string) => document(id)),
  completedPdf: vi.fn(async () => Buffer.from("%PDF-completed")),
};

const signer = {
  ...fixtureSigner,
  id: randomUUID(),
  email: `${randomUUID()}@example.com`,
  isDefault: false,
};

/** A request bound to a SignWell document in `state`, last changed at `updatedAt`. */
async function bound(
  state: MndaState,
  signWellStatus: string,
  updatedAt?: string,
  error: string | null = null,
) {
  const draft = await repo.create(
    { ...fixtureInput, id: randomUUID(), countersignerId: signer.id },
    { id: actor.id, name: "Revenue operator", email: "seller@example.com" },
    "a".repeat(64),
    true,
    Buffer.from("%PDF-original"),
    signer,
    (await repo.settings()).noticeEmail,
  );
  const providerId = randomUUID();
  const { token } = await repo.claim(draft.id);
  const record = await repo.update(
    draft.id,
    token,
    { providerId, state, error },
    actor,
  );
  await repo.release(draft.id, token);
  signWell.set(providerId, { record, status: signWellStatus });
  if (updatedAt)
    await db.execute(
      sql`update commerce_mnda_requests set updated_at = ${updatedAt}::timestamptz where id = ${draft.id}`,
    );
  return { id: draft.id, providerId };
}

it("syncs stale open MNDAs through the lease and leaves fresh, closed and held ones alone", async () => {
  await repo.saveSigner(signer, actor);
  const failing = await bound("sent", "Sent", "1999-01-01T00:00:00Z");
  const completedInSignWell = await bound(
    "sent",
    "Completed",
    "2000-01-01T00:00:00Z",
  );
  const declinedInSignWell = await bound(
    "viewed",
    "Declined",
    "2000-01-02T00:00:00Z",
  );
  const unchanged = await bound("sent", "Sent", "2000-01-03T00:00:00Z");
  const attention = await bound("attention", "Sent", "2000-01-04T00:00:00Z");
  const takenMidRun = await bound("sent", "Completed", "2000-01-05T00:00:00Z");
  const fresh = await bound("sent", "Completed");
  const closed = await bound("declined", "Completed", "2000-01-06T00:00:00Z");
  const deleted = await bound(
    "attention",
    "Completed",
    "2000-01-07T00:00:00Z",
    "deleted_in_signwell",
  );
  const held = await bound("sent", "Completed", "2000-01-08T00:00:00Z");
  const lease = await repo.claim(held.id);

  get.mockImplementation(async (id) => {
    if (id === failing.providerId) throw new Error("SIGNWELL_HTTP_500");
    return document(id);
  });
  const mine = new Set(
    [
      failing,
      completedInSignWell,
      declinedInSignWell,
      unchanged,
      attention,
      takenMidRun,
      fresh,
      closed,
      deleted,
      held,
    ].map((r) => r.id),
  );
  let interloper: { token: string } | undefined;
  const workflow = new MndaWorkflow(repo, provider);
  // Scoped to this test's rows; the shared database holds other files' rows.
  const source: ESignReconciliationSource = {
    kind: "mnda",
    stale: async (query) => {
      const ids = (await stale.staleMndaRequests({ ...query, limit: 1000 }))
        .filter((id) => mine.has(id))
        .slice(0, query.limit);
      // A webhook takes one request's lease after the sweep selected it.
      if (!interloper && ids.includes(takenMidRun.id))
        interloper = await repo.claim(takenMidRun.id);
      return ids;
    },
    reconciled: (id) => stale.markMndaReconciled(id),
    sync: (id, by) => workflow.sync(id, by),
  };
  const log = vi.fn();
  const result = await reconcileESignatures([source], { pageSize: 3, log });

  expect(result.sources).toEqual([
    { kind: "mnda", synced: 4, busy: 1, failed: 1 },
  ]);
  expect(log).toHaveBeenCalledWith({
    event: "ESIGN_RECONCILE_FAILED",
    kind: "mnda",
    id: failing.id,
    error: "SIGNWELL_HTTP_500",
  });
  const state = async (id: string) => (await repo.get(id)).state;
  expect(await state(completedInSignWell.id)).toBe("completed");
  expect(
    (await repo.readArtifact(completedInSignWell.id, "executed")).toString(),
  ).toBe("%PDF-completed");
  expect(await state(declinedInSignWell.id)).toBe("declined");
  expect(await state(unchanged.id)).toBe("sent");
  expect(await state(attention.id)).toBe("sent");
  expect(await state(failing.id)).toBe("sent");
  // Never read: changed recently, closed, deleted in SignWell, or leased.
  const read = get.mock.calls.map(([id]) => id);
  for (const skipped of [fresh, closed, deleted, held, takenMidRun])
    expect(read).not.toContain(skipped.providerId);
  expect(await state(takenMidRun.id)).toBe("sent");
  expect(await state(held.id)).toBe("sent");
  expect(await state(fresh.id)).toBe("sent");

  // Leases released by their holders are picked up on the next run.
  await repo.release(held.id, lease.token);
  if (interloper) await repo.release(takenMidRun.id, interloper.token);
  const next = await reconcileESignatures([source], { log: () => {} });
  expect(next.sources[0]).toMatchObject({ busy: 0 });
  expect(await state(held.id)).toBe("completed");
  expect(await state(takenMidRun.id)).toBe("completed");
});

it("rotates through stale requests, so one that keeps failing cannot hold the front", async () => {
  const failing = await bound("sent", "Sent", "1998-01-01T00:00:00Z");
  const second = await bound("sent", "Sent", "1998-01-02T00:00:00Z");
  const third = await bound("viewed", "Viewed", "1998-01-03T00:00:00Z");
  const mine = new Set([failing.id, second.id, third.id]);
  get.mockImplementation(async (id) => {
    if (id === failing.providerId) throw new Error("SIGNWELL_HTTP_500");
    return document(id);
  });
  const row = async (id: string) => {
    const [r] = await db
      .select({
        updatedAt: mndaRequests.updatedAt,
        version: mndaRequests.version,
        reconciledAt: mndaRequests.reconciledAt,
      })
      .from(mndaRequests)
      .where(eq(mndaRequests.id, id));
    if (!r) throw new Error("missing");
    return r;
  };
  const before = await row(second.id);
  const workflow = new MndaWorkflow(repo, provider);
  const picked: string[] = [];
  const source: ESignReconciliationSource = {
    kind: "mnda",
    stale: async (query) =>
      (await stale.staleMndaRequests({ ...query, limit: 1000 }))
        .filter((id) => mine.has(id))
        .slice(0, query.limit),
    reconciled: async (id) => {
      picked.push(id);
      await stale.markMndaReconciled(id);
    },
    sync: (id, by) => workflow.sync(id, by),
  };
  for (let run = 0; run < 4; run++)
    await reconcileESignatures([source], { maxPerSource: 1, log: () => {} });
  expect(picked).toEqual([failing.id, second.id, third.id, failing.id]);

  // Marking is bookkeeping: a request SignWell left unchanged keeps its
  // version and last-changed time.
  const after = await row(second.id);
  expect(before.reconciledAt).toBeNull();
  expect(after.reconciledAt).not.toBeNull();
  expect(after.version).toBe(before.version);
  expect(after.updatedAt).toEqual(before.updatedAt);
});
