import { describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";

import type { RuntimeDatabase } from "../../client";
import {
  DatabaseCoreFinanceRepository,
  type DatabaseCoreMutation,
} from "./database-finance";
import { FixtureTaxPort } from "./tax-fixture";

/**
 * Two pools that are genuinely distinguishable.
 *
 * The suite missed the original defect because every existing test built the
 * repository with `database: db, pricingDatabase: db` over one superuser
 * connection, where `set local role clockwork_service` always succeeds. These
 * handles report different connection roles and record which one a command
 * actually opened, so a test that routes a command to the wrong pool fails
 * regardless of what the database would have permitted.
 */
class TrackingPool {
  public readonly opened: string[] = [];

  public constructor(private readonly user: string) {}

  public get db(): RuntimeDatabase {
    const handle = {
      $client: { options: { user: this.user } },
      transaction: (): Promise<never> => {
        this.opened.push("begin");
        // Stop before any SQL. Which pool was opened is the whole question;
        // simulating the command body would prove nothing extra.
        return Promise.reject(new PoolOpened(this.user));
      },
    };
    return handle as unknown as RuntimeDatabase;
  }
}

class PoolOpened extends Error {
  public constructor(public readonly user: string) {
    super(`pool opened: ${user}`);
  }
}

const authorizationSecret = "pool-routing-secret-at-least-32-bytes-long";

const financeAuthority = (): AuthorizationContext => ({
  userId: ids.user.parse("20000000-0000-4000-8000-000000000001"),
  accountIds: [],
  roles: ["finance_approver"],
  isInternalStaff: true,
  mfaVerified: true,
  recentAuthenticationVerified: true,
});

function command(
  resource: DatabaseCoreMutation["resource"],
): DatabaseCoreMutation {
  return {
    resource,
    id: "30000000-0000-4000-8000-000000000009",
    action: "create",
    payload: {},
    actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
    authorization: financeAuthority(),
    requestId: `pool-routing-${resource}`,
    idempotencyKey: `pool-routing-${resource}-0001`,
    occurredAt: "2026-08-01T16:00:00.000Z",
  };
}

function repository() {
  const runtime = new TrackingPool("clockwork_runtime");
  const pricing = new TrackingPool("clockwork_service");
  return {
    runtime,
    pricing,
    subject: new DatabaseCoreFinanceRepository({
      database: runtime.db,
      pricingDatabase: pricing.db,
      authorizationSecret,
      tax: new FixtureTaxPort(),
    }),
  };
}

describe("core finance command pool routing", () => {
  for (const resource of ["commitments", "price_books"] as const) {
    it(`opens ${resource} commands on the service pool, never the tenant pool`, async () => {
      const { runtime, pricing, subject } = repository();

      await expect(subject.mutate(command(resource))).rejects.toBeInstanceOf(
        PoolOpened,
      );

      expect(pricing.opened).toEqual(["begin"]);
      expect(runtime.opened).toEqual([]);
    });
  }

  /**
   * The control. Without it the assertions above would also pass for a
   * repository that had simply stopped using the tenant pool at all.
   */
  it("still opens tenant-scoped commands on the runtime pool", async () => {
    const { runtime, pricing, subject } = repository();

    await expect(subject.mutate(command("accounts"))).rejects.toBeInstanceOf(
      PoolOpened,
    );

    expect(runtime.opened).toEqual(["begin"]);
    expect(pricing.opened).toEqual([]);
  });
});
