import { createHash } from "node:crypto";

import type { LifecycleMigrationSourcePort } from "@clockwork/db";
import type {
  DiscoveryRecord,
  SnapshotAccessAuthorization,
} from "@clockwork/domain/lifecycle";

/** Isolated simulator source for discovery/rehearsal tests; execution is opt-in. */
export class FixtureLifecycleMigrationSource implements LifecycleMigrationSourcePort {
  private readonly snapshotHash: string;

  public constructor(
    private readonly fixture: {
      sourceBytes: Uint8Array;
      sourceRecords: readonly DiscoveryRecord[];
      snapshotAccessAuthorization?: SnapshotAccessAuthorization;
      allowExecute?: boolean;
    },
  ) {
    this.snapshotHash = createHash("sha256")
      .update(fixture.sourceBytes)
      .digest("hex");
  }

  public load(
    input: Parameters<LifecycleMigrationSourcePort["load"]>[0],
  ): ReturnType<LifecycleMigrationSourcePort["load"]> {
    if (input.sourceSnapshotHash !== this.snapshotHash)
      return Promise.reject(new Error("FIXTURE_MIGRATION_SNAPSHOT_MISMATCH"));
    if (input.executionMode === "execute" && !this.fixture.allowExecute)
      return Promise.reject(new Error("FIXTURE_MIGRATION_EXECUTION_DISABLED"));
    return Promise.resolve({
      sourceKind: "fixture",
      sourceBytes: new Uint8Array(this.fixture.sourceBytes),
      sourceRecords: this.fixture.sourceRecords.map((record) => ({
        ...record,
        matchReasons: [...record.matchReasons],
        candidateAccountIds: [...record.candidateAccountIds],
      })),
      ...(this.fixture.snapshotAccessAuthorization
        ? {
            snapshotAccessAuthorization:
              this.fixture.snapshotAccessAuthorization,
          }
        : {}),
    });
  }
}
