"use client";

import { useState } from "react";
import {
  contractCurrencies,
  templateLineItemLimit,
  type ContractCurrency,
  type Money,
  type TemplateLineItems,
  type TemplateValue,
} from "@clockwork/contracts";
import { indicativeLinePrice } from "@clockwork/domain/core";
import { Button, InlineNotice, Input, Select } from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import {
  bookMoney,
  formatQuantity,
} from "../administration-safety/price-book-presentation";
import { discountBps } from "../sales-pricing/scenarios";
import { errorMessage, fieldMessage, formatContractDate } from "./copy";
import { checkLineItems } from "./line-items";
import {
  importScenarioLineItems,
  listImportableScenarios,
  type ImportableScenario,
} from "./scenario-import";
import styles from "./contracts.module.css";

interface DraftRow {
  key: string;
  sku: string;
  description: string;
  region: string;
  unit: string;
  quantity: string;
  termMonths: string;
  /** Major units as typed, such as "15.00". */
  unitPrice: string;
  /** Percent as typed, such as "12.5". */
  discount: string;
  /** The rate's minimum for a row from a scenario; "0" for one typed in.
   * The server applies the in-force rate's minimum either way. */
  minimumQuantity: string;
  /** The scenario line this row was imported from, until detached. */
  scenarioLine?: number;
}

type ScenarioLink = NonNullable<TemplateLineItems["scenario"]>;

const blankRow = (): DraftRow => ({
  key: crypto.randomUUID(),
  sku: "",
  description: "",
  region: "",
  unit: "",
  quantity: "1",
  termMonths: "12",
  unitPrice: "",
  discount: "0",
  minimumQuantity: "0",
});

/** "1,250.5" as minor units, or null when it is not an amount. */
function minorUnits(major: string) {
  const match = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(
    major.trim().replaceAll(",", ""),
  );
  if (!match?.[1]) return null;
  return String(
    BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")),
  );
}

const majorUnits = (minor: string) => {
  const value = BigInt(minor);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
};

const draftRows = (items: TemplateLineItems): DraftRow[] =>
  items.rows.map((row) => ({
    key: crypto.randomUUID(),
    sku: row.sku,
    description: row.description,
    region: row.region,
    unit: row.unit,
    quantity: row.quantity,
    termMonths: String(row.termMonths),
    unitPrice: majorUnits(row.unitPriceMinor),
    discount: String(row.discountBps / 100),
    minimumQuantity: row.minimumQuantity,
    ...(row.scenarioLine === undefined
      ? {}
      : { scenarioLine: row.scenarioLine }),
  }));

/** One draft row as the table value holds it, priced when it is complete. */
function rowValue(row: DraftRow, currency: ContractCurrency) {
  const unitPriceMinor = minorUnits(row.unitPrice);
  const bps = discountBps(row.discount);
  let priced: ReturnType<typeof indicativeLinePrice> | null = null;
  try {
    if (unitPriceMinor !== null && bps !== null)
      priced = indicativeLinePrice({
        unitPrice: { currency, minor: unitPriceMinor } as Money,
        minimumQuantity: row.minimumQuantity,
        quantity: row.quantity.trim(),
        termMonths: Number(row.termMonths),
        discountBps: bps,
      });
  } catch {
    priced = null;
  }
  return {
    priced,
    value: {
      sku: row.sku,
      description: row.description,
      region: row.region,
      unit: row.unit,
      quantity: row.quantity.trim(),
      termMonths: Number(row.termMonths),
      unitPriceMinor: unitPriceMinor ?? "",
      minimumQuantity: row.minimumQuantity,
      discountBps: bps ?? -1,
      extendedMinor: priced?.total.minor ?? "",
      ...(row.scenarioLine === undefined
        ? {}
        : { scenarioLine: row.scenarioLine }),
    },
  };
}

/** A starting value for the editor: a table, never text. */
export const initialTable = (value: TemplateValue | undefined) =>
  typeof value === "object" ? value : undefined;

/** The editor's hidden form value, read back when the form is submitted. */
export function lineItemsFormValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type ImportState =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "choosing"; scenarios: readonly ImportableScenario[] };

/**
 * A priced line-item table for a template's `line_items` field. Lines can be
 * typed in or imported from a saved pricing scenario, then edited, and start
 * from `initialValue` when one is given. Totals use the pricing page's
 * functions; the server checks the same rules again.
 */
export function LineItemsEditor({
  id,
  name,
  label,
  help,
  error,
  initialValue,
}: {
  id: string;
  name: string;
  label: string;
  help?: string;
  error?: string | undefined;
  initialValue?: TemplateLineItems | undefined;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [currency, setCurrency] = useState<ContractCurrency>(
    initialValue?.currency ?? "USD",
  );
  const [rows, setRows] = useState<DraftRow[]>(() =>
    initialValue ? draftRows(initialValue) : [blankRow()],
  );
  const [imported, setImported] = useState<ScenarioLink | null>(
    initialValue?.scenario ?? null,
  );
  const [importState, setImportState] = useState<ImportState>({
    kind: "closed",
  });
  const [chosen, setChosen] = useState("");
  const [importError, setImportError] = useState<{
    code: string;
    line?: number;
  } | null>(null);

  const priced = rows.map((row) => rowValue(row, currency));
  const value = {
    currency,
    ...(imported ? { scenario: imported } : {}),
    rows: priced.map((row) => row.value),
  };
  const checked = checkLineItems(value);
  const money = (amount: { currency: string; minor: string }) =>
    bookMoney(amount, locale);
  const update = (key: string, change: Partial<DraftRow>) =>
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...change } : row)),
    );

  async function openImport() {
    setImportError(null);
    setImportState({ kind: "loading" });
    const result = await listImportableScenarios();
    if (!result.ok) {
      setImportState({ kind: "closed" });
      setImportError({ code: result.code });
      return;
    }
    setChosen(result.value[0]?.id ?? "");
    setImportState({ kind: "choosing", scenarios: result.value });
  }

  async function importChosen() {
    const typed = rows.some(
      (row) => row.sku.trim() || row.unit.trim() || row.unitPrice.trim(),
    );
    if (typed && !window.confirm(t("operations.contracts.lineItems.replace")))
      return;
    setImportError(null);
    const result = await importScenarioLineItems({ id: chosen });
    if (!result.ok) {
      setImportError({ code: result.code });
      return;
    }
    if (result.value.kind === "refused") {
      setImportError({ code: result.value.code, line: result.value.line });
      return;
    }
    const { lineItems } = result.value;
    setCurrency(lineItems.currency);
    setRows(draftRows(lineItems));
    setImported(lineItems.scenario ?? null);
    setImportState({ kind: "closed" });
  }

  /** Keeps the lines but drops their link to the scenario. */
  function detach() {
    setImported(null);
    setRows((current) =>
      current.map((row) => {
        const rest = { ...row };
        delete rest.scenarioLine;
        return rest;
      }),
    );
  }

  return (
    <fieldset id={id} className={`${styles.wide} ${styles.lineItems}`}>
      <legend>{label}</legend>
      {help ? <p className={styles.muted}>{help}</p> : null}
      {error ? (
        <p className={styles.fileError} role="alert">
          {error}
        </p>
      ) : null}
      <input type="hidden" name={name} value={JSON.stringify(value)} />
      <div className={styles.lineItemActions}>
        {importState.kind === "choosing" ? (
          importState.scenarios.length ? (
            <>
              <Select
                label={t("operations.contracts.lineItems.import.choose")}
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
                options={importState.scenarios.map((scenario) => ({
                  value: scenario.id,
                  label: t("operations.contracts.lineItems.import.option", {
                    name: scenario.name,
                    company: scenario.company,
                    total: money(scenario.total),
                  }),
                }))}
              />
              <Button size="small" onClick={() => void importChosen()}>
                {t("operations.contracts.lineItems.import.submit")}
              </Button>
              <Button
                size="small"
                variant="quiet"
                onClick={() => setImportState({ kind: "closed" })}
              >
                {t("operations.contracts.form.cancel")}
              </Button>
            </>
          ) : (
            <p className={styles.muted}>
              {t("operations.contracts.lineItems.import.none")}
            </p>
          )
        ) : (
          <Button
            size="small"
            variant="secondary"
            loading={importState.kind === "loading"}
            loadingLabel={t("operations.contracts.lineItems.import.loading")}
            onClick={() => void openImport()}
          >
            {t("operations.contracts.lineItems.import.open")}
          </Button>
        )}
      </div>
      {importError ? (
        <InlineNotice
          tone="danger"
          title={t("operations.contracts.lineItems.import.failed")}
          description={
            importError.line === undefined
              ? t(errorMessage(importError.code))
              : t("operations.contracts.lineItems.import.lineRefused", {
                  number: String(importError.line),
                  reason: t(fieldMessage(importError.code)),
                })
          }
          live="assertive"
        />
      ) : null}
      {imported ? (
        <div className={styles.lineItemActions}>
          <p className={styles.hint} role="note">
            {t("operations.contracts.lineItems.import.done", {
              name: imported.name,
              date: formatContractDate(imported.asOf, locale),
            })}
          </p>
          <Button size="small" variant="quiet" onClick={detach}>
            {t("operations.contracts.lineItems.import.detach")}
          </Button>
        </div>
      ) : null}
      <Select
        label={t("operations.contracts.lineItems.currency")}
        {...(imported
          ? {
              help: t("operations.contracts.lineItems.currencyImported"),
              disabled: true,
            }
          : {})}
        value={currency}
        onChange={(event) =>
          setCurrency(event.target.value as ContractCurrency)
        }
        options={contractCurrencies.map((code) => ({
          value: code,
          label: code,
        }))}
      />
      {rows.map((row, index) => {
        const number = String(index + 1);
        const line = priced[index]?.priced;
        return (
          <fieldset className={styles.lineItem} key={row.key}>
            <legend>
              {t("operations.contracts.lineItems.line", { number })}
            </legend>
            <div className={styles.lineItemFields}>
              <Input
                label={t("operations.contracts.lineItems.sku")}
                value={row.sku}
                maxLength={120}
                required
                onChange={(event) =>
                  update(row.key, { sku: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.description")}
                optionalLabel={t("operations.contracts.form.optional")}
                value={row.description}
                maxLength={200}
                onChange={(event) =>
                  update(row.key, { description: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.region")}
                optionalLabel={t("operations.contracts.form.optional")}
                value={row.region}
                maxLength={120}
                onChange={(event) =>
                  update(row.key, { region: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.unit")}
                value={row.unit}
                maxLength={60}
                required
                onChange={(event) =>
                  update(row.key, { unit: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.unitPrice", {
                  currency,
                })}
                inputMode="decimal"
                value={row.unitPrice}
                required
                onChange={(event) =>
                  update(row.key, { unitPrice: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.quantity")}
                inputMode="decimal"
                value={row.quantity}
                required
                onChange={(event) =>
                  update(row.key, { quantity: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.term")}
                type="number"
                min={1}
                max={120}
                step={1}
                value={row.termMonths}
                required
                onChange={(event) =>
                  update(row.key, { termMonths: event.target.value })
                }
              />
              <Input
                label={t("operations.contracts.lineItems.discount")}
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={row.discount}
                required
                onChange={(event) =>
                  update(row.key, { discount: event.target.value })
                }
              />
            </div>
            <p className={styles.hint}>
              {line
                ? t("operations.contracts.lineItems.extended", {
                    amount: money(line.total),
                  })
                : t("operations.contracts.lineItems.incomplete")}
            </p>
            {line?.belowMinimum ? (
              <p className={styles.fileError}>
                {t("operations.contracts.lineItems.belowMinimum", {
                  minimum: formatQuantity(row.minimumQuantity, locale),
                  unit: row.unit,
                })}
              </p>
            ) : null}
            {rows.length > 1 ? (
              <Button
                variant="quiet"
                size="small"
                onClick={() =>
                  setRows((current) =>
                    current.filter(({ key }) => key !== row.key),
                  )
                }
              >
                {t("operations.contracts.lineItems.remove", { number })}
              </Button>
            ) : null}
          </fieldset>
        );
      })}
      <Button
        variant="secondary"
        size="small"
        disabled={rows.length >= templateLineItemLimit}
        onClick={() => setRows((current) => [...current, blankRow()])}
      >
        {t("operations.contracts.lineItems.add")}
      </Button>
      <div role="status" aria-live="polite">
        {checked.ok ? (
          <dl className={styles.lineItemTotals}>
            <div>
              <dt>{t("operations.contracts.lineItems.subtotal")}</dt>
              <dd>{money(checked.totals.subtotal)}</dd>
            </div>
            <div>
              <dt>{t("operations.contracts.lineItems.discounts")}</dt>
              <dd>{money(checked.totals.discount)}</dd>
            </div>
            <div>
              <dt>{t("operations.contracts.lineItems.total")}</dt>
              <dd>{money(checked.totals.total)}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.muted}>
            {t("operations.contracts.lineItems.noTotal")}
          </p>
        )}
      </div>
    </fieldset>
  );
}
