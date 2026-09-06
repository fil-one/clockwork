import { describe, expect, it } from "vitest";
import { CatalogMappingSchema } from "./catalog-admin";

const mapping = {
  rateCardId: "00000000-0000-4000-8000-000000000001",
  expectedRowVersion: 2,
  providerSku: "object",
  providerRegion: "fr",
  meterId: "byte_hours",
  sourceEvidence: "https://evidence.example/mapping?token=secret#fragment",
  reason: "Verified mapping reference",
};
describe("catalog mapping commands", () => {
  it("retains a sanitized source URI without query tokens", () => {
    expect(CatalogMappingSchema.parse(mapping).sourceEvidence).toBe(
      "https://evidence.example/mapping",
    );
  });
  it.each([
    "not a reference",
    "https://user:password@evidence.example/map",
    "javascript:alert(1)",
  ])(
    "rejects unsafe evidence without escaping validation: %s",
    (sourceEvidence) => {
      expect(
        CatalogMappingSchema.safeParse({ ...mapping, sourceEvidence }).success,
      ).toBe(false);
    },
  );
  it("rejects unknown authority and activation fields and stale version syntax", () => {
    expect(
      CatalogMappingSchema.safeParse({ ...mapping, activate: true }).success,
    ).toBe(false);
    expect(
      CatalogMappingSchema.safeParse({ ...mapping, expectedRowVersion: 0 })
        .success,
    ).toBe(false);
  });
});
