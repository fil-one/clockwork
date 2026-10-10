"use server";

import { revalidatePath } from "next/cache";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt, type ActionResult } from "../contracts/action-result";
import { contractActor, contractStaff } from "../contracts/server";
import { handoffRepository } from "./server";

/** Session expiry is its own code so the page can offer a reload. */
async function run<T>(operation: () => Promise<T>): Promise<ActionResult<T>> {
  return attempt(async () => {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      throw error;
    }
  });
}

/** A seller with `contract:write` hands a signed contract to operations. */
export async function requestHandoff(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("contract:write");
    const request = await handoffRepository().create(
      raw,
      contractActor(session),
      // Commerce administrators reach every seller's scenarios.
      { anyScenario: session.roles.includes("commerce_admin") },
    );
    revalidatePath("/internal/handoffs");
    return { id: request.id, version: request.version };
  });
}

/**
 * Operations moves a request on: take it, mark it done, or decline it with a
 * note. `operations:write` is held by internal operators and commerce
 * administrators.
 */
export async function decideHandoff(
  decision: "take" | "complete" | "decline",
  raw: unknown,
) {
  return run(async () => {
    const session = await contractStaff("operations:write");
    const repository = handoffRepository();
    const actor = contractActor(session);
    const request =
      decision === "take"
        ? await repository.take(raw, actor)
        : decision === "complete"
          ? await repository.complete(raw, actor, {
              anyAssignee: session.roles.includes("commerce_admin"),
            })
          : decision === "decline"
            ? await repository.decline(raw, actor)
            : null;
    if (!request) throw new Error("INVALID_INPUT");
    revalidatePath("/internal/handoffs");
    return { id: request.id, version: request.version, status: request.status };
  });
}
