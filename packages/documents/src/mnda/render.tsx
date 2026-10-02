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
    padding: 48,
    fontFamily: "Times-Roman",
    fontSize: 11,
    lineHeight: 1.3,
  },
  title: {
    fontFamily: "Times-Bold",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 18,
  },
  paragraph: { marginBottom: 9 },
  footer: {
    position: "absolute",
    bottom: 25,
    left: 48,
    right: 48,
    fontSize: 9,
    textAlign: "center",
  },
  signatures: { flexDirection: "row", gap: 28 },
  party: { width: 244 },
  heading: { fontFamily: "Times-Bold", marginBottom: 18 },
  line: { marginBottom: 16 },
  signature: { height: 56, borderBottomWidth: 0.5, marginBottom: 14 },
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

function RecipientField({
  id,
  wide = false,
  input,
}: {
  id: MndaDetailFieldId;
  wide?: boolean;
  input: MndaInput;
}) {
  const field = mndaDetailFields.find((f) => f.id === id);
  if (input.detailsMode !== "recipient" && mndaDetailValue(input, id)) {
    const prefix =
      id === "signer_name"
        ? "Name: "
        : id === "signer_title"
          ? "Title: "
          : id === "notice_contact"
            ? "ATTN: "
            : id === "email_notice"
              ? "email: "
              : "";
    return (
      <Text
        style={
          id === "company_sign"
            ? style.heading
            : id === "signer_name" || id === "signer_title"
              ? style.line
              : undefined
        }
      >
        {prefix}
        {mndaDetailValue(input, id)}
      </Text>
    );
  }
  if (!field) throw new Error("MNDA_FIELD_UNKNOWN");
  const width = wide ? 680 : 320;
  const tag = `{{text:1:y:${field.label}::${field.id}:${width}:18:${"email" in field ? "email_address" : ""}:y}}`;
  return (
    <View wrap={false} style={{ height: wide ? 47 : 65, marginBottom: 5 }}>
      <Text style={{ fontSize: 8, color: "#555555" }}>{field.label}</Text>
      <View
        style={{
          height: wide ? 32 : 50,
          borderBottomWidth: 0.5,
          borderBottomColor: "#999999",
        }}
      >
        <Text
          hyphenationCallback={(word) => [word]}
          style={{ fontSize: 4, color: "#ffffff" }}
        >
          {tag}
        </Text>
      </View>
    </View>
  );
}
function RecipientAddress({
  input,
  wide = false,
}: {
  input: MndaInput;
  wide?: boolean;
}) {
  if (input.detailsMode === "recipient")
    return (
      <RecipientField
        input={input}
        id={wide ? "address_intro" : "address_notice"}
        wide={wide}
      />
    );
  return (
    <View>
      <RecipientField
        input={input}
        id={wide ? "street_intro" : "street_notice"}
        wide={wide}
      />
      <RecipientField
        input={input}
        id={wide ? "locality_intro" : "locality_notice"}
        wide={wide}
      />
    </View>
  );
}
function RecipientIntroduction({ input }: { input: MndaInput }) {
  const ids: Record<string, MndaDetailFieldId> = {
    "[Counterparty Legal Name]": "company_intro",
    "[jurisdiction / entity type, e.g., Delaware corporation]": "entity",
    "[Counterparty email]": "email_intro",
    "[Counterparty address for notices]": "address_intro",
    "[Counterparty Short Name]": "short_name",
  };
  const introduction = template.paragraphs[1];
  if (!introduction) throw new Error("MNDA_INTRODUCTION_MISSING");
  return (
    <View style={style.paragraph}>
      {introduction
        .replace("[Effective Date]", input.effectiveDate)
        .replace(/\[[^\]]+\]/g, (token) => {
          const id = ids[token];
          if (!id) throw new Error("MNDA_FIELD_UNKNOWN");
          if (
            input.detailsMode === "recipient" ||
            (id === "address_intro" &&
              (!input.streetAddress || !input.locality))
          )
            return token;
          return mndaDetailValue(input, id) || token;
        })
        .split(/(\[[^\]]+\])/g)
        .map((part, i) => {
          if (!part.startsWith("["))
            return (
              <Text key={i} hyphenationCallback={(word) => [word]}>
                {part}
              </Text>
            );
          const id = ids[part];
          if (!id) throw new Error("MNDA_FIELD_UNKNOWN");
          return id === "address_intro" ? (
            <RecipientAddress key={i} input={input} wide />
          ) : (
            <RecipientField key={i} input={input} id={id} wide />
          );
        })}
    </View>
  );
}

/** Exact supplied legal paragraphs; variable values are plain text, never markup. */
export async function renderMnda(input: MndaInput, countersigner: MndaSigner) {
  const recipientDetails = mndaSigningFields(input).length > 0;
  const paragraphs = recipientDetails
    ? template.paragraphs.map((p) => p.replaceAll("\t", " "))
    : mndaParagraphs(input);
  const pdf = await renderToBuffer(
    <Document
      title="Mutual Non-Disclosure Agreement"
      author="FIL One LLC"
      creationDate={new Date(`${input.effectiveDate}T00:00:00Z`)}
      modificationDate={new Date(`${input.effectiveDate}T00:00:00Z`)}
    >
      <Page size="LETTER" style={style.page}>
        {paragraphs.map((p, i) =>
          recipientDetails && i === 1 ? (
            <RecipientIntroduction key={i} input={input} />
          ) : (
            <Text
              key={i}
              hyphenationCallback={(word) => [word]}
              style={i === 0 ? style.title : style.paragraph}
            >
              {p}
            </Text>
          ),
        )}
        <Text
          fixed
          style={style.footer}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </Page>
      <Page size="LETTER" style={style.page}>
        <View style={style.signatures}>
          <View style={style.party}>
            <Text style={style.heading}>
              FIL ONE LLC, on behalf of itself and its Affiliates
            </Text>
            <Text>Signature:</Text>
            <View style={style.signature}>
              <Text style={{ color: "#ffffff", fontSize: 23 }}>
                {"{{signature:2:y}}"}
              </Text>
            </View>
            <Text style={style.line}>Name: {countersigner.name}</Text>
            <Text style={style.line}>Title: {countersigner.title}</Text>
            <View style={style.line}>
              <Text>Date:</Text>
              <Text style={{ color: "#ffffff" }}>{"{{af_d_s:2:y}}"}</Text>
            </View>
            <Text style={style.heading}>Address for Notices:</Text>
            <Text>FIL One LLC</Text>
            <Text>ATTN: {countersigner.name}</Text>
            <Text>600 N Broad Street, Suite 5</Text>
            <Text>Middletown, DE 19709</Text>
            <Text>email: m@fil.org</Text>
          </View>
          <View style={style.party}>
            {recipientDetails ? (
              <RecipientField input={input} id="company_sign" />
            ) : (
              <Text style={style.heading}>{input.company}</Text>
            )}
            <Text>Signature:</Text>
            <View style={style.signature}>
              <Text style={{ color: "#ffffff", fontSize: 23 }}>
                {"{{signature:1:y}}"}
              </Text>
            </View>
            {recipientDetails ? (
              <RecipientField input={input} id="signer_name" />
            ) : (
              <Text style={style.line}>Name: {input.signerName}</Text>
            )}
            {recipientDetails ? (
              <RecipientField input={input} id="signer_title" />
            ) : (
              <Text style={style.line}>Title: {input.signerTitle}</Text>
            )}
            <View style={style.line}>
              <Text>Date:</Text>
              <Text style={{ color: "#ffffff" }}>{"{{af_d_s:1:y}}"}</Text>
            </View>
            <Text style={style.heading}>Address for Notices:</Text>
            {recipientDetails ? (
              <>
                <RecipientField input={input} id="company_notice" />
                <RecipientField input={input} id="notice_contact" />
                <RecipientAddress input={input} />
                <RecipientField input={input} id="email_notice" />
              </>
            ) : (
              <>
                <Text>{input.company}</Text>
                <Text>ATTN: {input.noticesContact}</Text>
                <Text>{input.streetAddress}</Text>
                <Text>{input.locality}</Text>
                <Text>email: {input.noticesEmail}</Text>
              </>
            )}
          </View>
        </View>
        <Text
          fixed
          style={style.footer}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>,
  );
  const bytes = Buffer.from(canonicalizeReactPdf(pdf));
  const text = bytes.toString("latin1");
  const pages = [...text.matchAll(/\/Type\s*\/Page\b/g)].length;
  return {
    bytes,
    pages,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
