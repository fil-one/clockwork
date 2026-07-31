import type { ProviderResult } from "@clockwork/contracts";

export type FakeOutcome = "success" | "transient_failure" | "permanent_failure";

export interface FakeScenario {
  outcome: FakeOutcome;
  delayMs?: number;
  duplicate?: boolean;
  callbacks?: readonly { id: string; type: string; payload: unknown }[];
  callbackOrder?: "in_order" | "reverse";
  code?: string;
  message?: string;
}

export interface DelayScheduler {
  wait(milliseconds: number): Promise<void>;
}

export class ImmediateScheduler implements DelayScheduler {
  public readonly delays: number[] = [];

  public async wait(milliseconds: number): Promise<void> {
    this.delays.push(milliseconds);
    await Promise.resolve();
  }
}

export class FakeProviderKernel {
  private readonly scenarios = new Map<string, FakeScenario[]>();
  private readonly callbacks: { id: string; type: string; payload: unknown }[] =
    [];
  public readonly calls: { operation: string; input: unknown }[] = [];

  public constructor(
    private readonly scheduler: DelayScheduler = new ImmediateScheduler(),
  ) {}

  public enqueue(operation: string, ...scenarios: FakeScenario[]): void {
    this.scenarios.set(operation, [
      ...(this.scenarios.get(operation) ?? []),
      ...scenarios,
    ]);
  }

  public async execute<T>(
    operation: string,
    input: unknown,
    success: () => T,
  ): Promise<ProviderResult<T>> {
    this.calls.push({ operation, input });
    const scenario = this.scenarios.get(operation)?.shift() ?? {
      outcome: "success",
    };
    if (scenario.delayMs) await this.scheduler.wait(scenario.delayMs);

    const callbacks = [...(scenario.callbacks ?? [])];
    if (scenario.callbackOrder === "reverse") callbacks.reverse();
    for (const callback of callbacks) {
      this.callbacks.push(callback);
      if (scenario.duplicate) this.callbacks.push({ ...callback });
    }

    if (scenario.outcome === "transient_failure") {
      return {
        ok: false,
        kind: "transient",
        code: scenario.code ?? "FAKE_TRANSIENT",
        message: scenario.message ?? "Deterministic transient provider failure",
        retryAfterMs: scenario.delayMs ?? 1000,
      };
    }
    if (scenario.outcome === "permanent_failure") {
      return {
        ok: false,
        kind: "permanent",
        code: scenario.code ?? "FAKE_PERMANENT",
        message: scenario.message ?? "Deterministic permanent provider failure",
      };
    }
    return {
      ok: true,
      value: success(),
      ...(scenario.duplicate === undefined
        ? {}
        : { duplicate: scenario.duplicate }),
    };
  }

  public drainCallbacks(): readonly {
    id: string;
    type: string;
    payload: unknown;
  }[] {
    return this.callbacks.splice(0);
  }

  public reset(): void {
    this.scenarios.clear();
    this.callbacks.splice(0);
    this.calls.splice(0);
  }
}
