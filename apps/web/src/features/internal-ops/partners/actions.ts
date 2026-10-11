"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt, type ActionResult } from "../contracts/action-result";
import { contractReader } from "../contracts/demo-access";
import { contractActor, contractStaff } from "../contracts/server";
import { partnerReader, partnerRepository, partnerToday } from "./server";

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

/**
 * Records a partner, or saves an edit made against the version the form
 * opened at. Anyone with `contract:write` may change any partner; each change
 * is audited with who made it and what changed.
 */
export async function savePartner(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("contract:write");
    const partner = await partnerRepository().save(raw, contractActor(session));
    revalidatePath("/internal/partners");
    return { id: partner.id, version: partner.version };
  });
}

/**
 * Registers or edits a deal. Overlapping registrations by other partners
 * come back with the result so the form can warn; they never block the save.
 */
export async function savePartnerDeal(raw: unknown) {
  return run(async () => {
    const session = await contractStaff("contract:write");
    const { deal, conflicts } = await partnerRepository().saveDeal(
      raw,
      contractActor(session),
      partnerToday(),
    );
    revalidatePath(`/internal/partners/${deal.partnerId}`);
    return {
      id: deal.id,
      version: deal.version,
      status: deal.status,
      conflicts,
    };
  });
}

/** Other partners' open registrations for an end client, while a seller types. */
export async function findPartnerDealConflicts(raw: unknown) {
  return run(async () => {
    const session = await contractReader("sales:read");
    const { endClient, partnerId } = z
      .object({ endClient: z.string().trim().max(200), partnerId: z.guid() })
      .strict()
      .parse(raw);
    if (!endClient) return [];
    return partnerReader(session).dealConflicts(endClient, {
      excludePartnerId: partnerId,
      today: partnerToday(),
    });
  });
}
