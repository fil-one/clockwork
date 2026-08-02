import { describe, expect, it } from "vitest";

import { canonicalDenialCode, denialCodes, isDenialCode } from "./errors";

describe("denial codes", () => {
  it("exposes the three codes runtime alerting matches on", () => {
    expect([...denialCodes]).toEqual([
      "AUTHORIZATION_DENIED",
      "CROSS_ACCOUNT_DENIED",
      "WEBHOOK_SIGNATURE_INVALID",
    ]);
    for (const code of denialCodes) {
      expect(isDenialCode(code)).toBe(true);
      expect(canonicalDenialCode(code)).toBe(code);
    }
  });

  it("resolves every boundary-specific denial code the product emits", () => {
    expect(canonicalDenialCode("ACCOUNT_SCOPE")).toBe("CROSS_ACCOUNT_DENIED");
    expect(canonicalDenialCode("ACCOUNT_SCOPE_FORBIDDEN")).toBe(
      "CROSS_ACCOUNT_DENIED",
    );
    expect(canonicalDenialCode("INTERNAL_ACCOUNT_FILTER_FORBIDDEN")).toBe(
      "CROSS_ACCOUNT_DENIED",
    );
    expect(canonicalDenialCode("AUDIENCE_FORBIDDEN")).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(canonicalDenialCode("ASSISTED_SESSION_REQUIRED")).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(canonicalDenialCode("ASSISTED_SESSION_INVALID")).toBe(
      "AUTHORIZATION_DENIED",
    );
    expect(canonicalDenialCode("FORBIDDEN")).toBe("AUTHORIZATION_DENIED");
    expect(canonicalDenialCode("STAFF_BOUNDARY")).toBe("AUTHORIZATION_DENIED");
  });

  it("returns nothing for codes that are not denials", () => {
    expect(isDenialCode("MFA_REQUIRED")).toBe(false);
    expect(canonicalDenialCode("MFA_REQUIRED")).toBeUndefined();
    expect(canonicalDenialCode("VALIDATION_FAILED")).toBeUndefined();
    expect(canonicalDenialCode(undefined)).toBeUndefined();
    expect(canonicalDenialCode(403)).toBeUndefined();
  });
});
