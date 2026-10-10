"use server";

import { revalidatePath } from "next/cache";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt } from "../contracts/action-result";
import { contractActor, contractStaff } from "../contracts/server";
import { onboardingRepository } from "./server";

/**
 * Operations creates a customer or partner organization, from a handoff it
 * is working or on its own. Held by internal operators and commerce
 * administrators through `operations:write`.
 */
export async function createOrganization(raw: unknown) {
  return attempt(async () => {
    try {
      const session = await contractStaff("operations:write");
      const created = await onboardingRepository().create(
        raw,
        contractActor(session),
      );
      revalidatePath("/internal/organizations");
      revalidatePath("/internal/handoffs");
      return created;
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      throw error;
    }
  });
}
