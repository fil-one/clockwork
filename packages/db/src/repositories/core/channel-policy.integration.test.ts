import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createRuntimeDatabase } from "../../client";
import { auditEvents, commerceUsers, memberships } from "../../schema";
import { withInternalTransaction } from "../../transaction";
import { DatabaseChannelPolicyRepository } from "./channel-policy";
const { db, client } = createRuntimeDatabase({
  url:
    process.env.DIRECT_DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  role: "clockwork_service",
  ssl: false,
});
const repo = new DatabaseChannelPolicyRepository(db);
const creator = randomUUID(),
  reviewer = randomUUID();
beforeAll(async () =>
  withInternalTransaction(db, randomUUID(), async (tx) => {
    for (const id of [creator, reviewer]) {
      await tx.insert(commerceUsers).values({
        id,
        workosUserId: `user_${id}`,
        email: `${id}@clockwork.test`,
        name: "Channel finance",
        isInternalStaff: true,
        mfaEnrolled: true,
      });
      await tx.insert(memberships).values({
        userId: id,
        organizationId: "30000000-0000-4000-8000-000000000008",
        role: "finance_approver",
      });
    }
  }),
);
afterAll(async () => client.end());
describe("persisted channel controls", () => {
  it("edits, freezes and approves an audited policy through persisted finance authority", async () => {
    const now = new Date().toISOString();
    const request = (
      command: Parameters<typeof repo.command>[0]["command"],
      id = creator,
    ) =>
      repo.command({
        command,
        actor: { kind: "user", id },
        requestId: randomUUID(),
        now,
      });
    const version = 1_000_000 + Math.floor(Math.random() * 1_000_000);
    let row = await request({
      action: "create",
      terms: {
        version,
        effectiveFrom: new Date(Date.UTC(2100, 0, 1) + version * 86_400_000)
          .toISOString()
          .slice(0, 10),
        selfServeThresholdTb: 250,
        defaultProtectionDays: 30,
        maximumProtectionDays: 60,
        extensionDays: 30,
        maximumExtensions: 1,
        sourceEvidence: "test-source-reference",
      },
    });
    row = await request({
      action: "save",
      id: row.id,
      expectedRowVersion: row.rowVersion,
      terms: { ...row.terms, selfServeThresholdTb: 300 },
    });
    row = await request({
      action: "propose",
      id: row.id,
      expectedRowVersion: row.rowVersion,
      reason: "Ready for review",
    });
    await expect(
      request({
        action: "approve",
        id: row.id,
        expectedRowVersion: row.rowVersion,
        reason: "Approval review",
        approvalEvidence: "test-approval-evidence",
      }),
    ).rejects.toThrow("DISTINCT_APPROVER");
    row = await request(
      {
        action: "approve",
        id: row.id,
        expectedRowVersion: row.rowVersion,
        reason: "Approval review",
        approvalEvidence: "test-approval-evidence",
      },
      reviewer,
    );
    expect(row.status).toBe("approved");
    expect((await repo.list()).some((item) => item.id === row.id)).toBe(true);
    const audit = await withInternalTransaction(db, randomUUID(), (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.aggregateId, row.id)),
    );
    expect(audit).toHaveLength(4);
    expect((await repo.active()).source).toBe("legacy_defaults");
  });
});
