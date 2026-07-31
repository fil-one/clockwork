import { describe, expect, it } from "vitest";

import { goldenPdfs } from "./__fixtures__/golden-pdfs";
import { DOCUMENT_KINDS } from "./model";
import { documentTitles, englishDocumentMessages } from "./messages";

describe("document catalog", () => {
  it("has a title and golden fixture for every supported artifact", () => {
    expect(Object.keys(documentTitles).sort()).toEqual(
      [...DOCUMENT_KINDS].sort(),
    );
    expect(Object.keys(goldenPdfs).sort()).toEqual([...DOCUMENT_KINDS].sort());
  });

  it("keeps document-facing labels in the English message catalog", () => {
    expect(englishDocumentMessages.immutableRecordNotice).toContain(
      "immutable commerce record",
    );
    expect(englishDocumentMessages.recordHash).toContain("SHA-256");
  });
});
