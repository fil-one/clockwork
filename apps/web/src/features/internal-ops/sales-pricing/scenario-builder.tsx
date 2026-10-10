"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  pricingCapacityUnits,
  pricingScenarioLineLimit,
  type Money,
  type PricingScenarioRecord,
} from "@clockwork/contracts";
import {
  convertCapacity,
  indicativeLinePrice,
  indicativeScenarioPrice,
  scenarioPartnerEconomics,
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
import {
  PartnerEconomicsPanel,
  parsePartnerDraft,
  partnerDraftOf,
  type PartnerDraft,
} from "./partner-economics";
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
  /** The capacity unit `quantity` is typed in: the rate's own, or TB, PB, TiB or PiB. */
  unit: string;
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
  PRICING_SCENARIO_UNIT_UNSUPPORTED:
    "operations.sales.pricing.scenario.error.unit",
  PARTNER_INPUTS_INVALID: "operations.sales.pricing.partner.error.save",
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
const summaryPath = (id: string, audience?: "partner") =>
  `/internal/pricing/scenarios/${id}/summary${audience ? "?audience=partner" : ""}`;

/** The units a seller may type a rate's capacity in: any of the four for a
 * decimal TB rate, otherwise only the rate's own. */
const unitsFor = (rateUnit: string): readonly string[] =>
  rateUnit === "TB" ? pricingCapacityUnits : [rateUnit];

function newLine(book: IndicativePriceBook | undefined): DraftLine {
  return {
    key: crypto.randomUUID(),
    bookId: book?.id ?? "",
    rateId: book?.rates[0]?.id ?? "",
    quantity: "100",
    unit: capacityUnit(book?.rates[0]?.unit ?? "TB-month"),
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
      quantity: line.entered?.quantity ?? line.quantity,
      unit: line.entered?.unit ?? capacityUnit(line.unit),
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
  partner: PartnerDraft,
) =>
  JSON.stringify([
    name,
    company,
    notes,
    lines.map((line) => [
      line.bookId,
      line.rateId,
      line.quantity.trim(),
      line.unit,
      line.termMonths,
      line.discount,
    ]),
    JSON.stringify(parsePartnerDraft(partner)),
  ]);

/** A converted quantity for display: whole units from 1,000 up, else three
 * decimals, and whether the figure shown is exact. */
function formatRounded(value: string, locale: string) {
  const digits = Number(value) >= 1_000 ? 0 : 3;
  const [, fraction = ""] = value.split(".");
  return {
    text: new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
    }).format(value as Intl.StringNumericLiteral),
    exact: fraction.replace(/0+$/u, "").length <= digits,
  };
}

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
  const demo = state.kind === "demo" ? state : null;
  const opened = ready?.opened ?? demo?.opened ?? null;
  const [id] = useState(() => opened?.id ?? crypto.randomUUID());
  const [name, setName] = useState(opened?.name ?? "");
  const [company, setCompany] = useState(opened?.company ?? "");
  const [notes, setNotes] = useState(opened?.notes ?? "");
  const [lines, setLines] = useState(() =>
    opened ? openedLines(opened, books) : [newLine(books[0])],
  );
  const [partner, setPartner] = useState(() =>
    partnerDraftOf(opened?.partnerEconomics ?? null),
  );
  const [partnerAttempted, setPartnerAttempted] = useState(false);
  const [savedEntry] = useState(() =>
    entryOf(name, company, notes, lines, partner),
  );
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
    const rateUnit = capacityUnit(rate?.unit ?? "TB-month");
    // The capacity in the rate's unit, exactly, or null if it cannot be.
    const quantity =
      rate && valid
        ? attempt(
            (entered: string) => convertCapacity(entered, line.unit, rateUnit),
            line.quantity.trim(),
          )
        : null;
    const entry =
      rate && quantity
        ? {
            unitPrice: rate.unitPrice as Money,
            minimumQuantity: rate.minimumQuantity,
            quantity,
            termMonths: Number(line.termMonths),
            discountBps: discountBps(line.discount) ?? 0,
          }
        : null;
    return {
      book,
      rate,
      rateUnit,
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
  const partnerParsed = parsePartnerDraft(partner);
  const sharedUnit = priced.every(
    ({ rate }) => rate && rate.unit === priced[0]?.rate?.unit,
  )
    ? capacityUnit(priced[0]?.rate?.unit ?? "TB-month")
    : null;
  const partnerResult =
    totals && sharedUnit && partnerParsed.ok && partnerParsed.economics
      ? attempt(
          (economics: NonNullable<typeof partnerParsed.economics>) =>
            scenarioPartnerEconomics(entries, economics),
          partnerParsed.economics,
        )
      : null;
  const percentFormat = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  });
  const percent = (bps: number) => percentFormat.format(bps / 10_000);
  const savedTotal = opened
    ? indicativeScenarioPrice(opened.lines).total
    : null;
  const unchanged =
    entryOf(name, company, notes, lines, partner) === savedEntry;
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
    if (!partnerParsed.ok) {
      setBusy(false);
      setPartnerAttempted(true);
      setError("PARTNER_INPUTS_INVALID");
      return;
    }
    const result = await saveScenario({
      id,
      name,
      company,
      notes,
      lines: lines.map((line) => ({
        bookId: line.bookId,
        rateId: line.rateId,
        quantity: line.quantity.trim(),
        // Only an entry in another unit says so; the server converts it.
        ...(line.unit ===
        capacityUnit(
          priced.find(({ rate }) => rate?.id === line.rateId)?.rate?.unit ??
            "TB-month",
        )
          ? {}
          : { quantityUnit: line.unit }),
        termMonths: Number(line.termMonths),
        discountBps: discountBps(line.discount) ?? -1,
      })),
      partnerEconomics: partnerParsed.economics,
      ...(ready?.opened ? { expectedVersion: ready.opened.version } : {}),
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
      {ready?.opened ? (
        <h2 className={styles.editing}>
          {t("operations.sales.pricing.scenario.editing", {
            name: ready.opened.name,
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
        {ready?.opened
          ? t("operations.sales.pricing.scenario.asOf", {
              date: formatContractDate(ready.opened.asOf, locale),
            })
          : t("operations.sales.pricing.source.active", {
              date: firstBook?.effectiveLabel ?? "",
            })}
      </p>
      <form className={styles.builder} onSubmit={(event) => void save(event)}>
        {lines.map((line, index) => {
          const { book, rate, rateUnit, problems, entry, price } =
            priced[index] ?? {};
          const offered = index
            ? books.filter((candidate) => candidate.currency === currency)
            : books;
          const number = String(index + 1);
          const unit = rateUnit ?? "TB";
          const units = unitsFor(unit);
          const conversion =
            entry && line.unit !== unit
              ? (() => {
                  const shown = formatRounded(entry.quantity, locale);
                  return t(
                    shown.exact
                      ? "operations.sales.pricing.conversion.exact"
                      : "operations.sales.pricing.conversion.approx",
                    {
                      entered: `${formatQuantity(line.quantity.trim(), locale)} ${line.unit}`,
                      converted: `${shown.text} ${unit}`,
                    },
                  );
                })()
              : null;
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
                      // Keep the typed unit if the new rate offers it.
                      const nextUnit = capacityUnit(
                        next?.rates[0]?.unit ?? "TB-month",
                      );
                      const unitFor = (typed: string) =>
                        unitsFor(nextUnit).includes(typed)
                          ? {}
                          : { unit: nextUnit };
                      if (index === 0 && next?.currency !== currency)
                        setLines((current) =>
                          current.map((other) => ({
                            ...other,
                            bookId: next?.id ?? "",
                            rateId,
                            ...unitFor(other.unit),
                          })),
                        );
                      else
                        update(line.key, {
                          bookId: next?.id ?? "",
                          rateId,
                          ...unitFor(line.unit),
                        });
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
                  onChange={(event) => {
                    const next = book?.rates.find(
                      ({ id: r }) => r === event.target.value,
                    );
                    const nextUnit = capacityUnit(next?.unit ?? "TB-month");
                    update(line.key, {
                      rateId: event.target.value,
                      ...(unitsFor(nextUnit).includes(line.unit)
                        ? {}
                        : { unit: nextUnit }),
                    });
                  }}
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
                <div className={styles.capacity}>
                  <Input
                    label={t("operations.sales.pricing.capacity", {
                      unit: line.unit,
                    })}
                    inputMode="decimal"
                    required
                    pattern="[0-9]+(?:\.[0-9]{1,6})?"
                    value={line.quantity}
                    {...(rate
                      ? {
                          help: [
                            conversion,
                            t("operations.sales.pricing.minimum", {
                              minimum: formatQuantity(
                                rate.minimumQuantity,
                                locale,
                              ),
                              unit,
                            }),
                          ]
                            .filter(Boolean)
                            .join(" "),
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
                  {units.length > 1 ? (
                    <Select
                      label={t("operations.sales.pricing.capacityUnit")}
                      value={line.unit}
                      onChange={(event) =>
                        update(line.key, { unit: event.target.value })
                      }
                      options={units.map((option) => ({
                        value: option,
                        label: option,
                      }))}
                    />
                  ) : null}
                </div>
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
                    <dt>{t("operations.sales.pricing.result.annual")}</dt>
                    <dd>{money(price.annual)}</dd>
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
                  <dt>{t("operations.sales.pricing.scenario.monthly")}</dt>
                  <dd>{money(totals.monthly)}</dd>
                </div>
                <div>
                  <dt>{t("operations.sales.pricing.scenario.annual")}</dt>
                  <dd>{money(totals.annual)}</dd>
                </div>
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
          <PartnerEconomicsPanel
            draft={partner}
            onChange={setPartner}
            problems={partnerParsed.ok ? {} : partnerParsed.problems}
            showEmpty={partnerAttempted}
            result={partnerResult}
            unit={sharedUnit}
            money={money}
            percent={percent}
            t={t}
          />
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
                <>
                  <a
                    className={buttonClassName({ variant: "secondary" })}
                    href={summaryPath(opened.id)}
                    download
                  >
                    {t("operations.sales.pricing.scenario.download")}
                  </a>
                  {opened.partnerEconomics ? (
                    <a
                      className={buttonClassName({ variant: "secondary" })}
                      href={summaryPath(opened.id, "partner")}
                      download
                    >
                      {t("operations.sales.pricing.scenario.downloadPartner")}
                    </a>
                  ) : null}
                </>
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
              <p className={styles.hint} id="summary-download-hint">
                {opened && unchanged
                  ? t("operations.sales.pricing.scenario.downloadHelp")
                  : t(
                      opened
                        ? "operations.sales.pricing.scenario.downloadAfterChanges"
                        : "operations.sales.pricing.scenario.downloadAfterSave",
                    )}
              </p>
            </div>
          ) : null}
        </div>
      </form>
      {demo && demo.examples.length ? (
        <section className={styles.saved} aria-labelledby="example-scenarios">
          <h2 id="example-scenarios">
            {t("operations.sales.pricing.scenario.examples")}
          </h2>
          <p>{t("operations.sales.pricing.scenario.examplesHelp")}</p>
          <ul className={styles.savedList}>
            {demo.examples.map((example) => (
              <li key={example.id}>
                <div>
                  <strong>{example.name}</strong>
                  <span>
                    {t("operations.sales.pricing.scenario.summary", {
                      company: example.company,
                      date: formatContractDate(example.asOf, locale),
                      total: money(
                        indicativeScenarioPrice(example.lines).total,
                      ),
                    })}
                  </span>
                </div>
                <div className={styles.savedActions}>
                  <Link
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={`${pricingPath}?scenario=${example.id}` as Route}
                    aria-label={t(
                      "operations.sales.pricing.scenario.openNamed",
                      { name: example.name },
                    )}
                  >
                    {t("operations.sales.pricing.scenario.open")}
                  </Link>
                  <a
                    className={buttonClassName({
                      variant: "secondary",
                      size: "small",
                    })}
                    href={summaryPath(example.id)}
                    download
                    aria-label={t(
                      "operations.sales.pricing.scenario.downloadNamed",
                      { name: example.name },
                    )}
                  >
                    {t("operations.contracts.documents.download")}
                  </a>
                  {example.partnerEconomics ? (
                    <a
                      className={buttonClassName({
                        variant: "secondary",
                        size: "small",
                      })}
                      href={summaryPath(example.id, "partner")}
                      download
                      aria-label={t(
                        "operations.sales.pricing.scenario.downloadPartnerNamed",
                        { name: example.name },
                      )}
                    >
                      {t("operations.sales.pricing.scenario.partnerSummary")}
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
