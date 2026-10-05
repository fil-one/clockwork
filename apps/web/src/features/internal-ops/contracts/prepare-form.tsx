"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import type { LocalizedText, TemplateField } from "@clockwork/contracts";
import {
  Button,
  Fieldset,
  InlineNotice,
  Input,
  Select,
  ValidationSummary,
  buttonClassName,
} from "@clockwork/ui";
import { useLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import { prepareContract } from "./actions";
import { errorMessage, fieldMessage } from "./copy";
import styles from "./contracts.module.css";

export interface Countersigner {
  id: string;
  name: string;
  title: string;
  email: string;
  isDefault: boolean;
}

const standardFields = [
  ["counterpartyName", "operations.contracts.field.counterparty"],
  ["effectiveDate", "operations.contracts.field.effectiveDate"],
  ["signerName", "operations.contracts.prepare.signerName"],
  ["signerEmail", "operations.contracts.prepare.signerEmail"],
  ["signerTitle", "operations.contracts.prepare.signerTitle"],
  ["countersignerId", "operations.contracts.prepare.countersigner"],
  ["ownerName", "operations.contracts.field.owner"],
] as const satisfies readonly (readonly [string, MessageId])[];

export function PrepareForm({
  template,
  countersigners,
  ownerName,
  today,
  signingReady,
}: {
  template: {
    id: string;
    requiresApproval: boolean;
    fields: readonly TemplateField[];
  };
  countersigners: readonly Countersigner[];
  ownerName: string;
  today: string;
  signingReady: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const id = useRef(crypto.randomUUID());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = (text: LocalizedText) => text[locale] ?? text.en;
  const defaultSigner =
    countersigners.find((signer) => signer.isDefault) ?? countersigners[0];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    setBusy(true);
    setError(null);
    const result = await prepareContract({
      id: id.current,
      templateId: template.id,
      counterpartyName: text("counterpartyName"),
      effectiveDate: text("effectiveDate"),
      signerName: text("signerName"),
      signerEmail: text("signerEmail"),
      signerTitle: text("signerTitle"),
      countersignerId: text("countersignerId"),
      ownerName: text("ownerName"),
      values: Object.fromEntries(
        template.fields.map((field) => [field.id, text(`value.${field.id}`)]),
      ),
    });
    setBusy(false);
    if (result.ok) {
      router.push(`/internal/contracts/${result.value.id}` as Route);
      return;
    }
    if (result.fields) setProblems(result.fields);
    else {
      setProblems({});
      setError(result.code);
    }
  }

  const fieldError = (path: string) =>
    problems[path] ? t(fieldMessage(problems[path])) : undefined;
  const issues = Object.entries(problems).map(([path, code]) => {
    const standard = standardFields.find(([key]) => key === path);
    const field = template.fields.find((f) => `values.${f.id}` === path);
    const label = standard
      ? t(standard[1])
      : field
        ? local(field.label)
        : t("operations.contracts.form.check");
    return {
      id: path,
      label: `${label}: ${t(fieldMessage(code))}`,
      href: `#${formId}-${path.replace(".", "-")}`,
    };
  });

  return (
    <form
      className={`${styles.card} ${styles.form}`}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      {issues.length ? (
        <ValidationSummary
          title={t("operations.contracts.form.checkFields")}
          issues={issues}
        />
      ) : null}
      {error ? (
        <InlineNotice
          tone="danger"
          title={t("operations.contracts.prepare.notPrepared")}
          description={t(errorMessage(error))}
          live="assertive"
        />
      ) : null}
      {template.requiresApproval ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.prepare.approvalTitle")}
          description={t("operations.contracts.prepare.approvalBody")}
        />
      ) : null}
      {!signingReady ? (
        <InlineNotice
          tone="warning"
          title={t("operations.contracts.error.signingNotConfigured")}
          description={t("operations.contracts.prepare.notReadyBody")}
        />
      ) : null}
      <Fieldset legend={t("operations.contracts.prepare.counterparty")}>
        <div className={styles.fieldGrid}>
          <Input
            id={`${formId}-counterpartyName`}
            name="counterpartyName"
            label={t("operations.contracts.field.counterparty")}
            help={t("operations.contracts.prepare.latinHelp")}
            maxLength={200}
            required
            error={fieldError("counterpartyName")}
          />
          <Input
            id={`${formId}-effectiveDate`}
            name="effectiveDate"
            type="date"
            label={t("operations.contracts.field.effectiveDate")}
            defaultValue={today}
            required
            error={fieldError("effectiveDate")}
          />
          <Input
            id={`${formId}-signerName`}
            name="signerName"
            label={t("operations.contracts.prepare.signerName")}
            maxLength={120}
            required
            error={fieldError("signerName")}
          />
          <Input
            id={`${formId}-signerEmail`}
            name="signerEmail"
            type="email"
            label={t("operations.contracts.prepare.signerEmail")}
            maxLength={254}
            required
            error={fieldError("signerEmail")}
          />
          <Input
            id={`${formId}-signerTitle`}
            name="signerTitle"
            label={t("operations.contracts.prepare.signerTitle")}
            maxLength={120}
            required
            error={fieldError("signerTitle")}
          />
        </div>
      </Fieldset>
      {template.fields.length ? (
        <Fieldset legend={t("operations.contracts.prepare.terms")}>
          <div className={styles.fieldGrid}>
            {template.fields.map((field) => {
              const common = {
                id: `${formId}-values-${field.id}`,
                name: `value.${field.id}`,
                label: local(field.label),
                required: field.required,
                error: fieldError(`values.${field.id}`),
                ...(field.help ? { help: local(field.help) } : {}),
                ...(field.required
                  ? {}
                  : { optionalLabel: t("operations.contracts.form.optional") }),
              };
              return field.kind === "choice" ? (
                <Select
                  key={field.id}
                  {...common}
                  defaultValue=""
                  options={[
                    {
                      value: "",
                      label: t("operations.contracts.prepare.choose"),
                      disabled: field.required,
                    },
                    ...(field.options ?? []).map((option) => ({
                      value: option.value,
                      label: local(option.label),
                    })),
                  ]}
                />
              ) : (
                <Input
                  key={field.id}
                  {...common}
                  type={
                    field.kind === "email"
                      ? "email"
                      : field.kind === "date"
                        ? "date"
                        : "text"
                  }
                  {...(field.kind === "number"
                    ? { inputMode: "numeric" as const }
                    : {})}
                  maxLength={field.maxLength ?? 200}
                />
              );
            })}
          </div>
        </Fieldset>
      ) : null}
      <Fieldset legend={t("operations.contracts.prepare.filOne")}>
        <div className={styles.fieldGrid}>
          <Select
            id={`${formId}-countersignerId`}
            name="countersignerId"
            label={t("operations.contracts.prepare.countersigner")}
            help={t("operations.contracts.prepare.order")}
            defaultValue={defaultSigner?.id ?? ""}
            options={countersigners.map((signer) => ({
              value: signer.id,
              label: `${signer.name}, ${signer.title}`,
            }))}
            error={fieldError("countersignerId")}
          />
          <Input
            id={`${formId}-ownerName`}
            name="ownerName"
            label={t("operations.contracts.field.owner")}
            defaultValue={ownerName}
            maxLength={120}
            required
            error={fieldError("ownerName")}
          />
        </div>
      </Fieldset>
      <div className={styles.formActions}>
        <Button
          type="submit"
          loading={busy}
          loadingLabel={t("operations.contracts.prepare.preparing")}
        >
          {t("operations.contracts.prepare.submit")}
        </Button>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/internal/contracts/templates"
        >
          {t("operations.contracts.form.cancel")}
        </Link>
      </div>
    </form>
  );
}
