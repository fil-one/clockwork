import type {
  DerivationNote,
  DerivationNoteCode,
  DerivationStep,
  DerivationStepKey,
  InvoiceDerivation,
  BillingInvoiceDerivation,
  PaygInvoiceDerivation,
  InvoiceDerivationLine,
} from "@clockwork/db";

import { use } from "react";

import { formattingLocales, type MessageId, type Translator } from "@/src/i18n";
import { getLocale, getTranslations } from "@/src/i18n/server";
import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";

import styles from "./invoice-derivation-panel.module.css";

const supportedCurrencies: readonly SupportedCurrency[] = ["USD", "EUR", "GBP"];

function amount(minorUnits: string, currency: string, locale: string): string {
  const supported = supportedCurrencies.find(
    (candidate) => candidate === currency,
  );
  return supported
    ? formatMoney(minorUnits, supported, locale)
    : `${minorUnits} ${currency}`;
}

/**
 * The derivation's step keys and note codes are its stable vocabulary, so the
 * labels and sentences are chosen here from them. `summary` and the per-step
 * `facts` are composed inside the domain assembler and arrive as written.
 */
const stepLabels: Readonly<Record<DerivationStepKey, MessageId>> = {
  quote: "experience.derivation.step.quote",
  order_line: "experience.derivation.step.orderLine",
  entitlement: "experience.derivation.step.entitlement",
  usage: "experience.derivation.step.usage",
  commitment: "experience.derivation.step.commitment",
  rate: "experience.derivation.step.rate",
  invoice_line: "experience.derivation.step.invoiceLine",
};

const noteMessages: Readonly<Record<DerivationNoteCode, MessageId>> = {
  QUOTE_SNAPSHOT_MISSING: "experience.derivation.note.quoteSnapshotMissing",
  ORDER_LINE_SNAPSHOT_MISSING:
    "experience.derivation.note.orderLineSnapshotMissing",
  LINE_SUPERSEDED: "experience.derivation.note.lineSuperseded",
  ENTITLEMENT_MISSING: "experience.derivation.note.entitlementMissing",
  USAGE_RECONCILIATION_MISSING:
    "experience.derivation.note.usageReconciliationMissing",
  USAGE_VARIANCE_OPEN: "experience.derivation.note.usageVarianceOpen",
  COMMITMENT_PERIOD_MISSING:
    "experience.derivation.note.commitmentPeriodMissing",
  COMMITMENT_OVERAGE_VARIANCE:
    "experience.derivation.note.commitmentOverageVariance",
  INVOICE_TOTAL_VARIANCE: "experience.derivation.note.invoiceTotalVariance",
};

const invoiceStatuses: Readonly<Record<string, MessageId>> = {
  draft: "status.invoice.draft",
  open: "status.invoice.open",
  paid: "status.invoice.paid",
  void: "status.invoice.void",
  uncollectible: "status.invoice.uncollectible",
};

const paygCharges: Readonly<Record<string, MessageId>> = {
  storage_bytes: "experience.derivation.charge.storage",
  egress_bytes: "experience.derivation.charge.egress",
  api_operations: "experience.derivation.charge.apiOperations",
  monthly_minimum_adjustment: "experience.derivation.charge.monthlyMinimum",
  correction_adjustment: "experience.derivation.charge.correction",
};

const taxTreatments: Readonly<Record<string, MessageId>> = {
  standard: "experience.derivation.treatment.standard",
  reverse_charge: "experience.derivation.treatment.reverseCharge",
  zero_rated: "experience.derivation.treatment.zeroRated",
  exempt: "experience.derivation.treatment.exempt",
  out_of_scope: "experience.derivation.treatment.outOfScope",
  not_registered: "experience.derivation.treatment.notRegistered",
};

/** A closed-set value in the reader's language; an unknown one as its code. */
function closed(
  labels: Readonly<Record<string, MessageId>>,
  value: string,
  t: Translator,
): string {
  const id = labels[value];
  return id ? t(id) : value;
}

/** Exact integer counts (byte-hours run past 2^53) grouped for the reader. */
function count(value: string, locale: string): string {
  return /^\d+$/.test(value)
    ? new Intl.NumberFormat(locale).format(BigInt(value))
    : value;
}

function day(value: string, locale: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(parsed);
}

/** `2026-08` as the reader names the month. */
function billingMonth(value: string, locale: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T00:00:00Z`));
}

function NoteList({
  notes,
  t,
}: {
  notes: readonly DerivationNote[];
  t: Translator;
}) {
  if (notes.length === 0) return null;
  return (
    <ul className={styles.notes}>
      {notes.map((note) => (
        <li key={`${note.code}:${note.orderLineId ?? "invoice"}`}>
          <span className={styles.noteCode}>{note.code}</span>
          <span>
            {(noteMessages[note.code] as MessageId | undefined)
              ? t(noteMessages[note.code])
              : note.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Step({
  step,
  currency,
  locale,
  t,
}: {
  step: DerivationStep;
  currency: string;
  locale: string;
  t: Translator;
}) {
  return (
    <li className={styles.step}>
      <div className={styles.stepHeader}>
        <span className={styles.stepLabel}>
          {(stepLabels[step.key] as MessageId | undefined)
            ? t(stepLabels[step.key])
            : step.label}
        </span>
        <span className={styles.stepSource}>
          {step.source}
          {step.reference ? ` · ${step.reference}` : ""}
        </span>
        {step.amountMinor ? (
          <span className={styles.lineAmount}>
            {amount(step.amountMinor, currency, locale)}
          </span>
        ) : null}
      </div>
      <p className={styles.stepSummary}>{step.summary}</p>
      {step.facts.length > 0 ? (
        <dl className={styles.facts}>
          {step.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <NoteList notes={step.notes} t={t} />
    </li>
  );
}

function Line({
  line,
  currency,
  locale,
  t,
}: {
  line: InvoiceDerivationLine;
  currency: string;
  locale: string;
  t: Translator;
}) {
  // Quantity and SKU are record facts, shown as recorded.
  const heading = `${line.quantity} ${line.sku}`;
  return (
    <li className={styles.line}>
      <div className={styles.lineHeader}>
        <h4>
          {line.superseded
            ? t("experience.derivation.lineAmended", { line: heading })
            : heading}
        </h4>
        <span className={styles.lineAmount}>
          {amount(line.amountMinor, currency, locale)}
        </span>
      </div>
      <ol className={styles.chain}>
        {line.steps.map((step) => (
          <Step
            currency={currency}
            key={step.key}
            locale={locale}
            step={step}
            t={t}
          />
        ))}
      </ol>
    </li>
  );
}

function Invoice({
  derivation,
  locale,
  t,
}: {
  derivation: InvoiceDerivation;
  locale: string;
  t: Translator;
}) {
  const variance = BigInt(derivation.varianceMinor);
  return (
    <li className={styles.invoice}>
      <div className={styles.invoiceHeader}>
        <h3>
          {t("common.join.labels", {
            first: derivation.reference,
            second: closed(invoiceStatuses, derivation.status, t),
          })}
        </h3>
        <dl className={styles.totals}>
          <div>
            <dt>{t("experience.derivation.invoiced")}</dt>
            <dd>
              {amount(
                derivation.invoicedTotalMinor,
                derivation.currency,
                locale,
              )}
            </dd>
          </div>
          {/*
            The invoiced figure is the amount owed and is gross of tax (001392).
            Every source row below it is pre-tax, so the difference is taken
            against the net and the net has to be on screen — otherwise the two
            numbers being subtracted are not the two numbers shown.
          */}
          <div>
            <dt>{t("experience.derivation.invoicedNet")}</dt>
            <dd>
              {amount(
                derivation.invoicedNetTotalMinor,
                derivation.currency,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("experience.derivation.fromSource")}</dt>
            <dd>
              {amount(
                derivation.derivedTotalMinor,
                derivation.currency,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt>{t("experience.derivation.difference")}</dt>
            <dd className={variance === 0n ? undefined : styles.variance}>
              {amount(derivation.varianceMinor, derivation.currency, locale)}
            </dd>
          </div>
        </dl>
      </div>
      <NoteList
        notes={derivation.notes.filter((note) => note.orderLineId === null)}
        t={t}
      />
      <ol className={styles.lines}>
        {derivation.lines.map((line) => (
          <Line
            currency={derivation.currency}
            key={line.orderLineId}
            line={line}
            locale={locale}
            t={t}
          />
        ))}
      </ol>
    </li>
  );
}

function PaygInvoice({
  derivation: invoice,
  locale,
  t,
}: {
  derivation: PaygInvoiceDerivation;
  locale: string;
  t: Translator;
}) {
  return (
    <li className={styles.invoice}>
      <div className={styles.invoiceHeader}>
        <h3>
          {t("common.join.labels", {
            first: invoice.reference,
            second: closed(invoiceStatuses, invoice.status, t),
          })}
        </h3>
        <p>
          {t(
            invoice.kind === "debit_adjustment"
              ? "experience.derivation.paygCorrection"
              : "experience.derivation.payg",
            {
              month: billingMonth(invoice.month, locale),
              revision: invoice.revision,
            },
          )}
        </p>
        <dl className={styles.totals}>
          <div>
            <dt>{t("experience.derivation.invoiced")}</dt>
            <dd>
              {amount(invoice.invoicedTotalMinor, invoice.currency, locale)}
            </dd>
          </div>
          <div>
            <dt>{t("experience.derivation.net")}</dt>
            <dd>
              {amount(invoice.invoicedNetTotalMinor, invoice.currency, locale)}
            </dd>
          </div>
          <div>
            <dt>{t("experience.derivation.tax")}</dt>
            <dd>{amount(invoice.taxMinor, invoice.currency, locale)}</dd>
          </div>
        </dl>
      </div>
      <p>
        {invoice.supplierName} → {invoice.customerName}
      </p>
      <p>
        {t("experience.derivation.policy", {
          sku: invoice.sku,
          region: invoice.region,
          version: invoice.policyVersion,
        })}
      </p>
      <p>
        {t("experience.derivation.servicePeriod", {
          start: day(invoice.serviceStartsAt, locale),
          end: day(invoice.serviceEndsAt, locale),
        })}
      </p>
      <dl className={styles.facts}>
        {invoice.lines.map((line) => (
          <div key={line.kind}>
            <dt>{closed(paygCharges, line.kind, t)}</dt>
            <dd>{amount(line.minor, invoice.currency, locale)}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>{t("experience.derivation.usageEvidence")}</summary>
        <dl className={styles.facts}>
          <div>
            <dt>{t("experience.derivation.storageByteHours")}</dt>
            <dd>{count(invoice.storageByteHours, locale)}</dd>
          </div>
          <div>
            <dt>{t("experience.derivation.egressBytes")}</dt>
            <dd>{count(invoice.egressBytes, locale)}</dd>
          </div>
          <div>
            <dt>{t("experience.derivation.charge.apiOperations")}</dt>
            <dd>{count(invoice.apiOperations, locale)}</dd>
          </div>
        </dl>
        {invoice.taxLines.map((line, index) => (
          // The notation is the rule book's statutory wording, quoted as
          // published; the treatment is the closed set, in the reader's words.
          <p key={`${line.jurisdiction}:${index}`}>
            {[
              line.jurisdiction,
              closed(taxTreatments, line.treatment, t),
              amount(line.taxMinor, invoice.currency, locale),
              ...(line.notation ? [line.notation] : []),
            ].reduce((first, second) =>
              t("common.join.labels", { first, second }),
            )}
          </p>
        ))}
      </details>
    </li>
  );
}

/**
 * The billed amount rebuilt from the rows that produced it: quote revision,
 * ordered line, entitlement, reconciled usage, commitment period, and the
 * contracted rates. Read only, and every step names the table it came from.
 */
export function InvoiceDerivationPanel({
  derivations,
}: {
  derivations: readonly BillingInvoiceDerivation[];
}) {
  const locale = formattingLocales[use(getLocale())];
  const t = use(getTranslations());
  return (
    <section aria-labelledby="derivation-title" className={styles.panel}>
      <div className={styles.heading}>
        <h2 id="derivation-title">{t("experience.derivation.title")}</h2>
        <p>{t("experience.derivation.description")}</p>
      </div>
      {derivations.length === 0 ? (
        <p className={styles.empty}>{t("experience.derivation.empty")}</p>
      ) : (
        <ol className={styles.invoices}>
          {derivations.map((derivation) =>
            "billingSource" in derivation ? (
              <PaygInvoice
                derivation={derivation}
                key={derivation.invoiceId}
                locale={locale}
                t={t}
              />
            ) : (
              <Invoice
                derivation={derivation}
                key={derivation.invoiceId}
                locale={locale}
                t={t}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}
