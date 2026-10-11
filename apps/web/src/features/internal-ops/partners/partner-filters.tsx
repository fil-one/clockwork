"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import {
  partnerModels,
  partnerStatuses,
  type PartnerListQuery,
  type PartnerOwnerOption,
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
  partnerListHref,
  partnerModelLabels,
  partnerStatusLabels,
  partnersPath,
} from "./model";
import styles from "./partners.module.css";

interface Values {
  q: string;
  status: string;
  model: string;
  owner: string;
  due: string;
  mine: boolean;
}

const valuesOf = (query: PartnerListQuery): Values => ({
  q: query.q,
  status: query.status ?? "",
  model: query.model ?? "",
  owner: query.owner ?? "",
  due: query.due ?? "",
  mine: query.mine,
});

/** How long typing pauses before the search runs. */
const searchDelay = 400;

/**
 * The list filters, applied as they change; the search runs when typing
 * pauses or on Enter. Below 40rem the fields fold behind one button.
 */
export function PartnerFilters({
  query,
  owners,
}: {
  query: PartnerListQuery;
  owners: readonly PartnerOwnerOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const fieldsId = useId();
  const incoming = valuesOf(query);
  const incomingKey = JSON.stringify(incoming);
  const [values, setValues] = useState(incoming);
  const [synced, setSynced] = useState(incomingKey);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the URL when it changes from elsewhere (Clear filters, back).
  if (synced !== incomingKey) {
    setSynced(incomingKey);
    setValues({
      ...incoming,
      q: values.q.trim() === incoming.q ? values.q : incoming.q,
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
    router.replace(
      partnerListHref({
        q: next.q.trim(),
        ...(next.status
          ? { status: next.status as PartnerListQuery["status"] }
          : {}),
        ...(next.model
          ? { model: next.model as PartnerListQuery["model"] }
          : {}),
        ...(next.owner ? { owner: next.owner } : {}),
        ...(next.due ? { due: next.due as PartnerListQuery["due"] } : {}),
        mine: next.mine,
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
    incoming.status,
    incoming.model,
    incoming.owner,
    incoming.due,
    incoming.mine,
  ].filter(Boolean).length;

  return (
    <form
      className={styles.filterForm}
      onSubmit={submit}
      role="search"
      aria-label={t("operations.partners.filters.label")}
    >
      <button
        type="button"
        className={`${buttonClassName({ variant: "secondary" })} ${styles.filterToggle}`}
        aria-expanded={open}
        aria-controls={fieldsId}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal aria-hidden="true" />
        {t("operations.partners.filters.label")}
      </button>
      <div
        className={`${styles.filters} ${styles.filterFields}`}
        id={fieldsId}
        data-open={open ? "true" : undefined}
      >
        <Input
          type="search"
          name="q"
          label={t("operations.partners.filters.search")}
          placeholder={t("operations.partners.filters.searchPlaceholder")}
          value={values.q}
          onChange={(event) => search(event.currentTarget.value)}
          maxLength={100}
        />
        <Select
          name="status"
          label={t("operations.partners.field.status")}
          value={values.status}
          onChange={(event) => change({ status: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.partners.filters.allStatuses") },
            ...partnerStatuses.map((status) => ({
              value: status,
              label: t(partnerStatusLabels[status]),
            })),
          ]}
        />
        <Select
          name="model"
          label={t("operations.partners.column.models")}
          value={values.model}
          onChange={(event) => change({ model: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.partners.filters.allModels") },
            ...partnerModels.map((model) => ({
              value: model,
              label: t(partnerModelLabels[model]),
            })),
          ]}
        />
        <Select
          name="owner"
          label={t("operations.partners.field.owner")}
          value={values.owner}
          onChange={(event) => change({ owner: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.partners.filters.anyOwner") },
            ...owners.map((owner) => ({ value: owner.id, label: owner.name })),
          ]}
        />
        <Select
          name="due"
          label={t("operations.partners.field.nextStepDue")}
          value={values.due}
          onChange={(event) => change({ due: event.currentTarget.value })}
          options={[
            { value: "", label: t("operations.partners.filters.anyDue") },
            {
              value: "overdue",
              label: t("operations.partners.filters.overdue"),
            },
            { value: "week", label: t("operations.partners.filters.week") },
          ]}
        />
        <div className={styles.filterActions}>
          <Checkbox
            name="mine"
            value="1"
            label={t("operations.partners.filters.mine")}
            checked={values.mine}
            onChange={(event) => change({ mine: event.currentTarget.checked })}
          />
          {active ? (
            <Link
              className={buttonClassName({ variant: "quiet" })}
              href={partnersPath}
              scroll={false}
            >
              {t("operations.partners.filters.clear")}
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}
