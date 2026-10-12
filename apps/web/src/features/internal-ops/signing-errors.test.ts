import { describe, expect, it } from "vitest";
import { mndaFailure } from "./mnda/results";
import { failure } from "./contracts/action-result";
import { errorMessage } from "./contracts/copy";

describe("signing failure guidance", () => {
  it.each([
    ["SIGNWELL_HTTP_401", "provider_access", "providerAccess"],
    ["SIGNWELL_HTTP_403", "provider_access", "providerAccess"],
    ["SIGNWELL_HTTP_429", "provider_rate_limit", "providerRateLimit"],
    ["SIGNWELL_HTTP_422", "provider_rejected", "providerRejected"],
    ["SIGNWELL_TIMEOUT", "provider_timeout", "providerTimeout"],
    ["SIGNWELL_HTTP_408", "provider_failed", "provider"],
    ["SIGNWELL_HTTP_500", "provider_failed", "provider"],
    ["SIGNWELL_INVALID_RESPONSE", "provider_failed", "provider"],
    ["SIGNWELL_NETWORK_ERROR", "provider_failed", "provider"],
  ])(
    "distinguishes %s without exposing provider details",
    (message, mndaCode, contractKey) => {
      expect(mndaFailure(new Error(message))).toEqual({
        ok: false,
        code: mndaCode,
      });
      expect(errorMessage(failure(new Error(message)).code)).toBe(
        `operations.contracts.error.${contractKey}`,
      );
    },
  );
  it("handles aborts consistently for both document types", () => {
    const error = Object.assign(new Error("private abort details"), {
      name: "AbortError",
    });
    expect(mndaFailure(error)).toEqual({ ok: false, code: "provider_timeout" });
    expect(failure(error)).toEqual({ ok: false, code: "SIGNWELL_TIMEOUT" });
  });
});
