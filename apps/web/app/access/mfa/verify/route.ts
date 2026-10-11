import { claimMfaAttempt, recordMfaReceipt } from "@clockwork/db";
import { getWorkOS } from "@workos-inc/authkit-nextjs";
import {
  getVerifiedWorkosSession,
  SessionExpiredError,
} from "@/src/auth/session";
import { getServiceDatabase } from "@/src/db/service";
import { mfaReturnTo } from "../return-to";
import { readMfaProof } from "../prepared-challenge";

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
  if (body.length > 4096) return new Response(null, { status: 413 });
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
    if (form.getAll("proof").length !== 1 || form.getAll("code").length !== 1)
      return failure("preparation");
    let prepared;
    try {
      prepared = readMfaProof(form.get("proof") ?? "", {
        sessionId: session.sessionId,
        workosUserId: session.user.id,
        workosOrganizationId: session.organizationId,
      });
    } catch {
      return failure("preparation");
    }
    const database = getServiceDatabase();
    if (!(await claimMfaAttempt(database, session.user.id)))
      return failure("limited");
    const provider = getWorkOS().multiFactorAuth;
    // Preparation is complete before code entry. No factor-list or challenge
    // request consumes the code's remaining lifetime before this verification.
    const result = await provider.verifyChallenge({
      authenticationChallengeId: prepared.challengeId,
      code,
    });
    if (
      !result.valid ||
      result.challenge.id !== prepared.challengeId ||
      result.challenge.authenticationFactorId !== prepared.factorId
    )
      return failure("invalid");
    // A reset/deletion since preparation must not grant an old factor a receipt.
    // This provider read happens AFTER the time-sensitive code verification.
    const factors = await (
      await provider.listUserAuthFactors({ userId: session.user.id })
    ).autoPagination();
    const owned = factors.filter(
      (factor) => factor.type === "totp" && factor.userId === session.user.id,
    );
    if (owned.length !== 1 || owned[0]?.id !== prepared.factorId)
      return failure("unavailable");
    await recordMfaReceipt(database, {
      sessionId: session.sessionId,
      workosUserId: session.user.id,
      workosOrganizationId: session.organizationId,
      challengeId: prepared.challengeId,
      factorId: prepared.factorId,
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
