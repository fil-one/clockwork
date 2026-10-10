"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";

import { Button, Input, Select, StateBanner } from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { SessionExpiredReload } from "../session-expiry";
import { createOrganization } from "./actions";
import { organizationErrorMessage } from "./model";
import styles from "../handoff/handoff.module.css";

const wide = styles.wide ?? "";

export interface OrganizationFormDefaults {
  handoffRequestId: string | null;
  legalName: string;
  side: "customer" | "channel_partner";
  billingName: string;
  billingEmail: string;
  domain: string;
}

/**
 * Sets up a customer or partner organization. The organization id is minted
 * once per form, so a retried submission returns the one already created.
 */
export function OrganizationForm({
  defaults,
}: {
  defaults: OrganizationFormDefaults;
}) {
  const t = useTranslations();
  const router = useRouter();
  const organizationId = useRef<string | null>(null);
  const [side, setSide] = useState<string>(defaults.side);
  const [code, setCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const error = (name: string) =>
    fields[name]
      ? t("operations.organizations.error.INVALID_INPUT")
      : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    organizationId.current ??= crypto.randomUUID();
    const input = {
      id: organizationId.current,
      handoffRequestId: defaults.handoffRequestId,
      legalName: text("legalName"),
      side: text("side"),
      ...(text("side") === "channel_partner"
        ? { channelAgreementType: text("channelAgreementType") }
        : {}),
      country: text("country").trim().toUpperCase(),
      currency: text("currency"),
      domain: text("domain"),
      registeredAddress: {
        line1: text("line1"),
        line2: text("line2"),
        city: text("city"),
        region: text("region"),
        postalCode: text("postalCode"),
      },
      billingContact: {
        name: text("billingName"),
        email: text("billingEmail"),
      },
      invoiceDeliveryEmail: text("invoiceEmail"),
    };
    setCode(null);
    setFields({});
    startTransition(async () => {
      const result = await createOrganization(input).catch(() => ({
        ok: false as const,
        code: "UNEXPECTED",
      }));
      if (result.ok) {
        router.push(
          `/internal/organizations/${result.value.organizationId}?created=1` as Route,
        );
        return;
      }
      setFields("fields" in result && result.fields ? result.fields : {});
      setCode(result.code);
    });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {code ? (
        <div className={wide} role="alert">
          <StateBanner
            tone="danger"
            title={t(organizationErrorMessage(code))}
            {...(code === "SESSION_EXPIRED"
              ? {
                  action: (
                    <SessionExpiredReload onReloaded={() => setCode(null)} />
                  ),
                }
              : {})}
          />
        </div>
      ) : null}
      <Input
        fieldClassName={wide}
        label={t("operations.organizations.form.legalName")}
        name="legalName"
        defaultValue={defaults.legalName}
        maxLength={200}
        required
        error={error("legalName")}
      />
      <Select
        label={t("operations.organizations.form.side")}
        name="side"
        value={side}
        onChange={(event) => setSide(event.target.value)}
        options={[
          {
            value: "customer",
            label: t("operations.organizations.side.customer"),
          },
          {
            value: "channel_partner",
            label: t("operations.organizations.side.channel_partner"),
          },
          {
            value: "referral_partner",
            label: t("operations.organizations.side.referral_partner"),
          },
        ]}
      />
      {side === "channel_partner" ? (
        <Select
          label={t("operations.organizations.form.agreementType")}
          name="channelAgreementType"
          defaultValue="resale"
          options={[
            {
              value: "resale",
              label: t("operations.organizations.form.agreementType.resale"),
            },
            {
              value: "msp",
              label: t("operations.organizations.form.agreementType.msp"),
            },
            {
              value: "embedded",
              label: t("operations.organizations.form.agreementType.embedded"),
            },
          ]}
        />
      ) : null}
      <Input
        label={t("operations.organizations.form.country")}
        help={t("operations.organizations.form.countryHelp")}
        name="country"
        maxLength={2}
        autoComplete="country"
        required
        error={error("country")}
      />
      <Select
        label={t("operations.organizations.form.currency")}
        name="currency"
        defaultValue="USD"
        options={["USD", "EUR", "GBP"].map((value) => ({
          value,
          label: value,
        }))}
      />
      <Input
        label={t("operations.organizations.form.domain")}
        help={t("operations.organizations.form.domainHelp")}
        name="domain"
        defaultValue={defaults.domain}
        maxLength={253}
        required
        error={error("domain")}
      />
      <Input
        fieldClassName={wide}
        label={t("operations.organizations.form.line1")}
        name="line1"
        maxLength={200}
        required
        error={error("registeredAddress.line1")}
      />
      <Input
        fieldClassName={wide}
        label={t("operations.organizations.form.line2")}
        optionalLabel={t("operations.organizations.form.optional")}
        name="line2"
        maxLength={200}
      />
      <Input
        label={t("operations.organizations.form.city")}
        name="city"
        maxLength={120}
        required
        error={error("registeredAddress.city")}
      />
      <Input
        label={t("operations.organizations.form.region")}
        optionalLabel={t("operations.organizations.form.optional")}
        name="region"
        maxLength={120}
      />
      <Input
        label={t("operations.organizations.form.postalCode")}
        name="postalCode"
        maxLength={40}
        required
        error={error("registeredAddress.postalCode")}
      />
      <Input
        label={t("operations.organizations.form.billingName")}
        name="billingName"
        defaultValue={defaults.billingName}
        maxLength={200}
        required
        error={error("billingContact.name")}
      />
      <Input
        label={t("operations.organizations.form.billingEmail")}
        name="billingEmail"
        type="email"
        defaultValue={defaults.billingEmail}
        maxLength={320}
        required
        error={error("billingContact.email")}
      />
      <Input
        label={t("operations.organizations.form.invoiceEmail")}
        name="invoiceEmail"
        type="email"
        defaultValue={defaults.billingEmail}
        maxLength={320}
        required
        error={error("invoiceDeliveryEmail")}
      />
      <div className={`${styles.actions} ${wide}`}>
        <Button type="submit" variant="primary" loading={pending}>
          {pending
            ? t("operations.organizations.form.pending")
            : t("operations.organizations.form.submit")}
        </Button>
      </div>
    </form>
  );
}
