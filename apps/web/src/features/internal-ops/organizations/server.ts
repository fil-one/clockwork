import "server-only";

import {
  InviteRepository,
  OrganizationOnboardingRepository,
  type OrganizationInvite,
  type HandoffRequestDetail,
  type OnboardingOrganizationDetail,
  type OnboardingOrganizationSummary,
} from "@clockwork/db";

import {
  explicitDemoIdentityEnabled,
  getRequestCommerceSession,
} from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";

import {
  ContractAccessError,
  contractStaff,
  sessionHas,
  type ContractStaffSession,
} from "../contracts/server";
import { handoffRepository, type Loaded } from "../handoff/server";

/**
 * Customer and partner organizations staff set up. The service role does not
 * narrow rows: `operations:read` reads them and `operations:write` creates
 * them, checked here and in the actions.
 */
export function onboardingRepository() {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const database = getOptionalServiceDatabase();
  if (!database) throw new Error("ONBOARDING_UNAVAILABLE");
  return new OrganizationOnboardingRepository(database);
}

/**
 * Invites to these organizations. Links are derived with the deployment's
 * authorization secret, so the page can show a pending link again.
 */
export function organizationInviteRepository() {
  if (explicitDemoIdentityEnabled())
    throw new ContractAccessError("CONTRACT_DEMO_UNAVAILABLE");
  const database = getOptionalServiceDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!database || !secret || secret.length < 32)
    throw new Error("INVITE_UNAVAILABLE");
  return new InviteRepository(database, secret);
}

async function load<T>(
  permission: "operations:read" | "operations:write",
  read: (session: ContractStaffSession) => Promise<T>,
): Promise<Loaded<T>> {
  if (explicitDemoIdentityEnabled()) return { kind: "demo" };
  if (!getOptionalServiceDatabase()) return { kind: "unavailable" };
  let session: ContractStaffSession;
  try {
    session = await contractStaff(permission, getRequestCommerceSession);
  } catch {
    return { kind: "forbidden" };
  }
  try {
    return { kind: "ready", value: await read(session) };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "ONBOARDING_ORGANIZATION_NOT_FOUND" ||
        error.message === "HANDOFF_NOT_FOUND")
    )
      return { kind: "forbidden" };
    console.error("Organizations could not be read", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return { kind: "unavailable" };
  }
}

export function loadOrganizations() {
  return load<OnboardingOrganizationSummary[]>("operations:read", () =>
    onboardingRepository().list(),
  );
}

export function loadOrganization(id: string) {
  return load<{
    organization: OnboardingOrganizationDetail;
    /** Null when invites cannot be read here, for example with no secret. */
    invites: OrganizationInvite[] | null;
    canWrite: boolean;
  }>("operations:read", async (session) => {
    const organization = await onboardingRepository().get(id);
    const invites = await Promise.resolve()
      .then(() => organizationInviteRepository().list(id))
      .catch((error: unknown) => {
        console.error("Organization invites could not be read", {
          error: error instanceof Error ? error.message : "unknown",
        });
        return null;
      });
    const canWrite = sessionHas(session, "operations:write");
    return {
      organization,
      // A pending link lets whoever holds it join; only someone who may
      // invite sees it. Readers see the invite without its link.
      invites: canWrite
        ? invites
        : (invites?.map((invite) => ({ ...invite, path: null })) ?? null),
      canWrite,
    };
  });
}

/** The handoff a new organization is set up from, to prefill the form. */
export function loadOnboardingHandoff(id: string | undefined) {
  return load<HandoffRequestDetail | null>("operations:write", async () =>
    id ? handoffRepository().get(id, { kind: "all" }) : null,
  );
}
