import { describe, expect, it } from "vitest";

import { demoDocuments } from "./__fixtures__/demo-documents";
import { goldenPdfs } from "./__fixtures__/golden-pdfs";
import { canonicalizeReactPdf } from "./canonicalize";
import { renderCommerceDocument } from "./render";

function pageCount(bytes: Uint8Array): number {
  const source = Buffer.from(bytes).toString("latin1");
  return source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("commerce PDF renderer", () => {
  it("matches the deterministic golden PDF for every document kind", async () => {
    for (const input of demoDocuments) {
      const rendered = await renderCommerceDocument(input);
      const golden = goldenPdfs[input.kind];
      const source = Buffer.from(rendered.bytes).toString("latin1");

      expect(rendered.contentHash, input.kind).toBe(golden.contentHash);
      expect(rendered.bytes.length, input.kind).toBe(golden.bytes);
      expect(pageCount(rendered.bytes), input.kind).toBe(golden.pages);
      expect(source.startsWith("%PDF-"), input.kind).toBe(true);
      expect(source.trimEnd().endsWith("%%EOF"), input.kind).toBe(true);
      expect(source, input.kind).toContain("/Title");
      expect(source, input.kind).toContain("/Author");
      expect(source, input.kind).toContain("/Lang (en)");
      expect(source, input.kind).toContain("/PageMode /UseOutlines");
      expect(rendered.fileName, input.kind).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(rendered.recordHash, input.kind).toBe(
        input.verification.recordHash,
      );
    }
  }, 30_000);

  it("renders identical bytes for identical immutable input", async () => {
    const input = demoDocuments.find(
      (candidate) => candidate.kind === "direct_quote",
    );
    if (!input) {
      throw new Error("Direct quote golden fixture is missing");
    }

    const first = await renderCommerceDocument(input);
    const second = await renderCommerceDocument(input);

    expect(second.contentHash).toBe(first.contentHash);
    expect(second.bytes).toEqual(first.bytes);
    expect(canonicalizeReactPdf(first.bytes)).toEqual(first.bytes);
  });

  it("rejects a record without a valid immutable hash", async () => {
    const input = demoDocuments[0];
    if (!input) {
      throw new Error("Document golden fixture is missing");
    }

    await expect(
      renderCommerceDocument({
        ...input,
        verification: { ...input.verification, recordHash: "not-a-hash" },
      }),
    ).rejects.toThrow(/SHA-256/);
  });
});
