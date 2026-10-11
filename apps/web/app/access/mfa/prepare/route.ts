import { claimMfaPreparationAttempt } from "@clockwork/db";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import {
  getVerifiedWorkosSession,
  SessionExpiredError,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import { prepareMfaProof } from "../prepared-challenge";

const reply = (body: object, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });

/** Only an intentional same-origin POST creates a challenge; GET/prefetch cannot. */
export async function POST(request: Request) {
  if (
    !process.env.APP_ORIGIN ||
    request.headers.get("origin") !== process.env.APP_ORIGIN
  )
    return reply({ error: "unavailable" }, 403);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return reply({ error: "unavailable" }, 415);
  if ((await request.text()).length > 0)
    return reply({ error: "unavailable" }, 400);
  try {
    const session = await getVerifiedWorkosSession();
    if (!session.organizationId || !session.sessionId || session.impersonator)
      return reply({ error: "unavailable" }, 403);
    if (
      !(await claimMfaPreparationAttempt(getServiceDatabase(), session.user.id))
    )
      return reply({ error: "limited" }, 429);
    const provider = getWorkOS().multiFactorAuth;
    const factors = await (
      await provider.listUserAuthFactors({ userId: session.user.id })
    ).autoPagination();
    const owned = factors.filter(
      (factor) => factor.type === "totp" && factor.userId === session.user.id,
    );
    const factor = owned[0];
    if (owned.length !== 1 || !factor)
      return reply({ error: "unavailable" }, 409);
    const challenge = await provider.challengeFactor({
      authenticationFactorId: factor.id,
    });
    if (challenge.authenticationFactorId !== factor.id)
      return reply({ error: "unavailable" }, 503);
    return reply(
      prepareMfaProof({
        challengeId: challenge.id,
        factorId: factor.id,
        sessionId: session.sessionId,
        workosUserId: session.user.id,
        workosOrganizationId: session.organizationId,
        providerExpiresAt: challenge.expiresAt,
      }),
    );
  } catch (error) {
    return reply(
      {
        error: error instanceof SessionExpiredError ? "expired" : "unavailable",
      },
      503,
    );
  }
}
