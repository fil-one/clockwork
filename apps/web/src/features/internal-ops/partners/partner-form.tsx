"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import {
  partnerContactLimit,
  partnerCurrencies,
  partnerExclusivity,
  partnerModels,
  partnerStatuses,
  partnerStepLimit,
  partnerTermRowLimit,
  type PartnerOrganizationOption,
  type PartnerOwnerOption,
  type PartnerRecord,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  Fieldset,
  Input,
  Select,
  StateBanner,
  Textarea,
  buttonClassName,
} from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { SessionExpiredReload } from "../session-expiry";
import { savePartner } from "./actions";
import {
  partnerErrorMessage,
  partnerExclusivityLabels,
  partnerFieldMessage,
  partnerHref,
  partnerModelLabels,
  partnerStatusLabels,
  partnersPath,
} from "./model";
import styles from "./partners.module.css";

const wide = styles.wide ?? "";

interface Row<T> {
  key: number;
  value: T;
}

let nextKey = 0;
const rowsOf = <T,>(values: readonly T[]): Row<T>[] =>
  values.map((value) => ({ key: (nextKey += 1), value }));

/**
 * The partner form, new or edit. Only the name is required; every term is
 * optional and free-form rows hold whatever the slots do not fit. An edit
 * carries the version it opened at, so a stale save is refused rather than
 * overwriting someone else's change.
 */
export function PartnerForm({
  partner,
  owners,
  organizations,
  viewer,
}: {
  partner: PartnerRecord | null;
  owners: readonly PartnerOwnerOption[];
  organizations: readonly PartnerOrganizationOption[];
  viewer: PartnerOwnerOption;
}) {
  const t = useTranslations();
  const router = useRouter();
  const id = useRef(partner?.id ?? null);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState(() =>
    rowsOf(partner?.contacts ?? []),
  );
  const [steps, setSteps] = useState(() =>
    rowsOf(
      (partner?.terms.commissionSteps ?? []).map((step) => ({
        fromMonth: String(step.fromMonth),
        ratePct: step.ratePct,
      })),
    ),
  );
  const [termRows, setTermRows] = useState(() =>
    rowsOf(partner?.terms.rows ?? []),
  );
  const error = (path: string) =>
    fields[path] ? t(partnerFieldMessage(fields[path])) : undefined;
  const optional = t("operations.partners.field.optional");
  // An owner who has since left the sales workspace stays selectable.
  const ownerOptions =
    partner?.ownerId && !owners.some((owner) => owner.id === partner.ownerId)
      ? [...owners, { id: partner.ownerId, name: partner.ownerName ?? "" }]
      : owners;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    id.current ??= crypto.randomUUID();
    const input = {
      id: id.current,
      ...(partner ? { expectedVersion: partner.version } : {}),
      name: text("name"),
      website: text("website"),
      region: text("region"),
      models: data.getAll("models").map(String),
      status: text("status"),
      ownerId: text("ownerId"),
      organizationId: text("organizationId"),
      contacts: contacts.map(({ value }) => value),
      nextStep: text("nextStep"),
      nextStepDue: text("nextStepDue"),
      notes: text("notes"),
      terms: {
        commissionPct: text("commissionPct"),
        commissionSchedule: text("commissionSchedule"),
        commissionSteps: steps.map(({ value }) => value),
        marginPct: text("marginPct"),
        territory: text("territory"),
        exclusivity: text("exclusivity"),
        exclusivityNote: text("exclusivityNote"),
        currency: text("currency"),
        nfrAllowance: text("nfrAllowance"),
        trialPeriod: text("trialPeriod"),
        trialTargets: text("trialTargets"),
        rows: termRows.map(({ value }) => value),
      },
    };
    setFailure(null);
    setFields({});
    startTransition(async () => {
      const result = await savePartner(input).catch(() => ({
        ok: false as const,
        code: "UNEXPECTED",
      }));
      if (result.ok) {
        router.push(partnerHref(result.value.id));
        router.refresh();
        return;
      }
      setFields("fields" in result && result.fields ? result.fields : {});
      setFailure(result.code);
    });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {failure ? (
        <div role="alert">
          <StateBanner
            tone="danger"
            title={t(partnerErrorMessage(failure))}
            {...(failure === "SESSION_EXPIRED"
              ? {
                  action: (
                    <SessionExpiredReload onReloaded={() => setFailure(null)} />
                  ),
                }
              : {})}
          />
        </div>
      ) : null}

      <section className={styles.card} aria-labelledby="partner-form-basics">
        <h2 id="partner-form-basics">{t("operations.partners.form.basics")}</h2>
        <div className={styles.fields}>
          <Input
            fieldClassName={wide}
            label={t("operations.partners.field.name")}
            name="name"
            defaultValue={partner?.name ?? ""}
            maxLength={200}
            required
            autoComplete="off"
            error={error("name")}
          />
          <Input
            label={t("operations.partners.field.website")}
            optionalLabel={optional}
            name="website"
            type="url"
            defaultValue={partner?.website ?? ""}
            maxLength={500}
            error={error("website")}
          />
          <Input
            label={t("operations.partners.field.region")}
            help={t("operations.partners.field.regionHelp")}
            optionalLabel={optional}
            name="region"
            defaultValue={partner?.region ?? ""}
            maxLength={500}
            error={error("region")}
          />
          <Select
            label={t("operations.partners.field.status")}
            name="status"
            defaultValue={partner?.status ?? "prospect"}
            options={partnerStatuses.map((status) => ({
              value: status,
              label: t(partnerStatusLabels[status]),
            }))}
          />
          <Select
            label={t("operations.partners.field.owner")}
            optionalLabel={optional}
            name="ownerId"
            defaultValue={partner ? (partner.ownerId ?? "") : viewer.id}
            error={error("ownerId")}
            options={[
              { value: "", label: t("operations.partners.unowned") },
              ...ownerOptions.map((owner) => ({
                value: owner.id,
                label: owner.name,
              })),
            ]}
          />
          <Select
            label={t("operations.partners.field.organization")}
            help={t("operations.partners.field.organizationHelp")}
            optionalLabel={optional}
            name="organizationId"
            defaultValue={partner?.organizationId ?? ""}
            error={error("organizationId")}
            options={[
              {
                value: "",
                label: t("operations.partners.field.organizationNone"),
              },
              ...organizations.map((organization) => ({
                value: organization.id,
                label: organization.name,
              })),
            ]}
          />
          <fieldset className={`${styles.checkGroup} ${wide}`}>
            <legend>{t("operations.partners.field.models")}</legend>
            {partnerModels.map((model) => (
              <Checkbox
                key={model}
                name="models"
                value={model}
                label={t(partnerModelLabels[model])}
                defaultChecked={partner?.models.includes(model) ?? false}
              />
            ))}
          </fieldset>
          <Input
            fieldClassName={wide}
            label={t("operations.partners.field.nextStep")}
            optionalLabel={optional}
            name="nextStep"
            defaultValue={partner?.nextStep ?? ""}
            maxLength={500}
            error={error("nextStep")}
          />
          <Input
            label={t("operations.partners.field.nextStepDue")}
            optionalLabel={optional}
            name="nextStepDue"
            type="date"
            defaultValue={partner?.nextStepDue ?? ""}
            error={error("nextStepDue")}
          />
        </div>
      </section>

      <section className={styles.card} aria-labelledby="partner-form-contacts">
        <h2 id="partner-form-contacts">
          {t("operations.partners.contacts.title")}
        </h2>
        <ul className={styles.repeat}>
          {contacts.map((row, index) => {
            const set = (patch: Partial<typeof row.value>) =>
              setContacts((all) =>
                all.map((item) =>
                  item.key === row.key
                    ? { ...item, value: { ...item.value, ...patch } }
                    : item,
                ),
              );
            return (
              <li className={styles.repeatRow} key={row.key}>
                <Input
                  label={t("operations.partners.contacts.name")}
                  value={row.value.name}
                  onChange={(event) => set({ name: event.currentTarget.value })}
                  maxLength={200}
                  error={error(`contacts.${index}.name`)}
                />
                <Input
                  label={t("operations.partners.contacts.email")}
                  optionalLabel={optional}
                  type="email"
                  value={row.value.email}
                  onChange={(event) =>
                    set({ email: event.currentTarget.value })
                  }
                  maxLength={320}
                  error={error(`contacts.${index}.email`)}
                />
                <Input
                  label={t("operations.partners.contacts.role")}
                  optionalLabel={optional}
                  value={row.value.role}
                  onChange={(event) => set({ role: event.currentTarget.value })}
                  maxLength={200}
                />
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() =>
                    setContacts((all) =>
                      all.filter((item) => item.key !== row.key),
                    )
                  }
                >
                  {t("operations.partners.contacts.remove", {
                    number: index + 1,
                  })}
                </Button>
              </li>
            );
          })}
        </ul>
        {contacts.length < partnerContactLimit ? (
          <div className={styles.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setContacts((all) => [
                  ...all,
                  ...rowsOf([{ name: "", email: "", role: "" }]),
                ])
              }
            >
              {t("operations.partners.contacts.add")}
            </Button>
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="partner-form-terms">
        <h2 id="partner-form-terms">{t("operations.partners.terms.title")}</h2>
        <p className={styles.muted}>
          {t("operations.partners.terms.description")}
        </p>
        <div className={styles.fields}>
          <Input
            label={t("operations.partners.terms.commissionPct")}
            help={t("operations.partners.terms.commissionPctHelp")}
            optionalLabel={optional}
            name="commissionPct"
            inputMode="decimal"
            defaultValue={partner?.terms.commissionPct ?? ""}
            maxLength={12}
            error={error("terms.commissionPct")}
          />
          <Input
            label={t("operations.partners.terms.marginPct")}
            optionalLabel={optional}
            name="marginPct"
            inputMode="decimal"
            defaultValue={partner?.terms.marginPct ?? ""}
            maxLength={12}
            error={error("terms.marginPct")}
          />
          <Select
            label={t("operations.partners.terms.currency")}
            optionalLabel={optional}
            name="currency"
            defaultValue={partner?.terms.currency ?? ""}
            options={[
              { value: "", label: t("operations.partners.notSet") },
              ...partnerCurrencies.map((currency) => ({
                value: currency,
                label: currency,
              })),
            ]}
          />
          <Input
            fieldClassName={wide}
            label={t("operations.partners.terms.commissionSchedule")}
            help={t("operations.partners.terms.commissionScheduleHelp")}
            optionalLabel={optional}
            name="commissionSchedule"
            defaultValue={partner?.terms.commissionSchedule ?? ""}
            maxLength={500}
            error={error("terms.commissionSchedule")}
          />
        </div>
        <Fieldset
          legend={t("operations.partners.terms.steps")}
          description={t("operations.partners.terms.stepsHelp")}
        >
          <ul className={styles.repeat}>
            {steps.map((row, index) => {
              const set = (patch: Partial<typeof row.value>) =>
                setSteps((all) =>
                  all.map((item) =>
                    item.key === row.key
                      ? { ...item, value: { ...item.value, ...patch } }
                      : item,
                  ),
                );
              return (
                <li className={styles.repeatRow} key={row.key}>
                  <Input
                    label={t("operations.partners.terms.stepFrom")}
                    inputMode="numeric"
                    value={row.value.fromMonth}
                    onChange={(event) =>
                      set({ fromMonth: event.currentTarget.value })
                    }
                    maxLength={3}
                    error={
                      error(`terms.commissionSteps.${index}.fromMonth`) ??
                      error("terms.commissionSteps")
                    }
                  />
                  <Input
                    label={t("operations.partners.terms.stepRate")}
                    inputMode="decimal"
                    value={row.value.ratePct}
                    onChange={(event) =>
                      set({ ratePct: event.currentTarget.value })
                    }
                    maxLength={12}
                    error={error(`terms.commissionSteps.${index}.ratePct`)}
                  />
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setSteps((all) =>
                        all.filter((item) => item.key !== row.key),
                      )
                    }
                  >
                    {t("operations.partners.terms.stepRemove", {
                      number: index + 1,
                    })}
                  </Button>
                </li>
              );
            })}
          </ul>
          {steps.length < partnerStepLimit ? (
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setSteps((all) => [
                    ...all,
                    ...rowsOf([{ fromMonth: "", ratePct: "" }]),
                  ])
                }
              >
                {t("operations.partners.terms.stepAdd")}
              </Button>
            </div>
          ) : null}
        </Fieldset>
        <div className={styles.fields}>
          <Input
            label={t("operations.partners.terms.territory")}
            optionalLabel={optional}
            name="territory"
            defaultValue={partner?.terms.territory ?? ""}
            maxLength={500}
            error={error("terms.territory")}
          />
          <Select
            label={t("operations.partners.terms.exclusivity")}
            optionalLabel={optional}
            name="exclusivity"
            defaultValue={partner?.terms.exclusivity ?? ""}
            options={[
              { value: "", label: t("operations.partners.notSet") },
              ...partnerExclusivity.map((value) => ({
                value,
                label: t(partnerExclusivityLabels[value]),
              })),
            ]}
          />
          <Input
            label={t("operations.partners.terms.exclusivityNote")}
            optionalLabel={optional}
            name="exclusivityNote"
            defaultValue={partner?.terms.exclusivityNote ?? ""}
            maxLength={500}
            error={error("terms.exclusivityNote")}
          />
          <Input
            label={t("operations.partners.terms.nfrAllowance")}
            help={t("operations.partners.terms.nfrAllowanceHelp")}
            optionalLabel={optional}
            name="nfrAllowance"
            defaultValue={partner?.terms.nfrAllowance ?? ""}
            maxLength={500}
            error={error("terms.nfrAllowance")}
          />
          <Input
            label={t("operations.partners.terms.trialPeriod")}
            optionalLabel={optional}
            name="trialPeriod"
            defaultValue={partner?.terms.trialPeriod ?? ""}
            maxLength={200}
            error={error("terms.trialPeriod")}
          />
          <Textarea
            fieldClassName={wide}
            label={t("operations.partners.terms.trialTargets")}
            help={t("operations.partners.terms.trialTargetsHelp")}
            optionalLabel={optional}
            name="trialTargets"
            rows={3}
            defaultValue={partner?.terms.trialTargets ?? ""}
            maxLength={2000}
            error={error("terms.trialTargets")}
          />
        </div>
        <Fieldset legend={t("operations.partners.terms.rows")}>
          <ul className={styles.repeat}>
            {termRows.map((row, index) => {
              const set = (patch: Partial<typeof row.value>) =>
                setTermRows((all) =>
                  all.map((item) =>
                    item.key === row.key
                      ? { ...item, value: { ...item.value, ...patch } }
                      : item,
                  ),
                );
              return (
                <li className={styles.repeatRow} key={row.key}>
                  <Input
                    label={t("operations.partners.terms.rowLabel")}
                    value={row.value.label}
                    onChange={(event) =>
                      set({ label: event.currentTarget.value })
                    }
                    maxLength={120}
                    error={error(`terms.rows.${index}.label`)}
                  />
                  <Input
                    label={t("operations.partners.terms.rowValue")}
                    value={row.value.value}
                    onChange={(event) =>
                      set({ value: event.currentTarget.value })
                    }
                    maxLength={500}
                    error={error(`terms.rows.${index}.value`)}
                  />
                  <Input
                    label={t("operations.partners.terms.rowNotes")}
                    optionalLabel={optional}
                    value={row.value.notes}
                    onChange={(event) =>
                      set({ notes: event.currentTarget.value })
                    }
                    maxLength={1000}
                  />
                  <Button
                    type="button"
                    variant="quiet"
                    onClick={() =>
                      setTermRows((all) =>
                        all.filter((item) => item.key !== row.key),
                      )
                    }
                  >
                    {t("operations.partners.terms.rowRemove", {
                      number: index + 1,
                    })}
                  </Button>
                </li>
              );
            })}
          </ul>
          {termRows.length < partnerTermRowLimit ? (
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setTermRows((all) => [
                    ...all,
                    ...rowsOf([{ label: "", value: "", notes: "" }]),
                  ])
                }
              >
                {t("operations.partners.terms.rowAdd")}
              </Button>
            </div>
          ) : null}
        </Fieldset>
      </section>

      <section className={styles.card} aria-labelledby="partner-form-notes">
        <h2 id="partner-form-notes">{t("operations.partners.field.notes")}</h2>
        <Textarea
          label={t("operations.partners.field.notes")}
          optionalLabel={optional}
          name="notes"
          rows={5}
          defaultValue={partner?.notes ?? ""}
          maxLength={8000}
          error={error("notes")}
        />
      </section>

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={pending}>
          {pending
            ? t("operations.partners.form.saving")
            : t("operations.partners.form.save")}
        </Button>
        <Link
          className={buttonClassName({ variant: "quiet" })}
          href={partner ? partnerHref(partner.id) : partnersPath}
        >
          {t("operations.partners.form.cancel")}
        </Link>
      </div>
    </form>
  );
}
