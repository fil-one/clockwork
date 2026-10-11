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
import {
  includedTemplateSections,
  templateContentJson,
  templateLineItemPricingLines,
  printableTemplateValue,
  type TemplateContent,
  type TemplateDerived,
} from "@clockwork/contracts";
import { indicativeScenarioPrice } from "@clockwork/domain/core";
import { canonicalMndaPdf } from "../mnda/render";
import { pricingSummaryPrint } from "../pricing-summary/render";
import {
  TemplateFileSchema,
  TemplateLineItemsSchema,
  type AvailableContractTemplate,
  type PreparedTemplateInput,
  type RenderedContract,
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
  bold: { fontFamily: "Times-Bold" },
  textTable: { marginTop: 2, marginBottom: 10, fontSize: 9.5 },
  textTableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#c8c8c8",
    paddingVertical: 4,
    lineHeight: 1.2,
  },
  textTableHead: { borderBottomWidth: 0.75, borderBottomColor: "#202020" },
  marking: {
    position: "absolute",
    top: 22,
    left: 48,
    right: 48,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: "#a01818",
  },
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

// Values the PDF fonts cannot draw are refused rather than dropped, and
// brackets and braces are refused so a value can never form a template token
// or a SignWell text tag.
export function assertTemplateValue(value: string) {
  if (!printableTemplateValue(value))
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

/** Text split at `**` markers, each run resolved; odd runs print bold. The
 * markers are read from the template before values go in, so a value can
 * never turn bold on or off. */
function runs(text: string, values: Readonly<Record<string, string>>) {
  return text
    .split("**")
    .map((run, index) => ({
      text: resolve(run, values),
      bold: index % 2 === 1,
    }))
    .filter((run) => run.text !== "");
}

// Fixed-point arithmetic for derived figures: twelve decimal places, exact
// for every value a numeric field accepts.
const scale = 10n ** 12n;
function fixed(value: string) {
  if (!/^\d{1,15}(\.\d{1,12})?$/.test(value))
    throw new Error("CONTRACT_TEMPLATE_FIELD_INVALID");
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * scale + BigInt(fraction.padEnd(12, "0").slice(0, 12));
}

/** Thousands separators, the decimals kept as given. */
function grouped(value: string) {
  const [whole = "0", fraction] = value.split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? withCommas : `${withCommas}.${fraction}`;
}

/** The value rounded half up to `decimals` places, still at full scale. */
function roundFixed(value: bigint, decimals: number) {
  const unit = 10n ** BigInt(12 - decimals);
  return ((value + unit / 2n) / unit) * unit;
}

function printFixed(value: bigint, decimals: number) {
  const unit = 10n ** BigInt(12 - decimals);
  const rounded = roundFixed(value, decimals) / unit;
  const text = rounded.toString().padStart(decimals + 1, "0");
  return grouped(
    decimals ? `${text.slice(0, -decimals)}.${text.slice(-decimals)}` : text,
  );
}

/** Each derived figure, worked out in order from the typed numbers. */
export function derivedValues(
  derived: readonly TemplateDerived[],
  numbers: Readonly<Record<string, string>>,
  included: ReadonlySet<string>,
) {
  const known = new Map<string, bigint>();
  const printed: Record<string, string> = {};
  for (const figure of derived) {
    if (figure.section && !included.has(figure.section)) continue;
    const operands = figure.of.map((operand) => {
      if (/^\d/.test(operand)) return fixed(operand);
      const value = known.get(operand) ?? numbers[operand];
      if (value === undefined || value === "")
        throw new Error("CONTRACT_TEMPLATE_FIELD_UNRESOLVED");
      return typeof value === "bigint" ? value : fixed(value);
    });
    const result =
      figure.op === "sum"
        ? operands.reduce((a, b) => a + b, 0n)
        : figure.op === "product"
          ? operands.reduce((a, b) => (a * b) / scale, scale)
          : ((operands[0] ?? 0n) * (operands[1] ?? 0n)) / scale / 100n;
    // A later figure builds on this one as printed, so five times a printed
    // 4,167 reads 20,835 and every line of an illustration adds up.
    known.set(figure.id, roundFixed(result, figure.decimals));
    printed[figure.id] = printFixed(result, figure.decimals);
  }
  return printed;
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

type Run = ReturnType<typeof runs>[number];
type ResolvedBlock =
  | { type: "pageBreak" }
  | { type: "heading" | "paragraph"; runs: Run[] }
  | {
      type: "table";
      header: boolean;
      widths: readonly number[] | undefined;
      rows: Run[][][];
    }
  | { type: "lineItems"; table: ReturnType<typeof pricedLineItems> };

function Runs({ runs }: { runs: readonly Run[] }) {
  return (
    <>
      {runs.map((run, index) =>
        run.bold ? (
          <Text key={index} style={style.bold}>
            {run.text.replaceAll("\t", " ")}
          </Text>
        ) : (
          run.text.replaceAll("\t", " ")
        ),
      )}
    </>
  );
}

const unbroken = {
  ...{ hyphenationPenalty: 1000000 },
  hyphenationCallback: (word: string) => [word],
};

function TextTable({
  header,
  widths,
  rows,
}: {
  header: boolean;
  widths: readonly number[] | undefined;
  rows: readonly Run[][][];
}) {
  const columns = Math.max(...rows.map((row) => row.length));
  const weights = widths ?? Array.from({ length: columns }, () => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const width = (column: number) => (516 * (weights[column] ?? 1)) / total;
  return (
    <View style={style.textTable}>
      {rows.map((row, r) => (
        <View
          key={r}
          wrap={false}
          style={[
            style.textTableRow,
            ...(header && r === 0 ? [style.textTableHead] : []),
          ]}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Text
              key={c}
              style={{
                width: width(c),
                paddingRight: c === columns - 1 ? 0 : 6,
                ...(header && r === 0 ? style.bold : {}),
              }}
              {...unbroken}
            >
              <Runs runs={row[c] ?? []} />
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Block({ block }: { block: ResolvedBlock }) {
  if (block.type === "pageBreak") return <View break />;
  if (block.type === "lineItems") return <LineItemsTable table={block.table} />;
  if (block.type === "table")
    return (
      <TextTable
        header={block.header}
        widths={block.widths}
        rows={block.rows}
      />
    );
  return (
    <Text
      style={block.type === "heading" ? style.heading : style.paragraph}
      orphans={3}
      widows={3}
      // A heading never ends a page on its own.
      {...(block.type === "heading" ? { minPresenceAhead: 48 } : {})}
      {...unbroken}
    >
      <Runs runs={block.runs} />
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

/** A template's content with the version label it prints. */
export type VersionedTemplate = TemplateContent & { version: string };

/**
 * Renders the template's blocks with resolved fields, leaving out sections
 * the contract does not include, then a signature page with SignWell text
 * tags. Recipient 1 is the counterparty and signs first; recipient 2 is the
 * Fil One countersigner. Output is byte-deterministic for the same input.
 */
export async function renderTemplateDocument(
  file: VersionedTemplate,
  input: PreparedTemplateInput,
): Promise<RenderedContract> {
  const included = input.everySection
    ? new Set(file.sections.map((section) => section.id))
    : includedTemplateSections(file, input.sections, input.values);
  const inContract = (section: string | undefined) =>
    section === undefined || included.has(section);
  const fields = file.fields.filter((f) => inContract(f.section));
  const tableFields = new Set(
    fields.filter((f) => f.kind === "line_items").map((f) => f.id),
  );
  const text: Record<string, string> = {};
  for (const field of fields) {
    if (tableFields.has(field.id)) continue;
    const value = input.values[field.id];
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw new Error("CONTRACT_TEMPLATE_FIELD_INVALID");
    text[field.id] = field.kind === "decimal" ? grouped(value) : value;
  }
  const tables = new Map(
    [...tableFields].map(
      (id) => [id, pricedLineItems(input.values[id])] as const,
    ),
  );
  const raw = Object.fromEntries(
    Object.entries(input.values).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const values: Record<string, string> = {
    ...text,
    ...derivedValues(file.derived, raw, included),
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
  const title = resolve(file.document.title.replaceAll("**", ""), values);
  const blocks = file.document.blocks
    .filter((block) => inContract(block.section))
    .map((block): ResolvedBlock => {
      if (block.type === "pageBreak") return { type: "pageBreak" };
      if (block.type === "table")
        return {
          type: "table",
          header: block.header,
          widths: block.widths,
          rows: block.rows.map((row) => row.map((cell) => runs(cell, values))),
        };
      const table = tables.get(
        /^\[\[([^\]]*)\]\]$/.exec(block.text)?.[1] ?? "",
      );
      if (block.type === "paragraph" && table)
        return { type: "lineItems", table };
      return { type: block.type, runs: runs(block.text, values) };
    });
  // Signing tags are only the signature page's own. Whatever the wording,
  // markers and values, no printed text may hold one.
  const printed = [
    title,
    file.name,
    ...blocks.flatMap((block) =>
      block.type === "heading" || block.type === "paragraph"
        ? [block.runs.map((run) => run.text).join("")]
        : block.type === "table"
          ? block.rows.flatMap((row) =>
              row.map((cell) => cell.map((run) => run.text).join("")),
            )
          : [],
    ),
  ];
  if (printed.some((text) => /\{\{|\}\}/.test(text)))
    throw new Error("CONTRACT_TEMPLATE_VALUE_CHARACTERS");
  const reference = `${input.contractId.slice(0, 8)} · ${file.id} ${file.version}`;
  const fixedDate = new Date(`${input.effectiveDate}T00:00:00Z`);
  // A preview or specimen says so on every page and in its title; a prepared
  // contract never has a marking.
  const marking = input.marking ? (
    <Text fixed style={style.marking}>
      {input.marking}
    </Text>
  ) : null;
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
      title={input.marking ? `${input.marking}: ${title}` : title}
      author="FIL One LLC"
      creationDate={fixedDate}
      modificationDate={fixedDate}
    >
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>{title}</Text>
        {blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        <Text style={style.paragraph}>[Signature page follows]</Text>
        {marking}
        {footer}
      </Page>
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>SIGNATURES</Text>
        <SignatureRow
          label="Party"
          left={<Text>FIL One LLC</Text>}
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
        {marking}
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

/** SHA-256 of a template's content (`templateContentJson`). */
export function templateContentHash(content: TemplateContent) {
  return createHash("sha256")
    .update(templateContentJson(content))
    .digest("hex");
}

/** Binds validated content to the renderer under a version label. */
export function templateFromContent(
  content: TemplateContent,
  version: string,
): AvailableContractTemplate {
  const file = { ...content, version };
  return {
    id: content.id,
    contractType: content.contractType,
    name: content.name,
    version,
    templateHash: templateContentHash(content),
    sourceNote: content.sourceNote ?? "",
    requiresApproval: content.requiresApproval,
    fields: content.fields,
    sections: content.sections,
    derived: content.derived,
    render: (input) => renderTemplateDocument(file, input),
  };
}

/**
 * Validates a template kept in code and binds it to the renderer. An invalid
 * file fails when the registry loads, never halfway through a preparation.
 */
export function availableTemplate(raw: unknown): AvailableContractTemplate {
  const { version, ...content } = TemplateFileSchema.parse(raw);
  return templateFromContent(content, version);
}
