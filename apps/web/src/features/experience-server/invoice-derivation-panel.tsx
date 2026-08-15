import type {
  DerivationNote,
  DerivationStep,
  InvoiceDerivation,
  InvoiceDerivationLine,
} from "@clockwork/db";

import {
  formatMoney,
  type SupportedCurrency,
} from "@/src/features/shared/format";

import styles from "./invoice-derivation-panel.module.css";

const supportedCurrencies: readonly SupportedCurrency[] = ["USD", "EUR", "GBP"];

function amount(minorUnits: string, currency: string): string {
  const supported = supportedCurrencies.find(
    (candidate) => candidate === currency,
  );
  return supported
    ? formatMoney(minorUnits, supported)
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

function Step({ step, currency }: { step: DerivationStep; currency: string }) {
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
            {amount(step.amountMinor, currency)}
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
}: {
  line: InvoiceDerivationLine;
  currency: string;
}) {
  return (
    <li className={styles.line}>
      <div className={styles.lineHeader}>
        <h4>
          {line.quantity} {line.sku}
          {line.superseded ? " · amended" : ""}
        </h4>
        <span className={styles.lineAmount}>
          {amount(line.amountMinor, currency)}
        </span>
      </div>
      <ol className={styles.chain}>
        {line.steps.map((step) => (
          <Step currency={currency} key={step.key} step={step} />
        ))}
      </ol>
    </li>
  );
}

function Invoice({ derivation }: { derivation: InvoiceDerivation }) {
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
              {amount(derivation.invoicedTotalMinor, derivation.currency)}
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
              {amount(derivation.invoicedNetTotalMinor, derivation.currency)}
            </dd>
          </div>
          <div>
            <dt>From source rows</dt>
            <dd>{amount(derivation.derivedTotalMinor, derivation.currency)}</dd>
          </div>
          <div>
            <dt>Difference</dt>
            <dd className={variance === 0n ? undefined : styles.variance}>
              {amount(derivation.varianceMinor, derivation.currency)}
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
          />
        ))}
      </ol>
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
  derivations: readonly InvoiceDerivation[];
}) {
  return (
    <section aria-labelledby="derivation-title" className={styles.panel}>
      <div className={styles.heading}>
        <h2 id="derivation-title">Invoice derivation</h2>
        <p>
          Every issued invoice on this account, traced from the priced quote to
          the billed amount.
        </p>
      </div>
      {derivations.length === 0 ? (
        <p className={styles.empty}>This account has no issued invoices.</p>
      ) : (
        <ol className={styles.invoices}>
          {derivations.map((derivation) => (
            <Invoice derivation={derivation} key={derivation.invoiceId} />
          ))}
        </ol>
      )}
    </section>
  );
}
