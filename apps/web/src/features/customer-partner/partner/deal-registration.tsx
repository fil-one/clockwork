"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { uuidV7 } from "@clockwork/contracts";
import { ApplicationStatePanel, Button, buttonClassName } from "@clockwork/ui";

import { sendCoreCommand } from "@/src/features/contracts/commerce-client";

import {
  dealRegistrationPayload,
  dealRegistrationSummary,
  emptyDealRegistrationDraft,
  resolveEndClient,
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
  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">Register a deal</h2>
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
  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">Register a deal</h2>
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
  const [draft, setDraft] = useState<DealRegistrationDraft>(
    emptyDealRegistrationDraft,
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
            ?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)
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
        "Registration submitted. Fil One channel operations decides it; house-account and prior-deal exclusions are resolved against the unified account records, not against anything stated here.",
      );
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

  const endClient = resolveEndClient(draft.endClientName, context.endClients);
  const summary = dealRegistrationSummary(draft, context);

  return (
    <section className={styles.workflow} aria-labelledby="deal-registration">
      <h2 id="deal-registration">Register a deal</h2>
      <p className={styles.muted}>
        Name an opportunity to open its protection window. Fil One submits the
        existing account identifiers; the decision, the protection clock, and
        any exclusion are recorded on the registration record itself.
      </p>
      <form
        className={styles.formGrid}
        ref={formRef}
        onSubmit={(event) => {
          void submit(event);
        }}
        noValidate
      >
        <label className={`${styles.field} ${styles.full}`}>
          End client
          <input
            name="endClientName"
            list="registrable-end-clients"
            value={draft.endClientName}
            onChange={(event) => update("endClientName", event.target.value)}
            aria-invalid={Boolean(errors.endClientName)}
            autoComplete="off"
          />
          <datalist id="registrable-end-clients">
            {context.endClients.map((option) => (
              <option value={option.name} key={option.id} />
            ))}
          </datalist>
          {errors.endClientName ? (
            <span className={styles.error} role="alert">
              {errors.endClientName}
            </span>
          ) : null}
        </label>
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
        <summary>Technical details</summary>
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
