import "server-only";

import type { WorkOS } from "@workos-inc/node";

interface SessionBinding {
  sessionId: string;
  workosUserId: string;
  workosOrganizationId: string;
}

function timestamp(value: string): number | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  )
    return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) &&
    parsed > 0 &&
    new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
    ? parsed
    : undefined;
}

/**
 * WorkOS requires enrolled users to complete TOTP on password/Magic Auth
 * sign-in, although its access token may omit `amr`:
 * https://workos.com/docs/reference/authkit/authentication
 * https://workos.com/docs/authkit/mfa
 *
 * Confirm the exact original provider session and a current factor that already
 * existed at that sign-in. Enrollment alone is insufficient, and SSO, migrated
 * sessions and impersonation do not have this authentication-flow guarantee.
 * This establishes ordinary session assurance only: it never issues a challenge
 * receipt, binds an access token to a factor, or renews recent authentication.
 */
export async function verifyWorkosHostedMfaSession(
  client: WorkOS,
  binding: SessionBinding,
): Promise<{ factorId: string } | undefined> {
  if (
    !binding.sessionId ||
    !binding.workosUserId ||
    !binding.workosOrganizationId
  )
    return undefined;
  try {
    const sessions = await (
      await client.userManagement.listSessions(binding.workosUserId)
    ).autoPagination();
    const matches = sessions.filter(({ id }) => id === binding.sessionId);
    if (matches.length !== 1) return undefined;
    const session = matches[0];
    if (!session) return undefined;
    const now = Date.now();
    const createdAt = timestamp(session.createdAt);
    const expiresAt = timestamp(session.expiresAt);
    if (
      session.userId !== binding.workosUserId ||
      session.organizationId !== binding.workosOrganizationId ||
      session.status !== "active" ||
      session.endedAt !== null ||
      session.impersonator ||
      !["password", "magic_code"].includes(session.authMethod) ||
      createdAt === undefined ||
      createdAt > now ||
      expiresAt === undefined ||
      expiresAt <= now
    )
      return undefined;

    const factors = await (
      await client.multiFactorAuth.listUserAuthFactors({
        userId: binding.workosUserId,
      })
    ).autoPagination();
    // Read every page: multiple factors are ambiguous even across pages.
    if (factors.length !== 1) return undefined;
    const factor = factors[0];
    if (!factor) return undefined;
    const enrolledAt = timestamp(factor.createdAt);
    const verified =
      factor.userId === binding.workosUserId &&
      factor.type === "totp" &&
      Boolean(factor.id) &&
      enrolledAt !== undefined &&
      enrolledAt < createdAt;
    return verified ? { factorId: factor.id } : undefined;
  } catch {
    // Provider outages or unknown response shapes cannot establish assurance.
    return undefined;
  }
}
