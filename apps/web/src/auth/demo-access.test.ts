import { afterEach, describe, expect, it, vi } from "vitest";

import {
  demoAccessConfiguration,
  equalDemoSecret,
  isDemoAccessExemptPath,
  issueDemoAccessCookie,
  safeDemoReturnPath,
  verifyDemoAccessCookie,
} from "./demo-access";

const password = "open-sesame-2026";

afterEach(() => vi.unstubAllEnvs());

function demoDeployEnvironment(): void {
  vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "1");
  vi.stubEnv("CLOCKWORK_EXPERIENCE_ADAPTER", "demo");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV", "demo");
  vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
}

describe("demo access gate configuration", () => {
  it("does not exist without the deploy opt-in", () => {
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", password);
    vi.stubEnv("CLOCKWORK_DEMO_DEPLOY", "");

    expect(demoAccessConfiguration(process.env)).toBeUndefined();
  });

  it("does not exist without a password", () => {
    demoDeployEnvironment();
    vi.stubEnv("CLOCKWORK_DEMO_ACCESS_PASSWORD", "   ");

    expect(demoAccessConfiguration(process.env)).toBeUndefined();
  });

  it("is configured on a deliberate fixture deploy", () => {
    demoDeployEnvironment();

    expect(demoAccessConfiguration(process.env)).toBe(password);
  });
});

describe("demo access password", () => {
  it("admits the configured password", async () => {
    await expect(equalDemoSecret(password, password)).resolves.toBe(true);
  });

  it("rejects a wrong password of the same length", async () => {
    await expect(equalDemoSecret("open-sesame-2027", password)).resolves.toBe(
      false,
    );
  });

  it("rejects a wrong password of a different length", async () => {
    await expect(equalDemoSecret("", password)).resolves.toBe(false);
    await expect(equalDemoSecret(`${password}x`, password)).resolves.toBe(
      false,
    );
  });
});

describe("demo access cookie", () => {
  it("admits a cookie it signed", async () => {
    const grant = await issueDemoAccessCookie(password);

    await expect(verifyDemoAccessCookie(grant.value, password)).resolves.toBe(
      true,
    );
  });

  it("rejects a cookie signed with a different password", async () => {
    const grant = await issueDemoAccessCookie("another-password");

    await expect(verifyDemoAccessCookie(grant.value, password)).resolves.toBe(
      false,
    );
  });

  it("rejects a tampered expiry", async () => {
    const grant = await issueDemoAccessCookie(password);
    const forged = `${Date.now() + 86_400_000}.${grant.value.split(".")[1]}`;

    await expect(verifyDemoAccessCookie(forged, password)).resolves.toBe(false);
  });

  it("rejects an expired cookie", async () => {
    const grant = await issueDemoAccessCookie(password, Date.now(), 60);

    await expect(
      verifyDemoAccessCookie(grant.value, password, grant.expiresAt + 1),
    ).resolves.toBe(false);
  });

  it("rejects absent and malformed values", async () => {
    for (const value of [undefined, "", "no-separator", ".", "123.!!!"])
      await expect(verifyDemoAccessCookie(value, password)).resolves.toBe(
        false,
      );
  });
});

describe("demo access routing", () => {
  it("exempts only the gate itself and framework payloads", () => {
    expect(isDemoAccessExemptPath("/demo/access")).toBe(true);
    expect(isDemoAccessExemptPath("/demo/access/submit")).toBe(true);
    expect(isDemoAccessExemptPath("/_next/data/build/index.json")).toBe(true);
    expect(isDemoAccessExemptPath("/demo")).toBe(false);
    expect(isDemoAccessExemptPath("/dashboard")).toBe(false);
    expect(isDemoAccessExemptPath("/api/experience/projections")).toBe(false);
  });

  it("follows same-site paths only", () => {
    expect(safeDemoReturnPath("/partner/portfolio")).toBe("/partner/portfolio");
    expect(safeDemoReturnPath("//evil.test/steal")).toBe("/");
    expect(safeDemoReturnPath("https://evil.test")).toBe("/");
    expect(safeDemoReturnPath(null)).toBe("/");
  });
});
