"use server";

import { z } from "zod";
import { attempt } from "../contracts/action-result";
import { contractActor, contractStaff } from "../contracts/server";
import {
  scenarioRepository,
  scenarioScope,
  scenarioToday,
} from "./scenario-server";

/**
 * Saves a scenario, or overwrites one when the input carries the version it
 * was opened at. Each line is priced on the server from the books in force
 * today; the browser sends only the book, rate and the seller's entry.
 */
export async function saveScenario(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("sales:read");
    const saved = await scenarioRepository().save(
      raw,
      contractActor(session),
      scenarioScope(session),
      scenarioToday(),
    );
    return { id: saved.id, version: saved.version };
  });
}

export async function deleteScenario(raw: unknown) {
  return attempt(async () => {
    const session = await contractStaff("sales:read");
    const { id, expectedVersion } = z
      .object({ id: z.uuid(), expectedVersion: z.int().min(1) })
      .strict()
      .parse(raw);
    await scenarioRepository().delete(
      id,
      expectedVersion,
      contractActor(session),
      scenarioScope(session),
    );
    return { id };
  });
}
