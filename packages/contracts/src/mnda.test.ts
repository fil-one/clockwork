import { expect, it } from "vitest";
import {
  defaultMndaNoticeEmail,
  MndaInputSchema,
  MndaSettingsSchema,
  mndaNoticeEmail,
  mndaRegisterSearchParams,
  mndaSignerEmail,
  mndaSigningFields,
  mndaStatusGroups,
  normalizeMndaCompany,
  parseMndaRegisterParams,
} from "./mnda";
import { fixtureInput, fixtureRecord } from "./mnda-fixture";

it("accepts Latin Extended names the agreement font prints and rejects reserved or non-Latin text", () => {
  for (const company of ["Łódź Société Générale", "Nguyễn Ştefan GmbH"])
    expect(
      MndaInputSchema.safeParse({ ...fixtureInput, company }).success,
    ).toBe(true);
  const reserved = MndaInputSchema.safeParse({
    ...fixtureInput,
    company: "Acme [internal]",
  });
  expect(reserved.error?.issues[0]).toMatchObject({
    path: ["company"],
    params: { mnda: "reserved_characters" },
  });
  const script = MndaInputSchema.safeParse({
    ...fixtureInput,
    company: "株式会社",
  });
  expect(script.error?.issues[0]).toMatchObject({
    path: ["company"],
    code: "invalid_format",
  });
});

it("reads register filters from the URL leniently and writes them back", () => {
  const query = parseMndaRegisterParams(
    new URLSearchParams("status=sent,viewed,bogus,sent&mine=1&q= acme &page=3"),
  );
  expect(query).toEqual({
    status: ["sent", "viewed"],
    mine: true,
    q: "acme",
    page: 3,
    pageSize: 25,
  });
  expect(mndaRegisterSearchParams(query).toString()).toBe(
    "status=sent%2Cviewed&mine=1&q=acme&page=3",
  );
  expect(
    parseMndaRegisterParams({ page: "-4", size: "7", mine: "yes" }),
  ).toMatchObject({ page: 1, pageSize: 25, mine: false, status: [] });
  expect(
    parseMndaRegisterParams({ status: ["completed"], size: "100" }),
  ).toMatchObject({ status: ["completed"], pageSize: 100 });
  for (const states of Object.values(mndaStatusGroups))
    expect(
      parseMndaRegisterParams({ status: states.join(",") }).status,
    ).toEqual(states);
});

it("matches the same company across case, accents, punctuation and entity suffixes", () => {
  expect(normalizeMndaCompany("Acme, Inc.")).toBe("acme");
  expect(normalizeMndaCompany("ACME Inc")).toBe("acme");
  expect(normalizeMndaCompany("Acme L.L.C.")).toBe("acme");
  expect(normalizeMndaCompany("Société Générale SA")).toBe("societe generale");
  expect(normalizeMndaCompany("Acme Labs")).not.toBe(
    normalizeMndaCompany("Acme"),
  );
  expect(normalizeMndaCompany("Inc")).toBe("inc");
});

it("snapshots the notice email and prefers a corrected partner email", () => {
  expect(MndaSettingsSchema.parse({ noticeEmail: "Legal@Fil.One" })).toEqual({
    noticeEmail: "legal@fil.one",
  });
  expect(MndaSettingsSchema.safeParse({ noticeEmail: "legal" }).success).toBe(
    false,
  );
  expect(defaultMndaNoticeEmail).toBe("james@fil.one");
  expect(mndaNoticeEmail(fixtureRecord)).toBe("notices@example.com");
  expect(mndaNoticeEmail({ ...fixtureRecord, noticeEmail: null })).toBe(
    fixtureRecord.countersigner.email,
  );
  expect(mndaSignerEmail(fixtureRecord)).toBe(fixtureInput.signerEmail);
  expect(
    mndaSignerEmail({
      ...fixtureRecord,
      correctedSignerEmail: "right@example.com",
    }),
  ).toBe("right@example.com");
});
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
