"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { staffEmailDomainAllowed } from "@clockwork/contracts";
import { StaffTeamRepository, staffTeamErrorCodes } from "@clockwork/db";
import {
  deactivateWorkosStaffMembership,
  provisionWorkosStaff,
} from "@clockwork/integrations";

import type { CommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import {
  requireStaffPermission,
  StaffPermissionError,
} from "@/src/features/shell/staff-access";

import { inviteRoles, teamRoles, type TeamActionResult } from "./model";
import { configuredStaffDomains } from "./server";

const InviteSchema = z
  .object({
    name: z.string().trim().min(1).max(180),
    email: z
      .email()
      .max(320)
      .transform((value) => value.toLowerCase()),
    role: z.enum(inviteRoles),
    title: z.string().trim().max(180).optional(),
  })
  .strict();

const ChangeRoleSchema = z
  .object({
    userId: z.uuid(),
    role: z.enum(teamRoles),
    expectedRowVersion: z.int().positive(),
  })
  .strict();

const DeactivateSchema = z
  .object({
    userId: z.uuid(),
    expectedRowVersion: z.int().positive(),
  })
  .strict();

type Failure = Extract<TeamActionResult, { ok: false }>;
const fail = (code: Failure["code"]): Failure => ({ ok: false, code });

interface Authorized {
  session: CommerceSession & { organizationId: string };
  database: NonNullable<ReturnType<typeof getOptionalServiceDatabase>>;
  apiKey: string;
}

/**
 * Every team change is made by a commerce administrator acting as themselves,
 * with a sign-in checked in the last few minutes, against a real database and
 * identity provider. The repository checks the administrator's membership row
 * again inside its transaction.
 */
async function authorize(): Promise<Authorized | Failure> {
  let session: CommerceSession;
  try {
    session = await requireStaffPermission("staff:manage");
  } catch (error) {
    if (error instanceof StaffPermissionError) return fail("NOT_PERMITTED");
    // The session itself refused: most often an expired MFA check.
    return fail("RECENT_SIGN_IN_REQUIRED");
  }
  if (
    !session.mfaVerified ||
    session.impersonation ||
    session.assistedSession ||
    session.authenticationProviderImpersonator
  )
    return fail("DIRECT_SESSION_REQUIRED");
  const database = getOptionalServiceDatabase();
  const apiKey = process.env.WORKOS_API_KEY;
  if (
    !session.providerBacked ||
    !database ||
    !apiKey ||
    !session.organizationId
  )
    return fail("NOT_CONFIGURED");
  if (!session.recentAuthenticationVerified)
    return fail("RECENT_SIGN_IN_REQUIRED");
  return {
    session: { ...session, organizationId: session.organizationId },
    database,
    apiKey,
  };
}

/** Maps a refusal to a code the page words; never echoes provider detail. */
function failure(error: unknown, operation: string): Failure {
  const message = error instanceof Error ? error.message : "";
  if ((staffTeamErrorCodes as readonly string[]).includes(message))
    return fail(message.replace(/^STAFF_TEAM_/u, "") as Failure["code"]);
  if (
    message === "STAFF_IDENTITY_MISMATCH" ||
    message === "STAFF_IDENTITY_AMBIGUOUS" ||
    message === "STAFF_MEMBERSHIP_AMBIGUOUS"
  )
    return fail("IDENTITY_CONFLICT");
  if (
    message.startsWith("STAFF_WORKOS_") ||
    message === "STAFF_MEMBERSHIP_MISMATCH" ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    console.error("Staff team provider step failed", { operation, message });
    return fail("PROVIDER_FAILED");
  }
  console.error("Staff team change failed", {
    operation,
    error: error instanceof Error ? error.name : "unknown",
  });
  return fail("UNEXPECTED");
}

const requestId = (operation: string) =>
  `staff-team-${operation}:${crypto.randomUUID()}`;

export async function inviteStaffMember(
  raw: unknown,
): Promise<TeamActionResult> {
  const authorized = await authorize();
  if ("ok" in authorized) return authorized;
  const parsed = InviteSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const person = parsed.data;
  if (!staffEmailDomainAllowed(person.email, configuredStaffDomains()))
    return fail("DOMAIN_NOT_ALLOWED");
  const { session, database, apiKey } = authorized;
  const repository = new StaffTeamRepository(database);
  try {
    const { workosOrganizationId } = await repository.prepareInvite({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      email: person.email,
      requestId: requestId("invite-check"),
    });
    // WorkOS first: the commerce membership is only written once the person
    // exists in the staff organization. A failure after this point leaves a
    // WorkOS identity with no commerce access, and retrying reuses it.
    const binding = await provisionWorkosStaff(apiKey, workosOrganizationId, {
      email: person.email,
      name: person.name,
      ...(person.title ? { title: person.title } : {}),
    });
    await repository.completeInvite({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      email: person.email,
      name: person.name,
      role: person.role,
      binding,
      requestId: requestId("invite"),
    });
  } catch (error) {
    return failure(error, "invite");
  }
  revalidatePath("/internal/team");
  return { ok: true };
}

export async function changeStaffRole(raw: unknown): Promise<TeamActionResult> {
  const authorized = await authorize();
  if ("ok" in authorized) return authorized;
  const parsed = ChangeRoleSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { session, database } = authorized;
  try {
    // Roles live only in Postgres; WorkOS role slugs are informational.
    await new StaffTeamRepository(database).changeRole({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      ...parsed.data,
      requestId: requestId("role"),
    });
  } catch (error) {
    return failure(error, "role");
  }
  revalidatePath("/internal/team");
  return { ok: true };
}

export async function deactivateStaffMember(
  raw: unknown,
): Promise<TeamActionResult> {
  const authorized = await authorize();
  if ("ok" in authorized) return authorized;
  const parsed = DeactivateSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { session, database, apiKey } = authorized;
  const repository = new StaffTeamRepository(database);
  const target = {
    actorUserId: session.userId,
    organizationId: session.organizationId,
    ...parsed.data,
  };
  try {
    const { member, workosOrganizationId } = await repository.prepareDeactivate(
      {
        ...target,
        requestId: requestId("deactivate-check"),
      },
    );
    // WorkOS first, and idempotently: if the commerce write then fails, the
    // person still cannot select the staff organization, and a retry finds the
    // WorkOS membership already inactive and completes the commerce half.
    const workos =
      member.workosMembershipId && workosOrganizationId
        ? await deactivateWorkosStaffMembership(apiKey, {
            organizationId: workosOrganizationId,
            membershipId: member.workosMembershipId,
          })
        : "not_linked";
    await repository.completeDeactivate({
      ...target,
      workos,
      requestId: requestId("deactivate"),
    });
  } catch (error) {
    return failure(error, "deactivate");
  }
  revalidatePath("/internal/team");
  return { ok: true };
}
