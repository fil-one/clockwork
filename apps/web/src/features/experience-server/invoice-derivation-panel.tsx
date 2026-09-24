import type {
  DerivationNote,
  DerivationStep,
  InvoiceDerivation,
  BillingInvoiceDerivation,
  PaygInvoiceDerivation,
  InvoiceDerivationLine,
} from "@clockwork/db";

import { use } from "react";

import { formattingLocales } from "@/src/i18n";
import { getLocale } from "@/src/i18n/server";
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

function NoteList({ notes }: { notes: readonly DerivationNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className={styles.notes}>
      {notes.map((note) => (
        <li key={`${note.code}:${note.orderLineId ?? "invoice"}`}>
          <span className={styles.noteCode}>{note.code}</span>
          <span>{note.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Step({
  step,
  currency,
  locale,
}: {
  step: DerivationStep;
  currency: string;
  locale: string;
}) {
  return (
    <li className={styles.step}>
      <div className={styles.stepHeader}>
        <span className={styles.stepLabel}>{step.label}</span>
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
      <NoteList notes={step.notes} />
    </li>
  );
}

function Line({
  line,
  currency,
  locale,
}: {
  line: InvoiceDerivationLine;
  currency: string;
  locale: string;
}) {
  return (
    <li className={styles.line}>
      <div className={styles.lineHeader}>
        <h4>
          {line.quantity} {line.sku}
          {line.superseded ? " · amended" : ""}
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
          />
        ))}
      </ol>
    </li>
  );
}

function Invoice({
  derivation,
  locale,
}: {
  derivation: InvoiceDerivation;
  locale: string;
}) {
  const variance = BigInt(derivation.varianceMinor);
  return (
    <li className={styles.invoice}>
      <div className={styles.invoiceHeader}>
        <h3>
          {derivation.reference} · {derivation.status}
        </h3>
        <dl className={styles.totals}>
          <div>
            <dt>Invoiced</dt>
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
            <dt>Invoiced net of tax</dt>
            <dd>
              {amount(
                derivation.invoicedNetTotalMinor,
                derivation.currency,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt>From source rows</dt>
            <dd>
              {amount(
                derivation.derivedTotalMinor,
                derivation.currency,
                locale,
              )}
            </dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd className={variance === 0n ? undefined : styles.variance}>
              {amount(derivation.varianceMinor, derivation.currency, locale)}
            </dd>
          </div>
        </dl>
      </div>
      <NoteList
        notes={derivation.notes.filter((note) => note.orderLineId === null)}
      />
      <ol className={styles.lines}>
        {derivation.lines.map((line) => (
          <Line
            currency={derivation.currency}
            key={line.orderLineId}
            line={line}
            locale={locale}
          />
        ))}
      </ol>
    </li>
  );
}

function PaygInvoice({
  derivation: invoice,
  locale,
}: {
  derivation: PaygInvoiceDerivation;
  locale: string;
}) {
  const labels: Record<string, string> = {
    storage_bytes: "Storage",
    egress_bytes: "Egress",
    api_operations: "API operations",
    monthly_minimum_adjustment: "Monthly minimum adjustment",
    correction_adjustment: "Correction adjustment",
  };
  return (
    <li className={styles.invoice}>
      <div className={styles.invoiceHeader}>
        <h3>
          {invoice.reference} · {invoice.status}
        </h3>
        <p>
          PAYG {invoice.month} · revision {invoice.revision}
          {invoice.kind === "debit_adjustment" ? " · correction" : ""}
        </p>
        <dl className={styles.totals}>
          <div>
            <dt>Invoiced</dt>
            <dd>
              {amount(invoice.invoicedTotalMinor, invoice.currency, locale)}
            </dd>
          </div>
          <div>
            <dt>Net</dt>
            <dd>
              {amount(invoice.invoicedNetTotalMinor, invoice.currency, locale)}
            </dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{amount(invoice.taxMinor, invoice.currency, locale)}</dd>
          </div>
        </dl>
      </div>
      <p>
        {invoice.supplierName} → {invoice.customerName}
      </p>
      <p>
        {invoice.sku} · {invoice.region} · approved policy version{" "}
        {invoice.policyVersion}
      </p>
      <p>
        Service period: {invoice.serviceStartsAt} to {invoice.serviceEndsAt}{" "}
        (end excluded).
      </p>
      <dl className={styles.facts}>
        {invoice.lines.map((line) => (
          <div key={line.kind}>
            <dt>{labels[line.kind] ?? line.kind}</dt>
            <dd>{amount(line.minor, invoice.currency, locale)}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Usage and tax evidence</summary>
        <dl className={styles.facts}>
          <div>
            <dt>Storage byte-hours</dt>
            <dd>{invoice.storageByteHours}</dd>
          </div>
          <div>
            <dt>Egress bytes</dt>
            <dd>{invoice.egressBytes}</dd>
          </div>
          <div>
            <dt>API operations</dt>
            <dd>{invoice.apiOperations}</dd>
          </div>
        </dl>
        {invoice.taxLines.map((line, index) => (
          <p key={`${line.jurisdiction}:${index}`}>
            {line.jurisdiction} · {line.treatment.replaceAll("_", " ")} ·{" "}
            {amount(line.taxMinor, invoice.currency, locale)}
            {line.notation ? ` · ${line.notation}` : ""}
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
  return (
    <section aria-labelledby="derivation-title" className={styles.panel}>
      <div className={styles.heading}>
        <h2 id="derivation-title">Invoice derivation</h2>
        <p>
          Recent issued invoices on this account, traced from their retained
          commercial terms and usage to the billed amount.
        </p>
      </div>
      {derivations.length === 0 ? (
        <p className={styles.empty}>This account has no issued invoices.</p>
      ) : (
        <ol className={styles.invoices}>
          {derivations.map((derivation) =>
            "billingSource" in derivation ? (
              <PaygInvoice
                derivation={derivation}
                key={derivation.invoiceId}
                locale={locale}
              />
            ) : (
              <Invoice
                derivation={derivation}
                key={derivation.invoiceId}
                locale={locale}
              />
            ),
          )}
        </ol>
      )}
    </section>
  );
}
