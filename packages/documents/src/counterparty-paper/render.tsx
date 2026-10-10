import { createHash } from "node:crypto";
import React from "react";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { ContractSigner } from "@clockwork/contracts";
import { canonicalizeReactPdf } from "../canonicalize";
import type { RenderedContract } from "../contract-templates/definition";
import { assertTemplateValue } from "../contract-templates/render";

/**
 * The Fil One signature page appended to an uploaded PDF, the
 * counterparty's paper or Fil One's own: the SHA-256 of the document it is
 * attached to, an execution statement, a counterparts and electronic
 * signature clause, and a name, title and date block for each signer. A
 * change to the wording is a new version; requests already prepared keep
 * theirs.
 */
export const counterpartySignaturePageVersion = "2026-10-10";

/** Fil One's contracting entity, exactly as it signs. */
const filOneEntity = "FIL One LLC";

export interface CounterpartySignaturePageInput {
  contractId: string;
  counterpartyName: string;
  /** SHA-256 of the uploaded PDF the page is appended to. */
  sourceSha256: string;
  /** Present when the counterparty signs in SignWell first; null when they
   * signed their paper already and Fil One alone signs. */
  counterpartySigner: ContractSigner | null;
  countersigner: ContractSigner;
  /** Fixes the PDF's dates, so the same input renders the same bytes. */
  preparedOn: string;
  /** The page size; the uploaded PDF's own when it is appended to one.
   * Letter when not given. */
  paperSize?: SignaturePageSize;
}

export type SignaturePageSize = "A4" | "LETTER";

/** A4 when the PDF's last page is A4 either way up, otherwise Letter. */
function sourcePaperSize(document: PDFDocument): SignaturePageSize {
  const last = document.getPage(document.getPageCount() - 1);
  const { width, height } = last.getSize();
  const [short, long] = [Math.min(width, height), Math.max(width, height)];
  return Math.abs(short - 595.28) <= 6 && Math.abs(long - 841.89) <= 6
    ? "A4"
    : "LETTER";
}

const style = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 56,
    fontFamily: "Times-Roman",
    fontSize: 10.5,
    color: "#202020",
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 18,
  },
  paragraph: { marginBottom: 18, lineHeight: 1.25 },
  party: { fontFamily: "Times-Bold", marginBottom: 8 },
  block: { marginBottom: 28 },
  row: { flexDirection: "row", gap: 6, marginBottom: 8 },
  caption: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#666666",
    width: 46,
    paddingTop: 2,
  },
  value: { width: 260, minHeight: 14 },
  rule: { borderBottomWidth: 0.5, borderBottomColor: "#9a9a9a" },
  tag: { color: "#ffffff" },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#666666",
  },
});

function Row({
  label,
  children,
  height = 14,
  rule = false,
}: {
  label: string;
  children: React.ReactNode;
  height?: number;
  rule?: boolean;
}) {
  return (
    <View wrap={false} style={style.row}>
      <Text style={style.caption}>{label}</Text>
      <View
        style={{
          ...style.value,
          minHeight: height,
          ...(rule ? style.rule : {}),
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** One party's block. `recipient` is the signer's SignWell position. */
function SignatureBlock({
  party,
  signer,
  recipient,
}: {
  party: string;
  signer: ContractSigner;
  recipient: number;
}) {
  return (
    <View wrap={false} style={style.block}>
      <Text style={style.party}>{party}</Text>
      <Row label="By" rule height={38}>
        <Text style={{ ...style.tag, fontSize: 23 }}>
          {`{{signature:${recipient}:y}}`}
        </Text>
      </Row>
      <Row label="Name">
        <Text>{signer.name}</Text>
      </Row>
      <Row label="Title">
        <Text>{signer.title}</Text>
      </Row>
      <Row label="Date" height={18}>
        <Text style={style.tag}>{`{{af_d_s:${recipient}:y}}`}</Text>
      </Row>
    </View>
  );
}

/** What the page says above the signature blocks. When Fil One alone signs
 * here, the counterparty signed the document itself. */
function executionText(input: CounterpartySignaturePageInput) {
  return input.counterpartySigner
    ? `${filOneEntity} and ${input.counterpartyName} have caused the Document to be signed by their authorized representatives as of the dates written below. Each person signing confirms that they are authorized to sign for the party named above their signature.`
    : `${input.counterpartyName} has signed the Document. ${filOneEntity} has caused the Document to be signed by its authorized representative as of the date written below, and the person signing confirms that they are authorized to sign for ${filOneEntity}.`;
}

const counterpartsText =
  "The Document may be signed in counterparts and by electronic signature, each of which is an original and all of which together are one document. An electronic signature, and a signed copy delivered electronically, has the same effect as an original signature.";

/** The signature page alone, with SignWell text tags: the counterparty is
 * recipient 1 when they sign here, and the Fil One signer comes last. */
export async function renderCounterpartySignaturePage(
  input: CounterpartySignaturePageInput,
): Promise<RenderedContract> {
  const signers = [input.countersigner, input.counterpartySigner].filter(
    (signer): signer is ContractSigner => signer !== null,
  );
  for (const value of [
    input.counterpartyName,
    ...signers.flatMap((s) => [s.name, s.title]),
  ])
    assertTemplateValue(value);
  if (!/^[0-9a-f]{64}$/.test(input.sourceSha256))
    throw new Error("CONTRACT_PAPER_HASH_INVALID");
  const fixedDate = new Date(`${input.preparedOn}T00:00:00Z`);
  const pdf = await renderToBuffer(
    <Document
      title="Signature page"
      author={filOneEntity}
      creationDate={fixedDate}
      modificationDate={fixedDate}
    >
      <Page size={input.paperSize ?? "LETTER"} style={style.page}>
        <Text style={style.title}>SIGNATURE PAGE</Text>
        <Text style={{ ...style.paragraph, marginBottom: 2 }}>
          This page forms part of the document it is attached to (the
          "Document"), identified by its SHA-256:
        </Text>
        <Text style={style.paragraph} hyphenationCallback={(word) => [word]}>
          {input.sourceSha256}
        </Text>
        <Text style={style.paragraph}>{executionText(input)}</Text>
        <Text style={style.paragraph}>{counterpartsText}</Text>
        {input.counterpartySigner ? (
          <SignatureBlock
            party={input.counterpartyName}
            signer={input.counterpartySigner}
            recipient={1}
          />
        ) : null}
        <SignatureBlock
          party={filOneEntity}
          signer={input.countersigner}
          recipient={input.counterpartySigner ? 2 : 1}
        />
        <Text fixed style={style.footer}>
          {`${input.contractId.slice(0, 8)} · Fil One signature page ${counterpartySignaturePageVersion}`}
        </Text>
      </Page>
    </Document>,
  );
  return rendered(Buffer.from(canonicalizeReactPdf(pdf)));
}

function rendered(bytes: Buffer): RenderedContract {
  return {
    bytes,
    pages: [...bytes.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * The uploaded PDF with the Fil One signature page appended, on the same
 * paper size (A4 or Letter) as its last page: what is stored as the
 * prepared document and sent to SignWell. Its pages are copied with any
 * form fields of their own drawn into the page as they look, so SignWell
 * finds only the fields the signature page places. A PDF that cannot be
 * opened (encrypted or damaged), or whose form cannot be drawn exactly, is
 * refused. The same input gives the same bytes.
 */
export async function renderCounterpartyPaper(
  source: Uint8Array,
  input: CounterpartySignaturePageInput,
): Promise<RenderedContract> {
  if (createHash("sha256").update(source).digest("hex") !== input.sourceSha256)
    throw new Error("CONTRACT_PAPER_HASH_INVALID");
  // pdf-lib reads a damaged file lazily, so it can fail at any step here.
  let theirs: PDFDocument;
  let paperSize: SignaturePageSize;
  try {
    theirs = await PDFDocument.load(source, { updateMetadata: false });
    if (theirs.getPageCount() === 0) throw new Error("no pages");
    paperSize = sourcePaperSize(theirs);
  } catch {
    throw new Error("CONTRACT_PAPER_UNREADABLE");
  }
  const page = await renderCounterpartySignaturePage({ ...input, paperSize });
  const signature = await PDFDocument.load(page.bytes, {
    updateMetadata: false,
  });
  let merged: Uint8Array;
  try {
    withoutFormFields(theirs);
    // Pages are copied into a new file, which carries only what they use:
    // nothing left over from the form, and a clean cross-reference table.
    const document = await PDFDocument.create({ updateMetadata: false });
    for (const [from, pages] of [
      [theirs, theirs.getPageIndices()],
      [signature, signature.getPageIndices()],
    ] as const)
      for (const copied of await document.copyPages(from, pages))
        document.addPage(copied);
    merged = await document.save({ useObjectStreams: false });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "CONTRACT_PAPER_FORM_UNREADABLE"
    )
      throw error;
    throw new Error("CONTRACT_PAPER_UNREADABLE");
  }
  return rendered(Buffer.from(merged));
}

const formUnreadable = () => new Error("CONTRACT_PAPER_FORM_UNREADABLE");

/**
 * Draws a PDF's own form fields into its pages, exactly as they appear, and
 * removes the form: SignWell would otherwise turn them into fields of its
 * own, beside the ones the signature page places. Nothing is ever dropped to
 * make that work. A form whose look a viewer would have to work out (a field
 * with no stored appearance, `NeedAppearances`, an XFA-only form) or that
 * cannot be drawn completely is refused, so what the counterparty signs is
 * what their PDF shows.
 */
function withoutFormFields(document: PDFDocument) {
  const acroForm = document.catalog.lookupMaybe(
    PDFName.of("AcroForm"),
    PDFDict,
  );
  if (acroForm) {
    // Read before `getForm()`, which removes XFA on its own.
    const xfa = acroForm.has(PDFName.of("XFA"));
    const form = document.getForm();
    const fields = form.getFields();
    if (
      acroForm.lookup(PDFName.of("NeedAppearances")) === PDFBool.True ||
      (xfa && fields.length === 0) ||
      fields.some((field) =>
        field.acroField
          .getWidgets()
          .some((widget) => !widget.getAppearances()?.normal),
      )
    )
      throw formUnreadable();
    try {
      form.deleteXFA();
      // The stored appearances are drawn as they are, never regenerated.
      form.flatten({ updateFieldAppearances: false });
    } catch {
      throw formUnreadable();
    }
    document.catalog.delete(PDFName.of("AcroForm"));
  }
  for (const page of document.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annotations) continue;
    // Flattening deletes the widgets but can leave references to them; a
    // widget that is still there belonged to no field and was never drawn.
    const kept = annotations.asArray().filter((ref) => {
      const annotation = document.context.lookupMaybe(ref, PDFDict);
      if (annotation?.get(PDFName.of("Subtype")) === PDFName.of("Widget"))
        throw formUnreadable();
      return annotation !== undefined;
    });
    page.node.set(PDFName.of("Annots"), document.context.obj(kept));
  }
}
