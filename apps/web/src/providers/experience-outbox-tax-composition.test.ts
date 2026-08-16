import type { TaxPort } from "@clockwork/contracts";
import { ids, MoneySchema } from "@clockwork/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The third tax-composition site, pinned.
 *
 * `apps/web/e2e/production-workflow-proof.ts` composes the whole production
 * experience outbox drain. The tax port reaches exactly one of the handlers it
 * builds -- `DatabaseAuthoritativePortalCommandExecutor` -- while the
 * projection materializer and the five `experience.*` acknowledgement handlers
 * never ask it anything. Composing with `requiredTaxProvider()` threw while the
 * argument list was being built, so an unwired `EXT-TAX-01` decomposed the
 * entire drain, materialization included, before a single message was claimed.
 *
 * That is not a hypothetical configuration. `isolatedReleaseEnvironment`
 * (scripts/release-artifacts.mjs) deletes every `.env.example` name from the
 * inherited environment, `TAX_PROVIDER_BASE_URL` and `TAX_PROVIDER_TOKEN` are
 * both documented there, and the `proof` shard in scripts/release-suites.mjs
 * re-supplies neither -- so this is the environment every release proof run
 * actually gets, at production-proof.spec.ts:497, :537 and :930.
 *
 * The same over-broad gate was already corrected in the API composition
 * (hono-app.ts) and in webhook replay (internal-ops/webhook-replay/actions.ts).
 * This file is the third.
 *
 * It lives under `src/` because that is where vitest looks: apps/web's unit and
 * integration configs both include only `{src,app}/**`, so a test placed next
 * to the e2e helper would never run.
 */
const mocks = vi.hoisted(() => ({
  configureDatabaseTransactionInstrumentation: vi.fn(),
  createRuntimeDatabase: vi.fn(),
  end: vi.fn(),
  handlers: vi.fn(),
  dispatchBatch: vi.fn(),
}));

vi.mock("@clockwork/db", () => ({
  configureDatabaseTransactionInstrumentation:
    mocks.configureDatabaseTransactionInstrumentation,
  createRuntimeDatabase: mocks.createRuntimeDatabase,
  DatabaseOutboxDispatcherStore: class {},
}));
vi.mock("@clockwork/integrations/telemetry", () => ({
  ClockworkTelemetry: class {},
  OtlpHttpTelemetrySink: class {},
  RuntimeBoundaryInstrumentation: class {
    public db<T>(input: { operation: () => T }): T {
      return input.operation();
    }

    public workflow<T>(input: { operation: () => T }): T {
      return input.operation();
    }
  },
}));
vi.mock("@clockwork/workflows", () => ({
  createProductionExperienceOutboxHandlers: mocks.handlers,
  DurableOutboxDispatcher: class {
    public dispatchBatch = mocks.dispatchBatch;
  },
}));

import { drainProductionExperienceOutbox } from "../../e2e/production-workflow-proof";

/** The port the drain actually handed the handler factory, for this call. */
function composedTaxPort(): TaxPort {
  expect(mocks.handlers).toHaveBeenCalledTimes(1);
  const options = mocks.handlers.mock.calls[0]?.[0] as { tax: TaxPort };
  return options.tax;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Exactly what the release harness leaves behind: the database and
  // authorization variables the proof shard re-supplies, and no tax engine.
  delete process.env.TAX_PROVIDER_BASE_URL;
  delete process.env.TAX_PROVIDER_TOKEN;
  process.env.CLOCKWORK_SERVICE_DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  process.env.AUTHORIZATION_CONTEXT_SECRET = "x".repeat(48);
  mocks.createRuntimeDatabase.mockReturnValue({
    db: {},
    client: { end: mocks.end },
  });
  mocks.handlers.mockReturnValue(new Map([["experience.noop", () => {}]]));
  mocks.dispatchBatch.mockResolvedValue({ delivered: 4, failed: 0 });
});

describe("the production experience outbox drain's tax composition", () => {
  it("drains when no tax engine is configured", async () => {
    // Unfixed, this rejected with `TAX_PROVIDER_NOT_CONFIGURED:EXT-TAX-01`
    // thrown out of `requiredTaxProvider()` while the handler factory's
    // argument list was being evaluated -- no dispatcher, no claim, no
    // materialization, on every one of the three call sites.
    await expect(
      drainProductionExperienceOutbox("release-proof-tax-composition"),
    ).resolves.toMatchObject({ delivered: 4 });
    expect(mocks.dispatchBatch).toHaveBeenCalledWith(
      "release-proof-tax-composition",
      100,
    );
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it("hands the handlers a tax port that refuses rather than one that throws", async () => {
    await drainProductionExperienceOutbox("release-proof-tax-refusal");
    const tax = composedTaxPort();

    // Not a zero-rate stub. The two commands that can write a `tax_minor`
    // still fail closed; every handler that never asks the port is unaffected.
    await expect(
      tax.calculate({
        accountId: ids.account.parse("10000000-0000-4000-8000-000000000001"),
        jurisdiction: "ES",
        lines: [
          {
            taxCode: "txcd_demo",
            amount: MoneySchema.parse({ currency: "EUR", minor: "168000" }),
          },
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      kind: "permanent",
      code: "TAX_PROVIDER_NOT_CONFIGURED",
    });
    await expect(
      tax.validateTaxId({ country: "ES", value: "ESA12345674" }),
    ).resolves.toMatchObject({
      ok: false,
      code: "TAX_PROVIDER_NOT_CONFIGURED",
    });
  });

  it("still refuses to run without the variables the proof shard does supply", async () => {
    // The gate that belongs at composition stays there: these two are
    // re-supplied by the release harness and their absence is a real
    // misconfiguration, not an unwired optional provider.
    delete process.env.CLOCKWORK_SERVICE_DATABASE_URL;
    await expect(
      drainProductionExperienceOutbox("release-proof-no-database"),
    ).rejects.toThrow("CLOCKWORK_SERVICE_DATABASE_URL");
    expect(mocks.handlers).not.toHaveBeenCalled();
  });
});
