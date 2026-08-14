/**
 * Signed, short-lived grant that lets `/api/telemetry` attach a browser record
 * to parentage THIS SERVER CHOSE.
 *
 * What it is not, and what an earlier revision of this file wrongly claimed it
 * was: proof that the server emitted a particular span. The server keeps no
 * register of the span ids it emits, and a per-instance set of them would not
 * survive a serverless deploy, so it cannot answer "did I emit this?" about an
 * id a caller names. The earlier revision tried anyway. It signed
 * `span.context()` of the proxy's `server.request` span, and that span is
 * started with `parent = parseTraceparent(request.headers.get("traceparent"))`,
 * so its trace id is whatever the caller asked for. Sending
 * `traceparent: 00-<victim trace>-...` on a document request returned a grant
 * for the victim's trace, and the route then accepted forged spans into it. The
 * control bound "parentage this server was told to issue", not "parentage this
 * server issued".
 *
 * What it is: parentage minted here. `newTelemetryIngestTrace` draws sixteen
 * random bytes for the trace id and eight for the span id from the platform
 * CSPRNG, and the route REWRITES every accepted record onto them -- trace id,
 * parent span id, and the record's own span id alike -- so nothing a caller
 * says about parentage is honoured. `telemetryIngestTrace` may reuse the
 * `server.request` context instead, but only when that context was generated
 * here rather than adopted from an incoming `traceparent`; that keeps the
 * document span and the browser spans in one trace for the ordinary case, in
 * which a browser sends no traceparent on a navigation.
 *
 * The grant also carries a subject: an HMAC over the `clockwork-csrf` cookie
 * the proxy minted for this browser. The route recomputes it from the presented
 * cookie and refuses a mismatch, so one browser's grant is not usable by
 * another. That is a browser binding and NOT a claim of user identity -- a
 * caller may drop both cookies and collect a fresh pair -- which is exactly why
 * the ingest meter keys on something else entirely.
 *
 * Web Crypto throughout, so the same code runs in the proxy and in a route
 * handler, matching src/auth/demo-access.ts.
 */
export const telemetryIngestCookieName = "clockwork-telemetry";
export const telemetryIngestLifetimeSeconds = 30 * 60;

/**
 * Format marker. It is part of the signed payload, so a cookie in any other
 * shape -- including the four-field v1 grant this file used to mint, whose
 * trace id a caller could choose -- fails to parse and is refused rather than
 * being read on a best-effort basis. Browsers still holding a v1 cookie get a
 * v2 one on their next document navigation.
 */
const telemetryIngestVersion = "t2";

/**
 * A signing key short enough to guess forges grants for every browser, so a
 * secret below this length is refused rather than used. Thirty-two bytes is the
 * floor the release-proof secret already applies.
 */
const minimumSecretBytes = 32;

const encoder = new TextEncoder();

export interface TelemetryIngestTrace {
  traceId: string;
  spanId: string;
}

export interface TelemetryIngestGrant extends TelemetryIngestTrace {
  subject: string;
}

/**
 * No single application secret exists in every deployment shape, so the
 * explicit setting comes first and the secrets that already establish the
 * deployment's own session are the fallback. Each candidate is domain-separated
 * before it becomes a signing key, so a telemetry token can never be replayed
 * against the surface its secret was issued for, and neither can the reverse.
 * A deployment with no secret at all mints nothing and ingests nothing.
 *
 * Every candidate here must be a SERVER-ONLY secret. `CLOCKWORK_DEMO_ACCESS_PASSWORD`
 * was one of them and is deliberately not any more: it is the password handed to
 * every demo visitor to get past the gate, so on a demo deploy — where nothing
 * steered an operator toward setting the explicit variable — any visitor who knew
 * the password held the grant-signing key. That was proved end to end: mint a
 * grant naming an arbitrary trace, post it, and the collector exported a browser
 * span on the caller's chosen trace. A key the product gives away is not a key.
 */
export function telemetryIngestSecret(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const candidate of [
    environment.CLOCKWORK_TELEMETRY_INGEST_SECRET,
    environment.WORKOS_COOKIE_PASSWORD,
    environment.CLOCKWORK_PROOF_AUTH_SECRET,
  ]) {
    const secret = candidate?.trim();
    if (secret && encoder.encode(secret).byteLength >= minimumSecretBytes)
      return secret;
  }
  return undefined;
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

async function signingKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`clockwork-telemetry-ingest:${secret}`),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signature(payload: string, secret: string): Promise<string> {
  const key = await signingKey(secret);
  return base64Url(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}

const traceIdPattern = /^[0-9a-f]{32}$/;
const spanIdPattern = /^[0-9a-f]{16}$/;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A span id the caller had no part in choosing. The route stamps one onto every
 * accepted record so a forged span cannot collide with the id of a span this
 * server really emitted.
 */
export function newTelemetrySpanId(): string {
  return randomHex(8);
}

/** Parentage drawn entirely from the CSPRNG, influenced by nothing inbound. */
export function newTelemetryIngestTrace(): TelemetryIngestTrace {
  return { traceId: randomHex(16), spanId: newTelemetrySpanId() };
}

/**
 * The parentage a grant is minted for.
 *
 * `ClockworkTelemetry.startSpan` adopts `input.parent.traceId` verbatim, so the
 * `server.request` context is only usable here when the proxy started that span
 * with no parent -- that is, when the request carried no `traceparent` and the
 * trace id came from the CSPRNG. A request that carried one names a trace this
 * server did not choose, so the grant gets a fresh trace instead of the caller's
 * and the browser records land somewhere the caller cannot aim.
 *
 * Real browsers send no `traceparent` on a document navigation, so the common
 * path keeps document and browser spans correlated in one trace; the forged
 * path silently loses that correlation, which is the correct direction to fail.
 */
export function telemetryIngestTrace(input: {
  span: TelemetryIngestTrace;
  adoptedIncomingTraceparent: boolean;
}): TelemetryIngestTrace {
  if (input.adoptedIncomingTraceparent) return newTelemetryIngestTrace();
  if (
    !traceIdPattern.test(input.span.traceId) ||
    !spanIdPattern.test(input.span.spanId) ||
    /^0+$/.test(input.span.traceId) ||
    /^0+$/.test(input.span.spanId)
  )
    return newTelemetryIngestTrace();
  return { traceId: input.span.traceId, spanId: input.span.spanId };
}

/**
 * The browser a grant belongs to, as a digest of the `clockwork-csrf` cookie
 * the proxy minted for it. A caller cannot present another browser's digest
 * without that browser's cookie, and the beacon already double-submits the same
 * cookie, so the two checks are satisfied by the same evidence. A caller with no
 * csrf cookie maps to the fixed empty binding, and the route refuses that caller
 * on the csrf check long before it reads a subject.
 */
export async function telemetryIngestSubject(
  browserBinding: string | undefined,
  secret: string,
): Promise<string> {
  return (await signature(`subject:${browserBinding ?? ""}`, secret)).slice(
    0,
    22,
  );
}

export interface TelemetryIngestCookie {
  value: string;
  expiresAt: number;
}

export async function issueTelemetryIngestCookie(input: {
  trace: TelemetryIngestTrace;
  browserBinding: string | undefined;
  secret: string;
  now?: number;
  lifetimeSeconds?: number;
}): Promise<TelemetryIngestCookie | undefined> {
  // Malformed parentage would sign a grant nothing can ever match, which the
  // route reads as forgery. Refusing to mint keeps that failure at the source.
  if (
    !traceIdPattern.test(input.trace.traceId) ||
    !spanIdPattern.test(input.trace.spanId)
  )
    return undefined;
  const expiresAt =
    (input.now ?? Date.now()) +
    (input.lifetimeSeconds ?? telemetryIngestLifetimeSeconds) * 1000;
  const subject = await telemetryIngestSubject(
    input.browserBinding,
    input.secret,
  );
  const payload = [
    telemetryIngestVersion,
    input.trace.traceId,
    input.trace.spanId,
    subject,
    expiresAt,
  ].join(".");
  return {
    value: `${payload}.${await signature(payload, input.secret)}`,
    expiresAt,
  };
}

export async function verifyTelemetryIngestCookie(input: {
  value: string | undefined;
  browserBinding: string | undefined;
  secret: string;
  now?: number;
}): Promise<TelemetryIngestGrant | undefined> {
  if (!input.value) return undefined;
  const parts = input.value.split(".");
  if (parts.length !== 6) return undefined;
  const [version, traceId, spanId, subject, expiry, presentedSignature] =
    parts as [string, string, string, string, string, string];
  if (
    version !== telemetryIngestVersion ||
    !traceIdPattern.test(traceId) ||
    !spanIdPattern.test(spanId) ||
    /^0+$/.test(traceId) ||
    /^0+$/.test(spanId)
  )
    return undefined;
  const presented = fromBase64Url(presentedSignature);
  if (!presented) return undefined;
  const payload = [version, traceId, spanId, subject, expiry].join(".");
  const expected = fromBase64Url(await signature(payload, input.secret));
  if (!expected || !equalBytes(expected, presented)) return undefined;
  // The signature proves this server wrote the subject; this proves the browser
  // presenting the grant is the one it was written for.
  const boundSubject = await telemetryIngestSubject(
    input.browserBinding,
    input.secret,
  );
  if (
    !equalBytes(encoder.encode(subject), encoder.encode(boundSubject)) ||
    subject.length === 0
  )
    return undefined;
  const expiresAt = Number(expiry);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= (input.now ?? Date.now())
  )
    return undefined;
  return { traceId, spanId, subject };
}
