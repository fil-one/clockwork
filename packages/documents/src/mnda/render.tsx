import { createHash } from "node:crypto";
import React from "react";
import {
  Document,
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
import template from "./template.json";

export const mndaTemplateVersion = template.version;
export const mndaTemplateHash = template.sourceSha256;
const style = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 52,
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
  paragraph: { marginBottom: 8, fontSize: 10.5, lineHeight: 1.25 },
  footer: {
    position: "absolute",
    bottom: 25,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#666666",
    textAlign: "center",
  },
  definitions: {
    position: "absolute",
    top: 8,
    left: 48,
    fontFamily: "Courier",
    fontSize: 1,
    lineHeight: 1,
    color: "#ffffff",
  },
  row: { flexDirection: "row", gap: 28 },
  cell: { width: 244 },
  caption: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#666666",
    marginBottom: 4,
  },
  rule: {
    borderBottomWidth: 0.5,
    borderBottomColor: "#9a9a9a",
    minHeight: 29,
    paddingBottom: 4,
  },
  section: {
    fontFamily: "Times-Bold",
    fontSize: 11,
    marginTop: 19,
    marginBottom: 10,
  },
});
export function mndaParagraphs(input: MndaInput): string[] {
  const values: Record<string, string> = {
    "[Counterparty Legal Name]": input.company,
    "[Counterparty Short Name]": input.shortName || input.company,
    "[jurisdiction / entity type, e.g., Delaware corporation]":
      input.entityDescription,
    "[Counterparty email]": input.noticesEmail,
    "[Counterparty address for notices]": `${input.streetAddress}, ${input.locality}`,
    "[Effective Date]": input.effectiveDate,
  };
  return template.paragraphs.map((p) =>
    p
      .replace(/\[[^\]]+\]/g, (token) => {
        const value = values[token];
        if (!value) throw new Error("MNDA_TEMPLATE_FIELD_UNRESOLVED");
        return value;
      })
      .replaceAll("\t", " "),
  );
}

// Short aliases keep signing instructions out of the visible paragraph. A
// monospaced, non-breaking span reserves the same width as the signing field.
// Definitions precede their use, as required by SignWell text-tag variables.
const alias = (id: MndaDetailFieldId) =>
  `f${mndaDetailFields.findIndex((f) => f.id === id) + 1}`;
const fieldWidth = (id: MndaDetailFieldId) =>
  id.endsWith("intro") || id === "entity"
    ? 297
    : id === "short_name"
      ? 189
      : 237.6;
const fieldTag = (id: MndaDetailFieldId) => `{{${alias(id)}}}`;
function Definitions({ input }: { input: MndaInput }) {
  return (
    <Text style={style.definitions}>
      {mndaSigningFields(input)
        .map(
          (field) =>
            `{{set=${alias(field.id)}:text:1:y:${field.label}::${field.id}:${Math.round((fieldWidth(field.id) * 4) / 3)}:18:${"email" in field ? "email_address" : ""}:y}}`,
        )
        .join("\n")}
    </Text>
  );
}
function isMissing(input: MndaInput, id: MndaDetailFieldId) {
  return mndaSigningFields(input).some((field) => field.id === id);
}
function InlineDetail({
  input,
  id,
}: {
  input: MndaInput;
  id: MndaDetailFieldId;
}) {
  if (!isMissing(input, id))
    return (
      <Text hyphenationCallback={(word) => [word]}>
        {mndaDetailValue(input, id)}
      </Text>
    );
  const tag = fieldTag(id);
  const characters = Math.round(fieldWidth(id) / 5.4); // Courier 9pt = 5.4pt per character.
  return (
    <Text
      style={{
        fontFamily: "Courier",
        fontSize: 9,
        lineHeight: 4,
        color: "#ffffff",
        textDecoration: "underline",
        textDecorationColor: "#a0a0a0",
      }}
    >
      {tag + "\u00a0".repeat(characters - tag.length)}
    </Text>
  );
}
function Introduction({ input }: { input: MndaInput }) {
  const ids: Record<string, MndaDetailFieldId> = {
    "[Counterparty Legal Name]": "company_intro",
    "[jurisdiction / entity type, e.g., Delaware corporation]": "entity",
    "[Counterparty email]": "email_intro",
    "[Counterparty Short Name]": "short_name",
  };
  const introduction = template.paragraphs[1];
  if (!introduction) throw new Error("MNDA_INTRODUCTION_MISSING");
  return (
    <Text
      style={style.paragraph}
      {...{ hyphenationPenalty: 1000000 }}
      hyphenationCallback={(word) => [word]}
    >
      {introduction
        .replace("[Effective Date]", input.effectiveDate)
        .split(/(\[[^\]]+\])/g)
        .map((part, i) => {
          if (part === "[Counterparty address for notices]")
            return input.detailsMode === "recipient" ? (
              <InlineDetail key={i} input={input} id="address_intro" />
            ) : (
              <Text key={i} hyphenationCallback={(word) => [word]}>
                <Text hyphenationCallback={(word) => [word]}>
                  <InlineDetail input={input} id="street_intro" />
                  {","}
                </Text>{" "}
                <InlineDetail input={input} id="locality_intro" />
              </Text>
            );
          const id = ids[part];
          return id ? <InlineDetail key={i} input={input} id={id} /> : part;
        })}
    </Text>
  );
}
function Detail({ input, id }: { input: MndaInput; id: MndaDetailFieldId }) {
  return isMissing(input, id) ? (
    <Text style={{ fontFamily: "Courier", fontSize: 9, color: "#ffffff" }}>
      {fieldTag(id)}
    </Text>
  ) : (
    <Text
      {...{ hyphenationPenalty: 1000000 }}
      hyphenationCallback={(word) => [word]}
    >
      {mndaDetailValue(input, id)}
    </Text>
  );
}
function Row({
  label,
  left,
  right,
  height = 38,
}: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  height?: number;
}) {
  return (
    <View wrap={false} style={{ ...style.row, marginBottom: 10 }}>
      {[left, right].map((content, i) => (
        <View key={i} style={style.cell}>
          <Text style={style.caption}>{label}</Text>
          <View style={{ ...style.rule, minHeight: height }}>{content}</View>
        </View>
      ))}
    </View>
  );
}
function Footer() {
  return (
    <Text
      fixed
      style={style.footer}
      render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
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
      hyphenationCallback={(word) => [word]}
    >
      {heading ? (
        <>
          <Text style={{ fontFamily: "Times-Bold" }}>{heading}</Text>
          {text.slice(heading.length)}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

/** Supplied legal wording is preserved; only layout and variable fields change. */
export async function renderMnda(input: MndaInput, countersigner: MndaSigner) {
  const missing = mndaSigningFields(input);
  const paragraphs = missing.length
    ? template.paragraphs.map((p) => p.replaceAll("\t", " "))
    : mndaParagraphs(input);
  const pdf = await renderToBuffer(
    <Document
      title="Mutual Non-Disclosure Agreement"
      author="Fil One LLC"
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
            <Introduction key={i} input={input} />
          ) : (
            <Paragraph key={i} text={p} />
          ),
        )}
        <Footer />
      </Page>
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>SIGNATURES</Text>
        <Row
          label="Party"
          height={42}
          left={
            <Text>FIL ONE LLC, on behalf of itself and its Affiliates</Text>
          }
          right={<Detail input={input} id="company_sign" />}
        />
        <Row
          label="Signature"
          height={45}
          left={
            <Text style={{ color: "#ffffff", fontSize: 23 }}>
              {"{{signature:2:y}}"}
            </Text>
          }
          right={
            <Text style={{ color: "#ffffff", fontSize: 23 }}>
              {"{{signature:1:y}}"}
            </Text>
          }
        />
        <Row
          label="Name"
          left={<Text>{countersigner.name}</Text>}
          right={<Detail input={input} id="signer_name" />}
        />
        <Row
          label="Title"
          left={<Text>{countersigner.title}</Text>}
          right={<Detail input={input} id="signer_title" />}
        />
        <Row
          label="Date"
          height={22}
          left={<Text style={{ color: "#ffffff" }}>{"{{af_d_s:2:y}}"}</Text>}
          right={<Text style={{ color: "#ffffff" }}>{"{{af_d_s:1:y}}"}</Text>}
        />
        <Text style={style.section}>ADDRESS FOR NOTICES</Text>
        <Row
          label="Company"
          height={32}
          left={<Text>FIL One LLC</Text>}
          right={<Detail input={input} id="company_notice" />}
        />
        <Row
          label="Attention"
          height={32}
          left={<Text>{countersigner.name}</Text>}
          right={<Detail input={input} id="notice_contact" />}
        />
        <Row
          label="Address"
          height={100}
          left={
            <Text>600 N Broad Street, Suite 5{"\n"}Middletown, DE 19709</Text>
          }
          right={
            input.detailsMode === "recipient" ? (
              <Detail input={input} id="address_notice" />
            ) : (
              <View>
                <View style={{ minHeight: 45 }}>
                  <Detail input={input} id="street_notice" />
                </View>
                <Detail input={input} id="locality_notice" />
              </View>
            )
          }
        />
        <Row
          label="Email"
          height={32}
          left={<Text>m@fil.org</Text>}
          right={<Detail input={input} id="email_notice" />}
        />
        <Footer />
      </Page>
    </Document>,
  );
  const bytes = Buffer.from(canonicalizeReactPdf(pdf));
  return {
    bytes,
    pages: [...bytes.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
