import { claimMfaAttempt, recordMfaReceipt } from "@clockwork/db";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import {
  getVerifiedWorkosSession,
  SessionExpiredError,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import { mfaReturnTo } from "../return-to";

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
  const form = new URLSearchParams(body);
  const code = form.get("code")?.trim() ?? "";
  const returnTo =
    form.getAll("returnTo").length === 1
      ? mfaReturnTo(form.get("returnTo"))
      : undefined;
  const failure = (error: string) => {
    const query = new URLSearchParams({ error });
    if (returnTo) query.set("returnTo", returnTo);
    return redirect(`/access/mfa?${query}`);
  };
  if (!/^\d{6}$/.test(code)) return failure("invalid");
  try {
    const session = await getVerifiedWorkosSession();
    if (!session.organizationId || !session.sessionId || session.impersonator)
      return new Response(null, { status: 403 });
    const database = getServiceDatabase();
    if (!(await claimMfaAttempt(database, session.user.id)))
      return failure("limited");
    const provider = getWorkOS().multiFactorAuth;
    const factors = await provider.listUserAuthFactors({
      userId: session.user.id,
    });
    const factor = factors.data.find((candidate) => candidate.type === "totp");
    if (!factor) return failure("unavailable");
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
      return failure("invalid");
    await recordMfaReceipt(database, {
      sessionId: session.sessionId,
      workosUserId: session.user.id,
      workosOrganizationId: session.organizationId,
      challengeId: challenge.id,
      factorId: factor.id,
    });
    return redirect(returnTo ?? "/");
  } catch (error) {
    // This POST skips the proxy, so an expired access token cannot be
    // refreshed here. The redirected GET goes through the proxy, which
    // refreshes the session or sends the reader to sign in; no attempt was
    // claimed and no receipt written, so the reader enters a code again.
    if (error instanceof SessionExpiredError) return failure("expired");
    return failure("unavailable");
  }
}
