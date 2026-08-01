/**
 * Provider effects are authorized from persisted gate state at the last
 * possible boundary. Environment variables and adapter construction are not
 * authorization signals.
 */
export const providerRuntimeGateKeys = [
  "EXT-ACC-01",
  "EXT-PROVIDER-01",
  "EXT-PROVISION-01",
  "EXT-APPROVERS-01",
  "EXT-TEARDOWN-01",
  "EXT-MARKETPLACE-01",
  "EXT-MIGRATION-01",
] as const;

export type ProviderRuntimeGateKey = (typeof providerRuntimeGateKeys)[number];
export type ProviderRuntimeEnvironment =
  "development" | "test" | "staging" | "production";
export type ProviderRuntimeMode = "live" | "simulator";
export type ProviderEffectBoundary =
  | "lifecycle"
  | "provider_effect"
  | "replay"
  | "assisted_action"
  | "redrive"
  | "recovery";

export const providerOperationPolicies = {
  "hosted-account.probe": {
    gates: ["EXT-ACC-01"],
    createsExternalEffect: false,
  },
  "provider.effect": {
    gates: ["EXT-ACC-01", "EXT-PROVIDER-01"],
    createsExternalEffect: true,
  },
  "provider.reconcile": {
    gates: ["EXT-ACC-01", "EXT-PROVIDER-01"],
    createsExternalEffect: false,
  },
  "provisioning.provision": {
    gates: ["EXT-ACC-01", "EXT-PROVIDER-01", "EXT-PROVISION-01"],
    createsExternalEffect: true,
  },
  "provisioning.reconcile": {
    gates: ["EXT-ACC-01", "EXT-PROVISION-01"],
    createsExternalEffect: false,
  },
  "provisioning.teardown": {
    gates: [
      "EXT-ACC-01",
      "EXT-PROVIDER-01",
      "EXT-PROVISION-01",
      "EXT-APPROVERS-01",
      "EXT-TEARDOWN-01",
    ],
    createsExternalEffect: true,
  },
  "marketplace.effect": {
    gates: ["EXT-ACC-01", "EXT-PROVIDER-01", "EXT-MARKETPLACE-01"],
    createsExternalEffect: true,
  },
  "marketplace.reconcile": {
    gates: ["EXT-ACC-01", "EXT-MARKETPLACE-01"],
    createsExternalEffect: false,
  },
  "migration.snapshot.read": {
    gates: ["EXT-ACC-01", "EXT-MIGRATION-01"],
    createsExternalEffect: false,
  },
  "migration.execute": {
    gates: [
      "EXT-ACC-01",
      "EXT-PROVIDER-01",
      "EXT-APPROVERS-01",
      "EXT-MIGRATION-01",
    ],
    createsExternalEffect: true,
  },
  "recovery.internal": { gates: [], createsExternalEffect: false },
} as const satisfies Record<
  string,
  {
    gates: readonly ProviderRuntimeGateKey[];
    createsExternalEffect: boolean;
  }
>;

export type ProviderOperationName = keyof typeof providerOperationPolicies;

export interface PersistedProviderGateState {
  gateKey: ProviderRuntimeGateKey;
  activationAllowed: boolean;
  effectiveStatus:
    | "active"
    | "blocked"
    | "pending"
    | "review"
    | "not_required"
    | "expired"
    | "unavailable"
    | "emergency_disabled";
  rowVersion: number;
  reviewOn: string | null;
  updatedAt: string;
}

export interface ProviderGateStateStore {
  load(input: {
    gateKeys: readonly ProviderRuntimeGateKey[];
    requestId: string;
  }): Promise<readonly PersistedProviderGateState[]>;
}

export interface PersistedExternalGateViewReader {
  list(input: { requestId: string; now: Date }): Promise<
    readonly {
      gateKey: string;
      activationAllowed: boolean;
      effectiveStatus: string;
      rowVersion: number;
      reviewOn: string | null;
      updatedAt: string;
    }[]
  >;
}

/**
 * Production composition adapter for DatabaseExternalGateService (or another
 * durable gate repository). It deliberately has no environment fallback.
 */
export class PersistedProviderGateStateStore implements ProviderGateStateStore {
  public constructor(
    private readonly reader: PersistedExternalGateViewReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async load(input: {
    gateKeys: readonly ProviderRuntimeGateKey[];
    requestId: string;
  }): Promise<readonly PersistedProviderGateState[]> {
    if (input.gateKeys.length === 0) return [];
    const requested = new Set(input.gateKeys);
    const rows = await this.reader.list({
      requestId: input.requestId,
      now: this.now(),
    });
    return rows.flatMap((row) => {
      if (!requested.has(row.gateKey as ProviderRuntimeGateKey)) return [];
      return [
        {
          gateKey: row.gateKey as ProviderRuntimeGateKey,
          activationAllowed: row.activationAllowed,
          effectiveStatus: providerGateStatus(row.effectiveStatus),
          rowVersion: row.rowVersion,
          reviewOn: row.reviewOn,
          updatedAt: row.updatedAt,
        },
      ];
    });
  }
}

export interface ProviderRuntimeContext {
  environment: ProviderRuntimeEnvironment;
  mode: ProviderRuntimeMode;
  boundary: ProviderEffectBoundary;
  requestId: string;
  effectId: string;
  idempotencyKey?: string;
}

export interface ProviderRuntimeAuthorization {
  operation: ProviderOperationName;
  gateVersions: Readonly<Partial<Record<ProviderRuntimeGateKey, number>>>;
  mayInvokeProvider: boolean;
  mayCreateEffectOutbox: boolean;
}

export type ProviderRuntimeDenialCode =
  | "PRODUCTION_SIMULATOR_FORBIDDEN"
  | "PROVIDER_GATE_REGISTER_UNAVAILABLE"
  | "PROVIDER_GATE_INACTIVE"
  | "PROVIDER_EFFECT_IDEMPOTENCY_REQUIRED"
  | "RECOVERY_EFFECT_FORBIDDEN";

export class ProviderRuntimeDeniedError extends Error {
  public constructor(
    public readonly code: ProviderRuntimeDenialCode,
    public readonly gateKeys: readonly ProviderRuntimeGateKey[] = [],
  ) {
    super(
      gateKeys.length === 0
        ? code
        : `${code}:${[...gateKeys].sort().join(",")}`,
    );
    this.name = "ProviderRuntimeDeniedError";
  }
}

export function isProviderRuntimeDeniedError(
  error: unknown,
): error is ProviderRuntimeDeniedError {
  return error instanceof ProviderRuntimeDeniedError;
}

export class ProviderRuntime {
  public constructor(
    private readonly gates: ProviderGateStateStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async authorize(
    operation: ProviderOperationName,
    context: ProviderRuntimeContext,
  ): Promise<ProviderRuntimeAuthorization> {
    const policy = providerOperationPolicies[operation];
    if (context.environment === "production" && context.mode === "simulator")
      throw new ProviderRuntimeDeniedError("PRODUCTION_SIMULATOR_FORBIDDEN");
    if (
      policy.createsExternalEffect &&
      (!context.idempotencyKey || context.idempotencyKey.length < 8)
    )
      throw new ProviderRuntimeDeniedError(
        "PROVIDER_EFFECT_IDEMPOTENCY_REQUIRED",
      );
    if (context.boundary === "recovery" && policy.createsExternalEffect)
      throw new ProviderRuntimeDeniedError("RECOVERY_EFFECT_FORBIDDEN");

    let persisted: readonly PersistedProviderGateState[] = [];
    if (policy.gates.length > 0) {
      try {
        persisted = await this.gates.load({
          gateKeys: policy.gates,
          requestId: context.requestId,
        });
      } catch {
        throw new ProviderRuntimeDeniedError(
          "PROVIDER_GATE_REGISTER_UNAVAILABLE",
          policy.gates,
        );
      }
    }
    const byKey = new Map(persisted.map((gate) => [gate.gateKey, gate]));
    const today = this.now().toISOString().slice(0, 10);
    const inactive = policy.gates.filter((gateKey) => {
      const gate = byKey.get(gateKey);
      return (
        !gate ||
        gate.activationAllowed !== true ||
        gate.effectiveStatus !== "active" ||
        (gate.reviewOn !== null && gate.reviewOn < today)
      );
    });
    if (inactive.length > 0)
      throw new ProviderRuntimeDeniedError("PROVIDER_GATE_INACTIVE", inactive);
    return {
      operation,
      gateVersions: Object.fromEntries(
        persisted.map((gate) => [gate.gateKey, gate.rowVersion]),
      ),
      mayInvokeProvider: operation !== "recovery.internal",
      mayCreateEffectOutbox: policy.createsExternalEffect,
    };
  }

  public async execute<T>(input: {
    operation: ProviderOperationName;
    context: ProviderRuntimeContext;
    invoke(authorization: ProviderRuntimeAuthorization): Promise<T>;
  }): Promise<T> {
    const authorization = await this.authorize(input.operation, input.context);
    return input.invoke(authorization);
  }
}

export class ProviderEffectBoundaryExecutor {
  public constructor(private readonly runtime: ProviderRuntime) {}

  public async execute<TResult, TPersisted>(input: {
    operation: ProviderOperationName;
    context: ProviderRuntimeContext;
    invoke(): Promise<TResult>;
    persist(input: {
      result: TResult;
      authorization: ProviderRuntimeAuthorization;
    }): Promise<TPersisted>;
  }): Promise<TPersisted> {
    const authorization = await this.runtime.authorize(
      input.operation,
      input.context,
    );
    const result = await input.invoke();
    return input.persist({ result, authorization });
  }
}

/** Test-only persisted-state substitute. Production composition is rejected. */
export class DeterministicProviderGateStateStore implements ProviderGateStateStore {
  private readonly states = new Map<
    ProviderRuntimeGateKey,
    PersistedProviderGateState
  >();

  public constructor(
    environment: ProviderRuntimeEnvironment,
    states: readonly PersistedProviderGateState[],
  ) {
    if (environment === "production")
      throw new Error("PRODUCTION_GATE_STATE_SIMULATOR_FORBIDDEN");
    for (const state of states) this.states.set(state.gateKey, { ...state });
  }

  public load(input: {
    gateKeys: readonly ProviderRuntimeGateKey[];
    requestId: string;
  }): Promise<readonly PersistedProviderGateState[]> {
    return Promise.resolve(
      input.gateKeys.flatMap((gateKey) => {
        const state = this.states.get(gateKey);
        return state ? [{ ...state }] : [];
      }),
    );
  }
}

function providerGateStatus(
  value: string,
): PersistedProviderGateState["effectiveStatus"] {
  if (
    value === "active" ||
    value === "blocked" ||
    value === "pending" ||
    value === "review" ||
    value === "not_required" ||
    value === "expired" ||
    value === "unavailable" ||
    value === "emergency_disabled"
  )
    return value;
  return "unavailable";
}
