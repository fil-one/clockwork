import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  formatDecimal,
  multiplyMinorByQuantity,
  parseDecimal,
} from "@clockwork/domain/core";

import { createRuntimeDatabase } from "../../client";
import {
  commitmentEntries,
  commitmentLedgers,
  usageEvents,
} from "../../schema";
import { commitmentLedgerCorrections } from "../../schema/core/finance";
import { withInternalTransaction } from "../../transaction";
import { DatabaseCoreScheduledDispatchStore } from "../workflows/core-schedules";
import {
  applyCommitmentDecision,
  ingestUsageEvents,
  replayCommitmentLedger,
} from "./commitments";

const databaseUrl =
  process.env.DIRECT_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
const { client, db } = createRuntimeDatabase({
  url: databaseUrl,
  maxConnections: 3,
  role: "clockwork_service",
  ssl: false,
});

/** Seeded term-drawdown commitment; its balance is read, never assumed. */
const LEDGER_ID = "84000000-0000-4000-8000-000000000001";
const ENTITLEMENT_ID = "83000000-0000-4000-8000-000000000001";
const PERIOD_ID = "84300000-0000-4000-8000-000000000001";
const OPERATOR_ID = "20000000-0000-4000-8000-000000000001";
const suffix = crypto.randomUUID().slice(0, 8);

function trail(reference: string, append: "always" | "on_drift" = "on_drift") {
  return {
    reasonCode: "late_usage_replay",
    sourceReference: `${reference}:${suffix}`,
    recordedBy: OPERATOR_ID,
    recordedAt: new Date("2026-08-01T12:00:00Z"),
    append,
  } as const;
}

function difference(left: string, right: string): string {
  return formatDecimal(parseDecimal(left, true) - parseDecimal(right, true));
}

function decide() {
  return withInternalTransaction(db, `ledger-decide-${suffix}`, async (tx) => {
    const { decision } = await replayCommitmentLedger(tx, LEDGER_ID);
    return decision;
  });
}

/** Ingests `quantity` and returns the balance before and after the replay. */
async function meter(
  quantity: string,
  externalEventId: string,
  measuredAt: string,
  now: string,
) {
  return withInternalTransaction(db, `meter-${externalEventId}`, async (tx) => {
    const before = await replayCommitmentLedger(tx, LEDGER_ID);
    await ingestUsageEvents(tx, ENTITLEMENT_ID, [
      { externalEventId, measuredAt, quantity, meter: "storage" },
    ]);
    const replay = await replayCommitmentLedger(tx, LEDGER_ID);
    await applyCommitmentDecision(
      tx,
      replay,
      trail(externalEventId),
      new Date(now),
    );
    return { before: before.decision, decision: replay.decision };
  });
}

/** What a term drawdown owes once consumption passes its adjusted allowance. */
function expectedOverage(consumed: string, allowance: string): string {
  const excess = parseDecimal(consumed, true) - parseDecimal(allowance, true);
  return formatDecimal(excess > 0n ? excess : 0n);
}

afterAll(async () => {
  await client.end();
});

describe.sequential("commitment ledger write path", () => {
  it("counts a usage event once however many times the provider delivers it", async () => {
    const before = await decide();
    const events = [
      {
        externalEventId: `ingest-${suffix}-a`,
        measuredAt: "2026-08-01T09:00:00Z",
        quantity: "2.5",
        meter: "storage",
      },
    ];
    const ingest = () =>
      withInternalTransaction(db, `ingest-${suffix}`, async (tx) => {
        const result = await ingestUsageEvents(tx, ENTITLEMENT_ID, events);
        const replay = await replayCommitmentLedger(tx, LEDGER_ID);
        await applyCommitmentDecision(
          tx,
          replay,
          trail("ingest"),
          new Date("2026-08-01T12:00:00Z"),
        );
        return { result, consumed: replay.decision.totalConsumed };
      });

    const first = await ingest();
    expect(first.result.ingested).toEqual([`ingest-${suffix}-a`]);
    expect(first.result.duplicates).toEqual([]);
    expect(difference(first.consumed, before.totalConsumed)).toBe("2.5");

    const replayed = await ingest();
    expect(replayed.result.ingested).toEqual([]);
    expect(replayed.result.duplicates).toEqual([`ingest-${suffix}-a`]);
    expect(replayed.consumed).toBe(first.consumed);
  });

  it("rejects a reused provider event id that carries a different measurement", async () => {
    await expect(
      withInternalTransaction(db, `ingest-conflict-${suffix}`, (tx) =>
        ingestUsageEvents(tx, ENTITLEMENT_ID, [
          {
            externalEventId: `ingest-${suffix}-a`,
            measuredAt: "2026-08-01T09:00:00Z",
            quantity: "9.75",
            meter: "storage",
          },
        ]),
      ),
    ).rejects.toThrow(
      "A usage event id was reused with a different measurement",
    );
  });

  it("lets the ledger, not the meter, decide that overage exists", async () => {
    const metered = await meter(
      "6.5",
      `ingest-${suffix}-b`,
      "2026-08-02T09:00:00Z",
      "2026-08-02T12:00:00Z",
    );
    const allowance = metered.decision.periods[0]?.allowance;
    if (!allowance) throw new Error("SEEDED_PERIOD_ALLOWANCE_MISSING");
    expect(metered.decision.authority).toBe("commitment_ledger");
    expect(
      difference(metered.decision.totalConsumed, metered.before.totalConsumed),
    ).toBe("6.5");
    const owed = expectedOverage(metered.decision.totalConsumed, allowance);
    expect(metered.decision.totalOverage).toBe(owed);
    expect(parseDecimal(owed) > 0n).toBe(true);
    expect(metered.decision.overageAmount).toEqual({
      currency: "USD",
      minor: multiplyMinorByQuantity(18000n, owed).toString(),
    });
    const ledger = await withInternalTransaction(
      db,
      `ledger-read-${suffix}`,
      (tx) =>
        tx.query.commitmentLedgers.findFirst({
          where: eq(commitmentLedgers.id, LEDGER_ID),
        }),
    );
    expect(parseDecimal(ledger?.overageQuantity ?? "0")).toBe(
      parseDecimal(owed),
    );
  });

  it("keeps the append-only trail equal to the authoritative overage", async () => {
    const totals = await withInternalTransaction(
      db,
      `trail-${suffix}`,
      async (tx) => {
        const entries = await tx.query.commitmentEntries.findMany({
          where: eq(commitmentEntries.ledgerId, LEDGER_ID),
        });
        const corrections = await tx.query.commitmentLedgerCorrections.findMany(
          {
            where: eq(commitmentLedgerCorrections.ledgerId, LEDGER_ID),
          },
        );
        const replay = await replayCommitmentLedger(tx, LEDGER_ID);
        return {
          trail: formatDecimal(
            [
              ...entries.map((entry) => entry.overageQuantity),
              ...corrections.map((correction) => correction.overageDelta),
            ].reduce((sum, value) => sum + parseDecimal(value, true), 0n),
          ),
          decided: replay.decision.totalOverage,
        };
      },
    );
    expect(totals.trail).toBe(totals.decided);
  });

  it("reverses usage with a correction instead of rewriting the measurement", async () => {
    const before = await withInternalTransaction(
      db,
      `correction-before-${suffix}`,
      (tx) =>
        tx.query.usageEvents.findFirst({
          where: eq(usageEvents.externalEventId, `ingest-${suffix}-b`),
        }),
    );
    if (!before) throw new Error("METERED_USAGE_EVENT_MISSING");
    const corrected = await withInternalTransaction(
      db,
      `correction-${suffix}`,
      async (tx) => {
        const priorDecision = (await replayCommitmentLedger(tx, LEDGER_ID))
          .decision;
        await tx.insert(usageEvents).values({
          entitlementId: ENTITLEMENT_ID,
          externalEventId: `correction-${suffix}-b`,
          measuredAt: before.measuredAt,
          quantity: `-${before.quantity}`,
          kind: "storage",
          ledgerKind: "correction",
          correctsUsageEventId: before.id,
        });
        const replay = await replayCommitmentLedger(tx, LEDGER_ID);
        const applied = await applyCommitmentDecision(
          tx,
          replay,
          {
            reasonCode: "over_reported_by_provider",
            sourceReference: `correction-${suffix}-b`,
            recordedBy: OPERATOR_ID,
            recordedAt: new Date("2026-08-03T12:00:00Z"),
            append: "always",
            quantityDelta: `-${before.quantity}`,
            periodId: PERIOD_ID,
          },
          new Date("2026-08-03T12:00:00Z"),
        );
        return { applied, priorDecision };
      },
    );
    // The corrected measurement leaves the term exactly where it stood before
    // the event was ever ingested.
    expect(
      difference(
        corrected.priorDecision.totalConsumed,
        corrected.applied.decision.totalConsumed,
      ),
    ).toBe(formatDecimal(parseDecimal(before.quantity)));
    expect(corrected.applied.correctionId).toBeDefined();

    const after = await withInternalTransaction(
      db,
      `correction-after-${suffix}`,
      (tx) =>
        tx.query.usageEvents.findFirst({
          where: eq(usageEvents.id, before.id),
        }),
    );
    expect(after?.quantity).toBe(before.quantity);
  });

  it("dispatches exactly the overage the ledger decided for an ended period", async () => {
    const metered = await meter(
      "7.5",
      `ingest-${suffix}-c`,
      "2026-08-04T09:00:00Z",
      "2026-08-04T12:00:00Z",
    );
    const decided = metered.decision.periods.find(
      (period) => period.periodId === PERIOD_ID,
    );
    if (!decided) throw new Error("SEEDED_PERIOD_NOT_DECIDED");
    expect(parseDecimal(decided.overage) > 0n).toBe(true);

    const builder = new DatabaseCoreScheduledDispatchStore(
      db,
      process.env.AUTHORIZATION_CONTEXT_SECRET ??
        "clockwork-local-auth-context-secret-change-me",
    );
    const dispatches = await builder.buildDueDispatches({
      scheduleId: "core.schedule.sync-overage.v1",
      occurrenceId: crypto.randomUUID(),
      scheduledAt: "2027-02-01T00:00:00Z",
      requestId: `overage-dispatch-${suffix}`,
      idempotencyPrefix: `overage-${suffix}`,
      limit: 50,
    });
    const dispatch = dispatches.find(
      (candidate) =>
        (candidate.payload as { periodId?: string }).periodId === PERIOD_ID,
    );
    expect(dispatch).toBeDefined();
    const line = (
      dispatch?.payload as {
        lines: readonly { quantity: string; amount: { minor: string } }[];
      }
    ).lines[0];
    expect(line?.quantity).toBe(decided.overage);
    expect(line?.amount.minor).toBe(
      multiplyMinorByQuantity(18000n, decided.overage).toString(),
    );
  });
});
