import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  fixtureInput,
  fixtureSigner,
} from "../../../contracts/src/mnda-fixture";
import { mndaParagraphs, mndaTemplateHash, renderMnda } from "./render";

it("preserves every supplied legal paragraph, both signers and all four tags in a deterministic PDF", async () => {
  const source = readFileSync(
    new URL(
      "../../../../docs/legal/FIL_One_Mutual_Non-Disclosure_Agreement_Template.docx",
      import.meta.url,
    ),
  );
  expect(createHash("sha256").update(source).digest("hex")).toBe(
    mndaTemplateHash,
  );
  const [a, b] = await Promise.all([
    renderMnda(fixtureInput, fixtureSigner),
    renderMnda(fixtureInput, fixtureSigner),
  ]);
  expect(a.sha256).toBe(b.sha256);
  const dir = mkdtempSync(join(tmpdir(), "mnda-pdf-"));
  try {
    writeFileSync(join(dir, "document.pdf"), a.bytes);
    const text = execFileSync(
      "pdftotext",
      ["-layout", join(dir, "document.pdf"), "-"],
      { encoding: "utf8" },
    );
    const normalize = (s: string) => s.replace(/\s+/g, "");
    for (const paragraph of mndaParagraphs(fixtureInput))
      expect(normalize(text)).toContain(normalize(paragraph));
    for (const tag of [
      "{{signature:1:y}}",
      "{{signature:2:y}}",
      "{{af_d_s:1:y}}",
      "{{af_d_s:2:y}}",
    ])
      expect(text).toContain(tag);
    expect(text).toContain(fixtureSigner.title);
    expect(text).toContain(fixtureInput.noticesEmail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
