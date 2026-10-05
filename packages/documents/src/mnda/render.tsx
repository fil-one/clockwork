import { createHash } from "node:crypto";
import React from "react";
import {
  Document,
  Font,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  mndaDetailFields,
  mndaDetailValue,
  mndaSigningFields,
  type MndaDetailFieldId,
  type MndaInput,
  type MndaSigner,
} from "@clockwork/contracts";
import { canonicalizeReactPdf } from "../canonicalize";
import { mndaEntityArticle } from "./article";
import {
  arimoRegular,
  cousineRegular,
  tinosBold,
  tinosRegular,
  tinosRegularMetrics,
} from "./fonts/fonts.generated";
import template from "./template.json";

export { mndaEntityArticle } from "./article";
export const mndaTemplateVersion = template.version;
export const mndaTemplateHash = template.sourceSha256;

/** Fil One settings printed into the agreement, snapshotted on each draft. */
export interface MndaRenderOptions {
  /** Fil One's address for legal notices, independent of the countersigner. */
  noticeEmail: string;
}

// Embedded, metric-compatible substitutes for Times, Helvetica and Courier, so
// every viewer draws the same glyphs and Latin Extended names render. Family
// names are MNDA-specific so other documents' registrations are unaffected.
const serif = "FilOneMndaSerif";
const sans = "FilOneMndaSans";
const mono = "FilOneMndaMono";
Font.register({
  family: serif,
  fonts: [
    { src: tinosRegular, fontWeight: 400 },
    { src: tinosBold, fontWeight: 700 },
  ],
});
Font.register({ family: sans, src: arimoRegular });
Font.register({ family: mono, src: cousineRegular });

const style = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 52,
    fontFamily: serif,
    fontSize: 10.5,
    color: "#202020",
  },
  title: {
    fontFamily: serif,
    fontWeight: 700,
    fontSize: 14,
    textAlign: "center",
    marginBottom: 18,
  },
  paragraph: { marginBottom: 8, fontSize: 10.5, lineHeight: 1.25 },
  follows: { marginTop: 10, textAlign: "center" },
  subtitle: {
    fontSize: 10.5,
    textAlign: "center",
    lineHeight: 1.3,
    marginTop: -10,
    marginBottom: 20,
    paddingHorizontal: 36,
  },
  footer: {
    position: "absolute",
    bottom: 25,
    left: 48,
    right: 48,
    fontFamily: sans,
    fontSize: 7.5,
    color: "#666666",
    textAlign: "center",
  },
  definitions: {
    position: "absolute",
    top: 8,
    left: 48,
    fontFamily: mono,
    fontSize: 1,
    lineHeight: 1,
    color: "#ffffff",
  },
  row: { flexDirection: "row", gap: 28 },
  cell: { width: 244, flexDirection: "row", gap: 6 },
  caption: {
    fontFamily: sans,
    fontSize: 8,
    color: "#666666",
    width: 42,
    paddingTop: 2,
  },
  value: { width: 196, paddingBottom: 2 },
  signatureLine: { borderBottomWidth: 0.5, borderBottomColor: "#9a9a9a" },
  section: {
    fontFamily: serif,
    fontWeight: 700,
    fontSize: 11,
    marginTop: 14,
    marginBottom: 10,
  },
  whiteTag: { color: "#ffffff" },
});

// Content widths in points: LETTER page less margins, a signature-page value
// column, and the centered signature-page subtitle.
const bodyWidth = 612 - 2 * 48;
const columnWidth = 196;
const subtitleWidth = bodyWidth - 2 * 36;
const noHyphenation = (word: string) => [word];
let advances: Map<number, number> | undefined;
/** Width in points of text set in the body face, without kerning. */
function measure(text: string, fontSize: number): number {
  advances ??= new Map(
    tinosRegularMetrics.widths.split(",").map((pair) => {
      const [code = "", width = ""] = pair.split(".");
      return [Number.parseInt(code, 16), Number(width)];
    }),
  );
  let units = 0;
  for (const c of text) units += advances.get(c.codePointAt(0) ?? 0) ?? 0;
  return (units * fontSize) / tinosRegularMetrics.unitsPerEm;
}

/**
 * Wraps a word too wide for its column (a long email, URL or single-word
 * name) at line feeds, preferring the points after @ . / and _, so it never
 * runs past the margin. Words that fit are left alone. A line feed is the
 * cleanest break react-pdf offers: a hyphenation point draws a hyphen into
 * the address, and an invisible break character changes nothing in extracted
 * text, which follows the printed lines either way.
 */
export function mndaBreakable(
  value: string,
  width: number,
  fontSize = 10.5,
): string {
  const room = width * 0.97; // Kerning and rounding margin.
  return value
    .split(" ")
    .map((word) => {
      if (measure(word, fontSize) <= room) return word;
      const fits = (piece: string) => measure(piece, fontSize) <= room;
      // A break after a hyphen is a last resort: text extraction (Poppler,
      // viewers' copy) reads a line-final hyphen as hyphenation and drops it.
      const pieces = word
        .split(/(?<=[@./_])/)
        .flatMap((piece) => (fits(piece) ? [piece] : piece.split(/(?<=-)/)))
        .flatMap((piece) => (fits(piece) ? [piece] : [...piece]));
      const lines = [""];
      for (const piece of pieces) {
        const line = lines.at(-1) ?? "";
        if (line && measure(line + piece, fontSize) > room) lines.push(piece);
        else lines[lines.length - 1] = line + piece;
      }
      return lines.join("\n");
    })
    .join(" ");
}

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
/** "2026-10-02" becomes "October 2, 2026", independent of time zone. */
export function formatMndaEffectiveDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = months[Number(match?.[2]) - 1];
  if (!match || !month || Number(match[3]) < 1 || Number(match[3]) > 31)
    throw new Error("MNDA_EFFECTIVE_DATE_INVALID");
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

const filOneNoticeEmail = "ATTN: email: m@fil.org;";
const entityPlaceholder =
  "[jurisdiction / entity type, e.g., Delaware corporation]";
const entityArticle = /\ba (?=\[jurisdiction \/ entity type)/;

function resolvedParagraphs(
  input: MndaInput,
  options: MndaRenderOptions,
  print: (value: string) => string,
): string[] {
  const values: Record<string, string> = {
    "[Counterparty Legal Name]": input.company,
    "[Counterparty Short Name]": input.shortName || input.company,
    [entityPlaceholder]: input.entityDescription,
    "[Counterparty email]": input.noticesEmail,
    "[Counterparty address for notices]": `${input.streetAddress}, ${input.locality}`,
    "[Effective Date]": formatMndaEffectiveDate(input.effectiveDate),
  };
  return template.paragraphs.map((p) =>
    p
      .replace(filOneNoticeEmail, `ATTN: email: ${print(options.noticeEmail)};`)
      .replace(entityArticle, `${mndaEntityArticle(input.entityDescription)} `)
      .replace(/\[[^\]]+\]/g, (token) => {
        const value = values[token];
        if (!value) throw new Error("MNDA_TEMPLATE_FIELD_UNRESOLVED");
        return print(value);
      })
      .replaceAll("\t", " "),
  );
}

/** The agreement text as signed, for a fully supplied draft. */
export function mndaParagraphs(
  input: MndaInput,
  options: MndaRenderOptions,
): string[] {
  return resolvedParagraphs(input, options, (value) => value);
}

/**
 * Partner-completed fields. One table sizes every field: the visible blank
 * reserved in the PDF and the field SignWell draws over it come from the same
 * width, in every detail mode, inline or on the signature page. SignWell text
 * tags measure in CSS pixels (96 per inch); PDF points are 72 per inch.
 */
const fieldWidthPt: Record<MndaDetailFieldId, number> = {
  company_intro: 297,
  entity: 297,
  email_intro: 297,
  address_intro: 297,
  street_intro: 297,
  locality_intro: 297,
  short_name: 189,
  company_sign: 189,
  signer_name: 189,
  signer_title: 189,
  company_notice: 189,
  notice_contact: 189,
  address_notice: 189,
  street_notice: 189,
  locality_notice: 189,
  email_notice: 189,
};
const fieldHeightPx = 18;
const tagFontSize = 9;
const tagAdvance = tagFontSize * 0.6; // Cousine, like Courier, is 0.6 em wide.
const toPx = (pt: number) => Math.round((pt * 4) / 3);
// Short aliases keep signing instructions out of the visible paragraph.
// Definitions precede their use, as SignWell requires for tag variables.
const alias = (id: MndaDetailFieldId) =>
  `f${mndaDetailFields.findIndex((f) => f.id === id) + 1}`;

function Definitions({ input }: { input: MndaInput }) {
  return (
    <Text style={style.definitions}>
      {mndaSigningFields(input)
        .map(
          (field) =>
            `{{set=${alias(field.id)}:text:1:y:${field.label}::${field.id}:${toPx(fieldWidthPt[field.id])}:${fieldHeightPx}:${"email" in field ? "email_address" : ""}:y}}`,
        )
        .join("\n")}
    </Text>
  );
}
function isMissing(input: MndaInput, id: MndaDetailFieldId) {
  return mndaSigningFields(input).some((field) => field.id === id);
}

/**
 * A partner detail: the supplied value, or, when missing, a white SignWell tag
 * padded with non-breaking spaces to the field's width over a grey rule. The
 * padding keeps following text clear of the field; a tall line inline leaves
 * room for the field's height above and below.
 */
function Slot({
  input,
  id,
  inline = false,
}: {
  input: MndaInput;
  id: MndaDetailFieldId;
  inline?: boolean;
}) {
  if (!isMissing(input, id))
    return (
      <Text>
        {mndaBreakable(
          mndaDetailValue(input, id),
          inline ? bodyWidth : columnWidth,
        )}
      </Text>
    );
  const tag = `{{${alias(id)}}}`;
  const characters = Math.floor(fieldWidthPt[id] / tagAdvance);
  return (
    <Text
      style={{
        fontFamily: mono,
        fontSize: tagFontSize,
        ...(inline ? { lineHeight: 4 } : {}),
        color: "#ffffff",
        textDecoration: "underline",
        textDecorationColor: "#a0a0a0",
      }}
    >
      {tag + "\u00a0".repeat(characters - tag.length)}
    </Text>
  );
}

function Introduction({
  input,
  options,
}: {
  input: MndaInput;
  options: MndaRenderOptions;
}) {
  const ids: Record<string, MndaDetailFieldId> = {
    "[Counterparty Legal Name]": "company_intro",
    [entityPlaceholder]: "entity",
    "[Counterparty email]": "email_intro",
    "[Counterparty Short Name]": "short_name",
  };
  const introduction = template.paragraphs[1];
  if (!introduction) throw new Error("MNDA_INTRODUCTION_MISSING");
  return (
    <Text
      style={style.paragraph}
      {...{ hyphenationPenalty: 1000000 }}
      hyphenationCallback={noHyphenation}
    >
      {introduction
        .replace(
          "[Effective Date]",
          formatMndaEffectiveDate(input.effectiveDate),
        )
        .replace(
          filOneNoticeEmail,
          `ATTN: email: ${mndaBreakable(options.noticeEmail, bodyWidth)};`,
        )
        .replace(
          entityArticle,
          isMissing(input, "entity")
            ? "a "
            : `${mndaEntityArticle(input.entityDescription)} `,
        )
        .split(/(\[[^\]]+\])/g)
        .map((part, i) => {
          if (part === "[Counterparty address for notices]")
            return input.detailsMode === "recipient" ? (
              <Slot key={i} input={input} id="address_intro" inline />
            ) : (
              <Text key={i}>
                <Slot input={input} id="street_intro" inline />
                {", "}
                <Slot input={input} id="locality_intro" inline />
              </Text>
            );
          const id = ids[part];
          return id ? <Slot key={i} input={input} id={id} inline /> : part;
        })}
    </Text>
  );
}

function Row({
  label,
  left,
  right,
  height = 14,
  signature = false,
}: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  height?: number;
  signature?: boolean;
}) {
  return (
    <View wrap={false} style={{ ...style.row, marginBottom: 6 }}>
      {[left, right].map((content, i) => (
        <View key={i} style={style.cell}>
          <Text style={style.caption}>{label}</Text>
          <View
            style={{
              ...style.value,
              minHeight: height,
              ...(signature ? style.signatureLine : {}),
            }}
          >
            <Text
              {...{ hyphenationPenalty: 1000000 }}
              hyphenationCallback={noHyphenation}
            >
              {content}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
function Footer({ input }: { input: MndaInput }) {
  const reference = `Mutual Non-Disclosure Agreement · Ref ${input.id.slice(0, 8)} · Template ${mndaTemplateVersion}`;
  return (
    <Text
      fixed
      style={style.footer}
      render={({ pageNumber, totalPages }) =>
        `${reference} · ${pageNumber} / ${totalPages}`
      }
    />
  );
}
const headings = [
  "Purpose.",
  "“Confidential Information”",
  "Non-use and Non-disclosure.",
  "Maintenance of Confidentiality.",
  "No Obligation.",
  "Competing Products/Services.",
  "No Warranty.",
  "Return of Materials.",
  "Ownership; No License.",
  "Term.",
  "Availability of Equitable Relief.",
  "Attorneys’ Fees.",
  "Severability.",
  "Miscellaneous.",
];
function Paragraph({ text }: { text: string }) {
  const heading = headings
    .map((h, i) => `${i + 1}. ${h}`)
    .find((h) => text.startsWith(h));
  return (
    <Text
      style={style.paragraph}
      {...{ hyphenationPenalty: 1000000 }}
      orphans={3}
      widows={3}
      hyphenationCallback={noHyphenation}
    >
      {heading ? (
        <>
          <Text style={{ fontWeight: 700 }}>{heading}</Text>
          {text.slice(heading.length)}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

function SignaturePageHeading({ input }: { input: MndaInput }) {
  // In recipient mode the company field holds only an internal reference.
  const counterparty =
    input.detailsMode === "recipient"
      ? "the counterparty named above"
      : mndaBreakable(input.company, subtitleWidth);
  return (
    <>
      <Text style={style.title}>SIGNATURE PAGE</Text>
      <Text
        style={style.subtitle}
        {...{ hyphenationPenalty: 1000000 }}
        hyphenationCallback={noHyphenation}
      >
        Signature page to the Mutual Non-Disclosure Agreement between FIL One
        LLC and {counterparty}, effective{" "}
        {formatMndaEffectiveDate(input.effectiveDate)}.
      </Text>
    </>
  );
}

/**
 * PDFKit names each embedded font subset with six random capitals
 * ("QYNXNZ+Tinos-Regular"). Blank them before canonicalizing, then derive
 * them from the canonical document, so the same draft renders to the same
 * bytes. Replacements keep their length, so cross-reference offsets hold.
 */
const subsetTag = /\/([A-Z]{6})\+((?:Tinos|Arimo|Cousine)-[A-Za-z]+)/g;
function canonicalMndaPdf(pdf: Uint8Array): Buffer {
  const blank = Buffer.from(
    Buffer.from(pdf).toString("latin1").replace(subsetTag, "/AAAAAA+$2"),
    "latin1",
  );
  const canonical = Buffer.from(canonicalizeReactPdf(blank));
  const digest = createHash("sha256").update(canonical).digest("hex");
  return Buffer.from(
    canonical.toString("latin1").replace(subsetTag, (_, _tag, name: string) => {
      const hash = createHash("sha256").update(`${digest}:${name}`).digest();
      const tag = [...hash.subarray(0, 6)]
        .map((byte) => String.fromCharCode(65 + (byte % 26)))
        .join("");
      return `/${tag}+${name}`;
    }),
    "latin1",
  );
}

/** Supplied legal wording is preserved; only layout and variable fields change. */
export async function renderMnda(
  input: MndaInput,
  countersigner: MndaSigner,
  options: MndaRenderOptions,
) {
  const missing = mndaSigningFields(input);
  const paragraphs = missing.length
    ? template.paragraphs.map((p) => p.replaceAll("\t", " "))
    : resolvedParagraphs(input, options, (value) =>
        mndaBreakable(value, bodyWidth),
      );
  const tall = (id: MndaDetailFieldId, missingHeight: number, height = 14) =>
    isMissing(input, id) ? missingHeight : height;
  const pdf = await renderToBuffer(
    <Document
      title="Mutual Non-Disclosure Agreement"
      author="FIL One LLC"
      creationDate={new Date(`${input.effectiveDate}T00:00:00Z`)}
      modificationDate={new Date(`${input.effectiveDate}T00:00:00Z`)}
    >
      <Page size="LETTER" style={style.page}>
        {missing.length ? <Definitions input={input} /> : null}
        {paragraphs.map((p, i) =>
          i === 0 ? (
            <Text key={i} style={style.title}>
              {p}
            </Text>
          ) : missing.length && i === 1 ? (
            <Introduction key={i} input={input} options={options} />
          ) : (
            <Paragraph key={i} text={p} />
          ),
        )}
        <Text style={style.follows}>[Signature page follows]</Text>
        <Footer input={input} />
      </Page>
      <Page size="LETTER" style={style.page}>
        <SignaturePageHeading input={input} />
        <Row
          label="Party"
          height={tall("company_sign", 44, 26)}
          left={<>FIL ONE LLC,{"\n"}on behalf of itself and its Affiliates</>}
          right={<Slot input={input} id="company_sign" />}
        />
        <Row
          label="Signature"
          height={38}
          signature
          left={
            <Text style={{ ...style.whiteTag, fontSize: 23 }}>
              {"{{signature:2:y}}"}
            </Text>
          }
          right={
            <Text style={{ ...style.whiteTag, fontSize: 23 }}>
              {"{{signature:1:y}}"}
            </Text>
          }
        />
        <Row
          label="Name"
          height={tall("signer_name", 38)}
          left={mndaBreakable(countersigner.name, columnWidth)}
          right={<Slot input={input} id="signer_name" />}
        />
        <Row
          label="Title"
          height={tall("signer_title", 38)}
          left={mndaBreakable(countersigner.title, columnWidth)}
          right={<Slot input={input} id="signer_title" />}
        />
        <Row
          label="Date"
          height={18}
          left={<Text style={style.whiteTag}>{"{{af_d_s:2:y}}"}</Text>}
          right={<Text style={style.whiteTag}>{"{{af_d_s:1:y}}"}</Text>}
        />
        <Text style={style.section}>ADDRESS FOR NOTICES</Text>
        <Row
          label="Company"
          height={tall("company_notice", 44)}
          left="FIL One LLC"
          right={<Slot input={input} id="company_notice" />}
        />
        <Row
          label="Attention"
          height={tall("notice_contact", 38)}
          left={mndaBreakable(countersigner.name, columnWidth)}
          right={<Slot input={input} id="notice_contact" />}
        />
        {input.detailsMode === "recipient" ? (
          <Row
            label="Address"
            height={70}
            left={<>600 N Broad Street, Suite 5{"\n"}Middletown, DE 19709</>}
            right={<Slot input={input} id="address_notice" />}
          />
        ) : (
          <View wrap={false} style={{ ...style.row, marginBottom: 6 }}>
            <View style={style.cell}>
              <Text style={style.caption}>Address</Text>
              <Text style={{ ...style.value, minHeight: 28 }}>
                600 N Broad Street, Suite 5{"\n"}Middletown, DE 19709
              </Text>
            </View>
            <View style={style.cell}>
              <Text style={style.caption}>Address</Text>
              <View style={style.value}>
                {(["street_notice", "locality_notice"] as const).map((id) => (
                  <View key={id} style={{ minHeight: tall(id, 42) }}>
                    <Text
                      {...{ hyphenationPenalty: 1000000 }}
                      hyphenationCallback={noHyphenation}
                    >
                      <Slot input={input} id={id} />
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}
        <Row
          label="Email"
          height={tall("email_notice", 32)}
          left={mndaBreakable(options.noticeEmail, columnWidth)}
          right={<Slot input={input} id="email_notice" />}
        />
        <Footer input={input} />
      </Page>
    </Document>,
  );
  const bytes = canonicalMndaPdf(pdf);
  return {
    bytes,
    pages: [...bytes.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
