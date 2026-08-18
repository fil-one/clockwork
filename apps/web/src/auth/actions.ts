"use server";

import { hasPermission, ids } from "@clockwork/contracts";
import { signOut, switchToOrganization } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveAuthorizedAccountSwitch } from "@/src/auth/identity-repository";
import {
  assistedSessionCookieName,
  getCommerceSession,
  requireRecentAuthentication,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import {
  createAssistedSession,
  endAssistedSession,
  endProviderAssistedSession,
} from "@/src/features/internal-ops/assisted-session/repository";

const requestId = (operation: string) =>
  `experience:${operation}:${crypto.randomUUID()}`;

function formText(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

export async function switchCommerceAccount(requestedAccountId: string) {
  const parsedAccountId = ids.account.safeParse(requestedAccountId);
  if (!parsedAccountId.success) return { ok: false as const };
  const accountId = parsedAccountId.data;
  const cookieStore = await cookies();
  const assistedCredential = cookieStore.get(assistedSessionCookieName)?.value;
  const commerceSession = await getCommerceSession();
  if (assistedCredential) {
    if (!commerceSession.assistedSession)
      cookieStore.delete(assistedSessionCookieName);
    return { ok: false as const };
  }
  if (
    commerceSession.authenticationSource !== "workos" ||
    !commerceSession.authenticationProviderUserId ||
    commerceSession.authenticationProviderImpersonator ||
    commerceSession.assistedSession
  )
    return { ok: false as const };
  let membership;
  try {
    membership = await resolveAuthorizedAccountSwitch(getServiceDatabase(), {
      workosUserId: commerceSession.authenticationProviderUserId,
      requestedAccountId: accountId,
      requestId: requestId("organization-switch"),
    });
  } catch {
    return { ok: false as const };
  }
  await switchToOrganization(membership.workosOrganizationId, {
    returnTo: membership.home,
  });
  return { ok: true as const };
}

export async function chooseCommerceAccount(formData: FormData) {
  const result = await switchCommerceAccount(formText(formData, "accountId"));
  if (!result.ok) throw new Error("Organization selection was denied");
}

export async function startAssistedSession(formData: FormData) {
  const session = await requireRecentAuthentication();
  if (
    !session.isInternalStaff ||
    !session.roles.some((role) =>
      hasPermission(role, "impersonation:assume"),
    ) ||
    !session.authenticationSessionId ||
    session.assistedSession
  )
    throw new Error("Assisted-action authority is required");
  const targetAccountId = ids.account.parse(
    formText(formData, "targetAccountId"),
  );
  const reason = formText(formData, "reason").trim();
  const assisted = await createAssistedSession(getServiceDatabase(), {
    authenticationSessionId: session.authenticationSessionId,
    internalUserId: session.userId,
    targetAccountId,
    reason,
    requestId: requestId("assisted-start"),
  });
  const cookieStore = await cookies();
  cookieStore.set(assistedSessionCookieName, assisted.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(
      1,
      Math.floor((assisted.expiresAt.getTime() - Date.now()) / 1_000),
    ),
  });
  redirect("/internal");
}

export async function exitAssistedSession() {
  const cookieStore = await cookies();
  const id = cookieStore.get(assistedSessionCookieName)?.value;
  try {
    if (id) {
      const session = await getCommerceSession();
      if (!session.authenticationSessionId)
        throw new Error("Authenticated session identity is missing");
      await endAssistedSession(getServiceDatabase(), {
        id: ids.impersonationSession.parse(id),
        authenticationSessionId: session.authenticationSessionId,
        internalUserId: session.userId,
        requestId: requestId("assisted-exit"),
      });
    }
  } finally {
    cookieStore.delete(assistedSessionCookieName);
  }
  redirect("/internal");
}

export async function exitProviderAssistedSession() {
  const session = await getCommerceSession();
  if (
    session.authenticationSource !== "workos" ||
    !session.authenticationProviderImpersonator ||
    session.assistedSessionProvider !== "workos" ||
    !session.assistedSession ||
    !session.authenticationSessionId
  )
    throw new Error("No provider assisted session is authorized for exit");
  await endProviderAssistedSession(getServiceDatabase(), {
    id: session.assistedSession.id,
    authenticationSessionId: session.authenticationSessionId,
    internalUserId: session.userId,
    actualActorEmail: session.assistedSession.actualActorEmail,
    requestId: requestId("provider-assisted-exit"),
  });
  await signOut({ returnTo: "/" });
}
