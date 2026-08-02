import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";

/**
 * Password gate for a demo deploy. It exists only while the demo flag and a
 * configured password are both present, and it uses Web Crypto throughout so
 * the same code runs in middleware on the edge runtime and in a route handler.
 */
export const demoAccessCookieName = "clockwork-demo-access";
export const demoAccessRoute = "/demo/access";
export const demoAccessSubmitRoute = "/demo/access/submit";
export const demoAccessLifetimeSeconds = 12 * 60 * 60;

const encoder = new TextEncoder();

export function demoAccessPassword(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const configured = environment.CLOCKWORK_DEMO_ACCESS_PASSWORD?.trim();
  return configured ? configured : undefined;
}

/**
 * The single answer to "is the gate on". The middleware, the form, and the
 * handler that checks the password all read it, so no surface can be reachable
 * while another believes the environment is closed.
 */
export function demoAccessConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return demoDeployIdentityEnabled(environment)
    ? demoAccessPassword(environment)
    : undefined;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array | undefined {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  try {
    const binary = atob(normalized.padEnd(normalized.length + padding, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  // Both operands are fixed-width digests, so the loop always runs to the end
  // and its timing carries no information about where the values diverge.
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (const [index, byte] of left.entries())
    difference |= byte ^ (right[index] ?? 0);
  return difference === 0;
}

function digestBuffer(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await digestBuffer(value));
}

/** Constant-time comparison of two secrets of any length. */
export async function equalDemoSecret(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    digest(left),
    digest(right),
  ]);
  return equalBytes(leftDigest, rightDigest);
}

async function signingKey(password: string): Promise<CryptoKey> {
  const material = await digestBuffer(`clockwork-demo-access:${password}`);
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signature(payload: string, password: string): Promise<string> {
  const key = await signingKey(password);
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}

export interface DemoAccessGrant {
  value: string;
  expiresAt: number;
}

export async function issueDemoAccessCookie(
  password: string,
  now = Date.now(),
  lifetimeSeconds = demoAccessLifetimeSeconds,
): Promise<DemoAccessGrant> {
  const expiresAt = now + lifetimeSeconds * 1000;
  const payload = String(expiresAt);
  return {
    value: `${payload}.${await signature(payload, password)}`,
    expiresAt,
  };
}

export async function verifyDemoAccessCookie(
  value: string | undefined,
  password: string,
  now = Date.now(),
): Promise<boolean> {
  if (!value) return false;
  const separator = value.indexOf(".");
  if (separator < 1) return false;
  const payload = value.slice(0, separator);
  const presented = fromBase64Url(value.slice(separator + 1));
  if (!presented) return false;
  const expected = fromBase64Url(await signature(payload, password));
  if (!expected || !equalBytes(expected, presented)) return false;
  const expiresAt = Number(payload);
  return Number.isSafeInteger(expiresAt) && expiresAt > now;
}

/**
 * Paths that must answer before the gate can be satisfied: the form itself, the
 * handler that checks the password, and the framework payloads a rendered page
 * needs. Static brand assets are already outside the middleware matcher.
 */
export function isDemoAccessExemptPath(pathname: string): boolean {
  return (
    pathname === demoAccessRoute ||
    pathname === demoAccessSubmitRoute ||
    pathname.startsWith("/_next/")
  );
}

/** Only a same-site path is ever followed after the gate opens. */
export function safeDemoReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
