import {
  createMemoryDemoStore,
  resetDemoExperience,
} from "@clockwork/testing/demo-reset";
import { describe, expect, it } from "vitest";

import {
  classifyDemoReconciliationVariance,
  decideDemoDeadLetter,
  decideDemoRuntimeFailure,
  decideDemoMigration,
  demoOperatorIds,
  readDemoDeadLetters,
  readDemoReconciliationWorkspace,
  readDemoRuntimeFailureIncidents,
  readDemoMigrationDecisions,
  readDemoWebhookEvents,
  replayDemoWebhook,
} from "./demo-operator-state";

const actorId = "20000000-0000-4000-8000-000000000001";

describe("resettable demo operator ledger", () => {
  it("seeds each DB-backed workspace with production-shaped records", async () => {
    const store = createMemoryDemoStore();

    const [recovery, webhooks, reconciliation, incidents] = await Promise.all([
      readDemoDeadLetters({ store }),
      readDemoWebhookEvents({ store }),
      readDemoReconciliationWorkspace({ store }),
      readDemoRuntimeFailureIncidents({ locale: "en", store }),
    ]);

    expect(recovery.map(({ source }) => source)).toEqual([
      "outbox_message",
      "provisioning_attempt",
      "workflow_run",
    ]);
    expect(webhooks).toEqual([
      expect.objectContaining({
        provider: "stripe",
        providerEventId: "evt_demo_invoice_failed",
        state: "failed",
        signatureVerifiedAt: "2026-07-31T14:31:01.000Z",
      }),
    ]);
    expect(reconciliation).toMatchObject({
      readable: true,
      periods: [
        {
          mathematicallyTied: false,
          billingProviderVarianceMinor: "-120000",
        },
      ],
      variances: [
        {
          caseId: demoOperatorIds.variance,
          objectType: "invoice",
          objectId: "INV-2026-0781",
          rowVersion: 1,
        },
      ],
    });
    expect(incidents).toMatchObject({
      readable: true,
      state: "read",
      incidents: [
        {
          auditEventId: demoOperatorIds.incident,
          eventType: "lifecycle.provider_effect.dead_lettered",
          safeCode: "PROVIDER_TIMEOUT",
        },
      ],
    });
  });

  /**
   * The provider message in the demo ledger stands in for text a provider
   * would send, so it is demo-authored and reaches each reader in their
   * language. Its provenance stays a key the page words, never a sentence.
   */
  it("gives the demo provider message in the reader's language", async () => {
    const store = createMemoryDemoStore();
    const [english, portuguese] = await Promise.all([
      readDemoRuntimeFailureIncidents({ locale: "en", store }),
      readDemoRuntimeFailureIncidents({ locale: "pt", store }),
    ]);
    expect(english.source).toBe("demo");
    expect(english.incidents[0]?.diagnosis).toEqual({
      kind: "provider_message",
      message: "The activation provider did not answer before its deadline.",
      provenance: "operationAttempt",
    });
    expect(portuguese.incidents[0]?.diagnosis).toMatchObject({
      message: "O provedor de ativação não respondeu antes do prazo.",
      provenance: "operationAttempt",
    });
  });

  it("persists representative recovery, replay, disposition, and incident actions", async () => {
    const store = createMemoryDemoStore();
    const at = "2026-07-31T16:05:00.000Z";

    await expect(
      decideDemoDeadLetter({
        source: "workflow_run",
        id: demoOperatorIds.deadLetterWorkflow,
        action: "retry",
        reason: "Provider recovered under INC-4421",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toEqual({ redriveSubmitted: true });
    await expect(readDemoDeadLetters({ store })).resolves.toContainEqual(
      expect.objectContaining({
        id: demoOperatorIds.deadLetterWorkflow,
        decision: "retry_requested",
        decisionReason: "Provider recovered under INC-4421",
        decidedAt: at,
      }),
    );
    await expect(
      decideDemoDeadLetter({
        source: "workflow_run",
        id: demoOperatorIds.deadLetterWorkflow,
        action: "retry",
        reason: "Provider recovered under INC-4421",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toEqual({ redriveSubmitted: false });

    await expect(
      replayDemoWebhook({
        provider: "stripe",
        providerEventId: "evt_demo_invoice_failed",
        reason: "Verified provider recovery under INC-4421",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toEqual({
      started: true,
      workflowRunId: demoOperatorIds.workflowReplay,
    });
    await expect(
      replayDemoWebhook({
        provider: "stripe",
        providerEventId: "evt_demo_invoice_failed",
        reason: "Verified provider recovery under INC-4421",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toMatchObject({ started: false });
    await expect(readDemoWebhookEvents({ store })).resolves.toEqual([]);

    await expect(
      classifyDemoReconciliationVariance({
        caseId: demoOperatorIds.variance,
        expectedRowVersion: 1,
        classification: "delivery_timing",
        reason: "Provider settlement crossed the July cut-off",
        expectedClearingPeriod: "2026-08",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toEqual({ blocksClose: false, rowVersion: 2 });
    await expect(
      readDemoReconciliationWorkspace({ store }),
    ).resolves.toMatchObject({
      variances: [
        {
          rowVersion: 2,
          latestClassification: "delivery_timing",
          latestClassificationReason:
            "Provider settlement crossed the July cut-off",
          latestClassificationAt: at,
          expectedClearingPeriod: "2026-08",
        },
      ],
    });

    await expect(
      decideDemoRuntimeFailure({
        auditEventId: demoOperatorIds.incident,
        decision: "contain",
        reason: "Provisioning capability paused under INC-4421",
        containmentReference: "gate EXT-PROVIDER-01",
        actorId,
        now: at,
        store,
      }),
    ).resolves.toEqual({ recordVersion: 1 });
    await expect(
      readDemoRuntimeFailureIncidents({ locale: "en", store }),
    ).resolves.toMatchObject({
      incidents: [
        {
          decisionCount: 1,
          latestDecision: "contain",
          latestDecisionReason: "Provisioning capability paused under INC-4421",
          latestDecisionAt: at,
        },
      ],
    });
  });

  it("restores all operator workspaces on the canonical demo reset", async () => {
    const store = createMemoryDemoStore();
    await replayDemoWebhook({
      provider: "stripe",
      providerEventId: "evt_demo_invoice_failed",
      reason: "Verified provider recovery under INC-4421",
      actorId,
      store,
    });
    await decideDemoRuntimeFailure({
      auditEventId: demoOperatorIds.incident,
      decision: "contain",
      reason: "Provisioning capability paused under INC-4421",
      actorId,
      store,
    });

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });

    await expect(readDemoWebhookEvents({ store })).resolves.toHaveLength(1);
    await expect(
      readDemoRuntimeFailureIncidents({ locale: "en", store }),
    ).resolves.toMatchObject({
      incidents: [{ decisionCount: 0, latestDecision: null }],
    });
  });

  it("persists one migration identity decision and restores it on reset", async () => {
    const store = createMemoryDemoStore();
    await expect(
      decideDemoMigration({
        migrationId: "MIG-EXAMPLE-021",
        action: "link",
        targetAccountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
        reason: "Legal name and verified domain match",
        actorId,
        now: "2026-07-31T16:08:00.000Z",
        store,
      }),
    ).resolves.toMatchObject({
      action: "link",
      version: 1,
      targetAccountId: "0af8d9dd-3790-45a2-8f86-c66fa8c18a04",
    });
    await expect(readDemoMigrationDecisions(store)).resolves.toEqual([
      expect.objectContaining({ migrationId: "MIG-EXAMPLE-021" }),
    ]);

    await resetDemoExperience(store, {
      environment: { NODE_ENV: "test", CLOCKWORK_ENV: "demo" },
      target: "demo",
    });
    await expect(readDemoMigrationDecisions(store)).resolves.toEqual([]);
  });
});
