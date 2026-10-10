import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PDFBool,
  PDFDocument,
  PDFName,
  StandardFonts,
  type PDFPage,
} from "pdf-lib";
import { expect, it } from "vitest";
import {
  renderCounterpartyPaper,
  type CounterpartySignaturePageInput,
} from "./render";

/** A partner's own two-page A4 agreement, made by another PDF writer. */
async function partnerPdf() {
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const line of [
    "Bluefin Reseller Agreement, page one.",
    "Bluefin Reseller Agreement, page two. Signed by Bluefin.",
  ])
    document
      .addPage([595.28, 841.89])
      .drawText(line, { x: 40, y: 780, size: 11, font });
  return Buffer.from(await document.save());
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function input(
  source: Uint8Array,
  patch: Partial<CounterpartySignaturePageInput> = {},
): CounterpartySignaturePageInput {
  return {
    contractId: "019a44ac-0000-7000-8000-00000000c0de",
    counterpartyName: "Bluefin Data Co.",
    sourceSha256: sha256(source),
    counterpartySigner: null,
    countersigner: {
      name: "James Kurz",
      email: "james@example.com",
      title: "CFO/CSO",
    },
    preparedOn: "2026-10-10",
    ...patch,
  };
}

/** What Poppler reads, whitespace collapsed. */
function text(bytes: Uint8Array) {
  const dir = mkdtempSync(join(tmpdir(), "counterparty-paper-"));
  try {
    const path = join(dir, "paper.pdf");
    writeFileSync(path, bytes);
    const read = spawnSync("pdftotext", ["-raw", path, "-"], {
      encoding: "utf8",
    });
    // Poppler reads the file without repairing it.
    expect(read.status).toBe(0);
    expect(read.stderr).toBe("");
    return read.stdout.replace(/\s+/g, " ").trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("appends the Fil One signature page to their pages, deterministically", async () => {
  const source = await partnerPdf();
  const [a, b] = await Promise.all([
    renderCounterpartyPaper(source, input(source)),
    renderCounterpartyPaper(source, input(source)),
  ]);
  expect(a.sha256).toBe(b.sha256);
  expect(a.pages).toBe(3);
  const rendered = text(a.bytes);
  // `UPDATE_GOLDEN=1` rewrites the golden after a reviewed wording change.
  const golden = new URL(
    "../__fixtures__/counterparty-paper.golden.txt",
    import.meta.url,
  );
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, `${rendered}\n`);
  expect(rendered).toBe(readFileSync(golden, "utf8").trim());
  expect(rendered).toContain("page one");
  expect(rendered).toContain(`SHA-256: ${sha256(source)}`);
  // Fil One alone signs: one recipient, one signature and one date.
  expect(rendered).toContain("{{signature:1:y}}");
  expect(rendered).toContain("{{af_d_s:1:y}}");
  expect(rendered).not.toContain("{{signature:2:y}}");
}, 30_000);

it("places the counterparty first when they sign in SignWell too", async () => {
  const source = await partnerPdf();
  const both = await renderCounterpartyPaper(
    source,
    input(source, {
      counterpartySigner: {
        name: "Alex Example",
        email: "alex@example.com",
        title: "CEO",
      },
    }),
  );
  const rendered = text(both.bytes);
  const counterparty = rendered.indexOf("Bluefin Data Co. By");
  const filOne = rendered.indexOf("FIL One LLC By");
  expect(counterparty).toBeGreaterThan(-1);
  expect(filOne).toBeGreaterThan(counterparty);
  expect(rendered.slice(counterparty, filOne)).toContain("{{signature:1:y}}");
  expect(rendered.slice(filOne)).toContain("{{signature:2:y}}");
  expect(rendered).toContain("Alex Example");
}, 30_000);

it("prints the signature page on the uploaded PDF's paper size", async () => {
  const lastPage = async (bytes: Uint8Array) => {
    const document = await PDFDocument.load(bytes);
    return document.getPage(document.getPageCount() - 1).getSize();
  };
  // An A4 agreement gets an A4 page.
  const a4 = await partnerPdf();
  const onA4 = await lastPage(
    (await renderCounterpartyPaper(a4, input(a4))).bytes,
  );
  expect(onA4.width).toBeCloseTo(595.28, 0);
  expect(onA4.height).toBeCloseTo(841.89, 0);
  // A Letter term sheet, Fil One's own paper, gets a Letter page.
  const document = await PDFDocument.create({ updateMetadata: false });
  document.addPage([612, 792]);
  const letter = Buffer.from(await document.save());
  const both = await renderCounterpartyPaper(
    letter,
    input(letter, {
      counterpartySigner: {
        name: "Alex Example",
        email: "alex@example.com",
        title: "Chief Executive Officer",
      },
    }),
  );
  // Both signature blocks fit on the one added page.
  expect(both.pages).toBe(2);
  expect(await lastPage(both.bytes)).toEqual({ width: 612, height: 792 });
}, 30_000);

it("refuses a PDF other than the one it was pinned to, or one it cannot open", async () => {
  const source = await partnerPdf();
  await expect(
    renderCounterpartyPaper(
      source,
      input(source, { sourceSha256: "a".repeat(64) }),
    ),
  ).rejects.toThrow("CONTRACT_PAPER_HASH_INVALID");
  const damaged = Buffer.from("%PDF-1.7\nnot really a pdf");
  await expect(
    renderCounterpartyPaper(damaged, input(damaged)),
  ).rejects.toThrow("CONTRACT_PAPER_UNREADABLE");
  await expect(
    renderCounterpartyPaper(
      source,
      input(source, { counterpartyName: "{{signature:1:y}}" }),
    ),
  ).rejects.toThrow("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
});

it("draws their own form fields into the page and leaves SignWell no form to read", async () => {
  // A partner PDF with a filled text field, a checkbox and an empty
  // signature-style field of its own.
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([595.28, 841.89]);
  const form = document.getForm();
  const name = form.createTextField("partner.name");
  name.setText("Bluefin Data Co.");
  name.addToPage(page, { x: 40, y: 700, width: 200, height: 20 });
  form.createCheckBox("partner.agree").addToPage(page, { x: 40, y: 660 });
  form
    .createTextField("partner.signature")
    .addToPage(page, { x: 40, y: 600, width: 200, height: 30 });
  const source = Buffer.from(await document.save({ useObjectStreams: false }));
  expect(source.toString("latin1")).toContain("/AcroForm");

  const merged = await renderCounterpartyPaper(source, input(source));
  const reopened = await PDFDocument.load(merged.bytes);
  expect(reopened.catalog.get(PDFName.of("AcroForm"))).toBeUndefined();
  expect(merged.bytes.toString("latin1")).not.toMatch(/\/Widget|\/XFA/);
  expect(merged.pages).toBe(2);
  // The filled value stays visible; only the signature page's tags remain.
  const rendered = text(merged.bytes);
  expect(rendered).toContain("Bluefin Data Co.");
  expect(rendered).toContain("{{signature:1:y}}");
}, 30_000);

/** A one-page PDF with a form, changed by `edit` before it is saved as is. */
async function formPdf(edit: (document: PDFDocument, page: PDFPage) => void) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage([595.28, 841.89]);
  edit(document, page);
  return Buffer.from(
    await document.save({
      useObjectStreams: false,
      updateFieldAppearances: false,
    }),
  );
}
const filledField = (document: PDFDocument, page: PDFPage) => {
  const terms = document.getForm().createTextField("partner.terms");
  terms.setText("Net 30 payment terms");
  terms.addToPage(page, { x: 40, y: 700, width: 300, height: 20 });
};
const refuses = async (source: Buffer) =>
  expect(renderCounterpartyPaper(source, input(source))).rejects.toThrow(
    "CONTRACT_PAPER_FORM_UNREADABLE",
  );

it("refuses a form it cannot draw exactly, rather than drop any of it", async () => {
  // An unsigned signature field with no stored look, before a filled field:
  // flattening would stop at the first and drop the terms after it.
  await refuses(
    await formPdf((document, page) => {
      const signature = document.getForm().createTextField("partner.sign");
      signature.addToPage(page, { x: 40, y: 600, width: 200, height: 30 });
      signature.acroField.dict.set(PDFName.of("FT"), PDFName.of("Sig"));
      for (const widget of signature.acroField.getWidgets())
        widget.dict.delete(PDFName.of("AP"));
      filledField(document, page);
    }),
  );
  // Appearances a viewer is asked to work out for itself.
  await refuses(
    await formPdf((document, page) => {
      filledField(document, page);
      document
        .getForm()
        .acroForm.dict.set(PDFName.of("NeedAppearances"), PDFBool.True);
    }),
  );
  // An XFA form with no fields of its own to draw.
  await refuses(
    await formPdf((document) => {
      document.catalog.set(
        PDFName.of("AcroForm"),
        document.context.obj({ Fields: [], XFA: [] }),
      );
    }),
  );
});
