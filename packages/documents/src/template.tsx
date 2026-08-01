import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import React, { type ReactNode } from "react";

import { FIL_ONE_WORDMARK_PNG } from "./assets/wordmark";
import {
  formatAddress,
  formatDateTime,
  groupHash,
  normalizeSha256Hash,
  taxIdentityLabel,
} from "./format";
import { englishDocumentMessages as copy } from "./messages";
import type { BaseDocumentInput, BrandConfig, Party } from "./model";

Font.registerHyphenationCallback((word) => [word]);

export const DEFAULT_BRAND: BrandConfig = {
  accentColor: "#0067CC",
  legalFooter: "Fil One commerce records",
  legalName: "Fil One, Inc.",
  logo: FIL_ONE_WORDMARK_PNG,
  supportEmail: "support@filone.com",
  wordmark: "FIL ONE",
};

const palette = {
  amber: "#8A5A12",
  blueWash: "#EEF4F5",
  border: "#CAD5CF",
  critical: "#A13A36",
  ink: "#15241D",
  muted: "#596A61",
  paper: "#FFFFFF",
  soft: "#F4F7F5",
  wash: "#E8F0EC",
} as const;

export const styles = StyleSheet.create({
  address: {
    color: palette.muted,
    fontSize: 8.5,
    lineHeight: 1.4,
    marginTop: 6,
  },
  badge: {
    alignSelf: "flex-start",
    backgroundColor: palette.wash,
    borderRadius: 2,
    color: palette.ink,
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 0.8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  body: { lineHeight: 1.45 },
  card: {
    borderColor: palette.border,
    borderRadius: 3,
    borderWidth: 1,
    padding: 12,
  },
  cardMuted: {
    backgroundColor: palette.soft,
    borderColor: palette.border,
    borderRadius: 3,
    borderWidth: 1,
    padding: 12,
  },
  critical: { color: palette.critical },
  detail: { color: palette.muted, fontSize: 8, marginTop: 2 },
  footer: {
    alignItems: "center",
    borderTopColor: palette.border,
    borderTopWidth: 1,
    bottom: 20,
    color: palette.muted,
    display: "flex",
    flexDirection: "row",
    fontSize: 7.5,
    justifyContent: "space-between",
    left: 42,
    paddingTop: 8,
    position: "absolute",
    right: 42,
  },
  footerCenter: { textAlign: "center", width: "42%" },
  footerSide: { width: "29%" },
  footerSideRight: { textAlign: "right", width: "29%" },
  header: {
    alignItems: "flex-end",
    borderBottomWidth: 2,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    left: 42,
    paddingBottom: 10,
    position: "absolute",
    right: 42,
    top: 28,
  },
  headerMeta: {
    color: palette.muted,
    fontSize: 7.5,
    lineHeight: 1.35,
    textAlign: "right",
  },
  keyValueLabel: {
    color: palette.muted,
    fontSize: 7.5,
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  keyValuePair: {
    flexBasis: "48%",
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 9,
    maxWidth: "48%",
    width: "48%",
  },
  keyValueValue: { fontSize: 9.5, lineHeight: 1.35, marginTop: 2 },
  keyValues: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  listItem: {
    display: "flex",
    flexDirection: "row",
    marginBottom: 5,
  },
  listMarker: { color: palette.muted, width: 14 },
  listText: { flex: 1, lineHeight: 1.4 },
  logo: { height: 22, width: 85 },
  page: {
    backgroundColor: palette.paper,
    color: palette.ink,
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingBottom: 62,
    paddingHorizontal: 42,
    paddingTop: 98,
  },
  partyCard: { width: "48.5%" },
  partyLabel: {
    color: palette.muted,
    fontSize: 7.5,
    letterSpacing: 0.5,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  partyName: { fontSize: 11, fontWeight: 700 },
  partyRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  section: { marginTop: 18 },
  sectionHeading: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.25,
    marginBottom: 9,
    paddingBottom: 5,
  },
  small: { color: palette.muted, fontSize: 8, lineHeight: 1.4 },
  statusWarning: { color: palette.amber, fontWeight: 700 },
  table: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    marginTop: 3,
  },
  tableCell: { paddingHorizontal: 5, paddingVertical: 7 },
  tableCellRight: {
    paddingHorizontal: 5,
    paddingVertical: 7,
    textAlign: "right",
  },
  tableDetail: { color: palette.muted, fontSize: 7.5, marginTop: 2 },
  tableHeader: {
    backgroundColor: palette.soft,
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    color: palette.muted,
    display: "flex",
    flexDirection: "row",
    fontSize: 7,
    fontWeight: 700,
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  tableRow: {
    borderTopColor: palette.border,
    borderTopWidth: 1,
    display: "flex",
    flexDirection: "row",
    minHeight: 28,
  },
  title: { fontSize: 25, fontWeight: 700, letterSpacing: -0.25 },
  titleBlock: { marginBottom: 18 },
  titleEyebrow: {
    color: palette.muted,
    fontSize: 8,
    letterSpacing: 0.6,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  totals: { alignSelf: "flex-end", marginTop: 13, width: "50%" },
  totalsGrand: {
    borderTopColor: palette.ink,
    borderTopWidth: 1.5,
    display: "flex",
    flexDirection: "row",
    fontSize: 11,
    fontWeight: 700,
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 8,
  },
  totalsRow: {
    color: palette.muted,
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  verification: {
    backgroundColor: palette.blueWash,
    borderColor: palette.border,
    borderRadius: 3,
    borderWidth: 1,
    marginTop: 24,
    padding: 12,
  },
  verificationHash: {
    fontFamily: "Courier",
    fontSize: 7.5,
    lineHeight: 1.45,
    marginTop: 6,
  },
  wordmark: { fontSize: 15, fontWeight: 700, letterSpacing: 2.1 },
});

export interface KeyValueItem {
  label: string;
  value: string;
}

export interface TableColumn {
  label: string;
  width: `${number}%`;
  align?: "left" | "right";
}

export interface TableRowData {
  id: string;
  cells: readonly { value: string; detail?: string }[];
}

export function BrandedDocument({
  input,
  title,
  subject,
  orientation = "portrait",
  pages,
  children,
}: {
  input: BaseDocumentInput;
  title: string;
  subject: string;
  orientation?: "portrait" | "landscape";
  pages?: readonly ReactNode[];
  children?: ReactNode;
}) {
  const brand = {
    accentColor:
      input.brand?.accentColor ?? DEFAULT_BRAND.accentColor ?? palette.ink,
    legalFooter:
      input.brand?.legalFooter ??
      DEFAULT_BRAND.legalFooter ??
      DEFAULT_BRAND.legalName,
    legalName: input.brand?.legalName ?? DEFAULT_BRAND.legalName,
    // A branded document never inherits the Fil One mark. A partner that
    // supplies no logo of its own falls back to its own wordmark text.
    logo: input.brand ? input.brand.logo : DEFAULT_BRAND.logo,
    supportEmail: input.brand?.supportEmail ?? DEFAULT_BRAND.supportEmail,
    wordmark: input.brand?.wordmark ?? DEFAULT_BRAND.wordmark,
  };
  const createdAt = new Date(input.issuedAt);
  const pageContents = pages ?? [children];

  return (
    <Document
      author={brand.legalName}
      creationDate={createdAt}
      creator="Commerce Document Engine"
      keywords={`${input.kind}, ${input.documentId}, immutable commerce record`}
      language="en"
      modificationDate={createdAt}
      pageLayout="singlePage"
      pageMode="useOutlines"
      producer="Commerce Document Engine"
      subject={subject}
      title={`${title} ${input.documentId}`}
    >
      {pageContents.map((pageContent, pageIndex) => (
        <Page
          key={`document-page-${pageIndex + 1}`}
          {...(pageIndex === 0 ? { bookmark: title } : {})}
          orientation={orientation}
          size="LETTER"
          style={styles.page}
          wrap
        >
          <View
            fixed
            style={[styles.header, { borderBottomColor: brand.accentColor }]}
          >
            {brand.logo ? (
              <Image src={brand.logo} style={styles.logo} />
            ) : (
              <Text style={[styles.wordmark, { color: brand.accentColor }]}>
                {brand.wordmark}
              </Text>
            )}
            <View style={styles.headerMeta}>
              <Text>{input.documentId}</Text>
              <Text>
                {copy.version} {input.version}
              </Text>
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.titleEyebrow}>{input.documentId}</Text>
            <Text style={styles.title}>{title}</Text>
          </View>

          {pageContent}

          {pageIndex === pageContents.length - 1 &&
          input.notes &&
          input.notes.length > 0 ? (
            <DocumentSection title={copy.notes}>
              <BulletList items={input.notes} />
            </DocumentSection>
          ) : null}

          {pageIndex === pageContents.length - 1 ? (
            <VerificationBlock input={input} />
          ) : null}

          <View fixed style={styles.footer}>
            <View style={styles.footerSide}>
              <Text>{brand.legalFooter}</Text>
              {brand.supportEmail ? <Text>{brand.supportEmail}</Text> : null}
            </View>
            <Text style={styles.footerCenter}>
              {copy.immutableRecordNotice}
            </Text>
            <Text
              render={({ pageNumber, totalPages }) =>
                `${copy.page} ${pageNumber} / ${totalPages}`
              }
              style={styles.footerSideRight}
            />
          </View>
        </Page>
      ))}
    </Document>
  );
}

function VerificationBlock({ input }: { input: BaseDocumentInput }) {
  return (
    <View style={styles.verification} wrap={false}>
      <Text style={styles.badge}>{copy.contentVerification}</Text>
      <Text style={styles.verificationHash}>
        {copy.recordHash}:{" "}
        {groupHash(normalizeSha256Hash(input.verification.recordHash))}
      </Text>
      <KeyValueGrid
        items={[
          { label: copy.documentId, value: input.documentId },
          { label: copy.version, value: input.version },
          {
            label: copy.dateIssued,
            value: formatDateTime(input.issuedAt, input.locale),
          },
          ...(input.verification.objectVersion
            ? [
                {
                  label: copy.objectVersion,
                  value: input.verification.objectVersion,
                },
              ]
            : []),
          ...(input.verification.verificationUrl
            ? [
                {
                  label: copy.verificationUrl,
                  value: input.verification.verificationUrl,
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}

export function Parties({
  issuer,
  recipient,
  issuerLabel,
  recipientLabel,
}: {
  issuer: Party;
  recipient: Party;
  issuerLabel: string;
  recipientLabel: string;
}) {
  return (
    <View style={styles.partyRow} wrap={false}>
      <PartyCard label={issuerLabel} party={issuer} />
      <PartyCard label={recipientLabel} party={recipient} />
    </View>
  );
}

export function PartyCard({ label, party }: { label: string; party: Party }) {
  return (
    <View style={[styles.card, styles.partyCard]}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={styles.partyName}>{party.legalName}</Text>
      <View style={styles.address}>
        {formatAddress(party.address).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
      </View>
      {party.taxId ? (
        <Text style={styles.detail}>
          {taxIdentityLabel(party)}: {party.taxId}
        </Text>
      ) : null}
      {party.contactName ? (
        <Text style={styles.detail}>{party.contactName}</Text>
      ) : null}
      {party.contactEmail ? (
        <Text style={styles.detail}>{party.contactEmail}</Text>
      ) : null}
    </View>
  );
}

export function DocumentSection({
  title,
  children,
  keepTogether = false,
  presenceAhead,
}: {
  title: string;
  children: ReactNode;
  keepTogether?: boolean;
  presenceAhead?: number;
}) {
  return (
    <View
      minPresenceAhead={presenceAhead ?? (keepTogether ? 100 : 35)}
      style={styles.section}
      wrap={!keepTogether}
    >
      <Text style={styles.sectionHeading}>{title}</Text>
      {children}
    </View>
  );
}

export function KeyValueGrid({ items }: { items: readonly KeyValueItem[] }) {
  return (
    <View style={styles.keyValues}>
      {items.map((item) => (
        <View key={`${item.label}-${item.value}`} style={styles.keyValuePair}>
          <Text style={styles.keyValueLabel}>{item.label}</Text>
          <Text style={styles.keyValueValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function DataTable({
  columns,
  rows,
}: {
  columns: readonly TableColumn[];
  rows: readonly TableRowData[];
}) {
  return (
    <View style={styles.table}>
      <View style={styles.tableHeader} wrap={false}>
        {columns.map((column) => (
          <Text
            key={column.label}
            style={
              column.align === "right"
                ? [styles.tableCellRight, { width: column.width }]
                : [styles.tableCell, { width: column.width }]
            }
          >
            {column.label}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row.id} style={styles.tableRow} wrap={false}>
          {columns.map((column, index) => {
            const cell = row.cells[index];
            return (
              <View
                key={`${row.id}-${column.label}`}
                style={
                  column.align === "right"
                    ? [styles.tableCellRight, { width: column.width }]
                    : [styles.tableCell, { width: column.width }]
                }
              >
                <Text>{cell?.value ?? ""}</Text>
                {cell?.detail ? (
                  <Text style={styles.tableDetail}>{cell.detail}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export function BulletList({ items }: { items: readonly string[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View key={`${index}-${item}`} style={styles.listItem} wrap={false}>
          <Text style={styles.listMarker}>{index + 1}.</Text>
          <Text style={styles.listText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export { Text, View };
