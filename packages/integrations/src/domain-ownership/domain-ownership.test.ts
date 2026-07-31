import { describe, expect, it, vi } from "vitest";

import { DnsTxtDomainOwnershipVerifier } from ".";

describe("DNS TXT domain ownership verification", () => {
  it("returns server-derived evidence only after observing the exact proof", async () => {
    const resolver = vi
      .fn()
      .mockResolvedValue([["clockwork-verification=proof-token-123456"]]);
    const verifier = new DnsTxtDomainOwnershipVerifier(
      resolver,
      () => new Date("2026-07-31T16:00:00.000Z"),
    );
    await expect(
      verifier.verify({
        domain: "Brand.Example.COM.",
        verificationToken: "proof-token-123456",
        requestId: "domain-proof-test",
      }),
    ).resolves.toEqual({
      verifiedAt: "2026-07-31T16:00:00.000Z",
      evidenceReference: "dns-txt:_clockwork-domain.brand.example.com",
    });
    expect(resolver).toHaveBeenCalledWith(
      "_clockwork-domain.brand.example.com",
    );
  });

  it("fails closed for mismatches, invalid domains, and resolver failure", async () => {
    const mismatch = new DnsTxtDomainOwnershipVerifier(() =>
      Promise.resolve([["clockwork-verification=different-proof"]]),
    );
    await expect(
      mismatch.verify({
        domain: "brand.example.com",
        verificationToken: "proof-token-123456",
        requestId: "domain-mismatch-test",
      }),
    ).rejects.toThrow("DOMAIN_OWNERSHIP_PROOF_MISMATCH");
    await expect(
      mismatch.verify({
        domain: "localhost",
        verificationToken: "proof-token-123456",
        requestId: "domain-invalid-test",
      }),
    ).rejects.toThrow("DOMAIN_OWNERSHIP_DOMAIN_INVALID");
    const unavailable = new DnsTxtDomainOwnershipVerifier(() =>
      Promise.reject(new Error("resolver unavailable")),
    );
    await expect(
      unavailable.verify({
        domain: "brand.example.com",
        verificationToken: "proof-token-123456",
        requestId: "domain-unavailable-test",
      }),
    ).rejects.toThrow("DOMAIN_OWNERSHIP_PROOF_NOT_FOUND");
  });
});
