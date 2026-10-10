"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  pricingScenarioLineLimit,
  type Money,
  type PricingScenarioRecord,
} from "@clockwork/contracts";
import { indicativeScenarioPrice } from "@clockwork/domain/core";
import {
  Button,
  InlineNotice,
  Input,
  Select,
  Textarea,
  buttonClassName,
} from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import {
  bookMoney,
  formatQuantity,
} from "../administration-safety/price-book-presentation";
import {
  errorMessage,
  fieldMessage,
  formatContractDate,
} from "../contracts/copy";
import type { IndicativePriceBook } from "./books";
import styles from "./pricing.module.css";
import { deleteScenario, saveScenario } from "./scenario-actions";
import { discountBps, type ScenarioPanelState } from "./scenarios";

interface DraftLine {
  key: string;
  bookId: string;
  rateId: string;
  quantity: string;
  termMonths: string;
  discount: string;
  /** The saved rate when it has left force; the seller must choose again. */
  gone?: { sku: string; region: string };
}

const scenarioErrors: Readonly<Record<string, MessageId>> = {
  PRICING_SCENARIO_RATE_UNAVAILABLE:
    "operations.sales.pricing.scenario.error.rateUnavailable",
  PRICING_SCENARIO_CURRENCY_MISMATCH:
    "operations.sales.pricing.scenario.error.currency",
  PRICING_SCENARIO_VERSION_CONFLICT:
    "operations.sales.pricing.scenario.error.conflict",
  PRICING_SCENARIO_NOT_FOUND:
    "operations.sales.pricing.scenario.error.notFound",
  PRICING_SCENARIO_BELOW_MINIMUM:
    "operations.sales.pricing.scenario.error.belowMinimum",
};
const problem = (code: string) => scenarioErrors[code] ?? errorMessage(code);

const pricingPath = "/internal/pricing" as Route;

function newLine(book: IndicativePriceBook | undefined): DraftLine {
  return {
    key: crypto.randomUUID(),
    bookId: book?.id ?? "",
    rateId: book?.rates[0]?.id ?? "",
    quantity: "100",
    termMonths: "12",
    discount: "0",
  };
}

/** Opened lines on the books offered today. A line whose rate has left
 * force keeps no rate, in a book of its own currency where one is offered,
 * until the seller chooses one. */
function openedLines(
  opened: PricingScenarioRecord,
  books: readonly IndicativePriceBook[],
) {
  return opened.lines.map((line): DraftLine => {
    const book =
      books.find(({ id }) => id === line.bookId) ??
      books.find(({ currency }) => currency === line.unitPrice.currency);
    const rate = book?.rates.find(({ id }) => id === line.rateId);
    return {
      key: crypto.randomUUID(),
      bookId: book?.id ?? "",
      rateId: rate?.id ?? "",
      quantity: line.quantity,
      termMonths: String(line.termMonths),
      discount: String(line.discountBps / 100),
      ...(rate ? {} : { gone: { sku: line.sku, region: line.region } }),
    };
  });
}

/**
 * Several indicative lines for one prospect, saved to come back to and
 * downloaded as a summary to send. The browser sends only the book, rate and
 * entry for each line; the server prices them from today's list prices.
 */
export function ScenarioBuilder({
  books,
  state,
}: {
  books: readonly IndicativePriceBook[];
  state: ScenarioPanelState;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const opened = state.kind === "ready" ? state.opened : null;
  const [id] = useState(() => opened?.id ?? crypto.randomUUID());
  const [name, setName] = useState(opened?.name ?? "");
  const [company, setCompany] = useState(opened?.company ?? "");
  const [notes, setNotes] = useState(opened?.notes ?? "");
  const [lines, setLines] = useState(() =>
    opened ? openedLines(opened, books) : [newLine(books[0])],
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  if (state.kind !== "ready")
    return (
      <section className={styles.scenarios} aria-labelledby="scenarios">
        <h2 id="scenarios">{t("operations.sales.pricing.scenario.title")}</h2>
        <InlineNotice
          tone={state.kind === "error" ? "danger" : "info"}
          title={t(
            state.kind === "mfa"
              ? "operations.sales.pricing.scenario.mfa"
              : state.kind === "error"
                ? "operations.sales.pricing.scenario.loadError"
                : "operations.sales.pricing.scenario.unavailable",
          )}
        />
      </section>
    );

  const currency = books.find(
    ({ id: bookId }) => bookId === lines[0]?.bookId,
  )?.currency;
  const resolved = lines.map((line) => {
    const book = books.find(({ id: bookId }) => bookId === line.bookId);
    return { book, rate: book?.rates.find(({ id: r }) => r === line.rateId) };
  });
  let totals: ReturnType<typeof indicativeScenarioPrice> | null = null;
  try {
    totals = indicativeScenarioPrice(
      lines.map((line, index) => {
        const { rate } = resolved[index] ?? {};
        const bps = discountBps(line.discount);
        if (!rate || bps === null) throw new Error("invalid");
        return {
          unitPrice: rate.unitPrice as Money,
          minimumQuantity: rate.minimumQuantity,
          quantity: line.quantity.trim(),
          termMonths: Number(line.termMonths),
          discountBps: bps,
        };
      }),
    );
  } catch {
    totals = null;
  }
  const money = (value: { currency: string; minor: string }) =>
    bookMoney(value, locale);
  const belowMinimum = totals?.lines.some((line) => line.belowMinimum) ?? false;
  const savedTotal = opened
    ? indicativeScenarioPrice(opened.lines).total
    : null;
  const update = (key: string, change: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    setError(null);
    setFields({});
    const result = await saveScenario({
      id,
      name,
      company,
      notes,
      lines: lines.map((line) => ({
        bookId: line.bookId,
        rateId: line.rateId,
        quantity: line.quantity.trim(),
        termMonths: Number(line.termMonths),
        discountBps: discountBps(line.discount) ?? -1,
      })),
      ...(opened ? { expectedVersion: opened.version } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      if (result.fields) setFields(result.fields);
      setError(result.code);
      return;
    }
    setNotice(t("operations.sales.pricing.scenario.saved", { name }));
    router.push(`${pricingPath}?scenario=${result.value.id}` as Route);
    router.refresh();
  }

  async function remove(target: { id: string; name: string; version: number }) {
    if (
      !window.confirm(
        t("operations.sales.pricing.scenario.deleteConfirm", {
          name: target.name,
        }),
      )
    )
      return;
    setNotice(null);
    setError(null);
    const result = await deleteScenario({
      id: target.id,
      expectedVersion: target.version,
    });
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setNotice(
      t("operations.sales.pricing.scenario.deleted", { name: target.name }),
    );
    if (target.id === opened?.id) router.push(pricingPath);
    router.refresh();
  }

  const fieldError = (key: string) =>
    fields[key] === "unprintable"
      ? t("operations.sales.pricing.scenario.error.unprintableCompany")
      : fields[key]
        ? t(fieldMessage(fields[key]))
        : undefined;

  return (
    <section className={styles.scenarios} aria-labelledby="scenarios">
      <div className={styles.scenarioHeader}>
        <h2 id="scenarios">
          {opened
            ? t("operations.sales.pricing.scenario.editing", {
                name: opened.name,
              })
            : t("operations.sales.pricing.scenario.title")}
        </h2>
        <p>{t("operations.sales.pricing.scenario.description")}</p>
      </div>
      {notice ? (
        <InlineNotice tone="success" title={notice} live="polite" />
      ) : null}
      {error ? (
        <InlineNotice
          tone="danger"
          title={t(problem(error))}
          live="assertive"
        />
      ) : null}
      {opened ? (
        <p className={styles.source} role="note">
          {t("operations.sales.pricing.scenario.asOf", {
            date: formatContractDate(opened.asOf, locale),
          })}
        </p>
      ) : null}
      <form
        className={styles.calculator}
        onSubmit={(event) => void save(event)}
      >
        <div className={styles.fields}>
          <Input
            label={t("operations.sales.pricing.scenario.name")}
            value={name}
            maxLength={120}
            required
            error={fieldError("name")}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t("operations.sales.pricing.scenario.company")}
            value={company}
            maxLength={200}
            required
            error={fieldError("company")}
            onChange={(event) => setCompany(event.target.value)}
          />
          <Textarea
            label={t("operations.sales.pricing.scenario.notes")}
            help={t("operations.sales.pricing.scenario.notesHelp")}
            value={notes}
            maxLength={2000}
            rows={2}
            error={fieldError("notes")}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        {lines.map((line, index) => {
          const { book, rate } = resolved[index] ?? {};
          const offered = index
            ? books.filter((candidate) => candidate.currency === currency)
            : books;
          const number = String(index + 1);
          return (
            <fieldset className={styles.line} key={line.key}>
              <legend>
                {t("operations.sales.pricing.scenario.line", { number })}
              </legend>
              <div className={styles.lineFields}>
                {offered.length > 1 ? (
                  <Select
                    label={t("operations.sales.pricing.book")}
                    value={line.bookId}
                    onChange={(event) => {
                      const next = books.find(
                        ({ id: bookId }) => bookId === event.target.value,
                      );
                      const rateId = next?.rates[0]?.id ?? "";
                      if (index === 0 && next?.currency !== currency)
                        setLines((current) =>
                          current.map((other) => ({
                            ...other,
                            bookId: next?.id ?? "",
                            rateId,
                          })),
                        );
                      else update(line.key, { bookId: next?.id ?? "", rateId });
                    }}
                    options={offered.map((candidate) => ({
                      value: candidate.id,
                      label: t("operations.sales.pricing.bookOption", {
                        name: candidate.name,
                        version: String(candidate.version),
                        currency: candidate.currency,
                      }),
                    }))}
                  />
                ) : null}
                <Select
                  label={t("operations.sales.pricing.rate")}
                  value={line.rateId}
                  onChange={(event) =>
                    update(line.key, { rateId: event.target.value })
                  }
                  options={[
                    ...(line.rateId
                      ? []
                      : [
                          {
                            value: "",
                            label: t(
                              "operations.sales.pricing.scenario.chooseRate",
                            ),
                          },
                        ]),
                    ...(book?.rates ?? []).map((candidate) => ({
                      value: candidate.id,
                      label: t("operations.sales.pricing.rateOption", {
                        sku: candidate.sku,
                        region: candidate.region,
                        price: money(candidate.unitPrice),
                        unit: candidate.unit,
                      }),
                    })),
                  ]}
                />
                <Input
                  label={t("operations.sales.pricing.quantity", {
                    unit: rate?.unit ?? "",
                  })}
                  inputMode="decimal"
                  required
                  pattern="[0-9]+(?:\.[0-9]{1,6})?"
                  value={line.quantity}
                  onChange={(event) =>
                    update(line.key, { quantity: event.target.value })
                  }
                />
                <Input
                  label={t("operations.sales.pricing.term")}
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  required
                  value={line.termMonths}
                  onChange={(event) =>
                    update(line.key, { termMonths: event.target.value })
                  }
                />
                <Input
                  label={t("operations.sales.pricing.discount")}
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  required
                  value={line.discount}
                  onChange={(event) =>
                    update(line.key, { discount: event.target.value })
                  }
                />
              </div>
              {line.gone && !line.rateId ? (
                <p className={styles.warning} role="note">
                  {t("operations.sales.pricing.scenario.lineStale", line.gone)}
                </p>
              ) : null}
              {rate && totals?.lines[index]?.belowMinimum ? (
                <p className={styles.warning}>
                  {t("operations.sales.pricing.belowMinimum", {
                    minimum: formatQuantity(rate.minimumQuantity, locale),
                    unit: rate.unit,
                  })}
                </p>
              ) : null}
              {lines.length > 1 ? (
                <Button
                  variant="quiet"
                  size="small"
                  onClick={() =>
                    setLines((current) =>
                      current.filter(({ key }) => key !== line.key),
                    )
                  }
                >
                  {t("operations.sales.pricing.scenario.removeLine", {
                    number,
                  })}
                </Button>
              ) : null}
            </fieldset>
          );
        })}
        <Button
          variant="secondary"
          size="small"
          disabled={lines.length >= pricingScenarioLineLimit}
          onClick={() =>
            setLines((current) => [
              ...current,
              newLine(
                books.find(({ id: bookId }) => bookId === current[0]?.bookId),
              ),
            ])
          }
        >
          {t("operations.sales.pricing.scenario.addLine")}
        </Button>
        <div className={styles.result} role="status" aria-live="polite">
          {totals ? (
            <dl className={styles.figures}>
              <div>
                <dt>{t("operations.sales.pricing.scenario.subtotal")}</dt>
                <dd>{money(totals.subtotal)}</dd>
              </div>
              <div>
                <dt>{t("operations.sales.pricing.scenario.discounts")}</dt>
                <dd>{money(totals.discount)}</dd>
              </div>
              <div>
                <dt>{t("operations.sales.pricing.scenario.total")}</dt>
                <dd>{money(totals.total)}</dd>
              </div>
              {savedTotal &&
              (savedTotal.minor !== totals.total.minor ||
                savedTotal.currency !== totals.total.currency) ? (
                <div>
                  <dt>{t("operations.sales.pricing.scenario.savedTotal")}</dt>
                  <dd>{money(savedTotal)}</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p>{t("operations.sales.pricing.invalid")}</p>
          )}
          <p className={styles.caveat}>
            {t("operations.sales.pricing.caveat")}
          </p>
        </div>
        <div className={styles.actions}>
          <Button
            type="submit"
            loading={busy}
            disabled={!totals || belowMinimum}
          >
            {t(
              opened
                ? "operations.sales.pricing.scenario.saveChanges"
                : "operations.sales.pricing.scenario.save",
            )}
          </Button>
          {opened ? (
            <Link
              className={buttonClassName({ variant: "quiet" })}
              href={pricingPath}
            >
              {t("operations.sales.pricing.scenario.startNew")}
            </Link>
          ) : null}
        </div>
      </form>
      <section className={styles.saved} aria-labelledby="saved-scenarios">
        <h3 id="saved-scenarios">
          {t(
            state.seesAll
              ? "operations.sales.pricing.scenario.listAll"
              : "operations.sales.pricing.scenario.listMine",
          )}
        </h3>
        {state.scenarios.length === 0 ? (
          <p>{t("operations.sales.pricing.scenario.empty")}</p>
        ) : (
          <ul className={styles.savedList}>
            {state.scenarios.map((scenario) => (
              <li key={scenario.id}>
                <div>
                  <strong>{scenario.name}</strong>
                  <span>
                    {t("operations.sales.pricing.scenario.summary", {
                      company: scenario.company,
                      date: formatContractDate(scenario.asOf, locale),
                      total: money(scenario.total),
                    })}
                  </span>
                  {state.seesAll ? (
                    <span>
                      {t("operations.sales.pricing.scenario.owner", {
                        name: scenario.ownerName,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className={styles.savedActions}>
                  <Link
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={`${pricingPath}?scenario=${scenario.id}` as Route}
                    aria-label={t(
                      "operations.sales.pricing.scenario.openNamed",
                      {
                        name: scenario.name,
                      },
                    )}
                  >
                    {t("operations.sales.pricing.scenario.open")}
                  </Link>
                  <a
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={`/internal/pricing/scenarios/${scenario.id}/summary`}
                    download
                    aria-label={t(
                      "operations.sales.pricing.scenario.downloadNamed",
                      { name: scenario.name },
                    )}
                  >
                    {t("operations.contracts.documents.download")}
                  </a>
                  <Button
                    variant="quiet"
                    size="small"
                    aria-label={t(
                      "operations.sales.pricing.scenario.deleteNamed",
                      { name: scenario.name },
                    )}
                    onClick={() => void remove(scenario)}
                  >
                    {t("operations.sales.pricing.scenario.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
