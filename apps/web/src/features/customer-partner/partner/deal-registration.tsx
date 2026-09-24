"use client";
import type { MessageId } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";
import {
  ApplicationStatePanel,
  Button,
  buttonClassName,
  EntityCombobox,
} from "@clockwork/ui";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";
import { draftIsDirty } from "@/src/features/customer-partner/draft-state";
import { useUnsavedChangesWarning } from "@/src/features/customer-partner/unsaved-changes";

import {
  dealRegistrationPayload,
  dealRegistrationSummary,
  emptyDealRegistrationDraft,
  resolveRegistrationEndClient,
  validateDealRegistration,
  type DealRegistrationContext,
  type DealRegistrationDraft,
  type DealRegistrationValidation,
} from "./deal-registration-model";
import { partnerCommandFailure } from "./partner-command-errors";
import styles from "./partner.module.css";

/**
 * Named when the partner has nobody to register against.
 *
 * A registration binds an existing `accounts` row, and the accounts this
 * partner may name are the ones row-level security already admits. An empty
 * answer is a state to say out loud, not an empty picker above a Submit that
 * would post an end client the database has never heard of.
 */
function NothingToRegister() {
  const t = useTranslations();
  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">{t("action.register")}</h2>
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t("partner.registration.none.title")}
          description={t("partner.registration.none.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/partner/support"
            >
              {t("partner.registration.askChannel")}
            </Link>
          }
        />
      </div>
    </section>
  );
}

/**
 * Named when the account directory could not be read at all -- no runtime
 * database, or no authorization-context secret to open a scoped transaction
 * with.
 *
 * Deliberately a different sentence from `NothingToRegister`. "You have no end
 * clients" is a statement about this partner's relationships; "the directory is
 * unreadable" is a statement about the deployment, and reporting the second as
 * the first is how a broken read comes to look like a settled commercial fact.
 */
export function RegistrationDirectoryUnavailable() {
  const t = useTranslations();
  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">{t("action.register")}</h2>
      <div className={styles.state}>
        <ApplicationStatePanel
          state="empty"
          title={t("partner.registration.unavailable.title")}
          description={t("partner.registration.unavailable.description")}
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/partner/support"
            >
              {t("partner.registration.askChannel")}
            </Link>
          }
        />
      </div>
    </section>
  );
}

export function DealRegistration({
  context,
}: {
  /**
   * Required, and not defaulted. The partner account and the end-client list
   * are both server reads the route performs; a component that could be
   * mounted without them is one that could render a form binding nothing,
   * which is the shape this surface replaced.
   */
  context: DealRegistrationContext;
}) {
  if (context.endClients.length === 0) return <NothingToRegister />;
  return <RegistrationForm context={context} />;
}

function RegistrationForm({ context }: { context: DealRegistrationContext }) {
  const t = useTranslations();
  const formatting = useFormattingLocale();
  const router = useRouter();
  const [draft, setDraft] = useState<DealRegistrationDraft>(() =>
    emptyDealRegistrationDraft(context.channelPolicy?.defaultProtectionDays),
  );
  const [errors, setErrors] = useState<DealRegistrationValidation>({});
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState<MessageId | null>(null);
  const [failure, setFailure] = useState<MessageId | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * Held so a retry after a network failure replays the same registration
   * rather than racing a second protection window against the first.
   */
  const submissionRef = useRef<{
    idempotencyKey: string;
    registrationId: string;
  } | null>(null);

  /**
   * Armed once the seller has entered an opportunity that is not on the server.
   *
   * The default 90-day protection window is part of the pristine draft, so an
   * untouched form never warns. `registered` disarms; `update()` clears
   * `registered`, so editing the opportunity after submitting it re-arms.
   *
   * This form has no in-page "cancel" link to guard, so `beforeunload` is the
   * whole protection here: reload, tab close, and leaving the application.
   */
  useUnsavedChangesWarning(
    draftIsDirty(
      draft,
      emptyDealRegistrationDraft(context.channelPolicy?.defaultProtectionDays),
    ) && !registered,
  );

  function update<K extends keyof DealRegistrationDraft>(
    key: K,
    next: DealRegistrationDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: next }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    submissionRef.current = null;
    setRegistered(null);
    setFailure(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateDealRegistration(draft, context);
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      window.setTimeout(
        () =>
          formRef.current
            ?.querySelector<HTMLElement>(
              `[name="${firstInvalid}"], [data-field="${firstInvalid}"] input`,
            )
            ?.focus(),
        0,
      );
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      submissionRef.current ??= {
        idempotencyKey: crypto.randomUUID(),
        registrationId: uuidV7(),
      };
      const submission = submissionRef.current;
      await sendCoreCommand(
        {
          resource: "deal_registrations",
          id: submission.registrationId,
          // `deal_registrations_scope` checks this account on insert, and the
          // repository reads it as the registering partner.
          accountId: context.partnerAccountId,
          action: "create",
          payload: dealRegistrationPayload(draft, context),
        },
        { idempotencyKey: submission.idempotencyKey },
      );
      setRegistered("partner.registration.submitted");
      router.refresh();
    } catch (error) {
      setFailure(partnerCommandFailure(error, "partner.registration.failed"));
    } finally {
      setPending(false);
    }
  }

  const endClient = resolveRegistrationEndClient(draft, context.endClients);
  const summary = dealRegistrationSummary(draft, context, t, formatting);
  const technical = (label: MessageId, value: string) =>
    richText(t, "partner.labelled", {
      label: t(label),
      value: <code>{value}</code>,
    });

  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">{t("action.register")}</h2>
      <p className={styles.muted}>{t("partner.registration.intro")}</p>
      {context.channelPolicy?.source === "approved_policy" ? (
        <p className={styles.muted}>
          {t("partner.registration.policy", {
            version: context.channelPolicy.version,
            count: context.channelPolicy.maximumProtectionDays,
          })}
        </p>
      ) : null}
      <form
        className={styles.formGrid}
        ref={formRef}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
      >
        <div className={styles.full} data-field="endClientName">
          <EntityCombobox
            label={t("partner.registration.field.endClient")}
            value={
              resolveRegistrationEndClient(draft, context.endClients)?.id ?? ""
            }
            options={context.endClients.map((option) => ({
              id: option.id,
              label: option.name,
              ...([option.domain, option.country].some(Boolean)
                ? {
                    description: [option.domain, option.country]
                      .filter(Boolean)
                      .join(" · "),
                  }
                : {}),
            }))}
            onValueChange={(id, option) => {
              update("endClientName", option.label);
              setDraft((current) => ({ ...current, endClientId: id }));
            }}
            placeholder={t("partner.surface.portfolio.search")}
            {...(errors.endClientName
              ? {
                  error: t(
                    errors.endClientName.id,
                    errors.endClientName.values,
                  ),
                }
              : {})}
          />
        </div>
        <label className={`${styles.field} ${styles.full}`}>
          {t("partner.registration.field.workload")}
          <input
            name="workload"
            value={draft.workload}
            onChange={(event) => update("workload", event.target.value)}
            aria-invalid={Boolean(errors.workload)}
          />
          {errors.workload ? (
            <span className={styles.error} role="alert">
              {t(errors.workload.id, errors.workload.values)}
            </span>
          ) : null}
        </label>
        <label className={styles.field}>
          {t("partner.registration.field.volume")}
          <input
            name="expectedVolume"
            inputMode="decimal"
            value={draft.expectedVolume}
            onChange={(event) => update("expectedVolume", event.target.value)}
            aria-invalid={Boolean(errors.expectedVolume)}
          />
          {errors.expectedVolume ? (
            <span className={styles.error} role="alert">
              {t(errors.expectedVolume.id, errors.expectedVolume.values)}
            </span>
          ) : null}
        </label>
        <label className={styles.field}>
          {t("partner.registration.field.protection")}
          <input
            name="protectionDays"
            max={context.channelPolicy?.maximumProtectionDays ?? undefined}
            type="number"
            min="1"
            step="1"
            value={draft.protectionDays}
            onChange={(event) => update("protectionDays", event.target.value)}
            aria-invalid={Boolean(errors.protectionDays)}
          />
          {errors.protectionDays ? (
            <span className={styles.error} role="alert">
              {t(errors.protectionDays.id, errors.protectionDays.values)}
            </span>
          ) : null}
        </label>
        <div className={styles.full}>
          <ul className={styles.summaryList}>
            {summary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.gate}>{t("partner.registration.gate")}</p>
        </div>
        <div className={`${styles.actions} ${styles.full}`}>
          <Button
            type="submit"
            disabled={Boolean(registered)}
            loading={pending}
          >
            {t("partner.registration.submit")}
          </Button>
        </div>
        {registered ? (
          <p className={`${styles.success} ${styles.full}`} role="status">
            {t(registered)}
          </p>
        ) : null}
        {failure ? (
          <p className={`${styles.failure} ${styles.full}`} role="alert">
            {t(failure)}
          </p>
        ) : null}
      </form>
      <details className={styles.technical}>
        <summary>{t("common.technicalDetails")}</summary>
        <p>
          {technical(
            "partner.technical.partnerAccountId",
            context.partnerAccountId,
          )}
        </p>
        <p>
          {technical(
            "partner.technical.endClientAccountId",
            endClient?.id ?? t("partner.technical.unresolved"),
          )}
        </p>
      </details>
    </section>
  );
}
