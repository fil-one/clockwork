import { describe, expect, it } from "vitest";
import {
  ContractFileNameSchema,
  contractFileNameMaxLength,
  contractPdfFileName,
} from "./contract-register";

describe("contractPdfFileName", () => {
  it.each([186, 195, 196, 199, 200, 201, 260])(
    "keeps a %i-character base within the limit with its suffix",
    (length) => {
      const base = "B".repeat(length);
      const name = contractPdfFileName(base, " (executed)");
      expect(name.length).toBeLessThanOrEqual(contractFileNameMaxLength);
      expect(name.endsWith(" (executed).pdf")).toBe(true);
      expect(ContractFileNameSchema.parse(name)).toBe(name);
    },
  );

  it("does not add a second .pdf and keeps short names as they are", () => {
    expect(contractPdfFileName("Signed MSA.PDF")).toBe("Signed MSA.pdf");
    expect(contractPdfFileName("Bluefin")).toBe("Bluefin.pdf");
  });

  it("never splits a character made of two code units", () => {
    const name = contractPdfFileName(`${"a".repeat(195)}😀😀`);
    expect(name).toBe(`${"a".repeat(195)}.pdf`);
  });

  it("replaces path and control characters and falls back to a name", () => {
    expect(contractPdfFileName("a/b:c\u0001d")).toBe("a-b-c d.pdf");
    expect(contractPdfFileName("   ", " (executed)")).toBe(
      "document (executed).pdf",
    );
  });
});
