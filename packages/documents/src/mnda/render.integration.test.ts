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
    const normalize = (s: string) =>
      s.replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "").replace(/\s+/g, "");
    for (const paragraph of mndaParagraphs(fixtureInput, fixtureSigner))
      expect(normalize(text)).toContain(normalize(paragraph));
    for (const tag of [
      "{{signature:1:y}}",
      "{{signature:2:y}}",
      "{{af_d_s:1:y}}",
      "{{af_d_s:2:y}}",
    ])
      expect(text).toContain(tag);
    expect(text).toContain(fixtureSigner.title);
    expect(text.split(fixtureSigner.email)).toHaveLength(3);
    expect(text).not.toContain("m@fil.org");
    expect(text).toContain(fixtureInput.noticesEmail);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

it("places every partner-completed blank and preserves all legal clauses", async () => {
  const { mndaRecipientFields } = await import("../../../contracts/src/mnda");
  const template = (await import("./template.json")).default;
  const pdf = await renderMnda(
    { ...fixtureInput, detailsMode: "recipient" },
    fixtureSigner,
  );
  const dir = mkdtempSync(join(tmpdir(), "mnda-fields-"));
  try {
    writeFileSync(join(dir, "document.pdf"), pdf.bytes);
    const text = execFileSync(
      "pdftotext",
      ["-layout", join(dir, "document.pdf"), "-"],
      { encoding: "utf8" },
    );
    for (const field of mndaRecipientFields)
      expect(text).toContain(`::${field.id}:`);
    for (const paragraph of template.paragraphs.slice(2))
      expect(
        text.replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "").replace(/\s+/g, ""),
      ).toContain(paragraph.replace(/\s+/g, ""));
    expect(text).not.toMatch(/\[Counterparty|\[Effective Date|\[jurisdiction/);
    expect(text).toContain(fixtureInput.effectiveDate);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

it.each([
  { entityDescription: "", locality: "" },
  {
    entityDescription: "",
    streetAddress: "",
    locality: "",
    noticesContact: "",
    noticesEmail: "",
    signerTitle: "",
  },
  {},
])(
  "preserves supplied mixed-mode data and exposes only missing fields: %j",
  async (missing) => {
    const { mndaSigningFields } = await import("../../../contracts/src/mnda");
    const template = (await import("./template.json")).default;
    const input = {
      ...fixtureInput,
      ...missing,
      detailsMode: "mixed" as const,
    };
    const pdf = await renderMnda(input, fixtureSigner);
    const dir = mkdtempSync(join(tmpdir(), "mnda-mixed-"));
    try {
      writeFileSync(join(dir, "document.pdf"), pdf.bytes);
      const text = execFileSync(
        "pdftotext",
        ["-layout", join(dir, "document.pdf"), "-"],
        { encoding: "utf8" },
      );
      const extractedIds = [...text.matchAll(/::([a-z_]+):/g)]
        .map((m) => m[1])
        .sort();
      expect(extractedIds).toEqual(
        mndaSigningFields(input)
          .map((f) => f.id)
          .sort(),
      );
      const normalized = text
        .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "")
        .replace(/\s+/g, "");
      for (const paragraph of template.paragraphs.slice(2))
        expect(normalized).toContain(paragraph.replace(/\s+/g, ""));
      for (const value of [
        input.company,
        input.shortName,
        input.signerName,
        input.streetAddress,
        input.noticesEmail,
      ].filter(Boolean))
        expect(normalized).toContain(value.replace(/\s+/g, ""));
      expect(text).not.toMatch(
        /\[Counterparty|\[Effective Date|\[jurisdiction/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000,
);

it("keeps partial-detail previews compact, numbered and aligned without breaking supplied addresses", async () => {
  const pdf = await renderMnda(
    {
      ...fixtureInput,
      detailsMode: "mixed",
      streetAddress: "4 Example Street",
      entityDescription: "",
      locality: "",
      noticesEmail: "",
      noticesContact: "",
      signerTitle: "",
    },
    fixtureSigner,
  );
  expect(pdf.pages).toBe(4);
  const dir = mkdtempSync(join(tmpdir(), "mnda-layout-"));
  try {
    const path = join(dir, "document.pdf");
    writeFileSync(path, pdf.bytes);
    const text = execFileSync("pdftotext", ["-layout", path, "-"], {
      encoding: "utf8",
    });
    expect(text).toContain("4 Example Street,");
    for (let page = 1; page <= pdf.pages; page++)
      expect(text).toMatch(new RegExp(`${page}\\s*/\\s*${pdf.pages}`));
    const bounds = execFileSync("pdftotext", ["-bbox", path, "-"], {
      encoding: "utf8",
    });
    const signaturePage = bounds.split("<page ").at(-1) ?? "";
    for (const caption of [
      "Party",
      "Signature",
      "Name",
      "Title",
      "Date",
      "Company",
      "Attention",
      "Address",
      "Email",
    ]) {
      const positions = [
        ...signaturePage.matchAll(
          new RegExp(`<word[^>]+yMin="([0-9.]+)"[^>]*>${caption}</word>`, "g"),
        ),
      ].map((m) => Number(m[1]));
      expect(positions).toHaveLength(2);
      expect(positions[0]).toBe(positions[1]);
      expect(positions[0]).toBeLessThan(450);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

it.each(
  (["team", "mixed", "recipient"] as const).flatMap((detailsMode) =>
    ["james@fil.one", "alternate-signer@example.com"].map((email) => ({
      detailsMode,
      email,
    })),
  ),
)(
  "uses the configured countersigner email in both notice locations: %j",
  async ({ detailsMode, email }) => {
    const signer = { ...fixtureSigner, email };
    const pdf = await renderMnda(
      {
        ...fixtureInput,
        detailsMode,
        ...(detailsMode === "mixed" ? { locality: "" } : {}),
      },
      signer,
    );
    const dir = mkdtempSync(join(tmpdir(), "mnda-email-"));
    try {
      const path = join(dir, "document.pdf");
      writeFileSync(path, pdf.bytes);
      const text = execFileSync("pdftotext", ["-layout", path, "-"], {
        encoding: "utf8",
      });
      expect(text.split(signer.email)).toHaveLength(3);
      expect(text).not.toContain("m@fil.org");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30000,
);

it("preserves partner details that contain the former template email", () => {
  const input = {
    ...fixtureInput,
    company: "m@fil.org Ventures",
    noticesEmail: "m@fil.org",
  };
  const paragraphs = mndaParagraphs(input, {
    ...fixtureSigner,
    email: "james@fil.one",
  });
  expect(paragraphs[1]).toContain("m@fil.org Ventures");
  expect(paragraphs[1]).toContain("(ATTN: m@fil.org;");
  expect(paragraphs[1]).toContain("ATTN: email: james@fil.one;");
});
