import { createHmac, timingSafeEqual } from "node:crypto";
import type { SigningRecipient } from "@clockwork/contracts";

export const recipientLinkLifetimeSeconds = 7 * 86400;
export const recipientSessionLifetimeSeconds = 8 * 3600;

function signature(
  recipient: Pick<SigningRecipient, "id" | "nonce">,
  expires: number,
  secret: string,
) {
  if (secret.length < 32) throw new Error("SIGNING_LINK_SECRET_REQUIRED");
  return createHmac("sha256", secret)
    .update(`fil-one-signing:v1:${recipient.id}:${recipient.nonce}:${expires}`)
    .digest();
}

export function recipientAccessToken(
  recipient: Pick<SigningRecipient, "id" | "nonce">,
  secret: string,
  expires: number,
) {
  return `${expires}.${signature(recipient, expires, secret).toString("base64url")}`;
}

export function verifyRecipientAccess(
  recipient: SigningRecipient,
  token: string,
  secret: string,
  now = Date.now(),
): number | null {
  const match = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || recipient.revoked) return null;
  const expires = Number(match[1]);
  const seconds = Math.floor(now / 1000);
  if (
    expires <= seconds ||
    expires > seconds + recipientLinkLifetimeSeconds + 60
  )
    return null;
  const actual = Buffer.from(match[2] ?? "", "base64url");
  const expected = signature(recipient, expires, secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? expires
    : null;
}

/** Provider capabilities must never become arbitrary iframe/redirect URLs. */
export function signWellRecipientUrl(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== "https://www.signwell.com" ||
    url.username ||
    url.password ||
    !/^\/docs\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
    url.hash
  )
    throw new Error("SIGNING_URL_REFUSED");
  return url.href;
}
