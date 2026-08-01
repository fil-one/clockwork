import { describe, expect, it } from "vitest";

import {
  createReleaseProofCookieValue,
  releaseProofConfiguration,
  releaseProofPlaywrightCookie,
  verifyReleaseProofCookieValue,
} from "./release-proof";

const secret = "proof-secret-at-least-thirty-two-bytes-long";
const payload = {
  sessionId: "12000000-0000-4000-8000-000000000001",
  expiresAt: "2030-07-31T16:15:00.000Z",
  nonce: "0123456789abcdef0123456789abcdef",
};

describe("production release-proof cookie", () => {
  it("is impossible without every explicit production-loopback guard", () => {
    expect(
      releaseProofConfiguration({
        NODE_ENV: "production",
        CLOCKWORK_RELEASE_PROOF: "1",
        APP_ORIGIN: "https://commerce.filone.com",
        CLOCKWORK_PROOF_AUTH_SECRET: secret,
      }),
    ).toBeUndefined();
    expect(
      releaseProofConfiguration({
        NODE_ENV: "production",
        CLOCKWORK_RELEASE_PROOF: "1",
        APP_ORIGIN: "http://127.0.0.1:3200",
        CLOCKWORK_PROOF_AUTH_SECRET: secret,
      }),
    ).toBeUndefined();
    expect(
      releaseProofConfiguration({
        NODE_ENV: "production",
        CLOCKWORK_RELEASE_PROOF: "1",
        APP_ORIGIN: "http://localhost:3200",
        CLOCKWORK_PROOF_AUTH_SECRET: secret,
      }),
    ).toEqual({ origin: "http://localhost:3200", secret });
  });

  it("rejects tampering and expiry", () => {
    const configuration = { origin: "http://localhost:3200", secret };
    const cookie = createReleaseProofCookieValue(payload, secret);
    expect(
      verifyReleaseProofCookieValue(
        cookie,
        configuration,
        new Date("2030-07-31T16:00:00.000Z"),
      ),
    ).toEqual(payload);
    expect(() =>
      verifyReleaseProofCookieValue(
        `${cookie.slice(0, -1)}x`,
        configuration,
        new Date("2030-07-31T16:00:00.000Z"),
      ),
    ).toThrow(/signature/i);
    expect(() =>
      verifyReleaseProofCookieValue(
        cookie,
        configuration,
        new Date(payload.expiresAt),
      ),
    ).toThrow(/expired/i);
  });

  it("creates a URL-scoped host-only __Host cookie with mandatory attributes", () => {
    const cookie = releaseProofPlaywrightCookie({
      payload,
      origin: "http://localhost:3200",
      secret,
    });
    expect(cookie).toMatchObject({
      name: "__Host-clockwork-proof",
      url: "http://localhost:3200/",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    });
    expect(cookie).not.toHaveProperty("domain");
  });
});
