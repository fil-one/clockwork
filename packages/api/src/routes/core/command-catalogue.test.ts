import { ids } from "@clockwork/contracts";
import {
  databaseCoreCommands,
  workflowOwnedCoreCommands,
} from "@clockwork/db/core";
import {
  actionsFor,
  aggregateConfiguration,
  portalCommandActions,
} from "@clockwork/workflows";
import { describe, expect, it } from "vitest";

import {
  coreCommandCatalogue,
  coreResourceNames,
  CoreServiceError,
  MemoryCoreFinanceService,
  type CoreMutation,
  type CoreResourceName,
} from "./service";

/**
 * Consistency between the surfaces that advertise commands: the portal's action
 * list, this API's catalogue, and the repository's command guard.
 *
 * What this file can prove is limited, and the limit is the point. These are
 * three hand-maintained lists; holding them equal catches drift between them
 * and nothing else. The first version of this test claimed more than that, and
 * an invented verb declared in all three lists passed it 5/5 -- the lists
 * agreed, and agreement between declarations says nothing about whether a
 * branch exists. That is the same defect as P0-47.
 *
 * The binding to actual behaviour is `command-catalogue.integration.test.ts`,
 * which invokes every advertised verb against the running repository and
 * requires the answer to be anything other than that resource's refusal of a
 * verb no branch implements. Add a verb here and it is that test, not this one,
 * that decides whether the verb is real. It also requires every advertised verb
 * to be invoked or named unexercisable one at a time, which is what catches a
 * verb added to `accounts` -- the one resource whose repository code gives an
 * unknown verb no distinct answer to be caught by.
 */

const sorted = (values: Iterable<string>) => [...values].sort();

/** Every status the portal renders an action bar for, plus terminal ones. */
const statuses = [
  "draft",
  "issued",
  "pending_exception",
  "accepted",
  "expired",
  "superseded",
  "rejected",
  "open",
  "paid",
  "void",
  "uncollectible",
  "active",
  "amended",
  "provisioning",
  "terminated",
  "",
] as const;

const audiences = ["customer", "partner", "internal"] as const;

const userId = ids.user.parse("20000000-0000-4000-8000-000000000002");
const accountId = ids.account.parse("10000000-0000-4000-8000-000000000001");

function mutation(resource: CoreResourceName, action: string): CoreMutation {
  return {
    resource,
    id: "80000000-0000-4000-8000-000000000001",
    accountId,
    action,
    payload: {},
    actor: { kind: "user", id: userId },
    authorization: {
      userId,
      accountIds: [accountId],
      roles: ["owner"],
      isInternalStaff: true,
      mfaVerified: true,
      recentAuthenticationVerified: true,
    },
    requestId: "core-command-catalogue",
    idempotencyKey: `core-command-catalogue-${resource}-${action}`,
    occurredAt: "2026-08-14T00:00:00.000Z",
  };
}

describe("core command catalogue", () => {
  it("advertises exactly the commands the core repository branches on", () => {
    for (const resource of coreResourceNames)
      expect(
        sorted(coreCommandCatalogue[resource]),
        `${resource} advertises a command the repository does not list`,
      ).toEqual(sorted(databaseCoreCommands[resource]));
  });

  it("advertises nothing it has deferred to a workflow", () => {
    // A deferred verb is refused for every input: the workflows that own these
    // transitions write their rows directly and accept no command. Advertising
    // one is advertising an error, so deferral means withdrawal here, not a
    // second list of things the catalogue may still offer.
    for (const [resource, deferred] of Object.entries(
      workflowOwnedCoreCommands,
    )) {
      const name = resource as CoreResourceName;
      expect(
        (deferred as readonly string[]).filter((action) =>
          coreCommandCatalogue[name].has(action),
        ),
        `${resource} advertises a command it has deferred to a workflow`,
      ).toEqual([]);
      expect(
        (deferred as readonly string[]).filter((action) =>
          (databaseCoreCommands[name] as readonly string[]).includes(action),
        ),
        `${resource} cannot both implement and defer a command`,
      ).toEqual([]);
    }
  });

  it("offers the portal exactly the commands the repository implements", () => {
    for (const [resource, actions] of Object.entries(portalCommandActions)) {
      const name = resource as CoreResourceName;
      expect(
        workflowOwnedCoreCommands[
          name as keyof typeof workflowOwnedCoreCommands
        ],
        `${resource} is reachable from the portal, so it may not defer a command to a workflow`,
      ).toBeUndefined();
      expect(sorted(actions), `${resource} portal actions`).toEqual(
        sorted(databaseCoreCommands[name]),
      );
    }
  });

  it("never renders an action its resource does not admit", () => {
    for (const [aggregateType, configuration] of Object.entries(
      aggregateConfiguration,
    ))
      for (const audience of audiences)
        for (const status of statuses) {
          const offered = actionsFor(
            audience,
            aggregateType as Parameters<typeof actionsFor>[1],
            {
              aggregateType,
              aggregateId: "80000000-0000-4000-8000-000000000001",
              accountId: null,
              version: 1,
              sourceHash: "a".repeat(64),
              sourceUpdatedAt: "2026-08-14T00:00:00.000Z",
              data: { status },
            },
          );
          if (offered.length === 0) continue;
          const resource = configuration.resource;
          expect(
            resource,
            `${aggregateType}/${status} offers ${offered.join(",")} with no command resource`,
          ).not.toBeNull();
          const admitted = portalCommandActions[resource as string] ?? [];
          for (const action of offered)
            expect(
              admitted,
              `${aggregateType}/${status} offers ${action}, which ${resource} does not implement`,
            ).toContain(action);
        }
  });

  it("refuses the commands the repository does not implement", () => {
    const service = new MemoryCoreFinanceService();
    for (const [resource, action] of [
      ["quotes", "price"],
      ["quotes", "accept"],
      ["amendments", "accept"],
      ["amendments", "apply"],
      ["invoices", "issue"],
      ["invoices", "open"],
      ["invoices", "pay"],
      ["invoices", "void"],
      ["invoices", "mark_uncollectible"],
      ["invoices", "consolidate"],
      // Withdrawn with the same finding behind them: the repository has no
      // branch, the workflow that owns the row takes no command, and the probe
      // in the integration test shows each one failing for every input.
      ["deal_registrations", "expire"],
      ["deal_registrations", "dispute"],
      ["deal_registrations", "decide_dispute"],
      ["commissions", "state"],
      ["commissions", "settle"],
      ["reports", "generate"],
      ["reports", "complete"],
      ["reports", "fail"],
      ["accounting_exports", "create"],
      ["accounting_exports", "generate"],
      ["accounting_exports", "post"],
      ["accounting_exports", "reconcile"],
      ["marketplace_reconciliations", "create"],
      ["marketplace_reconciliations", "ingest"],
      ["marketplace_reconciliations", "reconcile"],
      ["marketplace_reconciliations", "replay"],
    ] as const) {
      let raised: unknown;
      try {
        void service.mutate(mutation(resource, action));
      } catch (error) {
        raised = error;
      }
      expect(raised, `${resource}:${action} was accepted`).toBeInstanceOf(
        CoreServiceError,
      );
      expect((raised as CoreServiceError).code).toBe("INVALID_STATE");
    }
  });

  it("keeps quote revision available to the builder", () => {
    expect(coreCommandCatalogue.quotes.has("revise")).toBe(true);
    expect(databaseCoreCommands.quotes).toContain("revise");
  });
});
