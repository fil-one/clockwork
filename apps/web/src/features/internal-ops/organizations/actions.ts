"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { SessionExpiredError } from "@/src/auth/session";

import { attempt } from "../contracts/action-result";
import { contractActor, contractStaff } from "../contracts/server";
import { onboardingRepository, organizationInviteRepository } from "./server";

/** Runs an operations change; session expiry gets its own code. */
function operate<T>(change: () => Promise<T>) {
  return attempt(async () => {
    try {
      return await change();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        throw new Error("SESSION_EXPIRED");
      throw error;
    }
  });
}

/**
 * Operations creates a customer or partner organization, from a handoff it
 * is working or on its own. Held by internal operators and commerce
 * administrators through `operations:write`.
 */
export async function createOrganization(raw: unknown) {
  return operate(async () => {
    const session = await contractStaff("operations:write");
    const created = await onboardingRepository().create(
      raw,
      contractActor(session),
    );
    revalidatePath("/internal/organizations");
    revalidatePath("/internal/handoffs");
    return created;
  });
}

const InviteSchema = z
  .object({
    organizationId: z.uuid(),
    email: z.email().max(320),
    role: z.enum([
      "owner",
      "admin",
      "billing",
      "member",
      "partner_admin",
      "partner_seller",
    ]),
  })
  .strict();

/**
 * Operations invites someone into a customer or partner organization,
 * usually its first administrator, with any role its side allows. No email
 * is sent: the result carries the link to copy, and the organization page
 * shows it until it is used or expires.
 */
export async function inviteToOrganization(raw: unknown) {
  return operate(async () => {
    const session = await contractStaff("operations:write");
    const input = InviteSchema.parse(raw);
    const created = await organizationInviteRepository().createAsStaff(
      input,
      contractActor(session),
    );
    revalidatePath(`/internal/organizations/${input.organizationId}`);
    return created;
  });
}

const RevokeSchema = z
  .object({ organizationId: z.uuid(), inviteId: z.uuid() })
  .strict();

/** Operations ends a pending invite so its link stops working. */
export async function revokeInvitation(raw: unknown) {
  return operate(async () => {
    const session = await contractStaff("operations:write");
    const input = RevokeSchema.parse(raw);
    await organizationInviteRepository().revokeAsStaff(
      input,
      contractActor(session),
    );
    revalidatePath(`/internal/organizations/${input.organizationId}`);
    return { inviteId: input.inviteId };
  });
}
