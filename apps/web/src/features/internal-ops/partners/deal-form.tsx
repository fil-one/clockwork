"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import {
  partnerDealModels,
  partnerDealStatuses,
  partnerSizeUnits,
  type PartnerDealConflict,
  type PartnerDealRecord,
  type PartnerOrganizationOption,
} from "@clockwork/contracts";
import { Button, Input, Select, StateBanner, Textarea } from "@clockwork/ui";

import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { formatContractDate } from "../contracts/copy";
import { SessionExpiredReload } from "../session-expiry";
import { findPartnerDealConflicts, savePartnerDeal } from "./actions";
import {
  partnerDealModelLabels,
  partnerDealStatusLabels,
  partnerErrorMessage,
  partnerFieldMessage,
} from "./model";
import styles from "./partners.module.css";

const wide = styles.wide ?? "";
/** How long typing pauses before the overlap check runs. */
const checkDelay = 450;

/** Other partners' open registrations for the same end client. Never blocks. */
export function DealConflictWarning({
  conflicts,
  title,
}: {
  conflicts: readonly PartnerDealConflict[];
  title?: string;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  if (!conflicts.length) return null;
  return (
    <StateBanner
      tone="warning"
      live="polite"
      title={title ?? t("operations.partners.deals.conflictTitle")}
      description={
        <ul className={styles.conflicts}>
          {conflicts.map((conflict) => (
            <li key={conflict.dealId}>
              <a href={`/internal/partners/${conflict.partnerId}`}>
                {t("operations.partners.deals.conflictLine", {
                  partner: conflict.partnerName,
                  status: t(partnerDealStatusLabels[conflict.status]),
                  registered: formatContractDate(conflict.registeredOn, locale),
                  until: formatContractDate(conflict.protectedUntil, locale),
                })}
              </a>
            </li>
          ))}
        </ul>
      }
    />
  );
}

/**
 * Registers a deal for a partner, or edits one. While the end client is
 * typed, another partner's open registration for the same company shows as a
 * warning; the deal saves either way.
 */
export function DealForm({
  partnerId,
  deal,
  today,
  protectionDays,
  organizations,
}: {
  partnerId: string;
  deal: PartnerDealRecord | null;
  today: string;
  protectionDays: number;
  organizations: readonly PartnerOrganizationOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const id = useRef(deal?.id ?? null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [endClient, setEndClient] = useState(deal?.endClient ?? "");
  const [conflicts, setConflicts] = useState<PartnerDealConflict[]>([]);
  const [saved, setSaved] = useState<{
    conflicts: PartnerDealConflict[];
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const error = (path: string) =>
    fields[path] ? t(partnerFieldMessage(fields[path])) : undefined;
  const optional = t("operations.partners.field.optional");

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Only the latest lookup may set the warning; an older, slower answer or
  // one that lands after the form was saved or closed is dropped.
  const lookup = useRef(0);
  function cancelCheck() {
    if (timer.current) clearTimeout(timer.current);
    lookup.current += 1;
  }

  function check(value: string) {
    setEndClient(value);
    cancelCheck();
    const current = lookup.current;
    timer.current = setTimeout(() => {
      void findPartnerDealConflicts({ endClient: value, partnerId })
        .then((result) => {
          if (lookup.current === current)
            setConflicts(result.ok ? result.value : []);
        })
        .catch(() => {
          if (lookup.current === current) setConflicts([]);
        });
    }, checkDelay);
  }

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
      partnerId,
      ...(deal ? { expectedVersion: deal.version } : {}),
      endClient,
      organizationId: text("organizationId"),
      registeredOn: text("registeredOn"),
      protectedUntil: text("protectedUntil"),
      estimatedSize: text("estimatedSize"),
      // A unit means nothing without a size.
      sizeUnit: text("estimatedSize").trim() ? text("sizeUnit") : "",
      model: text("model"),
      status: text("status"),
      notes: text("notes"),
    };
    cancelCheck();
    setFailure(null);
    setFields({});
    setSaved(null);
    startTransition(async () => {
      const result = await savePartnerDeal(input).catch(() => ({
        ok: false as const,
        code: "UNEXPECTED",
      }));
      if (result.ok) {
        if (!deal) {
          id.current = null;
          setEndClient("");
        }
        setConflicts([]);
        setOpen(false);
        setSaved({ conflicts: result.value.conflicts });
        router.refresh();
        return;
      }
      setFields("fields" in result && result.fields ? result.fields : {});
      setFailure(result.code);
    });
  }

  const outcome = (
    <>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {saved ? t("operations.partners.deals.saved") : ""}
      </p>
      {saved ? (
        saved.conflicts.length ? (
          <DealConflictWarning
            conflicts={saved.conflicts}
            title={t("operations.partners.deals.conflictSaved")}
          />
        ) : (
          <StateBanner
            tone="success"
            title={t("operations.partners.deals.saved")}
          />
        )
      ) : null}
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
    </>
  );

  if (!open)
    return (
      <div className={styles.column}>
        {outcome}
        <div className={styles.actions}>
          <Button
            type="button"
            variant={deal ? "quiet" : "primary"}
            onClick={() => {
              setSaved(null);
              setFailure(null);
              setOpen(true);
            }}
          >
            {deal
              ? t("operations.partners.deals.edit")
              : t("operations.partners.deals.register")}
          </Button>
        </div>
      </div>
    );

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {outcome}
      <div className={styles.fields}>
        <Input
          fieldClassName={wide}
          label={t("operations.partners.deals.endClient")}
          name="endClient"
          value={endClient}
          onChange={(event) => check(event.currentTarget.value)}
          maxLength={200}
          required
          autoComplete="off"
          error={error("endClient")}
        />
        <div className={wide}>
          <DealConflictWarning conflicts={conflicts} />
        </div>
        <Input
          label={t("operations.partners.deals.registeredOn")}
          name="registeredOn"
          type="date"
          defaultValue={deal?.registeredOn ?? today}
          required
          error={error("registeredOn")}
        />
        <Input
          label={t("operations.partners.deals.protectedUntil")}
          help={t("operations.partners.deals.protectedUntilHelp", {
            days: protectionDays,
          })}
          optionalLabel={optional}
          name="protectedUntil"
          type="date"
          defaultValue={deal?.protectedUntil ?? ""}
          error={error("protectedUntil")}
        />
        <Input
          label={t("operations.partners.deals.estimatedSize")}
          optionalLabel={optional}
          name="estimatedSize"
          inputMode="decimal"
          defaultValue={deal?.estimatedSize ?? ""}
          maxLength={20}
          error={error("estimatedSize")}
        />
        <Select
          label={t("operations.partners.deals.sizeUnit")}
          optionalLabel={optional}
          name="sizeUnit"
          defaultValue={deal?.sizeUnit ?? "TB"}
          error={error("sizeUnit")}
          options={partnerSizeUnits.map((unit) => ({
            value: unit,
            label: unit,
          }))}
        />
        <Select
          label={t("operations.partners.deals.model")}
          name="model"
          defaultValue={deal?.model ?? "referral"}
          options={partnerDealModels.map((model) => ({
            value: model,
            label: t(partnerDealModelLabels[model]),
          }))}
        />
        <Select
          label={t("operations.partners.deals.status")}
          name="status"
          defaultValue={deal?.status ?? "registered"}
          options={partnerDealStatuses.map((status) => ({
            value: status,
            label: t(partnerDealStatusLabels[status]),
          }))}
        />
        <Select
          label={t("operations.partners.deals.organization")}
          optionalLabel={optional}
          name="organizationId"
          defaultValue={deal?.organizationId ?? ""}
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
        <Textarea
          fieldClassName={wide}
          label={t("operations.partners.deals.notes")}
          optionalLabel={optional}
          name="notes"
          rows={3}
          defaultValue={deal?.notes ?? ""}
          maxLength={4000}
          error={error("notes")}
        />
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={pending}>
          {pending
            ? t("operations.partners.deals.saving")
            : t("operations.partners.deals.save")}
        </Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            cancelCheck();
            setConflicts([]);
            setOpen(false);
          }}
        >
          {t("operations.partners.deals.cancel")}
        </Button>
      </div>
    </form>
  );
}
