"use client";
import { useTranslations } from "@/src/i18n/client";

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
          title="No end client is available to register"
          description="A deal registration names an end client that already exists as a Fil One account, and the accounts your partner account can name are the ones an approved registration or an existing partner quote already reaches. Yours returned none, so Fil One channel operations has to open the end client before it can be registered here."
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/partner/support"
            >
              Ask channel operations
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
          title="Registration is unavailable on this deployment"
          description="Naming an end client needs a scoped read of the account directory, and this deployment returned no database connection or no authorization context to read it under. Nothing is missing from your account; the surface simply cannot bind a registration here."
          action={
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href="/partner/support"
            >
              Ask channel operations
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
  const router = useRouter();
  const [draft, setDraft] = useState<DealRegistrationDraft>(() =>
    emptyDealRegistrationDraft(context.channelPolicy?.defaultProtectionDays),
  );
  const [errors, setErrors] = useState<DealRegistrationValidation>({});
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState("");
  const [failure, setFailure] = useState("");
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
    setRegistered("");
    setFailure("");
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
    setFailure("");
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
      setRegistered(
        "Registration submitted and added to the decision queue below. Fil One channel operations decides it; house-account and prior-deal exclusions are resolved against the unified account records, not against anything stated here.",
      );
      router.refresh();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "The registration failed. Nothing was recorded.",
      );
    } finally {
      setPending(false);
    }
  }

  const endClient = resolveRegistrationEndClient(draft, context.endClients);
  const summary = dealRegistrationSummary(draft, context);

  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">{t("action.register")}</h2>
      <p className={styles.muted}>
        Name an opportunity and request its protection window. Fil One submits
        the existing account identifiers; the decision, the protection clock,
        and any exclusion are recorded on the registration record itself.
      </p>
      {context.channelPolicy?.source === "approved_policy" ? (
        <p className={styles.muted}>
          Policy v{context.channelPolicy.version}: request up to{" "}
          {context.channelPolicy.maximumProtectionDays} days. Registration
          remains subject to channel operations approval.
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
            label="End client"
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
            placeholder="Search end clients"
            error={errors.endClientName}
          />
        </div>
        <label className={`${styles.field} ${styles.full}`}>
          Workload
          <input
            name="workload"
            value={draft.workload}
            onChange={(event) => update("workload", event.target.value)}
            aria-invalid={Boolean(errors.workload)}
          />
          {errors.workload ? (
            <span className={styles.error} role="alert">
              {errors.workload}
            </span>
          ) : null}
        </label>
        <label className={styles.field}>
          Expected volume (TB)
          <input
            name="expectedVolume"
            inputMode="decimal"
            value={draft.expectedVolume}
            onChange={(event) => update("expectedVolume", event.target.value)}
            aria-invalid={Boolean(errors.expectedVolume)}
          />
          {errors.expectedVolume ? (
            <span className={styles.error} role="alert">
              {errors.expectedVolume}
            </span>
          ) : null}
        </label>
        <label className={styles.field}>
          Protection requested (days)
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
              {errors.protectionDays}
            </span>
          ) : null}
        </label>
        <div className={styles.full}>
          <ul className={styles.summaryList}>
            {summary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className={styles.gate}>
            Registration decisions are made by Fil One channel operations.
            Submitting opens the decision clock; it does not approve the deal or
            grant protection.
          </p>
        </div>
        <div className={`${styles.actions} ${styles.full}`}>
          <Button
            type="submit"
            disabled={Boolean(registered)}
            loading={pending}
          >
            Register the deal
          </Button>
        </div>
        {registered ? (
          <p className={`${styles.success} ${styles.full}`} role="status">
            {registered}
          </p>
        ) : null}
        {failure ? (
          <p className={`${styles.failure} ${styles.full}`} role="alert">
            {failure}
          </p>
        ) : null}
      </form>
      <details className={styles.technical}>
        <summary>{t("ui.96")}</summary>
        <p>
          Partner account ID: <code>{context.partnerAccountId}</code>
        </p>
        <p>
          End-client account ID: <code>{endClient?.id ?? "Unresolved"}</code>
        </p>
      </details>
    </section>
  );
}
