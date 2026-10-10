import type * as ScenarioServer from "../sales-pricing/scenario-server";
import { beforeEach, expect, it, vi } from "vitest";
import type { PricingScenarioRecord } from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  scenarios: { list: vi.fn(), get: vi.fn() },
}));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.session,
  getRequestCommerceSession: mocks.session,
  explicitDemoIdentityEnabled: () => false,
}));
vi.mock("@/src/db/service", () => ({
  getServiceDatabase: vi.fn(),
  getOptionalServiceDatabase: vi.fn(),
}));
vi.mock("../sales-pricing/scenario-server", async (original) => ({
  ...(await original<typeof ScenarioServer>()),
  scenarioRepository: () => mocks.scenarios,
}));
import { checkLineItems } from "./line-items";
import {
  importScenarioLineItems,
  listImportableScenarios,
} from "./scenario-import";

const userId = "019a44ac-0000-7000-8000-0000000000aa";
const as = (role: string, patch: Record<string, unknown> = {}) =>
  mocks.session.mockResolvedValue({
    userId,
    profile: { name: "Seller", email: "seller@fil.one" },
    roles: [role],
    isInternalStaff: true,
    mfaVerified: true,
    ...patch,
  });
const scenario = {
  id: "019a44ac-0000-7000-8000-00000000ab01",
  ownerId: userId,
  ownerName: "Seller",
  name: "Acme Q4",
  company: "Acme",
  notes: "",
  currency: "EUR",
  asOf: "2026-10-09",
  priceBooks: [{ id: "60000000-0000-4000-8000-000000000001", version: 3 }],
  lines: [
    {
      bookId: "60000000-0000-4000-8000-000000000001",
      bookVersion: 3,
      rateId: "61000000-0000-4000-8000-000000000001",
      sku: "STORAGE-TB",
      region: "eu-west",
      unit: "TB-month",
      unitPrice: { currency: "EUR", minor: "1500" },
      minimumQuantity: "10.000000000000000000",
      quantity: "500",
      termMonths: 12,
      discountBps: 1000,
    },
  ],
  createdAt: "2026-10-09T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
  version: 2,
} as unknown as PricingScenarioRecord;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scenarios.list.mockResolvedValue([
    {
      ...scenario,
      lineCount: 1,
      total: { currency: "EUR", minor: "8100000" },
    },
  ]);
  mocks.scenarios.get.mockResolvedValue(scenario);
});

it("lists a seller's own scenarios and an administrator's every scenario", async () => {
  as("revenue");
  await expect(listImportableScenarios()).resolves.toEqual({
    ok: true,
    value: [
      {
        id: scenario.id,
        name: "Acme Q4",
        company: "Acme",
        ownerName: "Seller",
        asOf: "2026-10-09",
        lineCount: 1,
        total: { currency: "EUR", minor: "8100000" },
      },
    ],
  });
  expect(mocks.scenarios.list).toHaveBeenLastCalledWith({
    kind: "own",
    ownerId: userId,
  });
  as("commerce_admin");
  await listImportableScenarios();
  expect(mocks.scenarios.list).toHaveBeenLastCalledWith({ kind: "all" });
});

it("refuses anyone who cannot both prepare contracts and use the sales workspace", async () => {
  for (const permissions of [["contract:write"], ["sales:read"]]) {
    as("revenue", { permissions });
    await expect(listImportableScenarios()).resolves.toEqual({
      ok: false,
      code: "CONTRACT_FORBIDDEN",
    });
    await expect(importScenarioLineItems({ id: scenario.id })).resolves.toEqual(
      { ok: false, code: "CONTRACT_FORBIDDEN" },
    );
  }
  expect(mocks.scenarios.list).not.toHaveBeenCalled();
  expect(mocks.scenarios.get).not.toHaveBeenCalled();
});

it("copies a scenario's lines and currency into a table the prepare check accepts", async () => {
  as("revenue");
  const result = await importScenarioLineItems({ id: scenario.id });
  if (!result.ok) throw new Error(result.code);
  expect(mocks.scenarios.get).toHaveBeenCalledWith(scenario.id, {
    kind: "own",
    ownerId: userId,
  });
  expect(result.value).toEqual({
    kind: "lines",
    lineItems: {
      currency: "EUR",
      scenario: {
        id: scenario.id,
        name: "Acme Q4",
        version: 2,
        asOf: "2026-10-09",
      },
      rows: [
        {
          sku: "STORAGE-TB",
          description: "",
          region: "eu-west",
          unit: "TB-month",
          quantity: "500",
          termMonths: 12,
          unitPriceMinor: "1500",
          minimumQuantity: "10.000000000000000000",
          discountBps: 1000,
          extendedMinor: "8100000",
          scenarioLine: 0,
        },
      ],
    },
  });
  if (result.value.kind !== "lines") throw new Error("refused");
  expect(checkLineItems(result.value.lineItems).ok).toBe(true);
});

it("names the first scenario line the agreement cannot print", async () => {
  as("revenue");
  const [line] = scenario.lines;
  mocks.scenarios.get.mockResolvedValue({
    ...scenario,
    lines: [line, { ...line, sku: "STORAGE-[TB]" }],
  });
  await expect(importScenarioLineItems({ id: scenario.id })).resolves.toEqual({
    ok: true,
    value: { kind: "refused", line: 2, code: "characters" },
  });
});
