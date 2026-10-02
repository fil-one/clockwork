import { expect, it } from "vitest";
import { MndaInputSchema } from "./mnda";
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
