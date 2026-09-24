import { describe, expect, it } from "vitest";

import { collectionDefinitions } from "./commercial/model";
import { customerCollections } from "./customer/customer-data";
import { translatorFor } from "@/src/i18n/catalogs";

import { partnerSurfaces } from "./partner/partner-data";

const t = translatorFor("en");

const customerPurposeLines = [
  ...Object.values(collectionDefinitions).map(({ eyebrow }) => t(eyebrow)),
  ...Object.values(customerCollections).map(({ eyebrow }) => eyebrow),
];
const partnerPurposeLines = Object.values(partnerSurfaces).map(({ eyebrow }) =>
  t(eyebrow),
);

describe("collection purpose lines and rules", () => {
  it("uses sentence-case two-part purpose lines instead of all-caps eyebrows", () => {
    for (const purposeLine of customerPurposeLines) {
      expect(purposeLine).toMatch(/^Customer workspace · \S/);
      expect(purposeLine).not.toBe(purposeLine.toLocaleUpperCase());
    }
    for (const purposeLine of partnerPurposeLines) {
      expect(purposeLine).toMatch(/^Partner desk · \S/);
      expect(purposeLine).not.toBe(purposeLine.toLocaleUpperCase());
    }
  });

  it("gives every collection a visible policy or commercial-boundary rule", () => {
    const rules = [
      ...Object.values(collectionDefinitions).map(({ rule }) => t(rule)),
      ...Object.values(customerCollections).map(({ rule }) => rule),
      ...Object.values(partnerSurfaces).map(({ rule }) => t(rule)),
    ];

    expect(rules).toHaveLength(22);
    for (const rule of rules) expect(rule.trim().length).toBeGreaterThan(30);
  });
});
