import type { Currency, Money } from "@clockwork/contracts";

import { divideRound, parseDecimal, formatDecimal } from "../decimal";

export interface RecurringRevenueInput {
  orderId: string;
  route: "direct" | "referral" | "resale" | "distributor" | "marketplace";
  grossContracted: Money;
  transferContracted?: Money;
  billingMonths: number;
  status:
    | "pipeline"
    | "committed"
    | "active"
    | "completed"
    | "cancelled"
    | "terminated";
}

export function recurringRevenue(input: RecurringRevenueInput): {
  revenueBasis: "gross" | "transfer";
  arr: Money;
  mrr: Money;
} {
  if (!Number.isInteger(input.billingMonths) || input.billingMonths < 1)
    throw new Error("Billing months must be positive");
  const basis =
    input.route === "resale" || input.route === "distributor"
      ? "transfer"
      : "gross";
  const amount =
    basis === "transfer" ? input.transferContracted : input.grossContracted;
  if (!amount)
    throw new Error("Resale ARR requires transfer-price contracted revenue");
  if (amount.currency !== input.grossContracted.currency)
    throw new Error("Revenue basis currency mismatch");
  const mrrMinor = divideRound(
    BigInt(amount.minor),
    BigInt(input.billingMonths),
  );
  return {
    revenueBasis: basis,
    mrr: { currency: amount.currency, minor: mrrMinor.toString() } as Money,
    arr: {
      currency: amount.currency,
      minor: (mrrMinor * 12n).toString(),
    } as Money,
  };
}

export interface ForecastLine extends RecurringRevenueInput {
  accountId: string;
  partnerAccountId?: string;
  serviceStartsOn: string;
  serviceEndsOn?: string;
  amendmentNetMinor?: string;
}

export function revenueForecast(lines: readonly ForecastLine[]): readonly {
  orderId: string;
  accountId: string;
  month: string;
  stage: "pipeline" | "backlog";
  channel: "direct" | "partner" | "marketplace";
  revenue: Money;
}[] {
  const output: {
    orderId: string;
    accountId: string;
    month: string;
    stage: "pipeline" | "backlog";
    channel: "direct" | "partner" | "marketplace";
    revenue: Money;
  }[] = [];
  for (const line of lines) {
    if (line.status === "cancelled" || line.status === "terminated") continue;
    const recurring = recurringRevenue(line);
    const monthlyMinor =
      BigInt(recurring.mrr.minor) + BigInt(line.amendmentNetMinor ?? "0");
    const start = new Date(`${line.serviceStartsOn}T00:00:00Z`);
    const end = line.serviceEndsOn
      ? new Date(`${line.serviceEndsOn}T00:00:00Z`)
      : new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), 1));
    for (
      let cursor = new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
      );
      cursor < end;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    ) {
      output.push({
        orderId: line.orderId,
        accountId: line.accountId,
        month: cursor.toISOString().slice(0, 7),
        stage: line.status === "pipeline" ? "pipeline" : "backlog",
        channel:
          line.route === "marketplace"
            ? "marketplace"
            : line.partnerAccountId
              ? "partner"
              : "direct",
        revenue: {
          currency: recurring.mrr.currency,
          minor: monthlyMinor.toString(),
        } as Money,
      });
    }
  }
  return output.sort(
    (left, right) =>
      left.month.localeCompare(right.month) ||
      left.orderId.localeCompare(right.orderId),
  );
}

export function capacityPlanning(
  rows: readonly {
    region: string;
    month: string;
    committedQuantity: string;
    provisionedQuantity: string;
    actualStoredQuantity: string;
  }[],
) {
  const grouped = new Map<
    string,
    { committed: bigint; provisioned: bigint; actual: bigint }
  >();
  for (const row of rows) {
    const key = `${row.region}:${row.month}`;
    const current = grouped.get(key) ?? {
      committed: 0n,
      provisioned: 0n,
      actual: 0n,
    };
    current.committed += parseDecimal(row.committedQuantity);
    current.provisioned += parseDecimal(row.provisionedQuantity);
    current.actual += parseDecimal(row.actualStoredQuantity);
    grouped.set(key, current);
  }
  return [...grouped.entries()].map(([key, values]) => {
    const separator = key.lastIndexOf(":");
    return {
      region: key.slice(0, separator),
      month: key.slice(separator + 1),
      committedQuantity: formatDecimal(values.committed),
      provisionedQuantity: formatDecimal(values.provisioned),
      actualStoredQuantity: formatDecimal(values.actual),
      utilizationBps:
        values.provisioned === 0n
          ? 0
          : Number(divideRound(values.actual * 10_000n, values.provisioned)),
    };
  });
}

export function renewalExposure(
  now: string,
  rows: readonly {
    orderId: string;
    partnerAccountId?: string;
    serviceEndsOn: string;
    revenue: Money;
    decliningUsage: boolean;
    overdueInvoice: boolean;
    openSupportIssue: boolean;
    inactivePortal: boolean;
    noticeRecorded: boolean;
  }[],
) {
  const nowMs = Date.parse(now);
  return rows
    .map((row) => {
      const days = Math.ceil(
        (Date.parse(`${row.serviceEndsOn}T00:00:00Z`) - nowMs) / 86_400_000,
      );
      const riskSignals = [
        row.decliningUsage && "declining_usage",
        row.overdueInvoice && "overdue_invoice",
        row.openSupportIssue && "open_support_issue",
        row.inactivePortal && "inactive_portal",
        row.noticeRecorded && "notice_recorded",
      ].filter((value): value is string => Boolean(value));
      const window =
        days <= 30
          ? "0_30"
          : days <= 90
            ? "31_90"
            : days <= 180
              ? "91_180"
              : "later";
      return { ...row, daysToEnd: days, window, riskSignals };
    })
    .sort((left, right) => left.daysToEnd - right.daysToEnd);
}

export function partnerPerformance(
  rows: readonly {
    partnerAccountId: string;
    agreementType: string;
    registrationId?: string;
    converted: boolean;
    endClientAccountId: string;
    booked: Money;
    renewed: boolean;
    eligibleForRenewal: boolean;
    revenueMinor: string;
    costMinor?: string;
  }[],
) {
  const grouped = new Map<string, typeof rows>();
  rows.forEach((row) => {
    const key = `${row.partnerAccountId}:${row.agreementType}:${row.booked.currency}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  });
  return [...grouped.values()].map((group) => {
    const first = group[0];
    if (!first) throw new Error("Partner performance group unexpectedly empty");
    const registrations = new Set(
      group.flatMap((row) => (row.registrationId ? [row.registrationId] : [])),
    );
    const closed = group.filter((row) => row.converted).length;
    const eligible = group.filter((row) => row.eligibleForRenewal).length;
    const renewals = group.filter(
      (row) => row.eligibleForRenewal && row.renewed,
    ).length;
    const revenue = group.reduce(
      (sum, row) => sum + BigInt(row.revenueMinor),
      0n,
    );
    const hasAllCosts = group.every((row) => row.costMinor !== undefined);
    const cost = group.reduce(
      (sum, row) => sum + BigInt(row.costMinor ?? "0"),
      0n,
    );
    return {
      partnerAccountId: first.partnerAccountId,
      agreementType: first.agreementType,
      bookings: {
        currency: first.booked.currency,
        minor: group
          .reduce((sum, row) => sum + BigInt(row.booked.minor), 0n)
          .toString(),
      } as Money,
      endClientCount: new Set(group.map((row) => row.endClientAccountId)).size,
      registrationToCloseBps:
        registrations.size === 0
          ? 0
          : Math.round((closed * 10_000) / registrations.size),
      renewalRateBps:
        eligible === 0 ? 0 : Math.round((renewals * 10_000) / eligible),
      margin: {
        currency: first.booked.currency,
        minor: (revenue - cost).toString(),
      } as Money,
      marginLabel: hasAllCosts ? "realized" : "modeled",
    };
  });
}

export function funnelCycleTime(
  rows: readonly {
    dealId: string;
    registeredAt: string;
    agreementAt?: string;
    quoteAt?: string;
    orderedAt?: string;
    provisionedAt?: string;
    invoicedAt?: string;
    paidAt?: string;
    pocStartedAt?: string;
    pocConvertedAt?: string;
  }[],
) {
  const durationHours = (from?: string, to?: string) =>
    from && to
      ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 3_600_000))
      : null;
  return rows.map((row) => ({
    dealId: row.dealId,
    registrationToAgreementHours: durationHours(
      row.registeredAt,
      row.agreementAt,
    ),
    quoteToOrderHours: durationHours(row.quoteAt, row.orderedAt),
    orderToProvisionedHours: durationHours(row.orderedAt, row.provisionedAt),
    invoiceToCashHours: durationHours(row.invoicedAt, row.paidAt),
    pocToConversionHours: durationHours(row.pocStartedAt, row.pocConvertedAt),
  }));
}

export function marginAndPoc(
  rows: readonly {
    objectId: string;
    kind: "order" | "poc";
    revenue: Money;
    modeledCost: Money;
    realizedCost?: Money;
    engineeringMinutes?: number;
    floorException?: boolean;
  }[],
) {
  return rows.map((row) => {
    const cost = row.realizedCost ?? row.modeledCost;
    if (cost.currency !== row.revenue.currency)
      throw new Error("Margin currencies differ");
    return {
      objectId: row.objectId,
      kind: row.kind,
      revenue: row.revenue,
      cost,
      margin: {
        currency: row.revenue.currency,
        minor: (BigInt(row.revenue.minor) - BigInt(cost.minor)).toString(),
      } as Money,
      label: row.realizedCost ? "realized" : "modeled",
      engineeringMinutes: row.engineeringMinutes ?? 0,
      floorException: row.floorException ?? false,
    };
  });
}

export function threeWayTieOut(input: {
  currency: Currency;
  platformMinor: bigint;
  stripeMinor: bigint;
  qboMinor: bigint;
}) {
  return {
    currency: input.currency,
    platformMinor: input.platformMinor.toString(),
    stripeMinor: input.stripeMinor.toString(),
    qboMinor: input.qboMinor.toString(),
    stripeVarianceMinor: (input.platformMinor - input.stripeMinor).toString(),
    qboVarianceMinor: (input.platformMinor - input.qboMinor).toString(),
    tied:
      input.platformMinor === input.stripeMinor &&
      input.platformMinor === input.qboMinor,
  };
}

/**
 * Code points a spreadsheet discards before deciding whether a cell is a
 * formula, so a value may not begin with the lead-in to be evaluated as one.
 * JavaScript's `\s` already covers TAB, LF, VT, FF, CR, space, NBSP (U+00A0),
 * U+1680, the U+2000-U+200A block, U+2028, U+2029, U+202F, U+205F, U+3000 and
 * U+FEFF; the rest of the class adds the zero-width code points `\s` omits.
 */
const CSV_STRIPPED_LEAD = /^[\s\u180E\u200B-\u200D\u2060]+/;

/**
 * Lead-ins Excel, LibreOffice Calc and Google Sheets evaluate. TAB (U+0009) and
 * CR (U+000D) are lead-ins in their own right, not only padding before `=+-@`.
 */
const CSV_FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A signed decimal or exponent literal is a numeric constant in every
 * spreadsheet, never a formula. It is deliberately left unescaped: quoting it
 * would import every negative delta, credit and clawback as text, which drops
 * those rows out of the reader's own column totals without any visible error.
 */
const CSV_NUMERIC_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Neutralises one cell for spreadsheet import and quotes it per RFC 4180.
 * Both the workflow report export and the CSV download render through this, so
 * a value neutralised in one is neutralised in the other.
 */
export function csvCell(value: unknown): string {
  const raw =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" ||
            typeof value === "boolean" ||
            typeof value === "bigint"
          ? `${value}`
          : (JSON.stringify(value) ?? "");
  const evaluated = raw.replace(CSV_STRIPPED_LEAD, "");
  const safe =
    (CSV_FORMULA_LEAD.test(raw) || CSV_FORMULA_LEAD.test(evaluated)) &&
    !CSV_NUMERIC_LITERAL.test(evaluated)
      ? `'${raw}`
      : raw;
  // Surrounding whitespace is quoted as well so lenient parsers that trim
  // unquoted fields still hand back the persisted value unchanged.
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe)
    ? `"${safe.replace(/"/g, '""')}"`
    : safe;
}

/** Column order discovered across the rows, first seen first. */
export function csvColumns(
  rows: readonly Readonly<Record<string, unknown>>[],
): string[] {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

/**
 * The single CSV writer. The leading BOM is what makes Excel read the bytes as
 * UTF-8 rather than the local code page.
 */
export function toCsv(
  rows: readonly Readonly<Record<string, unknown>>[],
  columns: readonly string[],
): string {
  const lines = [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function weeklyScorecard(input: {
  week: string;
  forecast: ReturnType<typeof revenueForecast>;
  renewals: ReturnType<typeof renewalExposure>;
  partners: ReturnType<typeof partnerPerformance>;
  funnel: ReturnType<typeof funnelCycleTime>;
  margins: ReturnType<typeof marginAndPoc>;
}) {
  return {
    week: input.week,
    forecastRows: input.forecast.length,
    revenueAtRiskMinor: input.renewals
      .reduce((sum, row) => sum + BigInt(row.revenue.minor), 0n)
      .toString(),
    partnerCount: new Set(input.partners.map((row) => row.partnerAccountId))
      .size,
    stalledDeals: input.funnel.filter(
      (row) =>
        row.quoteToOrderHours === null || row.orderToProvisionedHours === null,
    ).length,
    realizedMarginRows: input.margins.filter((row) => row.label === "realized")
      .length,
    modeledMarginRows: input.margins.filter((row) => row.label === "modeled")
      .length,
  };
}
