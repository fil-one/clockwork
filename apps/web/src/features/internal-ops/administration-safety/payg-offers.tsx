"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  PaygOfferCommand,
  PaygOfferRecord,
  PaygOfferTerms,
} from "@clockwork/domain/core";

import { AdministrationPage, styles } from "./ui";

function value(data: FormData, name: string): string {
  const field = data.get(name);
  return typeof field === "string" ? field.trim() : "";
}
function moneyInput(minor?: string): string {
  if (minor === undefined) return "";
  return `${BigInt(minor) / 100n}.${(BigInt(minor) % 100n).toString().padStart(2, "0")}`;
}
function decimalStorage(bytes: string | undefined): string {
  if (bytes === undefined) return "Not specified";
  const count = BigInt(bytes);
  const units = [
    [1_000_000_000_000n, "TB"],
    [1_000_000_000n, "GB"],
    [1_000_000n, "MB"],
    [1_000n, "kB"],
  ] as const;
  const unit = units.find(([scale]) => count >= scale);
  if (!unit) return `${bytes} bytes`;
  const [scale, label] = unit;
  const fraction = (((count % scale) * 100n) / scale)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${count / scale}${fraction ? `.${fraction}` : ""} ${label}`;
}

function minor(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match?.[1])
    throw new Error("Enter monetary amounts with at most two decimal places.");
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] ?? "").padEnd(2, "0"))
  ).toString();
}

async function postPayg(path: string, body: unknown): Promise<unknown> {
  const csrf = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("clockwork-csrf="))
    ?.slice("clockwork-csrf=".length);
  if (!csrf || csrf.length < 32)
    throw new Error("Refresh the page to restore the secure form token.");
  const response = await fetch(`/api/v1/core/payg-offers${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrf,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const code =
      result && typeof result === "object" && "code" in result
        ? String(result.code)
        : "";
    const messages: Record<string, string> = {
      PAYG_APPROVED_POLICY_BINDING_MISMATCH:
        "The approved policy must match this provider entitlement and be effective on the service start date.",
      TRIAL_ACCOUNT_NOT_CLEARED:
        "The customer account must clear screening before a trial is claimed.",
      TRIAL_ALREADY_USED:
        "This organization or verified domain has already claimed a trial. Its lifetime eligibility cannot be reset.",
      TRIAL_PERSISTED_DOMAIN_EVIDENCE_REQUIRED:
        "Use a retained successful registration verification event or verified DNS domain record for this organization’s account.",
      TRIAL_VERIFIED_TENANT_REQUIRED:
        "The organization needs a verified provider tenant mapping before a trial can be recorded.",
      TRIAL_PAID_CONVERSION_NOT_CONFIRMED:
        "The paid source must be active, verified, and bound to the same account and tenant.",
      TRIAL_APPROVED_POLICY_REQUIRED:
        "Choose an approved trial policy with retained approval evidence.",
      PAYG_ENROLLMENT_SOURCE_ALREADY_BOUND:
        "This provider entitlement already has an enrollment. Refresh the enrollment list to inspect its retained identity.",
      PAYG_STRIPE_CUSTOMER_UNMAPPED:
        "The customer account needs a verified Stripe customer mapping before enrollment.",
      PAYG_VERIFIED_ENROLLMENT_EVIDENCE_REQUIRED:
        "Identity verification and approved Clockwork billing cutover evidence are required.",
      PAYG_CREDIT_ORIGINAL_INVOICE_NOT_ISSUED:
        "The original invoices must finish provider delivery before this correction can create credits.",
      PAYG_ENROLLMENT_START_INVALID:
        "Enter a confirmed past service start at an exact UTC hour.",
      PAYG_CONFIRMED_CANCELLATION_REQUIRED:
        "Enter a confirmed past service end at an exact UTC hour, with provider evidence.",
      PAYG_ENROLLMENT_REPLAY_CONFLICT:
        "This enrollment is already recorded with different source or billing evidence.",
      PAYG_OFFER_VERSION_EXISTS:
        "This SKU, region, and offer version already exists. Open the existing draft or choose a new version.",
      PAYG_OFFER_STALE_VERSION:
        "This version changed. Refresh the page before trying again.",
      PAYG_OFFER_DISTINCT_APPROVER_REQUIRED:
        "A finance approver who did not create, edit, or propose this version must decide.",
      PAYG_OFFER_FINANCE_AUTHORITY_REQUIRED:
        "Your persisted finance membership and MFA enrollment are required to change policies.",
      PAYG_OFFERS_UNAVAILABLE:
        "The policy service is unavailable. Your changes were not saved.",
      RECENT_AUTHENTICATION_REQUIRED:
        "Sign in again before changing commercial policy.",
      PAYG_OFFER_SOURCE_CHECKED_IN_FUTURE:
        "The evidence check date cannot be in the future.",
    };
    throw new Error(
      (code.startsWith("PAYG_TAX_REVIEW_REQUIRED")
        ? "The account tax evidence requires finance review before an invoice can be created."
        : messages[code]) ??
        (response.status === 422
          ? "Check every required field. Evidence links must use HTTPS and contain no query string, fragment, or credentials."
          : "The policy change was not saved. Refresh the page and check your finance access."),
    );
  }
  return result;
}

async function command(body: PaygOfferCommand): Promise<PaygOfferRecord> {
  return (await postPayg("", body)) as PaygOfferRecord;
}

function tbBytes(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match?.[1])
    throw new Error(
      "Enter TB as a non-negative number with at most twelve decimal places.",
    );
  return (
    BigInt(match[1]) * 1_000_000_000_000n +
    BigInt((match[2] ?? "").padEnd(12, "0"))
  ).toString();
}

function PaygOfferSimulator({ offer }: { offer: PaygOfferRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    total: { currency: string; minor: string };
    lines: { kind: string; amount: { currency: string; minor: string } }[];
  }>();
  async function simulate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await postPayg("/simulate", {
        terms: offer.terms,
        month: value(data, "month"),
        averageStorageBytes: tbBytes(value(data, "storageTb")),
        egressBytes: tbBytes(value(data, "egressTb")),
        apiOperations: value(data, "operations"),
      });
      setResult(response as NonNullable<typeof result>);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The simulation could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const lineLabels: Record<string, string> = {
    storage_bytes: "Storage",
    egress_bytes: "Egress",
    api_operations: "API operations",
    monthly_minimum_adjustment: "Monthly minimum adjustment",
  };
  return (
    <div className={styles.panelBody}>
      <h3>Monthly rating preview</h3>
      <p>
        Uses the saved policy and a full UTC calendar month. This simulation
        creates no customer enrollment or invoice. Taxes are excluded.
      </p>
      <form onSubmit={(event) => void simulate(event)}>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            Service month
            <input
              type="month"
              name="month"
              required
              defaultValue={offer.terms.effectiveFrom.slice(0, 7)}
            />
          </label>
          <label className={styles.field}>
            Average daily storage (TB)
            <input
              name="storageTb"
              inputMode="decimal"
              required
              defaultValue="0.1"
            />
          </label>
          <label className={styles.field}>
            Total monthly egress (TB)
            <input
              name="egressTb"
              inputMode="decimal"
              required
              defaultValue="1"
            />
          </label>
          <label className={styles.field}>
            Total API operations
            <input
              name="operations"
              inputMode="numeric"
              required
              defaultValue="1000000"
            />
          </label>
        </div>
        <button
          type="submit"
          className={styles.buttonSecondary}
          disabled={busy}
        >
          {busy ? "Calculating…" : "Calculate monthly estimate"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {result ? (
        <div role="status">
          <dl>
            {result.lines.map((line) => (
              <div key={line.kind}>
                <dt>{lineLabels[line.kind] ?? line.kind}</dt>
                <dd>
                  {line.amount.currency} {moneyInput(line.amount.minor)}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>
              Estimated monthly total: {result.total.currency}{" "}
              {moneyInput(result.total.minor)}
            </strong>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function OfferForm({
  offer,
  onSave,
  busy,
}: {
  offer?: PaygOfferRecord;
  onSave: (terms: PaygOfferTerms) => Promise<void>;
  busy: boolean;
}) {
  const terms = offer?.terms;
  const [customerPolicyConfigured, setCustomerPolicyConfigured] = useState(
    Boolean(terms?.customerAcquisition),
  );
  const [error, setError] = useState("");
  const field = (
    name: string,
    label: string,
    defaultValue: string | number | undefined,
    type = "text",
    hint?: string,
  ) => (
    <label className={styles.field} key={name}>
      {label}
      <input
        name={name}
        defaultValue={defaultValue ?? ""}
        type={type}
        required
        {...(type === "number" ? { min: 0, step: 1 } : {})}
      />
      {hint ? <span className={styles.fieldHint}>{hint}</span> : null}
    </label>
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await onSave({
        name: value(data, "name"),
        sku: value(data, "sku"),
        region: value(data, "region"),
        version: Number(value(data, "version")),
        effectiveFrom: value(data, "effectiveFrom"),
        sourceUri: value(data, "sourceUri"),
        sourceCheckedAt: `${value(data, "sourceCheckedAt")}T00:00:00.000Z`,
        sourceDocumentId: value(data, "sourceDocumentId"),
        owner: value(data, "owner"),
        ...(customerPolicyConfigured
          ? {
              customerAcquisition: {
                paygRequestsEnabled: data.get("paygRequestsEnabled") === "on",
                trialRequestsEnabled: data.get("trialRequestsEnabled") === "on",
                serviceNotice: value(data, "serviceNotice"),
                cancellationNotice: value(data, "cancellationNotice"),
                trialNotice: value(data, "trialNotice"),
                terms: {
                  documentId: value(data, "customerTermsId"),
                  version: value(data, "customerTermsVersion"),
                  uri: value(data, "customerTermsUri"),
                  sha256: value(data, "customerTermsHash"),
                },
                retention: {
                  documentId: value(data, "customerRetentionId"),
                  version: value(data, "customerRetentionVersion"),
                  uri: value(data, "customerRetentionUri"),
                  sha256: value(data, "customerRetentionHash"),
                },
              },
            }
          : {}),
        payg: {
          currency: value(
            data,
            "currency",
          ) as PaygOfferTerms["payg"]["currency"],
          storageTbMonthMinor: minor(value(data, "storagePrice")),
          monthlyMinimumMinor: minor(value(data, "minimum")),
          partialMonthMinimum: value(
            data,
            "partialMinimum",
          ) as PaygOfferTerms["payg"]["partialMonthMinimum"],
          correctionWindowDays: Number(value(data, "correctionWindowDays")),
          aggregation: "hourly_average_daily_utc",
          egressRateMinor: "0",
          apiRateMinor: "0",
          stripeTaxCode: value(data, "stripeTaxCode"),
          qboIncomeAccount: value(data, "qboIncomeAccount"),
        },
        trial: {
          durationDays: Number(value(data, "durationDays")),
          gracePeriodDays: Number(value(data, "gracePeriodDays")),
          storageLimitBytes: value(data, "storageLimitBytes"),
          cumulativeEgressLimitBytes: value(data, "cumulativeEgressLimitBytes"),
          maximumCounterAgeSeconds: Number(
            value(data, "maximumCounterAgeSeconds"),
          ),
          egressExhaustion: value(
            data,
            "egressExhaustion",
          ) as PaygOfferTerms["trial"]["egressExhaustion"],
        },
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The draft was not saved.",
      );
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)} className={styles.panelBody}>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}>
        <legend>Offer and evidence</legend>
        <div className={styles.toolbar}>
          {field("name", "Policy name", terms?.name)}
          {field("sku", "Provisionable SKU", terms?.sku)}
          {field("region", "Region code", terms?.region)}
          {field("version", "Offer version", terms?.version ?? 1, "number")}
          {field(
            "effectiveFrom",
            "Effective from",
            terms?.effectiveFrom,
            "date",
          )}
          {field("owner", "Policy owner", terms?.owner)}
          {field(
            "sourceUri",
            "Evidence link",
            terms?.sourceUri,
            "url",
            "HTTPS document URL without a query string or fragment.",
          )}
          {field(
            "sourceCheckedAt",
            "Evidence checked on (UTC)",
            terms?.sourceCheckedAt.slice(0, 10),
            "date",
          )}
          {field(
            "sourceDocumentId",
            "Source document reference",
            terms?.sourceDocumentId,
          )}
        </div>
        <h3>Monthly PAYG pricing</h3>
        <p>
          Average daily storage uses hourly measurements in UTC. One TB is
          1,000,000,000,000 bytes. Egress and API operations are recorded at
          zero charge.
        </p>
        <div className={styles.toolbar}>
          <label className={styles.field}>
            Currency
            <select
              name="currency"
              defaultValue={terms?.payg.currency ?? "USD"}
            >
              {["USD", "EUR", "GBP"].map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          {field(
            "storagePrice",
            "Price per TB-month",
            moneyInput(terms?.payg.storageTbMonthMinor),
            "text",
            "Amount in the selected currency, such as 4.99.",
          )}
          {field(
            "minimum",
            "Monthly minimum charge",
            moneyInput(terms?.payg.monthlyMinimumMinor),
          )}
          <label className={styles.field}>
            First/final partial-month minimum
            <select
              name="partialMinimum"
              required
              defaultValue={terms?.payg.partialMonthMinimum ?? ""}
            >
              <option value="" disabled>
                Select approved treatment
              </option>
              <option value="full">Full monthly minimum</option>
              <option value="prorated">Prorated by service hours</option>
            </select>
          </label>
          {field(
            "correctionWindowDays",
            "Automatic correction window (days)",
            terms?.payg.correctionWindowDays,
            "number",
            "After the service period; later corrections require finance review.",
          )}
        </div>
        <div className={styles.toolbar}>
          {field("stripeTaxCode", "Stripe tax code", terms?.payg.stripeTaxCode)}
          {field(
            "qboIncomeAccount",
            "Accounting income account",
            terms?.payg.qboIncomeAccount,
          )}
        </div>
        <h3>Trial limits and access</h3>
        <div className={styles.toolbar}>
          {field(
            "durationDays",
            "Trial duration (days)",
            terms?.trial.durationDays,
            "number",
          )}
          {field(
            "gracePeriodDays",
            "Read-only grace period (days)",
            terms?.trial.gracePeriodDays,
            "number",
          )}
          {field(
            "storageLimitBytes",
            "Storage limit (bytes)",
            terms?.trial.storageLimitBytes,
            "text",
            "1 TB = 1000000000000 bytes.",
          )}
          {field(
            "cumulativeEgressLimitBytes",
            "Cumulative trial egress limit (bytes)",
            terms?.trial.cumulativeEgressLimitBytes,
            "text",
            "This budget does not reset each month.",
          )}
          {field(
            "maximumCounterAgeSeconds",
            "Maximum usage counter age (seconds)",
            terms?.trial.maximumCounterAgeSeconds,
            "number",
          )}
          <label className={styles.field}>
            When the egress budget is exhausted
            <select
              name="egressExhaustion"
              required
              defaultValue={terms?.trial.egressExhaustion ?? ""}
            >
              <option value="" disabled>
                Select approved behavior
              </option>
              <option value="disable_all">Disable all access</option>
              <option value="block_egress">Block egress only</option>
            </select>
          </label>
        </div>
        <p>
          Storage exhaustion blocks writes. Trial expiry starts the read-only
          grace period; the account is disabled when grace ends. Automatic
          deletion is not configured here.
        </p>
        <h3>Customer request notices and terms</h3>
        <p>
          Configure approved documents before offering this version to
          customers. These flags permit collecting requests; they do not
          activate billing, provision a tenant, or authorize a provider cutover.
        </p>
        <label>
          <input
            type="checkbox"
            checked={customerPolicyConfigured}
            onChange={(event) =>
              setCustomerPolicyConfigured(event.target.checked)
            }
          />{" "}
          Include customer acquisition policy
        </label>
        {customerPolicyConfigured ? (
          <>
            <div className={styles.toolbar}>
              <label>
                <input
                  type="checkbox"
                  name="paygRequestsEnabled"
                  defaultChecked={
                    terms?.customerAcquisition?.paygRequestsEnabled
                  }
                />{" "}
                Accept PAYG activation requests
              </label>
              <label>
                <input
                  type="checkbox"
                  name="trialRequestsEnabled"
                  defaultChecked={
                    terms?.customerAcquisition?.trialRequestsEnabled
                  }
                />{" "}
                Accept trial requests
              </label>
            </div>
            <div className={styles.formGrid}>
              {(
                [
                  ["serviceNotice", "Service and billing notice"],
                  ["cancellationNotice", "Cancellation and service-end notice"],
                  ["trialNotice", "Trial eligibility and expiry notice"],
                ] as const
              ).map(([name, label]) => (
                <label className={styles.field} key={name}>
                  {label}
                  <textarea
                    name={name}
                    required
                    minLength={20}
                    maxLength={4000}
                    defaultValue={terms?.customerAcquisition?.[name] ?? ""}
                  />
                </label>
              ))}
              {(
                [
                  ["customerTerms", "Terms", terms?.customerAcquisition?.terms],
                  [
                    "customerRetention",
                    "Retention policy",
                    terms?.customerAcquisition?.retention,
                  ],
                ] as const
              ).map(([prefix, label, reference]) => (
                <div key={prefix}>
                  <h4>{label}</h4>
                  {field(
                    `${prefix}Id`,
                    `${label} document reference`,
                    reference?.documentId,
                  )}
                  {field(
                    `${prefix}Version`,
                    `${label} document version`,
                    reference?.version,
                  )}
                  {field(
                    `${prefix}Uri`,
                    `${label} document URL`,
                    reference?.uri,
                    "url",
                  )}
                  {field(
                    `${prefix}Hash`,
                    `${label} exact document SHA-256`,
                    reference?.sha256,
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}
        <button className={styles.button} type="submit">
          {busy ? "Saving…" : offer ? "Save draft" : "Create policy draft"}
        </button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function TrialAdministration({
  offers,
}: {
  offers: readonly PaygOfferRecord[];
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [trials, setTrials] = useState<
    {
      accountId: string;
      trial: {
        id: string;
        verifiedDomain: string;
        expiresAt: string;
        convertedAt?: string;
      };
    }[]
  >([]);
  const approved = offers.filter((offer) => offer.status === "approved");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/trials", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Trial list unavailable.");
      const result = (await response.json()) as { trials: typeof trials };
      setTrials(result.trials);
      setMessage(
        result.trials.length ? "" : "No lifetime trial claims are recorded.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Trial list unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: "claim" | "convert",
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const body =
        action === "claim"
          ? {
              action,
              id: crypto.randomUUID(),
              organizationId: value(data, "trialOrganizationId"),
              offerVersionId: value(data, "trialOfferVersionId"),
              verificationEvidenceId: value(data, "trialEvidence"),
            }
          : {
              action,
              trialId: value(data, "trialId"),
              ...(value(data, "paidSource") === "payg"
                ? { paygEnrollmentId: value(data, "paidId") }
                : { entitlementId: value(data, "paidId") }),
            };
      const result = (await postPayg("/trials", body)) as {
        trial: { id: string };
      };
      setMessage(
        action === "claim"
          ? `Lifetime trial claim ${result.trial.id} retained. Provider enforcement requires the verified authorization adapter.`
          : `Trial ${result.trial.id} converted to its confirmed paid binding. Tenant and stored data are preserved.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Trial command was not saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>Verified trial lifecycle</h2>
      <p>
        Record a trial only for a mapped provider tenant and an existing
        server-verified domain. One claim is retained for each organization and
        domain. This does not provision storage or enable a live trial adapter.
      </p>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refresh()}
      >
        Refresh trial claims
      </button>
      {trials.map(({ trial }) => (
        <p key={trial.id}>
          Trial {trial.id} · {trial.verifiedDomain} ·{" "}
          {trial.convertedAt
            ? `Converted ${trial.convertedAt}`
            : `Write access expires ${trial.expiresAt}`}
        </p>
      ))}
      <details>
        <summary>Record verified trial claim</summary>
        <form onSubmit={(event) => void submit(event, "claim")}>
          <label>
            Organization ID
            <input name="trialOrganizationId" required />
          </label>
          <label>
            Approved trial policy
            <select name="trialOfferVersionId" required>
              {approved.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.terms.name} v{offer.terms.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Persisted domain verification reference
            <input
              name="trialEvidence"
              required
              placeholder="registration:verified-event-uuid or dns:verified-domain-uuid"
            />
          </label>
          <button
            className={styles.buttonPrimary}
            disabled={busy || approved.length === 0}
          >
            Record trial claim
          </button>
        </form>
      </details>
      <details>
        <summary>Confirm paid conversion</summary>
        <form onSubmit={(event) => void submit(event, "convert")}>
          <label>
            Trial ID
            <input name="trialId" required />
          </label>
          <label>
            Confirmed paid source
            <select name="paidSource">
              <option value="payg">PAYG enrollment</option>
              <option value="term">Active committed entitlement</option>
            </select>
          </label>
          <label>
            Paid source ID
            <input name="paidId" required />
          </label>
          <button className={styles.buttonSecondary} disabled={busy}>
            Confirm trial conversion
          </button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function PaygEnrollments({ offers }: { offers: readonly PaygOfferRecord[] }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [enrollments, setEnrollments] = useState<
    {
      id: string;
      startsAt: string;
      endsAt?: string;
      billingAuthority: string;
      binding: { accountId: string; entitlementId: string };
    }[]
  >([]);
  async function refreshEnrollments() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/enrollments", {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Enrollment list unavailable.");
      const result = (await response.json()) as {
        enrollments: typeof enrollments;
      };
      setEnrollments(result.enrollments);
      setMessage(
        result.enrollments.length
          ? ""
          : "No verified enrollments are recorded.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enrollment list unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  const approved = offers.filter((offer) => offer.status === "approved");
  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    const offer = approved.find(
      (candidate) => candidate.id === value(data, "offerVersionId"),
    );
    if (!offer) {
      setMessage("Choose an approved policy version.");
      setBusy(false);
      return;
    }
    try {
      const retained = await postPayg("/enrollments", {
        action: "enroll",
        id: crypto.randomUUID(),
        offerVersionId: offer.id,
        binding: {
          mappingVersionId: value(data, "mappingVersionId"),
          accountId: value(data, "accountId"),
          filOneOrganizationId: value(data, "organizationId"),
          tenantId: value(data, "tenantId"),
          entitlementId: value(data, "entitlementId"),
          sku: offer.terms.sku,
          region: offer.terms.region,
          source: value(data, "source"),
          meters: ["storage_bytes", "egress_bytes", "api_operations"],
          status: "active",
        },
        bindingEvidenceId: value(data, "bindingEvidenceId"),
        startsAt: new Date(value(data, "startsAt")).toISOString(),
        billingAuthority: value(data, "authority"),
        ...(value(data, "cutoverEvidenceId")
          ? { cutoverEvidenceId: value(data, "cutoverEvidenceId") }
          : {}),
      });
      setMessage(
        `Enrollment ${(retained as { enrollment: { id: string } }).enrollment.id} retained. Its approved policy and supplier identity are now frozen.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Enrollment was not saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await postPayg("/enrollments", {
        action: "cancel",
        enrollmentId: value(data, "enrollmentId"),
        serviceEndsAt: new Date(value(data, "serviceEndsAt")).toISOString(),
        evidenceId: value(data, "evidenceId"),
      });
      setMessage(
        "Confirmed service end retained. The next billing sweep will close the final service period.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Cancellation was not saved.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>Verified PAYG enrollment</h2>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refreshEnrollments()}
      >
        Refresh enrollments
      </button>
      {enrollments.map((enrollment) => (
        <p key={enrollment.id}>
          Enrollment {enrollment.id} · Account {enrollment.binding.accountId} ·{" "}
          {enrollment.billingAuthority === "clockwork"
            ? "Clockwork bills"
            : "Fil One bills"}{" "}
          ·{" "}
          {enrollment.endsAt
            ? `Service ended ${enrollment.endsAt}`
            : `Service from ${enrollment.startsAt}`}
        </p>
      ))}
      <p>
        Record an existing verified provider entitlement and its approved
        commercial cutover. This records billing authority; it does not create a
        provider account or stop storage service.
      </p>
      <details>
        <summary>Record verified enrollment</summary>
        <form onSubmit={(event) => void enroll(event)}>
          <label>
            Approved policy
            <select name="offerVersionId" required>
              {approved.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.terms.name} v{offer.terms.version}
                </option>
              ))}
            </select>
          </label>
          {[
            ["accountId", "Customer account ID"],
            ["organizationId", "Verified provider organization ID"],
            ["tenantId", "Verified provider tenant ID"],
            ["entitlementId", "Verified provider entitlement ID"],
            ["source", "Metering source name"],
            ["mappingVersionId", "Verified mapping version"],
            ["bindingEvidenceId", "Identity verification evidence reference"],
            ["startsAt", "Confirmed service start (UTC, full hour)"],
          ].map(([name, label]) => (
            <label key={name}>
              {label}
              <input
                name={name}
                required
                placeholder={
                  name === "startsAt" ? "2026-09-01T00:00:00.000Z" : undefined
                }
              />
            </label>
          ))}
          <label>
            Billing authority
            <select name="authority">
              <option value="fil_one">Fil One retains billing</option>
              <option value="clockwork">
                Clockwork, with approved cutover evidence
              </option>
            </select>
          </label>
          <label>
            Approved cutover evidence reference
            <input name="cutoverEvidenceId" />
          </label>
          <button
            disabled={busy || approved.length === 0}
            className={styles.buttonPrimary}
          >
            Record enrollment
          </button>
        </form>
      </details>
      <details>
        <summary>Record confirmed service cancellation</summary>
        <form onSubmit={(event) => void cancel(event)}>
          <label>
            Enrollment ID
            <input name="enrollmentId" required />
          </label>
          <label>
            Confirmed service end (UTC, full hour)
            <input
              name="serviceEndsAt"
              required
              placeholder="2026-09-01T01:00:00.000Z"
            />
          </label>
          <label>
            Provider service-end evidence reference
            <input name="evidenceId" required />
          </label>
          <button disabled={busy} className={styles.buttonSecondary}>
            Record confirmed cancellation
          </button>
        </form>
      </details>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

function PaygBillingQueue() {
  const [effects, setEffects] = useState<
    {
      idempotencyKey: string;
      kind: string;
      accountId: string;
      month: string;
      amount: { currency: string; minor: string };
    }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/core/payg-offers/billing-effects", {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("Unable to load retained billing effects.");
      const result = (await response.json()) as { effects: typeof effects };
      setEffects(result.effects);
      setMessage(
        result.effects.length
          ? ""
          : "No billing effects await materialization.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Billing queue unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function materialize(effectKey: string) {
    setBusy(true);
    try {
      const result = (await postPayg("/billing-effects", { effectKey })) as {
        invoiceId: string;
        creditNoteIds?: string[];
      };
      setEffects((current) =>
        current.filter((effect) => effect.idempotencyKey !== effectKey),
      );
      setMessage(
        result.creditNoteIds?.length
          ? `Credit notes ${result.creditNoteIds.join(", ")} saved and queued for provider delivery.`
          : `Invoice ${result.invoiceId} saved and queued for provider delivery.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Billing requires review.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.card}>
      <h2>Retained billing effects</h2>
      <p>
        Review rated periods and corrections, then create the corresponding
        financial documents. Each effect can be materialized once; provider
        delivery remains subject to capability gates. Corrections to paid
        invoices create customer balance credits; cash refunds require a
        separate approved refund.
      </p>
      <button
        type="button"
        className={styles.buttonSecondary}
        disabled={busy}
        onClick={() => void refresh()}
      >
        Refresh billing queue
      </button>
      {message ? <p role="status">{message}</p> : null}
      {effects.map((effect) => (
        <div key={effect.idempotencyKey}>
          <p>
            {effect.month} · {effect.kind.replaceAll("_", " ")} ·{" "}
            {effect.amount.currency} {moneyInput(effect.amount.minor)} · Account{" "}
            {effect.accountId}
          </p>
          <button
            type="button"
            className={styles.buttonSecondary}
            disabled={busy}
            onClick={() => void materialize(effect.idempotencyKey)}
          >
            Create financial document
          </button>
        </div>
      ))}
    </section>
  );
}

export function PaygOfferAdministration({
  offers: initial,
  demo = false,
  available,
  roles,
  userId,
}: {
  offers: readonly PaygOfferRecord[];
  demo?: boolean;
  available: boolean;
  roles: readonly string[];
  userId: string;
}) {
  const router = useRouter();
  const [offers, setOffers] = useState(initial);
  const [selected, setSelected] = useState<PaygOfferRecord>();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canManage = roles.includes("finance_approver");
  async function run(body: PaygOfferCommand) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await command(body);
      setOffers((current) => [
        saved,
        ...current.filter((offer) => offer.id !== saved.id),
      ]);
      setSelected(saved);
      setCreating(false);
      setMessage(
        `Policy version ${saved.terms.version} is ${saved.status}. Sales activation is unchanged.`,
      );
      router.refresh();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Policy change failed.",
      );
      throw failure;
    } finally {
      setBusy(false);
    }
  }
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const action = submitter?.value as
      "propose" | "approve" | "reject" | "retire";
    if (!action) return;
    await run({
      action,
      id: selected.id,
      expectedRowVersion: selected.rowVersion,
      reason: value(data, "reason"),
      ...(value(data, "approvalEvidenceId")
        ? { approvalEvidenceId: value(data, "approvalEvidenceId") }
        : {}),
    }).catch(() => undefined);
  }
  const distinct =
    selected &&
    ![selected.createdBy, selected.lastEditedBy, selected.proposedBy].includes(
      userId,
    );
  return (
    <AdministrationPage
      eyebrow="Commercial administration"
      title="PAYG and trial policies"
      description="Configure versioned usage pricing and trial rules. Drafts require a distinct finance approver. Approval records policy readiness; provider mappings, external gates, and account cutover still control activation."
      actions={
        <Link href="/internal/price-books" className={styles.buttonSecondary}>
          Committed price books
        </Link>
      }
    >
      <p>
        <Link href="/internal/payg-requests">
          Review customer activation, trial and cancellation requests
        </Link>
      </p>
      {demo ? (
        <p className={styles.notice}>
          Fictional policy workspace. Changes persist until demo reset. Review
          the proposal from a different demo author or create a draft. No
          enrollment, provider verification, billing execution, or live policy
          approval occurs here.
        </p>
      ) : null}
      {available && canManage && !demo ? (
        <>
          <TrialAdministration offers={offers} />
          <PaygEnrollments offers={offers} />
          <PaygBillingQueue />
        </>
      ) : null}
      {!available ? (
        <p className={styles.notice} role="status">
          The policy database is unavailable. No policy versions are shown and
          changes cannot be saved.
        </p>
      ) : null}
      {!canManage ? (
        <p className={styles.roleNotice}>
          Finance approver access is required to manage these policies.
        </p>
      ) : null}
      {message ? (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.notice}>
          {error}
        </p>
      ) : null}
      <section className={styles.panel} aria-label="Policy versions">
        <div className={styles.panelHeading}>
          <h2>Policy versions</h2>
          <button
            type="button"
            className={styles.button}
            disabled={!available || !canManage || busy}
            onClick={() => {
              setSelected(undefined);
              setCreating(true);
            }}
          >
            New policy draft
          </button>
        </div>
        <div className={styles.panelBody}>
          {offers.length ? (
            offers.map((offer) => (
              <button
                key={offer.id}
                type="button"
                className={styles.buttonSecondary}
                aria-pressed={selected?.id === offer.id}
                disabled={busy}
                onClick={() => {
                  setSelected(offer);
                  setCreating(false);
                }}
              >
                {offer.terms.name} · {offer.terms.region} · v
                {offer.terms.version} · {offer.status}
              </button>
            ))
          ) : (
            <p>No saved PAYG or trial policy versions.</p>
          )}
        </div>
      </section>
      {creating || selected ? (
        <section className={styles.panel} aria-label="Selected policy">
          <div className={styles.panelHeading}>
            <h2>
              {creating
                ? "New policy draft"
                : `${selected?.terms.name} · ${selected?.status}`}
            </h2>
          </div>
          {creating || selected?.status === "draft" ? (
            <OfferForm
              key={selected?.id ?? "new"}
              {...(selected ? { offer: selected } : {})}
              busy={busy || !canManage}
              onSave={(terms) =>
                run(
                  selected
                    ? {
                        action: "save",
                        id: selected.id,
                        expectedRowVersion: selected.rowVersion,
                        terms,
                      }
                    : { action: "create", terms },
                )
              }
            />
          ) : (
            <div className={styles.panelBody}>
              <p>
                {selected?.terms.payg.currency}{" "}
                {moneyInput(selected?.terms.payg.storageTbMonthMinor)} per
                TB-month; minimum{" "}
                {moneyInput(selected?.terms.payg.monthlyMinimumMinor)}.
                Partial-month minimum:{" "}
                {selected?.terms.payg.partialMonthMinimum}.
              </p>
              <p>
                Trial: {selected?.terms.trial.durationDays} days, then{" "}
                {selected?.terms.trial.gracePeriodDays} days read-only. Storage
                cap: {decimalStorage(selected?.terms.trial.storageLimitBytes)}.
                Cumulative egress cap:{" "}
                {decimalStorage(
                  selected?.terms.trial.cumulativeEgressLimitBytes,
                )}
                .
              </p>
              <details>
                <summary>Full policy and approval evidence</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(selected, null, 2)}
                </pre>
              </details>
            </div>
          )}
          {selected && canManage ? (
            <PaygOfferSimulator
              key={`simulation:${selected.id}:${selected.rowVersion}`}
              offer={selected}
            />
          ) : null}
          {selected && selected.status !== "retired" ? (
            <form
              key={`${selected.id}:${selected.rowVersion}`}
              onSubmit={(event) => void decide(event)}
              className={styles.panelBody}
            >
              <label className={styles.field}>
                Decision reason
                <textarea
                  name="reason"
                  required
                  minLength={8}
                  maxLength={2000}
                  disabled={busy || !canManage}
                />
              </label>
              {selected.status === "proposed" ? (
                <label className={styles.field}>
                  Approval evidence reference
                  <input
                    name="approvalEvidenceId"
                    maxLength={255}
                    disabled={busy || !canManage || !distinct}
                  />
                </label>
              ) : null}
              <div className={styles.actions}>
                {selected.status === "draft" ? (
                  <button
                    name="decision"
                    value="propose"
                    disabled={busy || !canManage}
                    className={styles.button}
                  >
                    Propose for finance approval
                  </button>
                ) : null}
                {selected.status === "proposed" ? (
                  <>
                    <button
                      name="decision"
                      value="approve"
                      disabled={busy || !canManage || !distinct}
                      className={styles.button}
                    >
                      Approve policy version
                    </button>
                    <button
                      name="decision"
                      value="reject"
                      disabled={busy || !canManage || !distinct}
                      className={styles.buttonSecondary}
                    >
                      Return to draft
                    </button>
                  </>
                ) : null}
                {selected.status === "approved" ? (
                  <button
                    name="decision"
                    value="retire"
                    disabled={busy || !canManage}
                    className={styles.buttonDanger}
                  >
                    Retire for future enrollments
                  </button>
                ) : null}
              </div>
              {selected.status === "proposed" && !distinct ? (
                <p>A different finance approver must review this version.</p>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}
    </AdministrationPage>
  );
}
