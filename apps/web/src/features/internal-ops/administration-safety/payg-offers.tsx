"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId, Translator } from "@/src/i18n";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  PaygOfferCommand,
  PaygOfferRecord,
  PaygOfferTerms,
} from "@clockwork/domain/core";

import { bookMoney } from "./price-book-presentation";
import { AdministrationPage, styles } from "./ui";

/*
 * Every word on this page is a message ID. Stored facts (minor units, byte
 * counts, ISO timestamps, codes) are formatted for the reader here and placed
 * into messages as values. Errors travel as message IDs (`PaygError`), so a
 * failure is worded in the reader's language at the point it is shown.
 */

/** A failure whose reader-facing sentence is a message ID. */
class PaygError extends Error {
  public constructor(public readonly messageId: MessageId) {
    super(messageId);
    this.name = "PaygError";
  }
}

function errorText(
  failure: unknown,
  t: Translator,
  fallback: MessageId,
): string {
  return failure instanceof PaygError ? t(failure.messageId) : t(fallback);
}

function value(data: FormData, name: string): string {
  const field = data.get(name);
  return typeof field === "string" ? field.trim() : "";
}

/**
 * The hint's example amount, written with the reader's decimal separator
 * where the input accepts it: "4,99" for a comma locale, otherwise "4.99".
 * Always ASCII digits, which is what the input parses.
 */
export function exampleAmount(formattingLocale: string): string {
  const separator = new Intl.NumberFormat(formattingLocale)
    .formatToParts(4.99)
    .find((part) => part.type === "decimal")?.value;
  return separator === "," ? "4,99" : "4.99";
}

/** Minor units as the plain decimal an input accepts ("4.99"). */
function moneyInput(minor?: string): string {
  if (minor === undefined) return "";
  return `${BigInt(minor) / 100n}.${(BigInt(minor) % 100n).toString().padStart(2, "0")}`;
}

const storageUnits = [
  [1_000_000_000_000n, "terabyte"],
  [1_000_000_000n, "gigabyte"],
  [1_000_000n, "megabyte"],
  [1_000n, "kilobyte"],
] as const;

/** A decimal (SI) byte count in the reader's number and unit format. */
function decimalStorage(
  bytes: string | undefined,
  t: Translator,
  locale: string,
): string {
  if (bytes === undefined) return t("adminPricing.payg.notSpecified");
  const count = BigInt(bytes);
  const unit = storageUnits.find(([scale]) => count >= scale);
  if (!unit)
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "byte",
      unitDisplay: "long",
    }).format(count);
  const [scale, name] = unit;
  const fraction = (((count % scale) * 100n) / scale)
    .toString()
    .padStart(2, "0");
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: name,
    maximumFractionDigits: 2,
  }).format(`${count / scale}.${fraction}` as Intl.StringNumericLiteral);
}

/** An ISO timestamp in the reader's format, in UTC and labelled as UTC. */
function utcTimestamp(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

/** A service month ("2026-09") in the reader's format. */
function serviceMonth(value: string, locale: string): string {
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * A typed amount in minor units. Either decimal separator is accepted, so a
 * reader who writes "4,99" is not refused; at most two decimals and never a
 * grouping separator, so "1.500" cannot be read as fifteen hundred.
 */
export function minor(value: string): string {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/u.exec(value.trim());
  if (!match?.[1]) throw new PaygError("adminPricing.payg.error.moneyFormat");
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0"))
  ).toString();
}

/** What the reader is told for each problem code the PAYG API returns. */
const problemMessages: Readonly<Record<string, MessageId>> = {
  PAYG_APPROVED_POLICY_BINDING_MISMATCH:
    "adminPricing.payg.error.bindingMismatch",
  TRIAL_ACCOUNT_NOT_CLEARED: "adminPricing.payg.error.trialAccountNotCleared",
  TRIAL_ALREADY_USED: "adminPricing.payg.error.trialAlreadyUsed",
  TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED:
    "adminPricing.payg.error.trialDomainEvidence",
  TRIAL_VERIFIED_TENANT_REQUIRED: "adminPricing.payg.error.trialTenantRequired",
  TRIAL_PAID_CONVERSION_NOT_CONFIRMED:
    "adminPricing.payg.error.trialPaidNotConfirmed",
  TRIAL_APPROVED_POLICY_REQUIRED: "adminPricing.payg.error.trialPolicyRequired",
  PAYG_ENROLLMENT_SOURCE_ALREADY_BOUND:
    "adminPricing.payg.error.enrollmentAlreadyBound",
  PAYG_STRIPE_CUSTOMER_UNMAPPED:
    "adminPricing.payg.error.stripeCustomerUnmapped",
  PAYG_VERIFIED_ENROLLMENT_EVIDENCE_REQUIRED:
    "adminPricing.payg.error.enrollmentEvidenceRequired",
  PAYG_CREDIT_ORIGINAL_INVOICE_NOT_ISSUED:
    "adminPricing.payg.error.creditOriginalNotIssued",
  PAYG_ENROLLMENT_START_INVALID:
    "adminPricing.payg.error.enrollmentStartInvalid",
  PAYG_CONFIRMED_CANCELLATION_REQUIRED:
    "adminPricing.payg.error.cancellationRequired",
  PAYG_ENROLLMENT_REPLAY_CONFLICT:
    "adminPricing.payg.error.enrollmentReplayConflict",
  PAYG_OFFER_VERSION_EXISTS: "adminPricing.payg.error.versionExists",
  PAYG_OFFER_STALE_VERSION: "adminPricing.payg.error.staleVersion",
  PAYG_OFFER_DISTINCT_APPROVER_REQUIRED:
    "adminPricing.payg.error.distinctApprover",
  PAYG_OFFER_FINANCE_AUTHORITY_REQUIRED:
    "adminPricing.payg.error.financeAuthority",
  PAYG_OFFERS_UNAVAILABLE: "adminPricing.payg.error.unavailable",
  RECENT_AUTHENTICATION_REQUIRED:
    "adminPricing.payg.error.recentAuthentication",
  PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE:
    "adminPricing.payg.error.sourceCheckedInFuture",
};

function problemMessage(code: string, status: number): MessageId {
  if (code.startsWith("PAYG_TAX_REVIEW_REQUIRED"))
    return "adminPricing.payg.error.taxReview";
  return (
    problemMessages[code] ??
    (status === 422
      ? "adminPricing.payg.error.validation"
      : "adminPricing.payg.error.notSaved")
  );
}

async function postPayg(path: string, body: unknown): Promise<unknown> {
  const csrf = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("clockwork-csrf="))
    ?.slice("clockwork-csrf=".length);
  if (!csrf || csrf.length < 32)
    throw new PaygError("adminPricing.payg.error.csrf");
  const response = await fetch(`/api/v1/core/payg-offers${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const code =
      result && typeof result === "object" && "code" in result
        ? String(result.code)
        : "";
    throw new PaygError(problemMessage(code, response.status));
  }
  return result;
}

async function command(body: PaygOfferCommand): Promise<PaygOfferRecord> {
  return (await postPayg("", body)) as PaygOfferRecord;
}

function tbBytes(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match?.[1]) throw new PaygError("adminPricing.payg.error.tbFormat");
  return (
    BigInt(match[1]) * 1_000_000_000_000n +
    BigInt((match[2] ?? "").padEnd(12, "0"))
  ).toString();
}

const policyStatusLabels: Readonly<
  Record<PaygOfferRecord["status"], MessageId>
> = {
  draft: "adminPricing.payg.status.draft",
  proposed: "adminPricing.payg.status.proposed",
  approved: "adminPricing.payg.status.approved",
  retired: "adminPricing.payg.status.retired",
};

const savedMessages: Readonly<Record<PaygOfferRecord["status"], MessageId>> = {
  draft: "adminPricing.payg.saved.draft",
  proposed: "adminPricing.payg.saved.proposed",
  approved: "adminPricing.payg.saved.approved",
  retired: "adminPricing.payg.saved.retired",
};

const simulationLineLabels: Readonly<Record<string, MessageId>> = {
  storage_bytes: "adminPricing.payg.simulator.line.storage",
  egress_bytes: "adminPricing.payg.simulator.line.egress",
  api_operations: "adminPricing.payg.simulator.line.api",
  monthly_minimum_adjustment: "adminPricing.payg.simulator.line.minimum",
};

const billingEffectLabels: Readonly<Record<string, MessageId>> = {
  invoice: "recordKind.invoice",
  debit_adjustment: "adminPricing.payg.billing.kind.debitAdjustment",
  credit_adjustment: "adminPricing.payg.billing.kind.creditAdjustment",
};

const partialMinimumLabels: Readonly<
  Record<PaygOfferTerms["payg"]["partialMonthMinimum"], MessageId>
> = {
  full: "adminPricing.payg.form.partial.full",
  prorated: "adminPricing.payg.form.partial.prorated",
};

function PaygOfferSimulator({ offer }: { offer: PaygOfferRecord }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    total: { currency: string; minor: string };
    lines: { kind: string; amount: { currency: string; minor: string } }[];
  }>();
  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await postPayg("/simulate", {
        terms: offer.terms,
        month: value(data, "month"),
        averageStorageBytes: tbBytes(value(data, "storageTb")),
        egressBytes: tbBytes(value(data, "egressTb")),
        apiOperations: value(data, "operations"),
      });
      setResult(response as NonNullable<typeof result>);
    } catch (failure) {
      setError(
        errorText(failure, t, "adminPricing.payg.error.simulationFailed"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.panelBody}>
      <h3>{t("adminPricing.payg.simulator.title")}</h3>
      <p>{t("adminPricing.payg.simulator.description")}</p>
      <form onSubmit={(event) => void simulate(event)}>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            {t("adminPricing.payg.simulator.month")}
            <input
              type="month"
              name="month"
              required
              defaultValue={offer.terms.effectiveFrom.slice(0, 7)}
            />
          </label>
          <label className={styles.field}>
            {t("adminPricing.payg.simulator.storage")}
            <input
              name="storageTb"
              inputMode="decimal"
              required
              defaultValue="0.1"
            />
          </label>
          <label className={styles.field}>
            {t("adminPricing.payg.simulator.egress")}
            <input
              name="egressTb"
              inputMode="decimal"
              required
              defaultValue="1"
            />
          </label>
          <label className={styles.field}>
            {t("adminPricing.payg.simulator.operations")}
            <input
              name="operations"
              inputMode="numeric"
              required
              defaultValue="1000000"
            />
          </label>
        </div>
        <button
          type="submit"
          className={styles.buttonSecondary}
          disabled={busy}
        >
          {busy
            ? t("adminPricing.payg.simulator.calculating")
            : t("adminPricing.payg.simulator.calculate")}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div role="status">
          <dl>
            {result.lines.map((line) => {
              const label = simulationLineLabels[line.kind];
              return (
                <div key={line.kind}>
                  <dt>{label ? t(label) : line.kind}</dt>
                  <dd>{bookMoney(line.amount, locale)}</dd>
                </div>
              );
            })}
          </dl>
          <p>
            <strong>
              {t("adminPricing.payg.simulator.total", {
                amount: bookMoney(result.total, locale),
              })}
            </strong>
          </p>
        </div>
      ) : null}
    </div>
  );
}

const documentFields = {
  customerTerms: {
    heading: "adminPricing.payg.form.terms.heading",
    documentId: "adminPricing.payg.form.terms.documentId",
    version: "adminPricing.payg.form.terms.version",
    uri: "adminPricing.payg.form.terms.uri",
    hash: "adminPricing.payg.form.terms.hash",
  },
  customerRetention: {
    heading: "adminPricing.payg.form.retention.heading",
    documentId: "adminPricing.payg.form.retention.documentId",
    version: "adminPricing.payg.form.retention.version",
    uri: "adminPricing.payg.form.retention.uri",
    hash: "adminPricing.payg.form.retention.hash",
  },
} as const satisfies Record<string, Record<string, MessageId>>;

function OfferForm({
  offer,
  onSave,
  busy,
}: {
  offer?: PaygOfferRecord;
  onSave: (terms: PaygOfferTerms) => Promise<void>;
  busy: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const terms = offer?.terms;
  const [customerPolicyConfigured, setCustomerPolicyConfigured] = useState(
    Boolean(terms?.customerAcquisition),
  );
  const [error, setError] = useState("");
  const field = (
    name: string,
    label: MessageId,
    defaultValue: string | number | undefined,
    type = "text",
    hint?: string,
  ) => (
    <label className={styles.field} key={name}>
      {t(label)}
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        type={type}
        required
        {...(type === "number" ? { min: 0, step: 1 } : {})}
      />
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await onSave({
        name: value(data, "name"),
        sku: value(data, "sku"),
        region: value(data, "region"),
        version: Number(value(data, "version")),
        effectiveFrom: value(data, "effectiveFrom"),
        sourceUri: value(data, "sourceUri"),
        sourceCheckedAt: `${value(data, "sourceCheckedAt")}T00:00:00.000Z`,
        sourceDocumentId: value(data, "sourceDocumentId"),
        owner: value(data, "owner"),
        ...(customerPolicyConfigured
          ? {
              customerAcquisition: {
                paygRequestsEnabled: data.get("paygRequestsEnabled") === "on",
                trialRequestsEnabled: data.get("trialRequestsEnabled") === "on",
                serviceNotice: value(data, "serviceNotice"),
                cancellationNotice: value(data, "cancellationNotice"),
                trialNotice: value(data, "trialNotice"),
                terms: {
                  documentId: value(data, "customerTermsId"),
                  version: value(data, "customerTermsVersion"),
                  uri: value(data, "customerTermsUri"),
                  sha256: value(data, "customerTermsHash"),
                },
                retention: {
                  documentId: value(data, "customerRetentionId"),
                  version: value(data, "customerRetentionVersion"),
                  uri: value(data, "customerRetentionUri"),
                  sha256: value(data, "customerRetentionHash"),
                },
              },
            }
          : {}),
        payg: {
          currency: value(
            data,
            "currency",
          ) as PaygOfferTerms["payg"]["currency"],
          storageTbMonthMinor: minor(value(data, "storagePrice")),
          monthlyMinimumMinor: minor(value(data, "minimum")),
          partialMonthMinimum: value(
            data,
            "partialMinimum",
          ) as PaygOfferTerms["payg"]["partialMonthMinimum"],
          correctionWindowDays: Number(value(data, "correctionWindowDays")),
          aggregation: "hourly_average_daily_utc",
          egressRateMinor: "0",
          apiRateMinor: "0",
          stripeTaxCode: value(data, "stripeTaxCode"),
          qboIncomeAccount: value(data, "qboIncomeAccount"),
        },
        trial: {
          durationDays: Number(value(data, "durationDays")),
          gracePeriodDays: Number(value(data, "gracePeriodDays")),
          storageLimitBytes: value(data, "storageLimitBytes"),
          cumulativeEgressLimitBytes: value(data, "cumulativeEgressLimitBytes"),
          maximumCounterAgeSeconds: Number(
            value(data, "maximumCounterAgeSeconds"),
          ),
          egressExhaustion: value(
            data,
            "egressExhaustion",
          ) as PaygOfferTerms["trial"]["egressExhaustion"],
        },
      });
    } catch (failure) {
      setError(errorText(failure, t, "adminPricing.payg.error.draftNotSaved"));
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className={styles.panelBody}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <legend>{t("adminPricing.payg.form.offerAndEvidence")}</legend>
        <div className={styles.toolbar}>
          {field("name", "adminPricing.payg.form.name", terms?.name)}
          {field("sku", "adminPricing.payg.form.sku", terms?.sku)}
          {field("region", "adminPricing.payg.form.region", terms?.region)}
          {field(
            "version",
            "adminPricing.payg.form.version",
            terms?.version ?? 1,
            "number",
          )}
          {field(
            "effectiveFrom",
            "adminPricing.payg.form.effectiveFrom",
            terms?.effectiveFrom,
            "date",
          )}
          {field("owner", "adminPricing.payg.form.owner", terms?.owner)}
          {field(
            "sourceUri",
            "adminPricing.payg.form.sourceUri",
            terms?.sourceUri,
            "url",
            t("adminPricing.payg.form.sourceUriHint"),
          )}
          {field(
            "sourceCheckedAt",
            "adminPricing.payg.form.sourceCheckedAt",
            terms?.sourceCheckedAt.slice(0, 10),
            "date",
          )}
          {field(
            "sourceDocumentId",
            "adminPricing.payg.form.sourceDocumentId",
            terms?.sourceDocumentId,
          )}
        </div>
        <h3>{t("adminPricing.payg.form.pricingHeading")}</h3>
        <p>
          {t("adminPricing.payg.form.pricingDescription", {
            bytes: new Intl.NumberFormat(locale).format(1_000_000_000_000),
          })}
        </p>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            {t("common.currency")}
            <select
              name="currency"
              defaultValue={terms?.payg.currency ?? "USD"}
            >
              {["USD", "EUR", "GBP"].map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          {field(
            "storagePrice",
            "adminPricing.payg.form.storagePrice",
            moneyInput(terms?.payg.storageTbMonthMinor),
            "text",
            t("adminPricing.payg.form.storagePriceAmountHint", {
              example: exampleAmount(locale),
            }),
          )}
          {field(
            "minimum",
            "adminPricing.payg.form.minimum",
            moneyInput(terms?.payg.monthlyMinimumMinor),
          )}
          <label className={styles.field}>
            {t("adminPricing.payg.form.partialMinimum")}
            <select
              name="partialMinimum"
              required
              defaultValue={terms?.payg.partialMonthMinimum ?? ""}
            >
              <option value="" disabled>
                {t("adminPricing.payg.form.selectTreatment")}
              </option>
              <option value="full">
                {t("adminPricing.payg.form.partial.full")}
              </option>
              <option value="prorated">
                {t("adminPricing.payg.form.partial.prorated")}
              </option>
            </select>
          </label>
          {field(
            "correctionWindowDays",
            "adminPricing.payg.form.correctionWindow",
            terms?.payg.correctionWindowDays,
            "number",
            t("adminPricing.payg.form.correctionWindowHint"),
          )}
        </div>
        <div className={styles.toolbar}>
          {field(
            "stripeTaxCode",
            "adminPricing.rate.stripeTaxCode",
            terms?.payg.stripeTaxCode,
          )}
          {field(
            "qboIncomeAccount",
            "adminPricing.rate.incomeAccount",
            terms?.payg.qboIncomeAccount,
          )}
        </div>
        <h3>{t("adminPricing.payg.form.trialHeading")}</h3>
        <div className={styles.toolbar}>
          {field(
            "durationDays",
            "adminPricing.payg.form.trialDuration",
            terms?.trial.durationDays,
            "number",
          )}
          {field(
            "gracePeriodDays",
            "adminPricing.payg.form.gracePeriod",
            terms?.trial.gracePeriodDays,
            "number",
          )}
          {field(
            "storageLimitBytes",
            "adminPricing.payg.form.storageLimit",
            terms?.trial.storageLimitBytes,
            "text",
            t("adminPricing.payg.form.storageLimitHint", {
              bytes: "1000000000000",
            }),
          )}
          {field(
            "cumulativeEgressLimitBytes",
            "adminPricing.payg.form.egressLimit",
            terms?.trial.cumulativeEgressLimitBytes,
            "text",
            t("adminPricing.payg.form.egressLimitHint"),
          )}
          {field(
            "maximumCounterAgeSeconds",
            "adminPricing.payg.form.counterAge",
            terms?.trial.maximumCounterAgeSeconds,
            "number",
          )}
          <label className={styles.field}>
            {t("adminPricing.payg.form.egressExhaustion")}
            <select
              name="egressExhaustion"
              required
              defaultValue={terms?.trial.egressExhaustion ?? ""}
            >
              <option value="" disabled>
                {t("adminPricing.payg.form.selectBehavior")}
              </option>
              <option value="disable_all">
                {t("adminPricing.payg.form.exhaustion.disableAll")}
              </option>
              <option value="block_egress">
                {t("adminPricing.payg.form.exhaustion.blockEgress")}
              </option>
            </select>
          </label>
        </div>
        <p>{t("adminPricing.payg.form.exhaustionNote")}</p>
        <h3>{t("adminPricing.payg.form.customerHeading")}</h3>
        <p>{t("adminPricing.payg.form.customerDescription")}</p>
        <label>
          <input
            type="checkbox"
            checked={customerPolicyConfigured}
            onChange={(event) =>
              setCustomerPolicyConfigured(event.target.checked)
            }
          />{" "}
          {t("adminPricing.payg.form.includeCustomerPolicy")}
        </label>
        {customerPolicyConfigured ? (
          <>
            <div className={styles.toolbar}>
              <label>
                <input
                  type="checkbox"
                  name="paygRequestsEnabled"
                  defaultChecked={
                    terms?.customerAcquisition?.paygRequestsEnabled
                  }
                />{" "}
                {t("adminPricing.payg.form.acceptPayg")}
              </label>
              <label>
                <input
                  type="checkbox"
                  name="trialRequestsEnabled"
                  defaultChecked={
                    terms?.customerAcquisition?.trialRequestsEnabled
                  }
                />{" "}
                {t("adminPricing.payg.form.acceptTrial")}
              </label>
            </div>
            <div className={styles.formGrid}>
              {(
                [
                  ["serviceNotice", "adminPricing.payg.form.serviceNotice"],
                  [
                    "cancellationNotice",
                    "adminPricing.payg.form.cancellationNotice",
                  ],
                  ["trialNotice", "adminPricing.payg.form.trialNotice"],
                ] as const
              ).map(([name, label]) => (
                <label className={styles.field} key={name}>
                  {t(label)}
                  <textarea
                    name={name}
                    required
                    minLength={20}
                    maxLength={4000}
                    defaultValue={terms?.customerAcquisition?.[name] ?? ""}
                  />
                </label>
              ))}
              {(
                [
                  ["customerTerms", terms?.customerAcquisition?.terms],
                  ["customerRetention", terms?.customerAcquisition?.retention],
                ] as const
              ).map(([prefix, reference]) => {
                const labels = documentFields[prefix];
                return (
                  <div key={prefix}>
                    <h4>{t(labels.heading)}</h4>
                    {field(
                      `${prefix}Id`,
                      labels.documentId,
                      reference?.documentId,
                    )}
                    {field(
                      `${prefix}Version`,
                      labels.version,
                      reference?.version,
                    )}
                    {field(`${prefix}Uri`, labels.uri, reference?.uri, "url")}
                    {field(`${prefix}Hash`, labels.hash, reference?.sha256)}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
        <button className={styles.button} type="submit">
          {busy
            ? t("common.saving")
            : offer
              ? t("adminPricing.payg.form.saveDraft")
              : t("adminPricing.payg.form.createDraft")}
        </button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function TrialAdministration({
  offers,
}: {
  offers: readonly PaygOfferRecord[];
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [trials, setTrials] = useState<
    {
      accountId: string;
      trial: {
        id: string;
        verifiedDomain: string;
        expiresAt: string;
        convertedAt?: string;
      };
    }[]
  >([]);
  const approved = offers.filter((offer) => offer.status === "approved");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/trials", {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new PaygError("adminPricing.payg.error.trialListUnavailable");
      const result = (await response.json()) as { trials: typeof trials };
      setTrials(result.trials);
      setMessage(
        result.trials.length ? "" : t("adminPricing.payg.trials.none"),
      );
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.trialListUnavailable"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: "claim" | "convert",
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const body =
        action === "claim"
          ? {
              action,
              id: crypto.randomUUID(),
              organizationId: value(data, "trialOrganizationId"),
              offerVersionId: value(data, "trialOfferVersionId"),
              verificationEvidenceId: value(data, "trialEvidence"),
            }
          : {
              action,
              trialId: value(data, "trialId"),
              ...(value(data, "paidSource") === "payg"
                ? { paygEnrollmentId: value(data, "paidId") }
                : { entitlementId: value(data, "paidId") }),
            };
      const result = (await postPayg("/trials", body)) as {
        trial: { id: string };
      };
      setMessage(
        action === "claim"
          ? t("adminPricing.payg.trials.claimed", { id: result.trial.id })
          : t("adminPricing.payg.trials.converted", { id: result.trial.id }),
      );
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.trialCommandFailed"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>{t("adminPricing.payg.trials.title")}</h2>
      <p>{t("adminPricing.payg.trials.description")}</p>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refresh()}
      >
        {t("adminPricing.payg.trials.refresh")}
      </button>
      {trials.map(({ trial }) => (
        <p key={trial.id}>
          {trial.convertedAt
            ? t("adminPricing.payg.trials.rowConverted", {
                id: trial.id,
                domain: trial.verifiedDomain,
                time: utcTimestamp(trial.convertedAt, locale),
              })
            : t("adminPricing.payg.trials.rowActive", {
                id: trial.id,
                domain: trial.verifiedDomain,
                time: utcTimestamp(trial.expiresAt, locale),
              })}
        </p>
      ))}
      <details>
        <summary>{t("adminPricing.payg.trials.recordClaim")}</summary>
        <form onSubmit={(event) => void submit(event, "claim")}>
          <label>
            {t("adminPricing.payg.trials.organizationId")}
            <input name="trialOrganizationId" required />
          </label>
          <label>
            {t("adminPricing.payg.trials.approvedPolicy")}
            <select name="trialOfferVersionId" required>
              {approved.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {t("adminPricing.bookName", {
                    name: offer.terms.name,
                    version: offer.terms.version,
                  })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("adminPricing.payg.trials.evidence")}
            <input
              name="trialEvidence"
              required
              placeholder={t("adminPricing.payg.trials.evidencePlaceholder", {
                registration: "registration:verified-event-uuid",
                dns: "dns:verified-domain-uuid",
              })}
            />
          </label>
          <button
            className={styles.buttonPrimary}
            disabled={busy || approved.length === 0}
          >
            {t("adminPricing.payg.trials.recordClaimButton")}
          </button>
        </form>
      </details>
      <details>
        <summary>{t("adminPricing.payg.trials.confirmConversion")}</summary>
        <form onSubmit={(event) => void submit(event, "convert")}>
          <label>
            {t("adminPricing.payg.trials.trialId")}
            <input name="trialId" required />
          </label>
          <label>
            {t("adminPricing.payg.trials.paidSource")}
            <select name="paidSource">
              <option value="payg">
                {t("adminPricing.payg.trials.paidSource.payg")}
              </option>
              <option value="term">
                {t("adminPricing.payg.trials.paidSource.term")}
              </option>
            </select>
          </label>
          <label>
            {t("adminPricing.payg.trials.paidSourceId")}
            <input name="paidId" required />
          </label>
          <button className={styles.buttonSecondary} disabled={busy}>
            {t("adminPricing.payg.trials.confirmConversionButton")}
          </button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

const enrollmentFields = [
  ["accountId", "adminPricing.payg.enrollments.accountId"],
  ["organizationId", "adminPricing.payg.enrollments.organizationId"],
  ["tenantId", "adminPricing.payg.enrollments.tenantId"],
  ["entitlementId", "adminPricing.payg.enrollments.entitlementId"],
  ["source", "adminPricing.payg.enrollments.source"],
  ["mappingVersionId", "adminPricing.payg.enrollments.mappingVersionId"],
  ["bindingEvidenceId", "adminPricing.payg.enrollments.bindingEvidenceId"],
  ["startsAt", "adminPricing.payg.enrollments.startsAt"],
] as const satisfies readonly (readonly [string, MessageId])[];

function PaygEnrollments({ offers }: { offers: readonly PaygOfferRecord[] }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enrollments, setEnrollments] = useState<
    {
      id: string;
      startsAt: string;
      endsAt?: string;
      billingAuthority: string;
      binding: { accountId: string; entitlementId: string };
    }[]
  >([]);
  async function refreshEnrollments() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/enrollments", {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new PaygError(
          "adminPricing.payg.error.enrollmentListUnavailable",
        );
      const result = (await response.json()) as {
        enrollments: typeof enrollments;
      };
      setEnrollments(result.enrollments);
      setMessage(
        result.enrollments.length
          ? ""
          : t("adminPricing.payg.enrollments.none"),
      );
    } catch (error) {
      setMessage(
        errorText(
          error,
          t,
          "adminPricing.payg.error.enrollmentListUnavailable",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const approved = offers.filter((offer) => offer.status === "approved");
  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    const offer = approved.find(
      (candidate) => candidate.id === value(data, "offerVersionId"),
    );
    if (!offer) {
      setMessage(t("adminPricing.payg.error.choosePolicy"));
      setBusy(false);
      return;
    }
    try {
      const retained = await postPayg("/enrollments", {
        action: "enroll",
        id: crypto.randomUUID(),
        offerVersionId: offer.id,
        binding: {
          mappingVersionId: value(data, "mappingVersionId"),
          accountId: value(data, "accountId"),
          filOneOrganizationId: value(data, "organizationId"),
          tenantId: value(data, "tenantId"),
          entitlementId: value(data, "entitlementId"),
          sku: offer.terms.sku,
          region: offer.terms.region,
          source: value(data, "source"),
          meters: ["storage_bytes", "egress_bytes", "api_operations"],
          status: "active",
        },
        bindingEvidenceId: value(data, "bindingEvidenceId"),
        startsAt: new Date(value(data, "startsAt")).toISOString(),
        billingAuthority: value(data, "authority"),
        ...(value(data, "cutoverEvidenceId")
          ? { cutoverEvidenceId: value(data, "cutoverEvidenceId") }
          : {}),
      });
      setMessage(
        t("adminPricing.payg.enrollments.retained", {
          id: (retained as { enrollment: { id: string } }).enrollment.id,
        }),
      );
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.enrollmentNotSaved"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await postPayg("/enrollments", {
        action: "cancel",
        enrollmentId: value(data, "enrollmentId"),
        serviceEndsAt: new Date(value(data, "serviceEndsAt")).toISOString(),
        evidenceId: value(data, "evidenceId"),
      });
      setMessage(t("adminPricing.payg.enrollments.cancellationRetained"));
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.cancellationNotSaved"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>{t("adminPricing.payg.enrollments.title")}</h2>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refreshEnrollments()}
      >
        {t("adminPricing.payg.enrollments.refresh")}
      </button>
      {enrollments.map((enrollment) => {
        const values = {
          id: enrollment.id,
          account: enrollment.binding.accountId,
        };
        const clockwork = enrollment.billingAuthority === "clockwork";
        return (
          <p key={enrollment.id}>
            {enrollment.endsAt
              ? t(
                  clockwork
                    ? "adminPricing.payg.enrollments.rowEnded.clockwork"
                    : "adminPricing.payg.enrollments.rowEnded.filOne",
                  { ...values, time: utcTimestamp(enrollment.endsAt, locale) },
                )
              : t(
                  clockwork
                    ? "adminPricing.payg.enrollments.rowActive.clockwork"
                    : "adminPricing.payg.enrollments.rowActive.filOne",
                  {
                    ...values,
                    time: utcTimestamp(enrollment.startsAt, locale),
                  },
                )}
          </p>
        );
      })}
      <p>{t("adminPricing.payg.enrollments.description")}</p>
      <details>
        <summary>{t("adminPricing.payg.enrollments.record")}</summary>
        <form onSubmit={(event) => void enroll(event)}>
          <label>
            {t("adminPricing.payg.enrollments.approvedPolicy")}
            <select name="offerVersionId" required>
              {approved.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {t("adminPricing.bookName", {
                    name: offer.terms.name,
                    version: offer.terms.version,
                  })}
                </option>
              ))}
            </select>
          </label>
          {enrollmentFields.map(([name, label]) => (
            <label key={name}>
              {t(label)}
              <input
                name={name}
                required
                placeholder={
                  name === "startsAt" ? "2026-09-01T00:00:00.000Z" : undefined
                }
              />
            </label>
          ))}
          <label>
            {t("adminPricing.payg.enrollments.billingAuthority")}
            <select name="authority">
              <option value="fil_one">
                {t("adminPricing.payg.enrollments.authority.filOne")}
              </option>
              <option value="clockwork">
                {t("adminPricing.payg.enrollments.authority.clockwork")}
              </option>
            </select>
          </label>
          <label>
            {t("adminPricing.payg.enrollments.cutoverEvidence")}
            <input name="cutoverEvidenceId" />
          </label>
          <button
            disabled={busy || approved.length === 0}
            className={styles.buttonPrimary}
          >
            {t("adminPricing.payg.enrollments.recordButton")}
          </button>
        </form>
      </details>
      <details>
        <summary>{t("adminPricing.payg.enrollments.cancelSummary")}</summary>
        <form onSubmit={(event) => void cancel(event)}>
          <label>
            {t("adminPricing.payg.enrollments.enrollmentId")}
            <input name="enrollmentId" required />
          </label>
          <label>
            {t("adminPricing.payg.enrollments.serviceEnd")}
            <input
              name="serviceEndsAt"
              required
              placeholder="2026-09-01T01:00:00.000Z"
            />
          </label>
          <label>
            {t("adminPricing.payg.enrollments.serviceEndEvidence")}
            <input name="evidenceId" required />
          </label>
          <button disabled={busy} className={styles.buttonSecondary}>
            {t("adminPricing.payg.enrollments.recordCancellation")}
          </button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function PaygBillingQueue() {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [effects, setEffects] = useState<
    {
      idempotencyKey: string;
      kind: string;
      accountId: string;
      month: string;
      amount: { currency: string; minor: string };
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/billing-effects", {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new PaygError("adminPricing.payg.error.billingQueueUnavailable");
      const result = (await response.json()) as { effects: typeof effects };
      setEffects(result.effects);
      setMessage(
        result.effects.length ? "" : t("adminPricing.payg.billing.none"),
      );
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.billingQueueUnavailable"),
      );
    } finally {
      setBusy(false);
    }
  }
  async function materialize(effectKey: string) {
    setBusy(true);
    try {
      const result = (await postPayg("/billing-effects", { effectKey })) as {
        invoiceId: string;
        creditNoteIds?: string[];
      };
      setEffects((current) =>
        current.filter((effect) => effect.idempotencyKey !== effectKey),
      );
      setMessage(
        result.creditNoteIds?.length
          ? t("adminPricing.payg.billing.creditNotesSaved", {
              count: result.creditNoteIds.length,
              ids: new Intl.ListFormat(locale, { type: "conjunction" }).format(
                result.creditNoteIds,
              ),
            })
          : t("adminPricing.payg.billing.invoiceSaved", {
              id: result.invoiceId,
            }),
      );
    } catch (error) {
      setMessage(
        errorText(error, t, "adminPricing.payg.error.billingNeedsReview"),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>{t("adminPricing.payg.billing.title")}</h2>
      <p>{t("adminPricing.payg.billing.description")}</p>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refresh()}
      >
        {t("adminPricing.payg.billing.refresh")}
      </button>
      {message ? <p role="status">{message}</p> : null}
      {effects.map((effect) => {
        const kind = billingEffectLabels[effect.kind];
        return (
          <div key={effect.idempotencyKey}>
            <p>
              {t("adminPricing.payg.billing.row", {
                month: serviceMonth(effect.month, locale),
                kind: kind ? t(kind) : effect.kind,
                amount: bookMoney(effect.amount, locale),
                account: effect.accountId,
              })}
            </p>
            <button
              type="button"
              className={styles.buttonSecondary}
              disabled={busy}
              onClick={() => void materialize(effect.idempotencyKey)}
            >
              {t("adminPricing.payg.billing.create")}
            </button>
          </div>
        );
      })}
    </section>
  );
}

export function PaygOfferAdministration({
  offers: initial,
  demo = false,
  available,
  roles,
  userId,
}: {
  offers: readonly PaygOfferRecord[];
  demo?: boolean;
  available: boolean;
  roles: readonly string[];
  userId: string;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [offers, setOffers] = useState(initial);
  const [selected, setSelected] = useState<PaygOfferRecord>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canManage = roles.includes("finance_approver");
  async function run(body: PaygOfferCommand) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await command(body);
      setOffers((current) => [
        saved,
        ...current.filter((offer) => offer.id !== saved.id),
      ]);
      setSelected(saved);
      setCreating(false);
      setMessage(
        t(savedMessages[saved.status], { version: saved.terms.version }),
      );
      router.refresh();
    } catch (failure) {
      setError(errorText(failure, t, "adminPricing.payg.error.changeFailed"));
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const action = submitter?.value as
      "propose" | "approve" | "reject" | "retire";
    if (!action) return;
    await run({
      action,
      id: selected.id,
      expectedRowVersion: selected.rowVersion,
      reason: value(data, "reason"),
      ...(value(data, "approvalEvidenceId")
        ? { approvalEvidenceId: value(data, "approvalEvidenceId") }
        : {}),
    }).catch(() => undefined);
  }
  const distinct =
    selected &&
    ![selected.createdBy, selected.lastEditedBy, selected.proposedBy].includes(
      userId,
    );
  return (
    <AdministrationPage
      eyebrow={t("adminPricing.payg.eyebrow")}
      title={t("adminPricing.payg.title")}
      description={t("adminPricing.payg.description")}
      actions={
        <Link href="/internal/price-books" className={styles.buttonSecondary}>
          {t("adminPricing.payg.priceBooksLink")}
        </Link>
      }
    >
      <p>
        <Link href="/internal/payg-requests">
          {t("adminPricing.payg.requestsLink")}
        </Link>
      </p>
      {demo ? (
        <p className={styles.notice}>{t("adminPricing.payg.demoNotice")}</p>
      ) : null}
      {available && canManage && !demo ? (
        <>
          <TrialAdministration offers={offers} />
          <PaygEnrollments offers={offers} />
          <PaygBillingQueue />
        </>
      ) : null}
      {!available ? (
        <p className={styles.notice} role="status">
          {t("adminPricing.payg.unavailable")}
        </p>
      ) : null}
      {!canManage ? (
        <p className={styles.roleNotice}>
          {t("adminPricing.payg.financeRequired")}
        </p>
      ) : null}
      {message ? (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      ) : null}
      <section
        className={styles.panel}
        aria-label={t("adminPricing.payg.versions.title")}
      >
        <div className={styles.panelHeading}>
          <h2>{t("adminPricing.payg.versions.title")}</h2>
          <button
            type="button"
            className={styles.button}
            disabled={!available || !canManage || busy}
            onClick={() => {
              setSelected(undefined);
              setCreating(true);
            }}
          >
            {t("adminPricing.payg.versions.new")}
          </button>
        </div>
        <div className={styles.panelBody}>
          {offers.length ? (
            offers.map((offer) => (
              <button
                key={offer.id}
                type="button"
                className={styles.buttonSecondary}
                aria-pressed={selected?.id === offer.id}
                disabled={busy}
                onClick={() => {
                  setSelected(offer);
                  setCreating(false);
                }}
              >
                {t("adminPricing.payg.versions.option", {
                  name: offer.terms.name,
                  region: offer.terms.region,
                  version: offer.terms.version,
                  status: t(policyStatusLabels[offer.status]),
                })}
              </button>
            ))
          ) : (
            <p>{t("adminPricing.payg.versions.none")}</p>
          )}
        </div>
      </section>
      {creating || selected ? (
        <section
          className={styles.panel}
          aria-label={t("adminPricing.payg.selected.label")}
        >
          <div className={styles.panelHeading}>
            <h2>
              {creating || !selected
                ? t("adminPricing.payg.versions.new")
                : t("common.join.labels", {
                    first: selected.terms.name,
                    second: t(policyStatusLabels[selected.status]),
                  })}
            </h2>
          </div>
          {creating || selected?.status === "draft" ? (
            <OfferForm
              key={selected?.id ?? "new"}
              {...(selected ? { offer: selected } : {})}
              busy={busy || !canManage}
              onSave={(terms) =>
                run(
                  selected
                    ? {
                        action: "save",
                        id: selected.id,
                        expectedRowVersion: selected.rowVersion,
                        terms,
                      }
                    : { action: "create", terms },
                )
              }
            />
          ) : selected ? (
            <div className={styles.panelBody}>
              <p>
                {t("adminPricing.payg.selected.pricing", {
                  price: bookMoney(
                    {
                      currency: selected.terms.payg.currency,
                      minor: selected.terms.payg.storageTbMonthMinor,
                    },
                    locale,
                  ),
                  minimum: bookMoney(
                    {
                      currency: selected.terms.payg.currency,
                      minor: selected.terms.payg.monthlyMinimumMinor,
                    },
                    locale,
                  ),
                  partial: t(
                    partialMinimumLabels[
                      selected.terms.payg.partialMonthMinimum
                    ],
                  ),
                })}
              </p>
              <p>
                {t("adminPricing.payg.selected.trial", {
                  duration: t("adminPricing.payg.days", {
                    count: selected.terms.trial.durationDays,
                  }),
                  grace: t("adminPricing.payg.days", {
                    count: selected.terms.trial.gracePeriodDays,
                  }),
                  storage: decimalStorage(
                    selected.terms.trial.storageLimitBytes,
                    t,
                    locale,
                  ),
                  egress: decimalStorage(
                    selected.terms.trial.cumulativeEgressLimitBytes,
                    t,
                    locale,
                  ),
                })}
              </p>
              <details>
                <summary>
                  {t("adminPricing.payg.selected.fullEvidence")}
                </summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
          {selected && canManage ? (
            <PaygOfferSimulator
              key={`simulation:${selected.id}:${selected.rowVersion}`}
              offer={selected}
            />
          ) : null}
          {selected && selected.status !== "retired" ? (
            <form
              key={`${selected.id}:${selected.rowVersion}`}
              onSubmit={(event) => void decide(event)}
              className={styles.panelBody}
            >
              <label className={styles.field}>
                {t("adminPricing.payg.decision.reason")}
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={2000}
                  disabled={busy || !canManage}
                />
              </label>
              {selected.status === "proposed" ? (
                <label className={styles.field}>
                  {t("adminPricing.payg.decision.evidence")}
                  <input
                    name="approvalEvidenceId"
                    maxLength={255}
                    disabled={busy || !canManage || !distinct}
                  />
                </label>
              ) : null}
              <div className={styles.actions}>
                {selected.status === "draft" ? (
                  <button
                    name="decision"
                    value="propose"
                    disabled={busy || !canManage}
                    className={styles.button}
                  >
                    {t("adminPricing.payg.decision.propose")}
                  </button>
                ) : null}
                {selected.status === "proposed" ? (
                  <>
                    <button
                      name="decision"
                      value="approve"
                      disabled={busy || !canManage || !distinct}
                      className={styles.button}
                    >
                      {t("adminPricing.payg.decision.approve")}
                    </button>
                    <button
                      name="decision"
                      value="reject"
                      disabled={busy || !canManage || !distinct}
                      className={styles.buttonSecondary}
                    >
                      {t("adminPricing.payg.decision.reject")}
                    </button>
                  </>
                ) : null}
                {selected.status === "approved" ? (
                  <button
                    name="decision"
                    value="retire"
                    disabled={busy || !canManage}
                    className={styles.buttonDanger}
                  >
                    {t("adminPricing.payg.decision.retire")}
                  </button>
                ) : null}
              </div>
              {selected.status === "proposed" && !distinct ? (
                <p>{t("adminPricing.payg.decision.distinctRequired")}</p>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}
    </AdministrationPage>
  );
}
