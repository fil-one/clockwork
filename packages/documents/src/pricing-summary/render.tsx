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
  PricingPartnerEconomicsSchema,
  pricingPartnerSummaryAvailable,
  PricingScenarioLinesSchema,
  pricingSummaryPrintable,
  type Money,
  type PricingPartnerEconomics,
  type PricingScenarioLine,
} from "@clockwork/contracts";
import {
  compareQuantities,
  convertCapacity,
  indicativeScenarioPrice,
  scenarioPartnerEconomics,
  type ScenarioPartnerEconomics,
} from "@clockwork/domain/core";
import { canonicalMndaPdf } from "../mnda/render";
import {
  arimoRegular,
  tinosBold,
  tinosRegular,
} from "../mnda/fonts/fonts.generated";

/** Fil One's registered legal name, as the MNDA prints it. */
export const filOneLegalName = "FIL One LLC";

/** Who a summary is for: the customer sees list pricing only. */
export type IndicativePricingSummaryAudience = "customer" | "partner";

/**
 * What an indicative pricing summary prints: the prospect, the day the list
 * prices were read, and the saved lines. Totals are worked out here from the
 * lines, never passed in. Nothing but list prices and the seller's partner
 * inputs reach this input; a floor or transfer price never does.
 */
export interface IndicativePricingSummaryInput {
  scenarioId: string;
  company: string;
  asOf: string;
  lines: readonly PricingScenarioLine[];
  /**
   * Product and region names as a reader says them, by SKU and region code.
   * A code with no name prints as it is.
   */
  productNames?: Readonly<Record<string, string>>;
  regionNames?: Readonly<Record<string, string>>;
  /** "customer" unless given. Only a partner summary prints partner figures. */
  audience?: IndicativePricingSummaryAudience;
  partnerEconomics?: PricingPartnerEconomics | null;
}

export const indicativePricingSummaryTitle = "Indicative Pricing Summary";
/** Printed at the foot of every page. */
export const indicativePricingSummaryNotice =
  "Indicative pricing, not an offer or a quote. Neither party is bound until an order form is signed.";
/**
 * Printed at the foot of a resale scenario's customer summary, which quotes
 * the partner's own price to its customer.
 */
export const partnerQuoteNotice =
  "Indicative pricing from the partner named above, not a binding offer. Neither party is bound until an order form is signed.";
export const indicativePartnerNotice =
  "Partner figures are indicative and worked out from the inputs shown. Commission, margin and partner prices are set only in a signed partner agreement.";

/** The notes under the totals: units, egress, validity and tax. */
export function pricingSummaryNotes(input: {
  date: string;
  decimalTb: boolean;
  converted: boolean;
  /** True only when every line's rate card includes egress at no charge. */
  freeEgress: boolean;
  /** The partner's quote to its customer, not Fil One's list. */
  partnerQuote?: boolean;
}): string[] {
  return [
    ...(input.decimalTb
      ? [
          `Prices are per decimal terabyte (TB) per month: 1 TB is 1,000 GB.${
            input.converted
              ? " Capacity given in PB, TiB or PiB is converted to TB exactly: 1 PB is 1,000 TB, 1 TiB is about 1.0995 TB and 1 PiB is about 1,125.9 TB."
              : ""
          }`,
        ]
      : []),
    ...(input.freeEgress
      ? ["No egress fees: reading and downloading stored data is free."]
      : []),
    input.partnerQuote
      ? `Prices are the partner's indicative prices as of ${input.date} and can change. The prices in the partner's signed order form are the ones that apply.`
      : `List prices are as of ${input.date} and can change. The prices in a signed order form are the ones that apply.`,
    "Year 1 is the first 12 months of each line, or its whole term when shorter. Taxes are not included.",
  ];
}

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
  subtitle: { fontSize: 11, marginTop: -10, marginBottom: 14 },
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
  sub: { fontFamily: sans, fontSize: 7.5, color: "#555555", marginTop: 1 },
  totals: { marginTop: 12, marginLeft: 276, width: 240 },
  partner: { marginTop: 20 },
  notes: { marginTop: 16, fontSize: 8.5, color: "#333333" },
  note: { marginBottom: 3 },
  heading: { fontWeight: 700, fontSize: 11, marginBottom: 8 },
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
  { label: "ITEM", width: 132, align: "left" },
  { label: "LIST PRICE", width: 76, align: "right" },
  { label: "QUANTITY", width: 86, align: "right" },
  { label: "TERM", width: 46, align: "right" },
  { label: "DISCOUNT", width: 46, align: "right" },
  { label: "PER MONTH", width: 64, align: "right" },
  { label: "TERM TOTAL", width: 66, align: "right" },
] as const;

// A partner's quote to its customer prices at the partner's price.
const quoteColumns = columns.map((column) =>
  column.label === "LIST PRICE" ? { ...column, label: "PRICE" } : column,
);

// The partner table: a span, its figure and the figure per capacity unit.
const partnerColumns = [
  { label: "PERIOD", width: 236, align: "left" },
  { label: "PARTNER EARNINGS", width: 140, align: "right" },
  { label: "PER UNIT PER MONTH", width: 140, align: "right" },
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

const format = (value: string, digits: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(
    value as `${number}`,
  );
const decimals = (value: string) =>
  (value.split(".")[1] ?? "").replace(/0+$/u, "").length;

/** A quantity to six places, as rate cards hold them; "about" if rounded. */
const quantity = (value: string) =>
  `${decimals(value) > 6 ? "about " : ""}${format(value, 6)}`;

/**
 * A capacity cell: the quantity in the rate's unit or, when it was entered in
 * another unit that converts to it exactly, the entry with the converted
 * figure beneath it, rounded to whole units from 1,000 up and to three
 * places below ("10 PiB" over "about 11,259 TB"). The price uses the exact
 * quantity either way.
 */
function capacity(
  stored: string,
  rateUnit: string,
  entered?: { quantity: string; unit: string },
): readonly [string, string] | string {
  const unit = rateUnit.replace(/-month$/u, "");
  const converted = entered
    ? convertCapacity(entered.quantity, entered.unit, unit)
    : null;
  if (!entered || converted === null || compareQuantities(converted, stored))
    return `${quantity(stored)} ${entered ? unit : rateUnit}`;
  const digits = Number(stored) >= 1_000 ? 0 : 3;
  return [
    `${format(entered.quantity, 6)} ${entered.unit}`,
    `${decimals(stored) > digits ? "about" : "="} ${format(stored, digits)} ${unit}`,
  ];
}

const percent = (bps: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(bps / 100)}%`;

/** The summary's faces and figure formats, shared with contract line items. */
export const pricingSummaryPrint = {
  serif,
  sans,
  money,
  quantity,
  capacity,
  percent,
};

function longDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso))
    throw new Error("PRICING_SUMMARY_DATE_INVALID");
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T00:00:00Z`));
}

/** A cell's text, with an optional smaller second line beneath it. */
type Cell = string | readonly [string, string];

function Cells({
  values,
  layout = columns,
}: {
  values: readonly Cell[];
  layout?: readonly { label: string; width: number; align: string }[];
}) {
  return (
    <>
      {layout.map((column, index) => {
        const value = values[index] ?? "";
        const [main, sub] = typeof value === "string" ? [value, ""] : value;
        return (
          <View
            key={column.label}
            style={{ width: column.width, paddingLeft: index ? 6 : 0 }}
          >
            <Text style={{ textAlign: column.align as "left" | "right" }}>
              {main}
            </Text>
            {sub ? (
              <Text
                style={{
                  ...style.sub,
                  textAlign: column.align as "left" | "right",
                }}
              >
                {sub}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

const months = (count: number) => (count === 1 ? "1 month" : `${count} months`);

const modelNames: Readonly<Record<PricingPartnerEconomics["model"], string>> = {
  referral: "Referral",
  resale: "Resale",
  other: "Other",
};

/**
 * The partner's inputs, line by line, as the seller entered them. The
 * partner's name is in the header.
 */
function partnerTerms(
  economics: PricingPartnerEconomics,
  result: ScenarioPartnerEconomics,
  perUnit: string,
): [string, string][] {
  const price = (minor: string) =>
    `${money({ currency: result.currency, minor } as Money)} / ${perUnit}`;
  const named: [string, string][] = [
    [
      "Model",
      economics.model === "other" && economics.label
        ? `${modelNames.other}: ${economics.label}`
        : modelNames[economics.model],
    ],
  ];
  if (economics.model === "referral")
    return [
      ...named,
      [
        "Commission",
        [
          `${percent(economics.commissionBps)} from month 1`,
          ...economics.steps
            .filter((step) => step.fromMonth <= result.months)
            .map(
              (step) =>
                `${percent(step.commissionBps)} from month ${step.fromMonth}`,
            ),
        ].join("; "),
      ],
    ];
  if (economics.model === "resale" && result.resale) {
    const margin =
      BigInt(result.resale.customerPrice.minor) -
      BigInt(result.resale.buyPrice.minor);
    return [
      ...named,
      ["Customer price", price(result.resale.customerPrice.minor)],
      ["Partner buy price", price(result.resale.buyPrice.minor)],
      [
        "Partner margin",
        `${price(margin.toString())}${
          result.resale.marginBps === null
            ? ""
            : ` (${percent(result.resale.marginBps)})`
        }`,
      ],
    ];
  }
  if (economics.model === "other")
    return [
      ...named,
      ["Share of spend", percent(economics.partnerShareBps)],
      ["Fee per unit", price(economics.partnerPerUnitMinor)],
      [
        "Fixed monthly",
        money({
          currency: result.currency,
          minor: economics.partnerMonthlyMinor,
        } as Money),
      ],
    ];
  return named;
}

/** Partner earnings by period, by year and over the term. Never Fil One's net. */
function PartnerSection({
  economics,
  result,
  perUnit,
}: {
  economics: PricingPartnerEconomics;
  result: ScenarioPartnerEconomics;
  perUnit: string | null;
}) {
  const unitLabel = perUnit ?? "unit";
  const rows: { cells: Cell[]; strong?: boolean }[] = [
    ...result.periods.map((period) => ({
      cells: [
        `${
          period.fromMonth === period.toMonth
            ? `Month ${period.fromMonth}`
            : `Months ${period.fromMonth}-${period.toMonth}`
        }${
          period.commissionBps === undefined
            ? ""
            : ` at ${percent(period.commissionBps)}`
        }, per month`,
        money(period.monthly.partnerEarnings),
        perUnit ? money(period.perUnit.partnerEarnings) : "",
      ] as Cell[],
    })),
    ...(result.years.length > 1
      ? result.years.map((year, index) => ({
          cells: [
            index * 12 + 12 > result.months
              ? `Year ${index + 1}, months ${index * 12 + 1}-${result.months}`
              : `Year ${index + 1}`,
            money(year.partnerEarnings),
            "",
          ] as Cell[],
        }))
      : [
          {
            cells: [
              result.months < 12 ? `Months 1-${result.months}` : "Year 1",
              money(result.firstYear.partnerEarnings),
              "",
            ] as Cell[],
          },
        ]),
    {
      cells: [
        `Term, ${months(result.months)}`,
        money(result.term.partnerEarnings),
        "",
      ],
      strong: true,
    },
  ];
  return (
    <View style={style.partner}>
      <Text style={style.heading} minPresenceAhead={120}>
        Partner economics
      </Text>
      <View style={style.meta} wrap={false}>
        {partnerTerms(economics, result, unitLabel).map(([label, value]) => (
          <View key={label} style={style.metaRow}>
            <Text style={style.caption}>{label}</Text>
            <Text style={style.metaValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View style={style.head} fixed>
        <Cells
          layout={partnerColumns}
          values={partnerColumns.map(({ label }, index) =>
            index === 2 && perUnit ? `PER ${perUnit.toUpperCase()}` : label,
          )}
        />
      </View>
      {rows.map((row, index) => (
        <View
          key={index}
          wrap={false}
          style={row.strong ? { ...style.row, fontWeight: 700 } : style.row}
        >
          <Cells layout={partnerColumns} values={row.cells} />
        </View>
      ))}
    </View>
  );
}

/**
 * A one-to-two page summary a seller can send a prospect or a partner: list
 * prices in product names, quantities as entered, terms and the entered
 * discounts, priced with the same function the pricing page uses, with
 * monthly, annual and term totals, under a fixed notice that nothing here is
 * an offer. A partner summary adds what the partner earns; it never prints
 * what Fil One keeps. A resale scenario's customer summary is the partner's
 * quote to its customer instead: every line at the partner's customer price,
 * with no Fil One list or buy price on it.
 */
export async function renderIndicativePricingSummary(
  input: IndicativePricingSummaryInput,
) {
  const lines = PricingScenarioLinesSchema.parse(input.lines);
  const saved = input.partnerEconomics
    ? PricingPartnerEconomicsSchema.parse(input.partnerEconomics)
    : null;
  const economics = input.audience === "partner" ? saved : null;
  const productOf = (sku: string) => input.productNames?.[sku] ?? sku;
  const regionOf = (region: string) => input.regionNames?.[region] ?? region;
  const printed = [
    input.company,
    ...lines.flatMap((l) => [productOf(l.sku), regionOf(l.region), l.unit]),
    saved?.partnerName ?? "",
    saved?.model === "other" ? (saved.label ?? "") : "",
  ];
  if (!printed.every((value) => pricingSummaryPrintable.test(value)))
    throw new Error("PRICING_SUMMARY_UNPRINTABLE");
  const shared = pricingPartnerSummaryAvailable({
    lines,
    partnerEconomics: saved,
  });
  const sharedUnit = shared ? lines[0]?.unit : undefined;
  // On a resale the customer pays the partner, so both summaries price every
  // line at the partner's customer price, with no list price or discount.
  // One price per unit needs every line in one unit.
  const resale = shared && saved?.model === "resale" ? saved : null;
  // The customer's copy of a resale is the partner's quote to its customer.
  const quote = input.audience !== "partner" ? resale : null;
  const shown = resale
    ? lines.map((line) => ({
        ...line,
        unitPrice: {
          currency: line.unitPrice.currency,
          minor: resale.customerPriceMinor,
        } as Money,
        discountBps: 0,
      }))
    : lines;
  const priced = indicativeScenarioPrice(shown);
  const quotedBy = quote?.partnerName ?? "Your Fil One partner";
  // Partner figures apply one price per unit to every line, so they print
  // only when every line is in the same unit, as the builder shows them.
  const partner =
    economics && shared ? scenarioPartnerEconomics(lines, economics) : null;
  const date = longDate(input.asOf);
  const reference = `Ref ${input.scenarioId.slice(0, 8)}`;
  const fixedDate = new Date(`${input.asOf}T00:00:00Z`);
  const total = (label: string, value: string, grand = false) => (
    <View style={grand ? style.grandTotal : style.totalRow}>
      <Text>{label}</Text>
      <Text>{value}</Text>
    </View>
  );
  const pdf = await renderToBuffer(
    <Document
      title={indicativePricingSummaryTitle}
      author={quote ? quotedBy : filOneLegalName}
      creationDate={fixedDate}
      modificationDate={fixedDate}
    >
      <Page size="LETTER" style={style.page}>
        <Text style={style.title}>{indicativePricingSummaryTitle}</Text>
        {quote ? (
          <Text style={style.subtitle}>
            {`Partner quote from ${quote.partnerName ?? "your Fil One partner"}, on Fil One storage`}
          </Text>
        ) : null}
        <View style={style.meta}>
          {(quote
            ? [
                ["Prepared for", input.company],
                ["Quoted by", quotedBy],
                ["Prices as of", date],
                ["Currency", priced.currency],
              ]
            : [
                ["Prepared for", input.company],
                ...(partner && economics?.partnerName
                  ? [["Partner", economics.partnerName]]
                  : []),
                ["Prepared by", filOneLegalName],
                ["List prices as of", date],
                ["Currency", priced.currency],
              ]
          ).map(([label, value]) => (
            <View key={label} style={style.metaRow}>
              <Text style={style.caption}>{label}</Text>
              <Text style={style.metaValue}>{value}</Text>
            </View>
          ))}
        </View>
        {/* The head repeats on every page the line table runs onto, and
            only on those. */}
        <View>
          <View style={style.head} fixed>
            <Cells
              layout={resale ? quoteColumns : columns}
              values={(resale ? quoteColumns : columns).map(
                ({ label }) => label,
              )}
            />
          </View>
          {shown.map((line, index) => {
            const result = priced.lines[index];
            return (
              <View key={index} style={style.row} wrap={false}>
                <Cells
                  layout={resale ? quoteColumns : columns}
                  values={[
                    [productOf(line.sku), regionOf(line.region)],
                    `${money(line.unitPrice)} / ${line.unit}`,
                    capacity(
                      line.quantity,
                      line.unit.replace(/-month$/u, ""),
                      line.entered,
                    ),
                    months(line.termMonths),
                    percent(line.discountBps),
                    result ? money(result.monthly) : "",
                    result ? money(result.total) : "",
                  ]}
                />
              </View>
            );
          })}
        </View>
        <View style={style.totals} wrap={false}>
          {total("Per month", money(priced.monthly))}
          {total("Year 1", money(priced.annual))}
          {resale ? null : (
            <>
              {total("Subtotal at list price", money(priced.subtotal))}
              {total(
                "Discounts",
                priced.discount.minor === "0"
                  ? money(priced.discount)
                  : `-${money(priced.discount)}`,
              )}
            </>
          )}
          {total(`Term total (${priced.currency})`, money(priced.total), true)}
        </View>
        <View style={style.notes} wrap={false}>
          {pricingSummaryNotes({
            date,
            decimalTb: lines.every((l) => l.unit === "TB-month"),
            converted: lines.some((l) => l.entered),
            // Only when the price book says so for every line.
            freeEgress: lines.every((l) => l.egressTreatment === "included"),
            partnerQuote: Boolean(quote),
          }).map((note) => (
            <Text key={note} style={style.note}>
              {note}
            </Text>
          ))}
        </View>
        {economics && partner ? (
          <PartnerSection
            economics={economics}
            result={partner}
            perUnit={sharedUnit ?? null}
          />
        ) : null}
        <Text
          fixed
          style={style.footer}
          render={({ pageNumber, totalPages }) =>
            `${partner ? `${indicativePartnerNotice} ` : ""}${quote ? partnerQuoteNotice : indicativePricingSummaryNotice}\n${indicativePricingSummaryTitle} · ${quote ? quotedBy : filOneLegalName} · ${reference} · ${pageNumber} / ${totalPages}`
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
