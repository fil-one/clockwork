import { expect, it } from "vitest";
import { MndaInputSchema, mndaSigningFields } from "./mnda";
import { fixtureInput } from "./mnda-fixture";
it("requires complete team details but permits recipient completion without inventing legal values", () => {
  const routing = {
    id: fixtureInput.id,
    company: fixtureInput.company,
    signerName: fixtureInput.signerName,
    signerEmail: fixtureInput.signerEmail,
    countersignerId: fixtureInput.countersignerId,
    effectiveDate: fixtureInput.effectiveDate,
  };
  expect(MndaInputSchema.safeParse(routing).success).toBe(false);
  expect(
    MndaInputSchema.parse({ ...routing, detailsMode: "recipient" }),
  ).toMatchObject({
    shortName: "",
    noticesEmail: "",
    signerTitle: "",
    detailsMode: "recipient",
  });
  expect(
    MndaInputSchema.safeParse({
      ...routing,
      detailsMode: "recipient",
      signerEmail: "",
    }).success,
  ).toBe(false);
  expect(
    MndaInputSchema.safeParse({ ...fixtureInput, detailsMode: "public" })
      .success,
  ).toBe(false);
});

it("defaults the short name to the legal name while preserving explicit edits", () => {
  for (const detailsMode of ["team", "mixed"] as const) {
    expect(
      MndaInputSchema.parse({ ...fixtureInput, detailsMode, shortName: "  " })
        .shortName,
    ).toBe(fixtureInput.company);
    expect(
      MndaInputSchema.parse({
        ...fixtureInput,
        detailsMode,
        shortName: "Custom",
      }).shortName,
    ).toBe("Custom");
  }
});
it("requires only missing details in mixed mode, preserving each known part of an address", () => {
  const input = MndaInputSchema.parse({
    ...fixtureInput,
    detailsMode: "mixed",
    entityDescription: "",
    locality: "",
  });
  expect(mndaSigningFields(input).map(({ id }) => id)).toEqual([
    "entity",
    "locality_intro",
    "locality_notice",
  ]);
  expect(input.streetAddress).toBe(fixtureInput.streetAddress);
  expect(mndaSigningFields({ ...fixtureInput, detailsMode: "mixed" })).toEqual(
    [],
  );
  expect(MndaInputSchema.safeParse({ ...input, signerEmail: "" }).success).toBe(
    false,
  );
});
