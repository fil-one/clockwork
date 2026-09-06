import { describe, expect, it } from "vitest";
import {
  ProviderReferenceCommandSchema,
  DatabaseProviderReferenceAdmin,
} from "./provider-reference-admin";
import type { RuntimeDatabase } from "../../client";
const valid = {
  provider: "billing" as const,
  expectedRowVersion: 0,
  secretReference: "vault:commerce/billing/key",
  secretVersion: "version-1",
  rotatedAt: "2026-09-01T12:00:00.000Z",
  owner: "Finance operations",
  reviewIntervalDays: 90,
  sourceEvidence: "https://evidence.example/rotation?token=redacted#part",
  reason: "Recorded completed rotation",
};
describe("provider reference commands", () => {
  it("strips evidence query credentials and fragments", () => {
    expect(ProviderReferenceCommandSchema.parse(valid).sourceEvidence).toBe(
      "https://evidence.example/rotation",
    );
  });
  it.each([
    "a-raw-credential-value",
    "https://user:password@example.test/key",
    "vault:key?token=value",
    "vault:key#fragment",
    "vault:",
    "vault:key with spaces",
  ])("rejects non-reference input %s", (secretReference) => {
    expect(
      ProviderReferenceCommandSchema.safeParse({ ...valid, secretReference })
        .success,
    ).toBe(false);
  });
  it.each([
    { provider: "unknown" },
    { reviewIntervalDays: 0 },
    { reviewIntervalDays: 731 },
    { expectedRowVersion: -1 },
    { secretValue: "forbidden" },
    { sourceEvidence: "javascript:alert(1)" },
    { rotatedAt: "tomorrow" },
  ])("rejects invalid administration fields %j", (change) => {
    expect(
      ProviderReferenceCommandSchema.safeParse({ ...valid, ...change }).success,
    ).toBe(false);
  });
  it("rejects a planned rotation before touching the database", () => {
    expect(() =>
      new DatabaseProviderReferenceAdmin({} as RuntimeDatabase).save({
        command: { ...valid, rotatedAt: "2999-01-01T00:00:00.000Z" },
        actor: { kind: "user", id: "20000000-0000-4000-8000-000000000001" },
        requestId: "future-rotation",
      }),
    ).toThrow("PROVIDER_REFERENCE_FUTURE_ROTATION");
  });
});
