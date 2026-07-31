"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Input, Select } from "@clockwork/ui";

import { t } from "@/src/i18n/en";

import type { SurfaceConfig } from "./surface-catalog";

const options = {
  offer: [
    { value: "annual", label: t("options.offer.annual") },
    { value: "enterprise", label: t("options.offer.enterprise") },
    { value: "poc", label: t("options.offer.poc") },
  ],
  currency: [
    { value: "USD", label: t("options.currency.usd") },
    { value: "EUR", label: t("options.currency.eur") },
    { value: "GBP", label: t("options.currency.gbp") },
  ],
  region: [
    { value: "us-east", label: t("options.region.us") },
    { value: "eu-west", label: t("options.region.eu") },
    { value: "uk-south", label: t("options.region.uk") },
  ],
} as const;

export function WorkflowPanel({
  workflow,
}: {
  workflow: NonNullable<SurfaceConfig["workflow"]>;
}) {
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [capacity, setCapacity] = useState("120");
  const [hydrated, setHydrated] = useState(false);
  const stableCapacity = useRef("120");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => setHydrated(true), []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (workflow === "quote" && Number(capacity) < 10) {
      setError(t("quotes.validation"));
      formRef.current
        ?.querySelector<HTMLInputElement>("[name=capacity]")
        ?.focus();
      return;
    }
    setPending(true);
    window.setTimeout(() => {
      setPending(false);
      if (workflow === "quote" && capacity === "13") {
        setCapacity(stableCapacity.current);
        setError(t("state.stale.description"));
        formRef.current
          ?.querySelector<HTMLInputElement>("[name=capacity]")
          ?.focus();
        return;
      }
      if (workflow === "quote") stableCapacity.current = capacity;
      setSaved(true);
    }, 450);
  };

  return (
    <section className="workflow-panel" aria-labelledby="workflow-title">
      <div>
        <p className="eyebrow">{t("common.nextAction")}</p>
        <h2 id="workflow-title">
          {workflow === "agreement"
            ? t("agreements.execute")
            : workflow === "payment"
              ? t("action.pay")
              : workflow === "assisted"
                ? t("internal.assisted.title")
                : workflow === "approval"
                  ? t("action.resolve")
                  : workflow === "brand"
                    ? t("partner.brand.title")
                    : workflow === "partner"
                      ? t("action.register")
                      : workflow === "account"
                        ? t("action.save")
                        : workflow === "admin"
                          ? t("nav.internal.admin")
                          : t("quotes.builder.title")}
        </h2>
      </div>
      <form ref={formRef} onSubmit={submit} noValidate>
        {workflow === "quote" ? (
          <>
            <Select
              label={t("quotes.offer")}
              options={options.offer}
              name="offer"
            />
            <Select
              label={t("quotes.currency")}
              options={options.currency}
              name="currency"
            />
            <Select
              label={t("quotes.region")}
              options={options.region}
              name="region"
            />
            <Input
              label={t("quotes.capacity")}
              help={t("quotes.builder.description")}
              name="capacity"
              inputMode="decimal"
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "workflow-error" : undefined}
              required
            />
          </>
        ) : null}
        {workflow === "agreement" ? (
          <>
            <Input
              label={t("agreements.signer")}
              name="signer"
              defaultValue="Maya Chen"
              required
            />
            <Input
              label={t("common.term")}
              name="title"
              defaultValue={t("options.role.coo")}
              required
            />
            <label className="checkbox-field">
              <input type="checkbox" name="authority" required />
              <span>{t("form.authority")}</span>
            </label>
          </>
        ) : null}
        {workflow === "payment" ? (
          <>
            <Input
              label={t("common.reference")}
              name="invoice"
              defaultValue="INV-2026-0781"
              readOnly
            />
            <Select
              label={t("billing.methods")}
              name="rail"
              options={[
                { value: "ach", label: t("options.payment.ach") },
                { value: "wire", label: t("options.payment.wire") },
                { value: "card", label: t("options.payment.card") },
              ]}
            />
          </>
        ) : null}
        {workflow === "assisted" ? (
          <>
            <Input
              label={t("common.account")}
              name="account"
              defaultValue="Northstar Archive Labs"
              required
            />
            <Input
              label={t("form.reason")}
              name="reason"
              minLength={8}
              required
            />
          </>
        ) : null}
        {workflow === "brand" ? (
          <>
            <Input
              label={t("app.name")}
              name="displayName"
              defaultValue="Meridian Channel Group"
            />
            <Input
              label={t("common.reference")}
              name="domain"
              defaultValue="commerce.meridian.example"
            />
          </>
        ) : null}
        {workflow === "partner" ? (
          <>
            <Input
              label={t("common.account")}
              name="endClient"
              defaultValue="Atlas Field Imaging"
              required
            />
            <Select
              label={t("table.path")}
              name="path"
              options={[
                { value: "referral", label: t("common.referral") },
                { value: "resale", label: t("common.resale") },
                { value: "distributor", label: t("common.distributor") },
              ]}
            />
          </>
        ) : null}
        {["account", "approval", "admin"].includes(workflow) ? (
          <>
            <Input
              label={t("common.reference")}
              name="reference"
              defaultValue="Northstar Archive Labs"
              required
            />
            <Input
              label={t("form.reason")}
              name="reason"
              minLength={8}
              required
            />
          </>
        ) : null}
        {error ? (
          <p
            className="form-message form-message--error"
            id="workflow-error"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {pending ? (
          <p className="form-message" role="status">
            {t("quotes.optimistic")}
          </p>
        ) : null}
        {saved ? (
          <p className="form-message form-message--success" role="status">
            {t("action.saved")}
          </p>
        ) : null}
        <div className="form-actions">
          <Button type="submit" disabled={pending || !hydrated}>
            {workflow === "payment"
              ? t("action.pay")
              : workflow === "agreement"
                ? t("signing.redirect")
                : t("action.save")}
          </Button>
          <Button
            variant="secondary"
            type="reset"
            onClick={() => {
              setError("");
              setSaved(false);
            }}
          >
            {t("action.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}
