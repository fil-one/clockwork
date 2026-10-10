import { createHash } from "node:crypto";
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  PricingScenarioLinesSchema,
  pricingSummaryPrintable,
  type Money,
  type PricingScenarioLine,
} from "@clockwork/contracts";
import { indicativeScenarioPrice } from "@clockwork/domain/core";
import { canonicalMndaPdf } from "../mnda/render";
import {
  arimoRegular,
  tinosBold,
  tinosRegular,
} from "../mnda/fonts/fonts.generated";

/** Fil One's registered legal name, as the MNDA prints it. */
export const filOneLegalName = "FIL One LLC";

/**
 * What an indicative pricing summary prints: the prospect, the day the list
 * prices were read, and the saved lines. Totals are worked out here from the
 * lines, never passed in. Nothing but list prices reaches this input.
 */
export interface IndicativePricingSummaryInput {
  scenarioId: string;
  company: string;
  asOf: string;
  lines: readonly PricingScenarioLine[];
}

// Copy below is interim until claims-approved document copy (EXT-BRAND-01).
export const indicativePricingSummaryTitle = "Indicative Pricing Summary";
export const indicativePricingSummaryNotice =
  "These are indicative list prices for discussion only. This summary is not an offer or a quote and does not bind either party. Prices, discounts and terms are subject to a signed order form. Taxes are not included.";

// The MNDA's embedded faces under this document's own family names, so every
// viewer draws the same glyphs and accented company names print exactly.
const serif = "FilOneSummarySerif";
const sans = "FilOneSummarySans";
Font.register({
  family: serif,
  fonts: [
    { src: tinosRegular, fontWeight: 400 },
    { src: tinosBold, fontWeight: 700 },
  ],
});
Font.register({ family: sans, src: arimoRegular });

const style = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 84,
    fontFamily: serif,
    fontSize: 10,
    color: "#202020",
  },
  title: { fontWeight: 700, fontSize: 16, marginBottom: 16 },
  meta: { marginBottom: 18 },
  metaRow: { flexDirection: "row", marginBottom: 4 },
  caption: {
    fontFamily: sans,
    fontSize: 8,
    color: "#666666",
    width: 96,
    paddingTop: 1.5,
  },
  metaValue: { width: 420 },
  head: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: "#202020",
    paddingBottom: 4,
    fontFamily: sans,
    fontSize: 7.5,
    color: "#444444",
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#c8c8c8",
    paddingVertical: 5,
    fontSize: 9.5,
  },
  totals: { marginTop: 12, marginLeft: 276, width: 240 },
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
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontFamily: sans,
    fontSize: 7.5,
    color: "#555555",
  },
});

// Column widths in points; they sum to the 516-point body width.
const columns = [
  { label: "ITEM", width: 150, align: "left" },
  { label: "LIST UNIT PRICE", width: 90, align: "right" },
  { label: "QUANTITY", width: 82, align: "right" },
  { label: "TERM", width: 54, align: "right" },
  { label: "DISCOUNT", width: 50, align: "right" },
  { label: "EXTENDED PRICE", width: 90, align: "right" },
] as const;

function money(value: Money) {
  const minor = BigInt(value.minor);
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const cents = String(abs % 100n).padStart(2, "0");
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: value.currency,
  }).format(`${sign}${abs / 100n}.${cents}` as `${number}`);
}

const quantity = (value: string) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
    value as `${number}`,
  );

const percent = (bps: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(bps / 100)}%`;

/** The summary's faces and figure formats, shared with contract line items. */
export const pricingSummaryPrint = { serif, sans, money, quantity, percent };

function longDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new Error("PRICING_SUMMARY_DATE_INVALID");
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

function Cells({ values }: { values: readonly string[] }) {
  return (
    <>
      {columns.map((column, index) => (
        <Text
          key={column.label}
          style={{
            width: column.width,
            textAlign: column.align,
            paddingLeft: index ? 6 : 0,
          }}
        >
          {values[index]}
        </Text>
      ))}
    </>
  );
}

/**
 * A one-to-two page summary a seller can send a prospect: list prices,
 * quantities, terms and the entered discounts, priced with the same function
 * the pricing page uses, under a fixed notice that nothing here is an offer.
 */
export async function renderIndicativePricingSummary(
  input: IndicativePricingSummaryInput,
) {
  const lines = PricingScenarioLinesSchema.parse(input.lines);
  const printed = [
    input.company,
    ...lines.flatMap((l) => [l.sku, l.region, l.unit]),
  ];
  if (!printed.every((value) => pricingSummaryPrintable.test(value)))
    throw new Error("PRICING_SUMMARY_UNPRINTABLE");
  const priced = indicativeScenarioPrice(lines);
  const date = longDate(input.asOf);
  const reference = `Ref ${input.scenarioId.slice(0, 8)}`;
  const fixedDate = new Date(`${input.asOf}T00:00:00Z`);
  const pdf = await renderToBuffer(
    <Document
      title={indicativePricingSummaryTitle}
      author={filOneLegalName}
      creationDate={fixedDate}
      modificationDate={fixedDate}
    >
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>{indicativePricingSummaryTitle}</Text>
        <View style={style.meta}>
          {[
            ["Prepared for", input.company],
            ["Prepared by", filOneLegalName],
            ["List prices as of", date],
            ["Currency", priced.currency],
          ].map(([label, value]) => (
            <View key={label} style={style.metaRow}>
              <Text style={style.caption}>{label}</Text>
              <Text style={style.metaValue}>{value}</Text>
            </View>
          ))}
        </View>
        <View style={style.head} fixed>
          <Cells values={columns.map(({ label }) => label)} />
        </View>
        {lines.map((line, index) => {
          const result = priced.lines[index];
          return (
            <View key={index} style={style.row} wrap={false}>
              <Cells
                values={[
                  `${line.sku}, ${line.region}`,
                  `${money(line.unitPrice)} / ${line.unit}`,
                  `${quantity(line.quantity)} ${line.unit}`,
                  line.termMonths === 1
                    ? "1 month"
                    : `${line.termMonths} months`,
                  percent(line.discountBps),
                  result ? money(result.total) : "",
                ]}
              />
            </View>
          );
        })}
        <View style={style.totals} wrap={false}>
          <View style={style.totalRow}>
            <Text>Subtotal at list price</Text>
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
        <Text
          fixed
          style={style.footer}
          render={({ pageNumber, totalPages }) =>
            `${indicativePricingSummaryNotice}\n${indicativePricingSummaryTitle} · ${filOneLegalName} · ${reference} · ${pageNumber} / ${totalPages}`
          }
        />
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
