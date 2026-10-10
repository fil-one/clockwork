import "server-only";
import {
  TemplateLineItemsSchema,
  type TemplateField,
  type TemplateLineItems,
} from "@clockwork/contracts";
import { DatabaseIndicativePriceBookReader } from "@clockwork/db";
import { getServiceDatabase } from "@/src/db/service";
import {
  scenarioRepository,
  scenarioScope,
  scenarioToday,
} from "../sales-pricing/scenario-server";
import { rateMinimums, scenarioNote, type RateMinimums } from "./line-items";
import type { ContractStaffSession } from "./server";

/**
 * The minimums of the rates in force today, which a template's line-item
 * table is checked against. Read only when the template has such a field.
 */
export async function templateRateMinimums(
  fields: readonly TemplateField[],
): Promise<RateMinimums> {
  if (!fields.some((field) => field.kind === "line_items")) return new Map();
  const books = await new DatabaseIndicativePriceBookReader(
    getServiceDatabase(),
  ).listInForce({ today: scenarioToday() });
  return rateMinimums(books);
}

/**
 * The register's pricing notes for tables imported from a pricing scenario,
 * each checked against the scenario as it is now (`scenarioNote`). Naming a
 * scenario the caller cannot reach, or one since deleted, refuses the
 * preparation; the seller can detach the scenario and prepare again.
 */
export async function importedScenarioNotes(
  session: ContractStaffSession,
  values: Readonly<Record<string, unknown>>,
) {
  const tables = Object.values(values).flatMap((value) => {
    const parsed = TemplateLineItemsSchema.safeParse(value);
    return parsed.success && parsed.data.scenario ? [parsed.data] : [];
  });
  if (!tables.length) return "";
  const repository = scenarioRepository();
  const scope = scenarioScope(session);
  const notes = await Promise.all(
    tables.map(async (items: TemplateLineItems) =>
      scenarioNote(
        items,
        await repository.get(items.scenario?.id ?? "", scope),
      ),
    ),
  );
  return notes.join("\n");
}
