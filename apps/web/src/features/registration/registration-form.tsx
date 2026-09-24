"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button, buttonClassName, Input, Select } from "@clockwork/ui";

import { registerOrganization } from "@/src/features/contracts/commerce-client";
import { commerceErrorText } from "@/src/features/contracts/error-text";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

/** Countries a registration can name today; labels come from `Intl`. */
const registrationCountries = ["US", "GB", "ES"] as const;

function value(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export function RegistrationForm({
  initialRegistrationToken,
}: {
  initialRegistrationToken: string;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const countryOptions = useMemo(() => {
    const names = new Intl.DisplayNames(locale, { type: "region" });
    const collator = new Intl.Collator(locale);
    return registrationCountries
      .map((code) => ({ value: code, label: names.of(code) ?? code }))
      .sort((left, right) => collator.compare(left.label, right.label));
  }, [locale]);
  const optional = t("common.optional");
  const [pending, setPending] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!initialRegistrationToken || window.location.search.length === 0)
      return;
    window.history.replaceState(null, "", "/register");
  }, [initialRegistrationToken]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    if (!form.checkValidity()) {
      form.reportValidity();
      form.querySelector<HTMLElement>(":invalid")?.focus();
      return;
    }
    const data = new FormData(form);
    const apName = value(data, "apName");
    const apEmail = value(data, "apEmail");
    const taxJurisdiction = value(data, "taxJurisdiction").toUpperCase();
    const taxId = value(data, "taxId");
    if (Boolean(apName) !== Boolean(apEmail)) {
      setError(t("platform.registration.apPair"));
      window.setTimeout(
        () => form.querySelector<HTMLElement>("[name=apName]")?.focus(),
        0,
      );
      return;
    }
    if (Boolean(taxJurisdiction) !== Boolean(taxId)) {
      setError(t("platform.registration.taxPair"));
      window.setTimeout(
        () =>
          form.querySelector<HTMLElement>("[name=taxJurisdiction]")?.focus(),
        0,
      );
      return;
    }
    const country = value(data, "country").toUpperCase();
    setPending(true);
    try {
      await registerOrganization({
        legalName: value(data, "legalName"),
        country,
        registeredAddress: {
          line1: value(data, "addressLine1"),
          ...(value(data, "addressLine2")
            ? { line2: value(data, "addressLine2") }
            : {}),
          city: value(data, "city"),
          ...(value(data, "region") ? { region: value(data, "region") } : {}),
          postalCode: value(data, "postalCode"),
          country,
        },
        relationshipRoles: [
          value(data, "relationshipRole") as
            "direct_client" | "partner" | "end_client",
        ],
        businessDomain: value(data, "businessDomain").toLowerCase(),
        registrantEmail: value(data, "registrantEmail").toLowerCase(),
        registrationToken: value(data, "registrationToken"),
        taxIds:
          taxJurisdiction && taxId
            ? [{ jurisdiction: taxJurisdiction, value: taxId }]
            : [],
        billingContact: {
          name: value(data, "billingName"),
          email: value(data, "billingEmail").toLowerCase(),
        },
        apContact:
          apName && apEmail
            ? { name: apName, email: apEmail.toLowerCase() }
            : null,
        invoiceDeliveryEmail: value(data, "invoiceDeliveryEmail").toLowerCase(),
      });
      setCompleted(true);
    } catch (caught) {
      // What happened, then why, as two sentences in the reader's language.
      setError(
        t("common.join.sentences", {
          first: t("platform.registration.failed"),
          second: commerceErrorText(caught, t),
        }),
      );
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setPending(false);
    }
  };

  if (completed)
    return (
      <div className="provider-state provider-state--success" role="status">
        <h2>{t("platform.registration.accepted.title")}</h2>
        <p>{t("platform.registration.accepted.description")}</p>
        <Link
          className={buttonClassName({ variant: "primary" })}
          href="/sign-in"
        >
          {t("platform.registration.accepted.continue")}
        </Link>
      </div>
    );

  return (
    <form
      className="registration-form"
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      {initialRegistrationToken ? (
        <>
          <input
            type="hidden"
            name="registrationToken"
            value={initialRegistrationToken}
          />
          <p className="form-message" role="status">
            {t("platform.registration.tokenReceived")}
          </p>
        </>
      ) : (
        <Input
          label={t("platform.registration.token")}
          name="registrationToken"
          type="password"
          minLength={32}
          autoComplete="one-time-code"
          help={t("platform.registration.tokenHelp")}
          required
        />
      )}
      <Input
        label={t("platform.registration.legalName")}
        name="legalName"
        minLength={2}
        required
      />
      <Select
        label={t("platform.registration.relationship")}
        name="relationshipRole"
        defaultValue="direct_client"
        options={[
          {
            value: "direct_client",
            label: t("platform.registration.relationship.directClient"),
          },
          {
            value: "partner",
            label: t("platform.registration.relationship.partner"),
          },
          {
            value: "end_client",
            label: t("platform.registration.relationship.endClient"),
          },
        ]}
      />
      <Input
        label={t("platform.registration.registrantEmail")}
        name="registrantEmail"
        type="email"
        autoComplete="email"
        required
      />
      <Input
        label={t("platform.registration.businessDomain")}
        name="businessDomain"
        inputMode="url"
        help={t("platform.registration.businessDomainHelp")}
        required
      />
      <Select
        label={t("platform.registration.country")}
        name="country"
        defaultValue="US"
        options={countryOptions}
      />
      <Input
        label={t("platform.registration.addressLine1")}
        name="addressLine1"
        autoComplete="address-line1"
        required
      />
      <Input
        label={t("platform.registration.addressLine2")}
        name="addressLine2"
        autoComplete="address-line2"
        optionalLabel={optional}
      />
      <Input
        label={t("platform.registration.city")}
        name="city"
        autoComplete="address-level2"
        required
      />
      <Input
        label={t("platform.registration.region")}
        name="region"
        autoComplete="address-level1"
        optionalLabel={optional}
      />
      <Input
        label={t("platform.registration.postalCode")}
        name="postalCode"
        autoComplete="postal-code"
        required
      />
      <Input
        label={t("platform.registration.billingName")}
        name="billingName"
        required
      />
      <Input
        label={t("platform.registration.billingEmail")}
        name="billingEmail"
        type="email"
        required
      />
      <Input
        label={t("platform.registration.apName")}
        name="apName"
        optionalLabel={optional}
      />
      <Input
        label={t("platform.registration.apEmail")}
        name="apEmail"
        type="email"
        optionalLabel={optional}
      />
      <Input
        label={t("platform.registration.invoiceDeliveryEmail")}
        name="invoiceDeliveryEmail"
        type="email"
        required
      />
      <Input
        label={t("platform.registration.taxJurisdiction")}
        name="taxJurisdiction"
        pattern="[A-Za-z]{2}"
        maxLength={2}
        help={t("platform.registration.taxJurisdictionHelp")}
        optionalLabel={optional}
      />
      <Input
        label={t("platform.registration.taxId")}
        name="taxId"
        optionalLabel={optional}
      />
      {error ? (
        <p
          className="form-message form-message--error"
          role="alert"
          ref={errorRef}
          tabIndex={-1}
        >
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <Button
          type="submit"
          loading={pending}
          loadingLabel={t("platform.registration.submitting")}
        >
          {t("platform.registration.submit")}
        </Button>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/sign-in"
        >
          {t("platform.registration.signIn")}
        </Link>
      </div>
    </form>
  );
}
