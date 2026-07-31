"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, Input, Select } from "@clockwork/ui";

import { registerOrganization } from "@/src/features/contracts/commerce-client";

function value(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export function RegistrationForm({
  initialRegistrationToken,
}: {
  initialRegistrationToken: string;
}) {
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
      setError("Enter both AP contact name and email, or leave both blank.");
      window.setTimeout(
        () => form.querySelector<HTMLElement>("[name=apName]")?.focus(),
        0,
      );
      return;
    }
    if (Boolean(taxJurisdiction) !== Boolean(taxId)) {
      setError("Enter both tax jurisdiction and tax ID, or leave both blank.");
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
      setError(
        caught instanceof Error
          ? caught.message
          : "Registration failed. No organization was created.",
      );
      window.setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      setPending(false);
    }
  };

  if (completed)
    return (
      <div className="provider-state provider-state--success" role="status">
        <h2>Registration accepted</h2>
        <p>
          Your organization record is being linked to WorkOS. Continue to sign
          in; access remains closed until that durable link is complete.
        </p>
        <Link className="cw-button cw-button--primary" href="/sign-in">
          Continue to sign in
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
            Verified sign-up context received. The one-time code has been
            removed from the address bar.
          </p>
        </>
      ) : (
        <Input
          label="WorkOS registration code"
          name="registrationToken"
          type="password"
          minLength={32}
          autoComplete="one-time-code"
          help="Use the one-time code from the secure WorkOS registration redirect."
          required
        />
      )}
      <Input
        label="Legal entity name"
        name="legalName"
        minLength={2}
        required
      />
      <Select
        label="Relationship"
        name="relationshipRole"
        defaultValue="direct_client"
        options={[
          { value: "direct_client", label: "Direct client" },
          { value: "partner", label: "Partner" },
          { value: "end_client", label: "End client" },
        ]}
      />
      <Input
        label="Verified work email"
        name="registrantEmail"
        type="email"
        autoComplete="email"
        required
      />
      <Input
        label="Business domain"
        name="businessDomain"
        inputMode="url"
        help="Must match the domain of the verified WorkOS email."
        required
      />
      <Select
        label="Country"
        name="country"
        defaultValue="US"
        options={[
          { value: "US", label: "United States" },
          { value: "GB", label: "United Kingdom" },
          { value: "ES", label: "Spain" },
        ]}
      />
      <Input
        label="Registered address"
        name="addressLine1"
        autoComplete="address-line1"
        required
      />
      <Input
        label="Address line 2"
        name="addressLine2"
        autoComplete="address-line2"
        optionalLabel="Optional"
      />
      <Input label="City" name="city" autoComplete="address-level2" required />
      <Input
        label="State or region"
        name="region"
        autoComplete="address-level1"
        optionalLabel="Optional"
      />
      <Input
        label="Postal code"
        name="postalCode"
        autoComplete="postal-code"
        required
      />
      <Input label="Billing contact name" name="billingName" required />
      <Input
        label="Billing contact email"
        name="billingEmail"
        type="email"
        required
      />
      <Input label="AP contact name" name="apName" optionalLabel="Optional" />
      <Input
        label="AP contact email"
        name="apEmail"
        type="email"
        optionalLabel="Optional"
      />
      <Input
        label="Invoice delivery email"
        name="invoiceDeliveryEmail"
        type="email"
        required
      />
      <Input
        label="Tax jurisdiction"
        name="taxJurisdiction"
        pattern="[A-Za-z]{2}"
        maxLength={2}
        optionalLabel="Optional"
      />
      <Input label="Tax ID" name="taxId" optionalLabel="Optional" />
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
          loadingLabel="Registering securely…"
        >
          Register organization
        </Button>
        <Link className="cw-button cw-button--secondary" href="/sign-in">
          Already registered
        </Link>
      </div>
    </form>
  );
}
