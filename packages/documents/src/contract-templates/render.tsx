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
import { templateLineItemPricingLines } from "@clockwork/contracts";
import { indicativeScenarioPrice } from "@clockwork/domain/core";
import { canonicalMndaPdf } from "../mnda/render";
import { pricingSummaryPrint } from "../pricing-summary/render";
import {
  TemplateFileSchema,
  TemplateLineItemsSchema,
  type AvailableContractTemplate,
  type PreparedTemplateInput,
  type RenderedContract,
  type TemplateBlock,
  type TemplateFile,
  type TemplateValue,
} from "./definition";

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
  heading: {
    fontFamily: "Times-Bold",
    fontSize: 11,
    marginTop: 10,
    marginBottom: 6,
  },
  paragraph: { marginBottom: 8, lineHeight: 1.25 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#666666",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  row: { flexDirection: "row", gap: 28, marginBottom: 8 },
  cell: { width: 244, flexDirection: "row", gap: 6 },
  caption: {
    fontFamily: "Helvetica",
    fontSize: 8,
    color: "#666666",
    width: 46,
    paddingTop: 2,
  },
  value: { width: 192, minHeight: 14 },
  tag: { color: "#ffffff" },
  // Line-item tables use the indicative pricing summary's faces and layout.
  table: {
    fontFamily: pricingSummaryPrint.serif,
    fontSize: 9.5,
    marginTop: 4,
    marginBottom: 12,
  },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: "#202020",
    paddingBottom: 4,
    fontFamily: pricingSummaryPrint.sans,
    fontSize: 7.5,
    color: "#444444",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#c8c8c8",
    paddingVertical: 5,
  },
  totals: { marginTop: 10, marginLeft: 276, width: 240, fontSize: 10 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.75,
    borderTopColor: "#202020",
    marginTop: 4,
    paddingTop: 4,
    fontWeight: 700,
  },
});

// Column widths in points; they sum to the 516-point body width.
const tableColumns = [
  { label: "ITEM", width: 150, align: "left" },
  { label: "UNIT PRICE", width: 90, align: "right" },
  { label: "QUANTITY", width: 82, align: "right" },
  { label: "TERM", width: 54, align: "right" },
  { label: "DISCOUNT", width: 50, align: "right" },
  { label: "EXTENDED PRICE", width: 90, align: "right" },
] as const;

// The PDF base fonts encode WinAnsi only. A value outside it would be dropped
// silently, so it is refused instead. Brackets and braces are refused so a
// value can never form a template token or a SignWell text tag.
const winAnsi: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x152, 0x153],
  [0x160, 0x161],
  [0x178, 0x178],
  [0x192, 0x192],
  [0x2c6, 0x2c6],
  [0x2dc, 0x2dc],
  [0x2013, 0x2014],
  [0x2018, 0x201a],
  [0x201c, 0x201e],
  [0x2020, 0x2022],
  [0x2026, 0x2026],
  [0x2030, 0x2030],
  [0x2039, 0x203a],
  [0x20ac, 0x20ac],
];
const drawable = (value: string) =>
  [...value].every((character) => {
    const point = character.codePointAt(0) ?? 0;
    return winAnsi.some(([from, to]) => point >= from && point <= to);
  });
export function assertTemplateValue(value: string) {
  if (/[<>[\]{}]/.test(value) || !drawable(value))
    throw new Error("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
}

function resolve(text: string, values: Readonly<Record<string, string>>) {
  return text.replace(/\[\[([^\]]*)\]\]/g, (_, token: string) => {
    const value = values[token];
    if (value === undefined)
      throw new Error("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
    return value;
  });
}

/**
 * A line-item table's value, checked as the prepare form checks it: the
 * shape, the characters the table's fonts draw, no row below its rate's
 * minimum, and every extended price equal to what the pricing functions
 * compute. Anything else fails closed.
 */
function pricedLineItems(raw: TemplateValue | undefined) {
  if (raw === undefined) throw new Error("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
  const parsed = TemplateLineItemsSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues.some((issue) => issue.message === "characters")
        ? "CONTRACT_TEMPLATE_VALUE_CHARACTERS"
        : "CONTRACT_TEMPLATE_LINE_ITEMS_INVALID",
    );
  const items = parsed.data;
  const priced = indicativeScenarioPrice(templateLineItemPricingLines(items));
  if (
    priced.lines.some(
      (line, index) =>
        line.belowMinimum ||
        line.total.minor !== items.rows[index]?.extendedMinor,
    )
  )
    throw new Error("CONTRACT_TEMPLATE_LINE_ITEMS_INVALID");
  return { items, priced };
}

function TableCells({ values }: { values: readonly string[] }) {
  return (
    <>
      {tableColumns.map((column, index) => (
        <Text
          key={column.label}
          style={{
            width: column.width,
            textAlign: column.align,
            paddingLeft: index ? 6 : 0,
          }}
          hyphenationCallback={(word) => [word]}
        >
          {values[index]}
        </Text>
      ))}
    </>
  );
}

function LineItemsTable({
  table,
}: {
  table: ReturnType<typeof pricedLineItems>;
}) {
  const { items, priced } = table;
  const { money, capacity, percent } = pricingSummaryPrint;
  const price = (minor: string) =>
    money({ currency: items.currency, minor } as Parameters<typeof money>[0]);
  return (
    <View style={style.table}>
      <View style={style.tableHead} wrap={false}>
        <TableCells values={tableColumns.map(({ label }) => label)} />
      </View>
      {items.rows.map((row, index) => (
        <View key={index} style={style.tableRow} wrap={false}>
          <TableCells
            values={[
              [
                row.region ? `${row.sku}, ${row.region}` : row.sku,
                row.description,
              ]
                .filter(Boolean)
                .join("\n"),
              `${price(row.unitPriceMinor)} / ${row.unit}`,
              // The entry over the converted quantity, so a long figure
              // wraps in its own cell rather than across the term.
              // Exact: an order form states the quantity the price uses.
              [capacity(row.quantity, row.unit, row.entered, { exact: true })]
                .flat()
                .join("\n"),
              row.termMonths === 1 ? "1 month" : `${row.termMonths} months`,
              percent(row.discountBps),
              price(row.extendedMinor),
            ]}
          />
        </View>
      ))}
      <View style={style.totals} wrap={false}>
        <View style={style.totalRow}>
          <Text>Subtotal before discounts</Text>
          <Text>{money(priced.subtotal)}</Text>
        </View>
        <View style={style.totalRow}>
          <Text>Discounts</Text>
          <Text>
            {priced.discount.minor === "0"
              ? money(priced.discount)
              : `-${money(priced.discount)}`}
          </Text>
        </View>
        <View style={style.grandTotal}>
          <Text>Total ({priced.currency})</Text>
          <Text>{money(priced.total)}</Text>
        </View>
      </View>
    </View>
  );
}

type ResolvedBlock =
  | TemplateBlock
  | { type: "lineItems"; table: ReturnType<typeof pricedLineItems> };

function Block({ block }: { block: ResolvedBlock }) {
  if (block.type === "pageBreak") return <View break />;
  if (block.type === "lineItems") return <LineItemsTable table={block.table} />;
  return (
    <Text
      style={block.type === "heading" ? style.heading : style.paragraph}
      {...{ hyphenationPenalty: 1000000 }}
      orphans={3}
      widows={3}
      hyphenationCallback={(word) => [word]}
    >
      {block.text.replaceAll("\t", " ")}
    </Text>
  );
}

function SignatureRow({
  label,
  left,
  right,
  height = 14,
  rule = false,
}: {
  label: string;
  left: React.ReactNode;
  right: React.ReactNode;
  height?: number;
  rule?: boolean;
}) {
  return (
    <View wrap={false} style={style.row}>
      {[left, right].map((content, i) => (
        <View key={i} style={style.cell}>
          <Text style={style.caption}>{label}</Text>
          <View
            style={{
              ...style.value,
              minHeight: height,
              ...(rule
                ? { borderBottomWidth: 0.5, borderBottomColor: "#9a9a9a" }
                : {}),
            }}
          >
            {content}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Renders counsel's blocks with resolved fields, then a signature page with
 * SignWell text tags. Recipient 1 is the counterparty and signs first;
 * recipient 2 is the Fil One countersigner. Output is byte-deterministic for
 * the same input.
 */
export async function renderTemplateDocument(
  file: TemplateFile,
  input: PreparedTemplateInput,
): Promise<RenderedContract> {
  const tableFields = new Set(
    file.fields.filter((f) => f.kind === "line_items").map((f) => f.id),
  );
  const text: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.values))
    if (!tableFields.has(key)) {
      if (typeof value !== "string")
        throw new Error("CONTRACT_TEMPLATE_FIELD_INVALID");
      text[key] = value;
    }
  const tables = new Map(
    [...tableFields].map(
      (id) => [id, pricedLineItems(input.values[id])] as const,
    ),
  );
  const values: Record<string, string> = {
    ...text,
    counterparty_name: input.counterpartyName,
    effective_date: input.effectiveDate,
    signer_name: input.signer.name,
    signer_email: input.signer.email,
    signer_title: input.signer.title,
    countersigner_name: input.countersigner.name,
    countersigner_title: input.countersigner.title,
  };
  for (const value of Object.values(values)) assertTemplateValue(value);
  // Every token resolves before layout starts, so a missing value fails
  // with its own code rather than inside the PDF renderer.
  const title = resolve(file.document.title, values);
  const blocks = file.document.blocks.map((block): ResolvedBlock => {
    if (block.type === "pageBreak") return block;
    const table = tables.get(/^\[\[([^\]]*)\]\]$/.exec(block.text)?.[1] ?? "");
    if (block.type === "paragraph" && table)
      return { type: "lineItems", table };
    return { ...block, text: resolve(block.text, values) };
  });
  const reference = `${input.contractId.slice(0, 8)} · ${file.id} ${file.version}`;
  const fixedDate = new Date(`${input.effectiveDate}T00:00:00Z`);
  const footer = (
    <View fixed style={style.footer}>
      <Text>{reference}</Text>
      <Text
        render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
      />
    </View>
  );
  const pdf = await renderToBuffer(
    <Document
      title={file.document.title}
      author="Fil One LLC"
      creationDate={fixedDate}
      modificationDate={fixedDate}
    >
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>{title}</Text>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        <Text style={style.paragraph}>[Signature page follows]</Text>
        {footer}
      </Page>
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>SIGNATURES</Text>
        <SignatureRow
          label="Party"
          left={<Text>FIL ONE LLC</Text>}
          right={<Text>{input.counterpartyName}</Text>}
          height={26}
        />
        <SignatureRow
          label="Signature"
          rule
          height={38}
          left={
            <Text style={{ ...style.tag, fontSize: 23 }}>
              {"{{signature:2:y}}"}
            </Text>
          }
          right={
            <Text style={{ ...style.tag, fontSize: 23 }}>
              {"{{signature:1:y}}"}
            </Text>
          }
        />
        <SignatureRow
          label="Name"
          left={<Text>{input.countersigner.name}</Text>}
          right={<Text>{input.signer.name}</Text>}
        />
        <SignatureRow
          label="Title"
          left={<Text>{input.countersigner.title}</Text>}
          right={<Text>{input.signer.title}</Text>}
        />
        <SignatureRow
          label="Date"
          height={18}
          left={<Text style={style.tag}>{"{{af_d_s:2:y}}"}</Text>}
          right={<Text style={style.tag}>{"{{af_d_s:1:y}}"}</Text>}
        />
        <Text style={{ ...style.caption, width: "auto", marginTop: 12 }}>
          {`Signature page to ${file.name}`}
        </Text>
        {footer}
      </Page>
    </Document>,
  );
  // Embedded table faces carry random subset tags; this pins them, and is
  // the plain canonical pass for a document without a table.
  const bytes = canonicalMndaPdf(pdf);
  return {
    bytes,
    pages: [...bytes.toString("latin1").matchAll(/\/Type\s*\/Page\b/g)].length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/**
 * Validates a template file and binds it to the renderer. An invalid file
 * fails when the registry loads, never halfway through a preparation.
 */
export function availableTemplate(raw: unknown): AvailableContractTemplate {
  const file = TemplateFileSchema.parse(raw);
  return {
    id: file.id,
    contractType: file.contractType,
    name: file.name,
    status: "available",
    version: file.version,
    templateHash: file.source.sha256,
    sourcePath: file.source.path,
    requiresApproval: file.requiresApproval,
    fields: file.fields,
    render: (input) => renderTemplateDocument(file, input),
  };
}
