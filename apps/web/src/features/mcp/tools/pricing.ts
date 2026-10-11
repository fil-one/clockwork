// i18n-exempt-file: MCP tool names, descriptions and results are read by MCP clients and the model, not rendered in the interface
import "server-only";

import { z } from "zod";

import {
  PricingPartnerEconomicsSchema,
  pricingCapacityUnits,
  pricingCustomerSummaryAvailable,
  pricingPartnerSummaryAvailable,
  type Money,
  type PricingScenarioRecord,
} from "@clockwork/contracts";
import {
  indicativeScenarioPrice,
  scenarioPartnerEconomics,
} from "@clockwork/domain/core";
import {
  DatabaseIndicativePriceBookReader,
  resolvePricingScenarioLines,
} from "@clockwork/db";

import { getServiceDatabase } from "@/src/db/service";
import { contractStaff } from "@/src/features/internal-ops/contracts/server";
import { saveScenario } from "@/src/features/internal-ops/sales-pricing/scenario-actions";
import {
  scenarioRepository,
  scenarioScope,
  scenarioToday,
} from "@/src/features/internal-ops/sales-pricing/scenario-server";

import {
  appLink,
  compact,
  defineTool,
  McpToolError,
  unwrap,
  type McpToolContext,
} from "../tool";

/** Money as a decimal amount; every book currency has two decimals. */
function amount(money: Money) {
  const minor = BigInt(money.minor);
  const sign = minor < 0n ? "-" : "";
  const absolute = minor < 0n ? -minor : minor;
  return {
    currency: money.currency,
    amount: `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`,
  };
}

/** Converts every Money-shaped value in a result into decimal amounts. */
function amounts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(amounts);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      typeof record.currency === "string" &&
      typeof record.minor === "string" &&
      Object.keys(record).length === 2
    )
      return amount(record as Money);
    return Object.fromEntries(
      Object.entries(record).map(([key, field]) => [key, amounts(field)]),
    );
  }
  return value;
}

async function booksInForce() {
  await contractStaff("sales:read");
  return new DatabaseIndicativePriceBookReader(
    getServiceDatabase(),
  ).listInForce({ today: scenarioToday() });
}

const lineInput = z
  .object({
    rateId: z.uuid().describe("From list_price_books"),
    bookId: z
      .uuid()
      .optional()
      .describe("Defaults to the book in force that holds the rate"),
    quantity: z.string().describe('Capacity, such as "500" or "1.5"'),
    quantityUnit: z.enum(pricingCapacityUnits).optional(),
    termMonths: z.number().int().min(1).max(120),
    discountPct: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Off list price, such as 10 for 10%"),
  })
  .strict();
type LineInput = z.infer<typeof lineInput>;

function lineEntries(
  lines: readonly LineInput[],
  books: Awaited<ReturnType<typeof booksInForce>>,
) {
  return lines.map((entry) => ({
    bookId:
      entry.bookId ??
      books.find((book) =>
        book.rateCards?.some((rate) => rate.id === entry.rateId),
      )?.id ??
      "00000000-0000-4000-8000-000000000000",
    rateId: entry.rateId,
    quantity: entry.quantity,
    ...(entry.quantityUnit ? { quantityUnit: entry.quantityUnit } : {}),
    termMonths: entry.termMonths,
    discountBps: Math.round((entry.discountPct ?? 0) * 100),
  }));
}

const partnerEconomicsInput = z
  .unknown()
  .optional()
  .describe(
    'Optional partner model. referral: {"model":"referral","commissionBps":1500,"steps":[{"fromMonth":13,"commissionBps":1000}]}. resale: {"model":"resale","customerPriceMinor":"650","marginBps":3200} or with "buyPriceMinor". other: {"model":"other","partnerShareBps":0,"partnerPerUnitMinor":"0","partnerMonthlyMinor":"0"}. Prices are minor units per TB-month.',
  );

export const listPriceBooks = defineTool({
  name: "list_price_books",
  title: "List price books in force",
  description:
    "The active price books in force today and their list-price rates (rate id, SKU, region, unit, list price, minimum quantity). The ids feed indicative_price and save_pricing_scenario.",
  input: {},
  access: "read",
  run: async () => {
    const books = await booksInForce();
    return {
      asOf: scenarioToday(),
      books: books.map((book) => ({
        id: book.id,
        name: book.name,
        currency: book.currency,
        version: book.version,
        effectiveFrom: book.effectiveFrom,
        effectiveTo: book.effectiveTo,
        rates: (book.rateCards ?? []).map((rate) =>
          compact({
            id: rate.id,
            sku: rate.sku,
            region: rate.region,
            unit: rate.unit,
            listPrice: amount(rate.unitPrice),
            minimumQuantity: rate.minimumQuantity,
            commitType: rate.commitType,
            egress: rate.egressTreatment,
          }),
        ),
      })),
    };
  },
});

export const indicativePrice = defineTool({
  name: "indicative_price",
  title: "Indicative price",
  description:
    "Prices lines from the books in force exactly as the Pricing page does, without saving anything: list price less discount, monthly, first-year and term totals, and partner economics when a partner model is given. Quantities may be entered in TB, PB, TiB or PiB. Indicative list pricing only.",
  input: {
    lines: z.array(lineInput).min(1).max(20),
    partnerEconomics: partnerEconomicsInput,
  },
  access: "read",
  run: async ({ lines, partnerEconomics }) => {
    const books = await booksInForce();
    const resolved = resolvePricingScenarioLines(
      lineEntries(lines, books),
      books,
    );
    const economics =
      partnerEconomics === undefined || partnerEconomics === null
        ? null
        : PricingPartnerEconomicsSchema.parse(partnerEconomics);
    const price = indicativeScenarioPrice(resolved);
    return amounts({
      asOf: scenarioToday(),
      lines: resolved.map((line, index) =>
        compact({
          sku: line.sku,
          region: line.region,
          unit: line.unit,
          quantity: line.quantity,
          entered: line.entered,
          termMonths: line.termMonths,
          discountBps: line.discountBps,
          listUnitPrice: line.unitPrice,
          ...price.lines[index],
        }),
      ),
      subtotal: price.subtotal,
      discount: price.discount,
      monthly: price.monthly,
      firstYear: price.annual,
      total: price.total,
      ...(economics
        ? { partnerEconomics: scenarioPartnerEconomics(resolved, economics) }
        : {}),
    });
  },
});

function scenarioView(
  scenario: PricingScenarioRecord,
  context: McpToolContext,
) {
  const price = indicativeScenarioPrice(scenario.lines);
  return amounts(
    compact({
      id: scenario.id,
      name: scenario.name,
      company: scenario.company,
      owner: scenario.ownerName,
      notes: scenario.notes,
      asOf: scenario.asOf,
      lines: scenario.lines.map((line) =>
        compact({
          rateId: line.rateId,
          bookId: line.bookId,
          sku: line.sku,
          region: line.region,
          unit: line.unit,
          quantity: line.quantity,
          entered: line.entered,
          termMonths: line.termMonths,
          discountBps: line.discountBps,
          listUnitPrice: line.unitPrice,
        }),
      ),
      monthly: price.monthly,
      firstYear: price.annual,
      total: price.total,
      partnerEconomics: scenario.partnerEconomics
        ? {
            inputs: scenario.partnerEconomics,
            figures: scenarioPartnerEconomics(
              scenario.lines,
              scenario.partnerEconomics,
            ),
          }
        : undefined,
      updatedAt: scenario.updatedAt,
      version: scenario.version,
      link: appLink(context, `/internal/pricing?scenario=${scenario.id}`),
    }),
  );
}

export const listPricingScenarios = defineTool({
  name: "list_pricing_scenarios",
  title: "List pricing scenarios",
  description:
    "Your saved pricing scenarios (every seller's for a commerce administrator) with totals. With id, one scenario's lines, totals and partner economics.",
  input: { id: z.uuid().optional() },
  access: "read",
  run: async ({ id }, context) => {
    const session = await contractStaff("sales:read");
    const repository = scenarioRepository();
    if (id) {
      context.targets.scenarioId = id;
      return scenarioView(
        await repository.get(id, scenarioScope(session)),
        context,
      );
    }
    const scenarios = await repository.list(scenarioScope(session));
    return {
      scenarios: scenarios.map((scenario) =>
        amounts({
          ...scenario,
          link: appLink(context, `/internal/pricing?scenario=${scenario.id}`),
        }),
      ),
    };
  },
});

export const savePricingScenario = defineTool({
  name: "save_pricing_scenario",
  title: "Save a pricing scenario",
  description:
    "Saves a pricing scenario for a prospect, priced on the server from the books in force today, or overwrites one when id and expectedVersion are given. Lines and partner economics take the same shape as indicative_price.",
  input: {
    id: z.uuid().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    name: z.string().min(1).max(120),
    company: z.string().min(1).max(200),
    notes: z.string().max(2000).optional(),
    lines: z.array(lineInput).min(1).max(20),
    partnerEconomics: partnerEconomicsInput,
  },
  access: "write",
  run: async (args, context) => {
    const books = await booksInForce();
    const id = args.id ?? crypto.randomUUID();
    context.targets.scenarioId = id;
    const saved = unwrap(
      await saveScenario({
        id,
        name: args.name,
        company: args.company,
        notes: args.notes ?? "",
        lines: lineEntries(args.lines, books),
        partnerEconomics: args.partnerEconomics ?? null,
        ...(args.expectedVersion
          ? { expectedVersion: args.expectedVersion }
          : {}),
      }),
    );
    return {
      id: saved.id,
      version: saved.version,
      link: appLink(context, `/internal/pricing?scenario=${saved.id}`),
    };
  },
});

export const pricingSummaryPdfLink = defineTool({
  name: "pricing_summary_pdf_link",
  title: "Pricing summary PDF link",
  description:
    "The download link for a saved scenario's indicative pricing summary PDF: the customer summary (list pricing only), or the partner summary with the partner's earnings when the scenario has partner inputs on lines in one unit. The link opens in the app for anyone signed in with access; downloads are audited.",
  input: {
    id: z.uuid(),
    audience: z.enum(["customer", "partner"]).optional(),
  },
  access: "read",
  run: async ({ id, audience }, context) => {
    context.targets.scenarioId = id;
    const session = await contractStaff("sales:read");
    const scenario = await scenarioRepository().get(id, scenarioScope(session));
    const wanted = audience ?? "customer";
    const available =
      wanted === "partner"
        ? pricingPartnerSummaryAvailable(scenario)
        : pricingCustomerSummaryAvailable(scenario);
    if (!available)
      throw new McpToolError(
        "summary_unavailable",
        wanted === "partner"
          ? "A partner summary needs partner inputs and every line in one unit."
          : "A resale scenario's customer summary needs every line in one unit.",
      );
    return {
      id,
      audience: wanted,
      link: appLink(
        context,
        `/internal/pricing/scenarios/${id}/summary${wanted === "partner" ? "?audience=partner" : ""}`,
      ),
    };
  },
});

export const pricingTools = [
  listPriceBooks,
  indicativePrice,
  listPricingScenarios,
  savePricingScenario,
  pricingSummaryPdfLink,
];
