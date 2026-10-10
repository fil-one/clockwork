import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { demoDocuments } from "./__fixtures__/demo-documents";
import { goldenPdfs } from "./__fixtures__/golden-pdfs";
import { canonicalizeReactPdf } from "./canonicalize";
import { renderCommerceDocument } from "./render";

// zlib builds differ in compressed output by about 1 percent, so the size
// check tolerates toolchain drift but still catches a missing or doubled body.
const SIZE_TOLERANCE = 0.1;

function pageCount(bytes: Uint8Array): number {
  const source = Buffer.from(bytes).toString("latin1");
  return source.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

describe("commerce PDF renderer", () => {
  it("renders identical bytes twice for every document kind", async () => {
    for (const input of demoDocuments) {
      const first = await renderCommerceDocument(input);
      const second = await renderCommerceDocument(input);
      const golden = goldenPdfs[input.kind];
      const source = Buffer.from(first.bytes).toString("latin1");

      // Runtime replay rejects a re-render whose bytes differ from the stored
      // artifact, so re-rendering must be byte-identical.
      expect(second.bytes, input.kind).toEqual(first.bytes);
      expect(second.contentHash, input.kind).toBe(first.contentHash);
      expect(first.contentHash, input.kind).toBe(
        createHash("sha256").update(first.bytes).digest("hex"),
      );
      expect(canonicalizeReactPdf(first.bytes), input.kind).toEqual(
        first.bytes,
      );

      expect(
        Math.abs(first.bytes.length - golden.bytes) / golden.bytes,
        input.kind,
      ).toBeLessThan(SIZE_TOLERANCE);
      expect(pageCount(first.bytes), input.kind).toBe(golden.pages);
      expect(source.startsWith("%PDF-"), input.kind).toBe(true);
      expect(source.trimEnd().endsWith("%%EOF"), input.kind).toBe(true);
      expect(source, input.kind).toContain("/Title");
      expect(source, input.kind).toContain("/Author");
      expect(source, input.kind).toContain("/Lang (en)");
      expect(source, input.kind).toContain("/PageMode /UseOutlines");
      expect(first.fileName, input.kind).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(first.recordHash, input.kind).toBe(input.verification.recordHash);
    }
  }, 60_000);

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
