import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { ids } from "@clockwork/contracts";

export const releaseProofCookieName = "__Host-clockwork-proof";

export interface ReleaseProofPayload {
  sessionId: string;
  expiresAt: string;
  nonce: string;
}

export interface ReleaseProofConfiguration {
  origin: string;
  secret: string;
}

export function releaseProofConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ReleaseProofConfiguration | undefined {
  if (
    environment.NODE_ENV !== "production" ||
    environment.CLOCKWORK_RELEASE_PROOF !== "1"
  )
    return undefined;
  const configuredOrigin = environment.APP_ORIGIN?.trim();
  const secret = environment.CLOCKWORK_PROOF_AUTH_SECRET;
  if (!configuredOrigin || !secret || Buffer.byteLength(secret) < 32)
    return undefined;
  try {
    const url = new URL(configuredOrigin);
    const normalized = configuredOrigin.replace(/\/$/, "");
    if (
      normalized !== url.origin ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol) ||
      (url.protocol === "http:" && url.hostname !== "localhost") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return undefined;
    return { origin: url.origin, secret };
  } catch {
    return undefined;
  }
}

function canonicalPayload(payload: ReleaseProofPayload): string {
  return JSON.stringify({
    sessionId: payload.sessionId,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  });
}

function signature(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

export function createReleaseProofCookieValue(
  payload: ReleaseProofPayload,
  secret: string,
): string {
  ids.impersonationSession.parse(payload.sessionId);
  if (!Number.isFinite(Date.parse(payload.expiresAt)))
    throw new Error("Release-proof expiry is invalid");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(payload.nonce))
    throw new Error("Release-proof nonce is invalid");
  if (Buffer.byteLength(secret) < 32)
    throw new Error("Release-proof secret must be at least 32 bytes");
  const encoded = Buffer.from(canonicalPayload(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifyReleaseProofCookieValue(
  value: string,
  configuration: ReleaseProofConfiguration,
  now = new Date(),
): ReleaseProofPayload {
  const [encoded, supplied, extra] = value.split(".");
  if (!encoded || !supplied || extra)
    throw new Error("Release-proof cookie is malformed");
  const expected = signature(encoded, configuration.secret);
  let suppliedBytes: Buffer;
  try {
    suppliedBytes = Buffer.from(supplied, "base64url");
  } catch {
    throw new Error("Release-proof signature is malformed");
  }
  if (
    suppliedBytes.length !== expected.length ||
    !timingSafeEqual(suppliedBytes, expected)
  )
    throw new Error("Release-proof signature is invalid");
  const parsed: unknown = JSON.parse(
    Buffer.from(encoded, "base64url").toString(),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Release-proof payload is invalid");
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "expiresAt,nonce,sessionId" ||
    typeof record.sessionId !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.nonce !== "string"
  )
    throw new Error("Release-proof payload is invalid");
  const payload = {
    sessionId: ids.impersonationSession.parse(record.sessionId),
    expiresAt: record.expiresAt,
    nonce: record.nonce,
  };
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())
    throw new Error("Release-proof session expired");
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(payload.nonce))
    throw new Error("Release-proof nonce is invalid");
  return payload;
}

export function releaseProofNonceHash(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

export function releaseProofPlaywrightCookie(input: {
  payload: ReleaseProofPayload;
  origin: string;
  secret: string;
}) {
  const origin = new URL(input.origin);
  return {
    name: releaseProofCookieName,
    value: createReleaseProofCookieValue(input.payload, input.secret),
    url: `${origin.origin}/`,
    path: "/",
    expires: Math.floor(Date.parse(input.payload.expiresAt) / 1_000),
    httpOnly: true,
    secure: true,
    sameSite: "Strict" as const,
  };
}
