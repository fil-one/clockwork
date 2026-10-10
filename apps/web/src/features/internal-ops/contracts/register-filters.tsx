"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  contractRenewalWindows,
  contractStatusFilterExtras,
  contractStatuses,
  contractTypes,
  type ContractListQuery,
} from "@clockwork/contracts";
import {
  Checkbox,
  Input,
  Select,
  SlidersHorizontal,
  buttonClassName,
} from "@clockwork/ui";
import { useTranslations } from "@/src/i18n/client";
import {
  contractStatusLabels,
  contractTypeLabels,
  statusFilterExtraLabels,
} from "./copy";
import { registerHref } from "./register-href";
import styles from "./contracts.module.css";

type FilterQuery = Pick<
  ContractListQuery,
  "q" | "type" | "status" | "window" | "mine" | "sort" | "direction"
>;

interface Values {
  q: string;
  type: string;
  status: string;
  window: string;
  mine: boolean;
}

const valuesOf = (query: FilterQuery): Values => ({
  q: query.q,
  type: query.type ?? "",
  status: query.status ?? "",
  window: query.window ? String(query.window) : "",
  mine: query.mine,
});

/** How long typing pauses before the search runs. */
const searchDelay = 400;

/**
 * The register filters. Each change applies at once, as on the other
 * registers; the search runs when typing pauses or on Enter. Below 40rem the
 * fields fold behind one "Filters" button that counts the active ones.
 */
export function RegisterFilters({ query }: { query: FilterQuery }) {
  const t = useTranslations();
  const router = useRouter();
  const fieldsId = useId();
  const statusId = `${fieldsId}-status`;
  const incoming = valuesOf(query);
  const incomingKey = JSON.stringify(incoming);
  const [values, setValues] = useState(incoming);
  const [synced, setSynced] = useState(incomingKey);
  const [sentSearch, setSentSearch] = useState(incoming.q);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the URL when it changes from elsewhere (Clear filters, back), but
  // keep a search the reader is still typing when the URL only echoes it.
  if (synced !== incomingKey) {
    setSynced(incomingKey);
    setValues({
      ...incoming,
      q: incoming.q === sentSearch ? values.q : incoming.q,
    });
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function apply(next: Values) {
    if (timer.current) clearTimeout(timer.current);
    const q = next.q.trim();
    setSentSearch(q);
    router.replace(
      registerHref({
        q,
        type: (next.type || undefined) as FilterQuery["type"],
        status: (next.status || undefined) as FilterQuery["status"],
        window: (next.window
          ? Number(next.window)
          : undefined) as FilterQuery["window"],
        mine: next.mine,
        sort: query.sort,
        ...(query.direction ? { direction: query.direction } : {}),
      }),
      { scroll: false },
    );
  }

  function change(patch: Partial<Values>) {
    const next = { ...values, ...patch };
    setValues(next);
    apply(next);
  }

  function search(q: string) {
    const next = { ...values, q };
    setValues(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), searchDelay);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(values);
  }

  const active = [
    incoming.q,
    incoming.type,
    incoming.status,
    incoming.window,
    incoming.mine,
  ].filter(Boolean).length;

  return (
    <form
      className={`${styles.card} ${styles.filterForm}`}
      onSubmit={submit}
      role="search"
      aria-label={t("operations.contracts.filters.label")}
    >
      <button
        type="button"
        className={`${buttonClassName({ variant: "secondary" })} ${styles.filterToggle}`}
        aria-expanded={open}
        aria-controls={fieldsId}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {active
          ? t("operations.contracts.filters.toggle", { count: active })
          : t("operations.contracts.filters.toggleNone")}
      </button>
      <div
        className={`${styles.filters} ${styles.filterFields}`}
        id={fieldsId}
        data-open={open ? "true" : undefined}
      >
        <Input
          type="search"
          name="q"
          label={t("operations.contracts.filters.search")}
          placeholder={t("operations.contracts.filters.searchPlaceholder")}
          value={values.q}
          onChange={(event) => search(event.currentTarget.value)}
          maxLength={100}
        />
        <Select
          name="type"
          label={t("operations.contracts.field.type")}
          value={values.type}
          onChange={(event) => change({ type: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.contracts.filters.allTypes") },
            ...contractTypes.map((type) => ({
              value: type,
              label: t(contractTypeLabels[type]),
            })),
          ]}
        />
        {/* The kit's Select takes flat options; signing outcomes need a group. */}
        <div className="cw-field">
          <label className="cw-field__label" htmlFor={statusId}>
            <span>{t("operations.contracts.field.status")}</span>
          </label>
          <select
            className="cw-select"
            id={statusId}
            name="status"
            value={values.status}
            onChange={(event) => change({ status: event.currentTarget.value })}
          >
            <option value="">
              {t("operations.contracts.filters.allStatuses")}
            </option>
            {contractStatuses.map((status) => (
              <option key={status} value={status}>
                {t(contractStatusLabels[status])}
              </option>
            ))}
            <optgroup label={t("operations.contracts.filters.signingGroup")}>
              {contractStatusFilterExtras.map((status) => (
                <option key={status} value={status}>
                  {t(statusFilterExtraLabels[status])}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <Select
          name="window"
          label={t("operations.contracts.column.renewsOrEnds")}
          value={values.window}
          onChange={(event) => change({ window: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.contracts.filters.anyDate") },
            ...contractRenewalWindows.map((days) => ({
              value: String(days),
              label: t("operations.contracts.filters.within", { count: days }),
            })),
          ]}
        />
        <div className={styles.filterActions}>
          <Checkbox
            name="mine"
            value="1"
            label={t("operations.contracts.filters.recordedByMe")}
            checked={values.mine}
            onChange={(event) => change({ mine: event.currentTarget.checked })}
          />
          {active ? (
            <Link
              className={buttonClassName({ variant: "quiet" })}
              href="/internal/contracts"
              scroll={false}
            >
              {t("operations.contracts.filters.clear")}
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}
