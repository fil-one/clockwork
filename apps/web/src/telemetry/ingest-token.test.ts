import { describe, expect, it } from "vitest";

import {
  issueTelemetryIngestCookie,
  newTelemetryIngestTrace,
  newTelemetrySpanId,
  telemetryIngestSecret,
  telemetryIngestTrace,
  verifyTelemetryIngestCookie,
} from "./ingest-token";

const secret = "telemetry-ingest-test-secret";
const browserBinding = "0123456789abcdef0123456789abcdef";
const trace = {
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
};

function mint(
  overrides: Partial<Parameters<typeof issueTelemetryIngestCookie>[0]> = {},
) {
  return issueTelemetryIngestCookie({
    trace,
    browserBinding,
    secret,
    ...overrides,
  });
}

describe("telemetry ingest grants", () => {
  it("round-trips the parentage and browser it was minted for", async () => {
    const cookie = await mint();
    await expect(
      verifyTelemetryIngestCookie({
        value: cookie?.value,
        browserBinding,
        secret,
      }),
    ).resolves.toMatchObject(trace);
  });

  it("refuses a tampered payload, a foreign secret, and an expired grant", async () => {
    const cookie = await mint();
    const [version, traceId, spanId, subject, expiry, signature] = (
      cookie?.value ?? ""
    ).split(".") as [string, string, string, string, string, string];

    for (const value of [
      `${version}.${traceId}.1111111111111111.${subject}.${expiry}.${signature}`,
      `${version}.0af7651916cd43dd8448eb211c80319c.${spanId}.${subject}.${expiry}.${signature}`,
      `${version}.${traceId}.${spanId}.AAAAAAAAAAAAAAAAAAAAAA.${expiry}.${signature}`,
      undefined,
      "not-a-grant",
    ])
      await expect(
        verifyTelemetryIngestCookie({ value, browserBinding, secret }),
      ).resolves.toBeUndefined();

    await expect(
      verifyTelemetryIngestCookie({
        value: cookie?.value,
        browserBinding,
        secret: "a-different-long-secret",
      }),
    ).resolves.toBeUndefined();
    await expect(
      verifyTelemetryIngestCookie({
        value: cookie?.value,
        browserBinding,
        secret,
        now: (cookie?.expiresAt ?? 0) + 1,
      }),
    ).resolves.toBeUndefined();
  });

  /**
   * The live refutation replayed one grant from a browser that never received
   * it. The subject is what makes that fail.
   */
  it("refuses a grant presented by a different browser", async () => {
    const cookie = await mint();
    for (const presented of [undefined, "f".repeat(32), ""])
      await expect(
        verifyTelemetryIngestCookie({
          value: cookie?.value,
          browserBinding: presented,
          secret,
        }),
      ).resolves.toBeUndefined();
  });

  /**
   * Fails against the unfixed code, which minted and accepted a four-field
   * grant whose trace id the caller chose. Refusing the old shape outright is
   * what stops a v1 cookie already in a browser from being honoured.
   */
  it("refuses the unversioned four-field grant the previous revision minted", async () => {
    const expiry = Date.now() + 60_000;
    await expect(
      verifyTelemetryIngestCookie({
        value: `${trace.traceId}.${trace.spanId}.${expiry}.AAAA`,
        browserBinding,
        secret,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to mint for malformed parentage", async () => {
    await expect(
      mint({ trace: { traceId: "short", spanId: "also-short" } }),
    ).resolves.toBeUndefined();
  });

  /**
   * The heart of the repair. `ClockworkTelemetry.startSpan` adopts a supplied
   * parent's trace id verbatim, so the proxy span's trace id is the caller's
   * whenever the request carried a traceparent. Against the unfixed code the
   * grant was minted straight from that context and the caller's trace id came
   * back signed.
   */
  it("never signs a trace id that arrived on the request", () => {
    const named = { traceId: "a".repeat(32), spanId: "b".repeat(16) };
    const issued = telemetryIngestTrace({
      span: named,
      adoptedIncomingTraceparent: true,
    });
    expect(issued.traceId).not.toBe(named.traceId);
    expect(issued.spanId).not.toBe(named.spanId);
    expect(issued.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(issued.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps a server-generated span context so a document stays correlated", () => {
    const own = newTelemetryIngestTrace();
    expect(
      telemetryIngestTrace({ span: own, adoptedIncomingTraceparent: false }),
    ).toEqual(own);
  });

  it("draws fresh parentage when a server context is malformed", () => {
    const fallback = telemetryIngestTrace({
      span: { traceId: "0".repeat(32), spanId: "0".repeat(16) },
      adoptedIncomingTraceparent: false,
    });
    expect(fallback.traceId).not.toMatch(/^0+$/);
    expect(fallback.spanId).not.toMatch(/^0+$/);
  });

  it("draws distinct span ids", () => {
    const ids = new Set(Array.from({ length: 64 }, () => newTelemetrySpanId()));
    expect(ids.size).toBe(64);
  });

  it("prefers the explicit secret and refuses a guessable one", () => {
    const explicit = "an-explicit-ingest-secret-of-ample-length";
    const workos = "a-workos-cookie-password-value-long-enough";
    expect(
      telemetryIngestSecret({
        CLOCKWORK_TELEMETRY_INGEST_SECRET: explicit,
        WORKOS_COOKIE_PASSWORD: workos,
      }),
    ).toBe(explicit);
    expect(telemetryIngestSecret({ WORKOS_COOKIE_PASSWORD: workos })).toBe(
      workos,
    );
    // Short and absent both resolve to nothing, and nothing means the proxy
    // mints no grant and the route ingests nothing.
    expect(
      telemetryIngestSecret({ CLOCKWORK_TELEMETRY_INGEST_SECRET: "demo123" }),
    ).toBeUndefined();
    expect(telemetryIngestSecret({})).toBeUndefined();
  });

  /**
   * The demo access password was a fallback signing key. It is the password the
   * product hands to every demo visitor, so on a demo deploy any visitor who
   * could read the gate could mint a grant naming any trace — proved end to end
   * against a production build, where the collector exported a browser span on
   * the caller's chosen trace. A key the product gives away is not a key.
   */
  it("never signs with a secret the product hands to visitors", () => {
    expect(
      telemetryIngestSecret({
        CLOCKWORK_DEMO_ACCESS_PASSWORD:
          "a-demo-visitor-password-well-over-the-length-floor",
      }),
    ).toBeUndefined();
  });
});
