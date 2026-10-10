"use server";

import { z } from "zod";
import type { Money, TemplateLineItems } from "@clockwork/contracts";
import {
  scenarioRepository,
  scenarioScope,
} from "../sales-pricing/scenario-server";
import { attempt } from "./action-result";
import { scenarioLineItems } from "./line-items";
import { ContractAccessError, contractStaff, sessionHas } from "./server";

export interface ImportableScenario {
  id: string;
  name: string;
  company: string;
  ownerName: string;
  asOf: string;
  lineCount: number;
  total: Money;
}

/**
 * Whoever prepares a contract and may use the sales workspace reaches the
 * scenarios the pricing page shows them: a seller their own, a commerce
 * administrator every one.
 */
async function importer() {
  const session = await contractStaff("contract:write");
  if (!sessionHas(session, "sales:read"))
    throw new ContractAccessError("CONTRACT_FORBIDDEN");
  return session;
}

/** Saved scenarios to import into a line-item field, newest first. */
export async function listImportableScenarios() {
  return attempt(async (): Promise<ImportableScenario[]> => {
    const session = await importer();
    const scenarios = await scenarioRepository().list(scenarioScope(session));
    return scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      company: scenario.company,
      ownerName: scenario.ownerName,
      asOf: scenario.asOf,
      lineCount: scenario.lineCount,
      total: scenario.total,
    }));
  });
}

/**
 * One scenario's lines and currency as a line-item table, linked to the
 * scenario, or the first line the table cannot carry and why.
 */
export async function importScenarioLineItems(raw: unknown) {
  return attempt(
    async (): Promise<
      | { kind: "lines"; lineItems: TemplateLineItems }
      | { kind: "refused"; line: number; code: string }
    > => {
      const session = await importer();
      const { id } = z.object({ id: z.uuid() }).strict().parse(raw);
      const imported = scenarioLineItems(
        await scenarioRepository().get(id, scenarioScope(session)),
      );
      return imported.ok
        ? { kind: "lines", lineItems: imported.lineItems }
        : { kind: "refused", line: imported.line, code: imported.code };
    },
  );
}
