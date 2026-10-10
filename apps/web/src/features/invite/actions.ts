"use server";

import { switchToOrganization } from "@workos-inc/authkit-nextjs";

import {
  deactivateWorkosStaffMembership,
  provisionWorkosStaff,
  removeWorkosOrganizationMembership,
  type WorkosMembershipOutcome,
} from "@clockwork/integrations";
import type { InviteRepository } from "@clockwork/db";

import {
  getVerifiedWorkosSession,
  SessionExpiredError,
  workosAuthenticationConfigured,
} from "@/src/auth/session";

import type { AcceptInviteResult } from "./model";
import { inviteRepository, inviteTokenShape } from "./server";

const fail = (code: string): AcceptInviteResult => ({ ok: false, code });

const codeOf = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  return /^INVITE_[A-Z_]+$/u.test(message) ? message : null;
};

interface Binding {
  inviteId: string;
  workosUserId: string;
  organizationId: string;
  membershipId: string;
  outcome: WorkosMembershipOutcome;
}

/**
 * Puts the provider membership back the way it was when Commerce refused the
 * acceptance after the provider step: a membership provisioning created is
 * deleted, one it reactivated is deactivated again, and one that was already
 * active, or that a Commerce membership holds (the winner of a race), is
 * kept. Each case is logged and audited as `invite.compensated`; a failure
 * here is logged, not raised, so the reader still sees why it was refused.
 */
async function compensate(
  repository: InviteRepository,
  apiKey: string,
  binding: Binding,
  reason: string,
) {
  const target = {
    organizationId: binding.organizationId,
    membershipId: binding.membershipId,
  };
  let action:
    "removed" | "deactivated" | "kept_existing" | "kept_in_use" | "failed";
  try {
    if (await repository.workosMembershipInUse(binding.membershipId))
      action = "kept_in_use";
    else if (binding.outcome === "created") {
      await removeWorkosOrganizationMembership(apiKey, target);
      action = "removed";
    } else if (binding.outcome === "reactivated") {
      await deactivateWorkosStaffMembership(apiKey, target);
      action = "deactivated";
    } else action = "kept_existing";
  } catch (error) {
    action = "failed";
    console.error("Invite acceptance refused; WorkOS membership not restored", {
      reason,
      inviteId: binding.inviteId,
      workosUserId: binding.workosUserId,
      membershipId: binding.membershipId,
      outcome: binding.outcome,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  if (action !== "failed")
    console.warn("Invite acceptance refused; WorkOS membership restored", {
      reason,
      inviteId: binding.inviteId,
      workosUserId: binding.workosUserId,
      membershipId: binding.membershipId,
      outcome: binding.outcome,
      action,
    });
  await repository
    .recordCompensation({
      inviteId: binding.inviteId,
      workosUserId: binding.workosUserId,
      workosMembershipId: binding.membershipId,
      outcome: binding.outcome,
      action,
      reason,
    })
    .catch((error: unknown) =>
      console.error("Invite compensation could not be audited", {
        inviteId: binding.inviteId,
        error: error instanceof Error ? error.message : "unknown",
      }),
    );
}

/**
 * Accepts an invite as the signed-in person it was sent to. Their WorkOS
 * email must be verified and match the invite, and an impersonated session
 * cannot accept for them. Commerce checks everything first; only then does
 * the person join the organization's WorkOS organization and Commerce record
 * the membership. If Commerce refuses after the provider step (a lost race),
 * the provider membership is put back as it was (see `compensate`). The
 * session then moves to the new organization.
 */
export async function acceptInvite(
  token: unknown,
): Promise<AcceptInviteResult> {
  if (typeof token !== "string" || !inviteTokenShape.test(token))
    return fail("INVITE_NOT_FOUND");
  const apiKey = process.env.WORKOS_API_KEY;
  if (!workosAuthenticationConfigured() || !apiKey)
    return fail("INVITE_UNAVAILABLE");
  let next: { workosOrganizationId: string; home: string };
  let binding: Binding | null = null;
  let repository: InviteRepository | null = null;
  try {
    const session = await getVerifiedWorkosSession();
    if (session.impersonator) return fail("INVITE_IMPERSONATION_REFUSED");
    const { user } = session;
    repository = inviteRepository();
    const acceptance = {
      token,
      workosUserId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
    };
    const checked = await repository.checkAcceptable(acceptance);
    if (!checked.workosOrganizationId)
      return fail("INVITE_ORGANIZATION_NOT_READY");
    const name =
      [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const provisioned = await provisionWorkosStaff(
      apiKey,
      checked.workosOrganizationId,
      { email: user.email, name },
    );
    binding = {
      inviteId: checked.inviteId,
      workosUserId: provisioned.workosUserId,
      organizationId: checked.workosOrganizationId,
      membershipId: provisioned.workosMembershipId,
      outcome: provisioned.outcome,
    };
    if (provisioned.workosUserId !== user.id)
      throw new Error("INVITE_IDENTITY_CONFLICT");
    const accepted = await repository.accept({
      ...acceptance,
      name,
      workosMembershipId: provisioned.workosMembershipId,
    });
    next = {
      workosOrganizationId: checked.workosOrganizationId,
      home: accepted.side === "customer" ? "/dashboard" : "/partner",
    };
  } catch (error) {
    if (error instanceof SessionExpiredError) return fail("SESSION_EXPIRED");
    const code = codeOf(error);
    if (binding && repository)
      await compensate(repository, apiKey, binding, code ?? "unexpected");
    if (code) return fail(code);
    const message = error instanceof Error ? error.message : "";
    console.error("Invite acceptance failed", {
      error: error instanceof Error ? error.name : "unknown",
      provider: message.startsWith("STAFF_") ? message : undefined,
    });
    return fail("INVITE_FAILED");
  }
  // Outside the try: switching redirects by throwing.
  await switchToOrganization(next.workosOrganizationId, {
    returnTo: next.home,
  });
  return { ok: true };
}
