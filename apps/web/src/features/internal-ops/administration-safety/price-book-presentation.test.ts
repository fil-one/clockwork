import { describe, expect, it } from "vitest";

import { CommerceApiError } from "@/src/features/contracts/commerce-client";
import { commerceErrorText as platformErrorText } from "@/src/features/contracts/error-text";
import { translatorFor } from "@/src/i18n/catalogs";

import { commerceErrorText } from "./price-book-presentation";

describe("pricing command failures", () => {
  /**
   * The core API explains a 422 in English for integrators. The pricing
   * surfaces used to quote that detail inside the translated sentence, so a
   * German finance user read "Die Änderung wurde nicht übernommen: Effective
   * date must not be before …".
   */
  it("never quotes the server's English detail", () => {
    const de = translatorFor("de");
    const detail = "Effective date must not be before the current version";
    const text = commerceErrorText(
      new CommerceApiError(422, "validation", detail, "INVALID_STATE"),
      de,
      "adminPricing.priceBooks.rateForm.saveFailed",
    );
    expect(text).not.toContain(detail);
    expect(text).toBe(
      platformErrorText(new CommerceApiError(422, "validation", detail), de),
    );
  });
});
