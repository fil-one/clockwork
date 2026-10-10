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
import {
  indicativeLinePrice,
  indicativeScenarioPrice,
} from "@clockwork/domain/core";
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
import {
  bookLabel,
  capacityUnit,
  productName,
  regionName,
} from "./presentation";
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

/** Why a scenario cannot be saved here; the calculator works regardless. */
const closedNotices: Readonly<
  Record<Exclude<ScenarioPanelState["kind"], "ready">, MessageId>
> = {
  demo: "operations.sales.pricing.scenario.demo",
  unavailable: "operations.sales.pricing.scenario.unavailable",
  mfa: "operations.sales.pricing.scenario.mfa",
  error: "operations.sales.pricing.scenario.loadError",
};

const pricingPath = "/internal/pricing" as Route;
const summaryPath = (id: string) => `/internal/pricing/scenarios/${id}/summary`;

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

/** The entry a save sends, to tell whether the form has changed since. */
const entryOf = (
  name: string,
  company: string,
  notes: string,
  lines: readonly DraftLine[],
) =>
  JSON.stringify([
    name,
    company,
    notes,
    lines.map((line) => [
      line.bookId,
      line.rateId,
      line.quantity.trim(),
      line.termMonths,
      line.discount,
    ]),
  ]);

/** A price, or null where the entry cannot be priced. */
function attempt<T, R>(price: (input: T) => R, input: T | null): R | null {
  if (input === null) return null;
  try {
    return price(input);
  } catch {
    return null;
  }
}

/** Which of a line's numbers cannot be priced, field by field. */
function lineProblems(line: DraftLine) {
  const term = Number(line.termMonths);
  return {
    quantity:
      !/^\d+(\.\d{1,6})?$/u.test(line.quantity.trim()) ||
      Number(line.quantity) <= 0,
    termMonths:
      !/^\d+$/u.test(line.termMonths.trim()) || term < 1 || term > 120,
    discount: discountBps(line.discount) === null,
  };
}

/**
 * The pricing builder: line 1 is the calculator, more lines make a scenario
 * for one prospect, and the total carries the save and the summary PDF. It
 * prices in the browser from list prices only. A save sends only the book,
 * rate and entry for each line; the server prices them again.
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
  const ready = state.kind === "ready" ? state : null;
  const opened = ready?.opened ?? null;
  const [id] = useState(() => opened?.id ?? crypto.randomUUID());
  const [name, setName] = useState(opened?.name ?? "");
  const [company, setCompany] = useState(opened?.company ?? "");
  const [notes, setNotes] = useState(opened?.notes ?? "");
  const [lines, setLines] = useState(() =>
    opened ? openedLines(opened, books) : [newLine(books[0])],
  );
  const [savedEntry] = useState(() => entryOf(name, company, notes, lines));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const currency = books.find(
    ({ id: bookId }) => bookId === lines[0]?.bookId,
  )?.currency;
  const money = (value: { currency: string; minor: string }) =>
    bookMoney(value, locale);
  const priced = lines.map((line) => {
    const book = books.find(({ id: bookId }) => bookId === line.bookId);
    const rate = book?.rates.find(({ id: r }) => r === line.rateId);
    const problems = lineProblems(line);
    const valid =
      !problems.quantity && !problems.termMonths && !problems.discount;
    const entry =
      rate && valid
        ? {
            unitPrice: rate.unitPrice as Money,
            minimumQuantity: rate.minimumQuantity,
            quantity: line.quantity.trim(),
            termMonths: Number(line.termMonths),
            discountBps: discountBps(line.discount) ?? 0,
          }
        : null;
    return {
      book,
      rate,
      problems,
      entry,
      price: attempt(indicativeLinePrice, entry),
    };
  });
  const entries = priced.flatMap(({ entry }) => (entry ? [entry] : []));
  const totals =
    entries.length === lines.length
      ? attempt(indicativeScenarioPrice, entries)
      : null;
  const belowMinimum = priced.some(({ price }) => price?.belowMinimum);
  const savedTotal = opened
    ? indicativeScenarioPrice(opened.lines).total
    : null;
  const unchanged = entryOf(name, company, notes, lines) === savedEntry;
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
  const firstBook = books.find(({ id: bookId }) => bookId === lines[0]?.bookId);

  return (
    <div className={styles.workspace}>
      {opened ? (
        <h2 className={styles.editing}>
          {t("operations.sales.pricing.scenario.editing", {
            name: opened.name,
          })}
        </h2>
      ) : null}
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
      <p className={styles.source} role="note">
        {opened
          ? t("operations.sales.pricing.scenario.asOf", {
              date: formatContractDate(opened.asOf, locale),
            })
          : t("operations.sales.pricing.source.active", {
              date: firstBook?.effectiveLabel ?? "",
            })}
      </p>
      <form className={styles.builder} onSubmit={(event) => void save(event)}>
        {lines.map((line, index) => {
          const { book, rate, problems, price } = priced[index] ?? {};
          const offered = index
            ? books.filter((candidate) => candidate.currency === currency)
            : books;
          const number = String(index + 1);
          const unit = capacityUnit(rate?.unit ?? "TB-month");
          return (
            <fieldset className={styles.line} key={line.key}>
              <legend>
                {t("operations.sales.pricing.scenario.line", { number })}
              </legend>
              <div className={styles.lineFields}>
                {offered.length > 1 ? (
                  <Select
                    label={t("operations.sales.pricing.book")}
                    fieldClassName={styles.wide ?? ""}
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
                      label: bookLabel(candidate, t),
                    }))}
                  />
                ) : null}
                <Select
                  label={t("operations.sales.pricing.rate")}
                  fieldClassName={styles.wide ?? ""}
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
                        product: productName(candidate.sku, t),
                        region: regionName(candidate.region, t),
                        price: money(candidate.unitPrice),
                        unit: capacityUnit(candidate.unit),
                      }),
                    })),
                  ]}
                />
                <Input
                  label={t("operations.sales.pricing.capacity", { unit })}
                  inputMode="decimal"
                  required
                  pattern="[0-9]+(?:\.[0-9]{1,6})?"
                  value={line.quantity}
                  {...(rate
                    ? {
                        help: t("operations.sales.pricing.minimum", {
                          minimum: formatQuantity(rate.minimumQuantity, locale),
                          unit,
                        }),
                      }
                    : {})}
                  error={
                    problems?.quantity
                      ? t("operations.sales.pricing.error.capacity")
                      : rate && price?.belowMinimum
                        ? t("operations.sales.pricing.belowMinimum", {
                            minimum: formatQuantity(
                              rate.minimumQuantity,
                              locale,
                            ),
                            unit,
                          })
                        : undefined
                  }
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
                  error={
                    problems?.termMonths
                      ? t("operations.sales.pricing.error.term")
                      : undefined
                  }
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
                  {...(index === 0
                    ? { help: t("operations.sales.pricing.discountHelp") }
                    : {})}
                  error={
                    problems?.discount
                      ? t("operations.sales.pricing.error.discount")
                      : undefined
                  }
                  onChange={(event) =>
                    update(line.key, { discount: event.target.value })
                  }
                />
              </div>
              {line.gone && !line.rateId ? (
                <p className={styles.warning} role="note">
                  {t("operations.sales.pricing.scenario.lineStale", {
                    product: productName(line.gone.sku, t),
                    region: regionName(line.gone.region, t),
                  })}
                </p>
              ) : null}
              {rate && price ? (
                <dl className={styles.lineFigures}>
                  <div>
                    <dt>{t("operations.sales.pricing.result.monthly")}</dt>
                    <dd>{money(price.monthly)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t("operations.sales.pricing.result.total", {
                        months: line.termMonths.trim(),
                      })}
                    </dt>
                    <dd>{money(price.total)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t("operations.sales.pricing.result.unit", { unit })}
                    </dt>
                    <dd>{money(price.unitPrice)}</dd>
                  </div>
                  <div>
                    <dt>{t("operations.sales.pricing.result.overage")}</dt>
                    <dd>
                      {t("operations.sales.pricing.perUnitMonth", {
                        price: money(rate.overageRate),
                        unit,
                      })}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {lines.length > 1 ? (
                <Button
                  variant="quiet"
                  size="small"
                  className={styles.removeLine ?? ""}
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
        <div className={styles.addLine}>
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
        </div>
        <div className={styles.totals}>
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
                {savedTotal &&
                (savedTotal.minor !== totals.total.minor ||
                  savedTotal.currency !== totals.total.currency) ? (
                  <div>
                    <dt>{t("operations.sales.pricing.scenario.savedTotal")}</dt>
                    <dd>{money(savedTotal)}</dd>
                  </div>
                ) : null}
                <div className={styles.total}>
                  <dt>{t("operations.sales.pricing.scenario.total")}</dt>
                  <dd>{money(totals.total)}</dd>
                </div>
              </dl>
            ) : (
              <p>{t("operations.sales.pricing.invalid")}</p>
            )}
          </div>
          <p className={styles.caveat}>
            {t("operations.sales.pricing.caveat")}
          </p>
          {ready ? (
            <fieldset className={styles.saveFields}>
              <legend>{t("operations.sales.pricing.scenario.details")}</legend>
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
                fieldClassName={styles.wide ?? ""}
                value={notes}
                maxLength={2000}
                rows={2}
                error={fieldError("notes")}
                onChange={(event) => setNotes(event.target.value)}
              />
            </fieldset>
          ) : (
            <InlineNotice
              tone={state.kind === "error" ? "danger" : "info"}
              title={t(
                closedNotices[
                  state.kind === "ready" ? "unavailable" : state.kind
                ],
              )}
            />
          )}
          {ready ? (
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
              {opened && unchanged ? (
                <a
                  className={buttonClassName({ variant: "secondary" })}
                  href={summaryPath(opened.id)}
                  download
                >
                  {t("operations.sales.pricing.scenario.download")}
                </a>
              ) : (
                <Button
                  variant="secondary"
                  disabled
                  aria-describedby="summary-download-hint"
                >
                  {t("operations.sales.pricing.scenario.download")}
                </Button>
              )}
              {opened ? (
                <Link
                  className={buttonClassName({ variant: "quiet" })}
                  href={pricingPath}
                >
                  {t("operations.sales.pricing.scenario.startNew")}
                </Link>
              ) : null}
              {opened && unchanged ? null : (
                <p className={styles.hint} id="summary-download-hint">
                  {t(
                    opened
                      ? "operations.sales.pricing.scenario.downloadAfterChanges"
                      : "operations.sales.pricing.scenario.downloadAfterSave",
                  )}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </form>
      {ready ? (
        <section className={styles.saved} aria-labelledby="saved-scenarios">
          <h2 id="saved-scenarios">
            {t(
              ready.seesAll
                ? "operations.sales.pricing.scenario.listAll"
                : "operations.sales.pricing.scenario.listMine",
            )}
          </h2>
          {ready.scenarios.length === 0 ? (
            <p>{t("operations.sales.pricing.scenario.empty")}</p>
          ) : (
            <ul className={styles.savedList}>
              {ready.scenarios.map((scenario) => (
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
                    {ready.seesAll ? (
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
                        { name: scenario.name },
                      )}
                    >
                      {t("operations.sales.pricing.scenario.open")}
                    </Link>
                    <a
                      className={buttonClassName({
                        variant: "secondary",
                        size: "small",
                      })}
                      href={summaryPath(scenario.id)}
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
      ) : null}
    </div>
  );
}
