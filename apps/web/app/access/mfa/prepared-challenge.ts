import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const lifetimeMs = 5 * 60 * 1000;
const identifier = z.string().min(1).max(200);
const schema = z
  .object({
    version: z.literal(1),
    challengeId: identifier,
    factorId: identifier,
    workosUserId: identifier,
    workosOrganizationId: identifier,
    sessionId: identifier,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export interface MfaBinding {
  workosUserId: string;
  workosOrganizationId: string;
  sessionId: string;
}

function key() {
  const secret = process.env.WORKOS_COOKIE_PASSWORD;
  if (!secret || Buffer.byteLength(secret) < 32)
    throw new Error("MFA_PREPARATION_UNAVAILABLE");
  return secret;
}
function signature(encoded: string) {
  return createHmac("sha256", key())
    .update("clockwork:mfa-preparation:v1\0")
    .update(encoded)
    .digest();
}

/** A challenge binding, never an MFA receipt or proof of successful verification. */
export function prepareMfaProof(
  input: MfaBinding & {
    challengeId: string;
    factorId: string;
    providerExpiresAt?: string | null | undefined;
  },
  now = Date.now(),
) {
  const providerExpiry =
    input.providerExpiresAt == null
      ? now + lifetimeMs
      : Date.parse(input.providerExpiresAt);
  if (!Number.isFinite(providerExpiry) || providerExpiry <= now)
    throw new Error("MFA_PREPARATION_UNAVAILABLE");
  const payload = schema.parse({
    version: 1,
    challengeId: input.challengeId,
    factorId: input.factorId,
    workosUserId: input.workosUserId,
    workosOrganizationId: input.workosOrganizationId,
    sessionId: input.sessionId,
    issuedAt: now,
    expiresAt: Math.min(now + lifetimeMs, providerExpiry),
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return {
    proof: `${encoded}.${signature(encoded).toString("base64url")}`,
    validForMs: payload.expiresAt - now,
  };
}

export function readMfaProof(
  proof: string,
  binding: MfaBinding,
  now = Date.now(),
) {
  if (
    proof.length > 2400 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(proof)
  )
    throw new Error("MFA_PREPARATION_INVALID");
  const [encoded, supplied] = proof.split(".");
  if (!encoded || !supplied) throw new Error("MFA_PREPARATION_INVALID");
  const expected = signature(encoded);
  const received = Buffer.from(supplied, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error("MFA_PREPARATION_INVALID");
  const payload = schema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  );
  if (
    payload.workosUserId !== binding.workosUserId ||
    payload.workosOrganizationId !== binding.workosOrganizationId ||
    payload.sessionId !== binding.sessionId ||
    payload.issuedAt > now ||
    payload.expiresAt <= now ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > lifetimeMs
  )
    throw new Error("MFA_PREPARATION_INVALID");
  return payload;
}
