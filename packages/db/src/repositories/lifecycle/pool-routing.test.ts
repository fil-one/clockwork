import { describe, expect, it } from "vitest";

import { ids } from "@clockwork/contracts";
import type { AuthorizationContext } from "@clockwork/domain";
import { exceptionQueues } from "@clockwork/domain/lifecycle";

import type { RuntimeDatabase } from "../../client";
import {
  DatabaseLifecycleCommandRepository,
  type DatabaseLifecycleCommandInput,
} from "./command-repository";

/**
 * Which pool a lifecycle command opens is the whole question, so these handles
 * report distinguishable connection roles and record which one was opened. The
 * existing suites all build the repository with `database: db,
 * serviceDatabase: db` over one superuser connection, where either role can be
 * assumed and a misrouted command is invisible.
 *
 * `create_signature_envelope` and `decide_poc` are here because they were the
 * defect: both are tenant commands that claim a `provider_operations` row, and
 * the two tempting ways to make that claim succeed -- adding them to
 * `staffServiceCommand`, or routing them to the service pool outright -- would
 * take a customer-initiated write out of row-level security. The admission is a
 * row policy instead
 * (supabase/migrations/001399_provider_operations_tenant_claim.sql), and this
 * test fails if anyone later moves the commands rather than the policy.
 */
class TrackingPool {
  public readonly opened: string[] = [];

  public constructor(private readonly user: string) {}

  public get db(): RuntimeDatabase {
    const handle = {
      $client: { options: { user: this.user } },
      transaction: (): Promise<never> => {
        this.opened.push("begin");
        // Stop before any SQL. Simulating the command body would prove nothing
        // the pool identity does not already prove.
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

const authorizationSecret = "lifecycle-pool-routing-secret-32-bytes-long";
const occurredAt = "2026-08-01T16:00:00.000Z";

function authorization(internal: boolean): AuthorizationContext {
  return {
    userId: ids.user.parse("20000000-0000-4000-8000-000000000002"),
    accountIds: [ids.account.parse("10000000-0000-4000-8000-000000000001")],
    roles: [internal ? "internal_operator" : "owner"],
    isInternalStaff: internal,
    mfaVerified: true,
    recentAuthenticationVerified: true,
  };
}

function command(
  name: DatabaseLifecycleCommandInput["command"],
  options: { internal?: boolean; provider?: boolean } = {},
): DatabaseLifecycleCommandInput {
  return {
    command: name,
    payload: {},
    context: {
      requestId: `lifecycle-pool-routing-${name}`,
      actor: options.provider
        ? { kind: "provider", id: "esign" }
        : { kind: "user", id: "20000000-0000-4000-8000-000000000002" },
      idempotencyKey: `lifecycle-pool-routing-${name}-0001`,
      ip: "192.0.2.40",
      userAgent: "Clockwork lifecycle pool routing",
      occurredAt,
      authorization: authorization(options.internal ?? false),
    },
  };
}

function repository() {
  const runtime = new TrackingPool("clockwork_runtime");
  const service = new TrackingPool("clockwork_service");
  return {
    runtime,
    service,
    subject: new DatabaseLifecycleCommandRepository({
      database: runtime.db,
      serviceDatabase: service.db,
      authorizationSecret,
      policies: {
        clickThroughThresholdMinor: "1000000",
        migrationFeatureEnabled: false,
        automatedTeardownEnabled: false,
        exceptionQueues: exceptionQueues.map((queue) => ({
          queue,
          ownerId: "20000000-0000-4000-8000-000000000001",
          backupId: "20000000-0000-4000-8000-000000000005",
          targetBusinessHours: 8,
          escalationOwnerId: "20000000-0000-4000-8000-000000000006",
          separationRequired: true,
        })),
      },
    }),
  };
}

describe("lifecycle command pool routing", () => {
  for (const name of ["create_signature_envelope", "decide_poc"] as const) {
    it(`opens ${name} on the tenant pool, never the service pool`, async () => {
      const { runtime, service, subject } = repository();

      await expect(
        subject.executeInTransaction(command(name)),
      ).rejects.toBeInstanceOf(PoolOpened);

      expect(runtime.opened).toEqual(["begin"]);
      expect(service.opened).toEqual([]);
    });
  }

  it("still opens a verified provider callback on the service pool", async () => {
    const { runtime, service, subject } = repository();

    await expect(
      subject.executeInTransaction(
        command("ingest_signature_event", { provider: true }),
      ),
    ).rejects.toBeInstanceOf(PoolOpened);

    expect(service.opened).toEqual(["begin"]);
    expect(runtime.opened).toEqual([]);
  });

  it("still opens an internal staff command on the service pool", async () => {
    const { runtime, service, subject } = repository();

    await expect(
      subject.executeInTransaction(
        command("publish_agreement_template", { internal: true }),
      ),
    ).rejects.toBeInstanceOf(PoolOpened);

    expect(service.opened).toEqual(["begin"]);
    expect(runtime.opened).toEqual([]);
  });
});
