import { claimMfaAttempt, recordMfaReceipt } from "@clockwork/db";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import { getVerifiedWorkosSession } from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";

function redirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "private, no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (
    !process.env.APP_ORIGIN ||
    request.headers.get("origin") !== process.env.APP_ORIGIN
  )
    return new Response(null, { status: 403 });
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    return new Response(null, { status: 415 });
  const body = await request.text();
  if (body.length > 1024) return new Response(null, { status: 413 });
  const code = new URLSearchParams(body).get("code")?.trim() ?? "";
  if (!/^\d{6}$/.test(code)) return redirect("/access/mfa?error=invalid");
  try {
    const session = await getVerifiedWorkosSession();
    if (!session.organizationId || !session.sessionId || session.impersonator)
      return new Response(null, { status: 403 });
    const database = getServiceDatabase();
    if (!(await claimMfaAttempt(database, session.user.id)))
      return redirect("/access/mfa?error=limited");
    const provider = getWorkOS().multiFactorAuth;
    const factors = await provider.listUserAuthFactors({
      userId: session.user.id,
    });
    const factor = factors.data.find((candidate) => candidate.type === "totp");
    if (!factor) return redirect("/access/mfa?error=unavailable");
    const challenge = await provider.challengeFactor({
      authenticationFactorId: factor.id,
    });
    const result = await provider.verifyChallenge({
      authenticationChallengeId: challenge.id,
      code,
    });
    if (
      !result.valid ||
      result.challenge.id !== challenge.id ||
      result.challenge.authenticationFactorId !== factor.id
    )
      return redirect("/access/mfa?error=invalid");
    await recordMfaReceipt(database, {
      sessionId: session.sessionId,
      workosUserId: session.user.id,
      workosOrganizationId: session.organizationId,
      challengeId: challenge.id,
      factorId: factor.id,
    });
    return redirect("/");
  } catch {
    return redirect("/access/mfa?error=unavailable");
  }
}
