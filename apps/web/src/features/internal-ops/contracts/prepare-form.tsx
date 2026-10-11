"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  includedTemplateSections,
  type LocalizedText,
  type TemplateField,
  type TemplateSection,
  type TemplateValue,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  Fieldset,
  InlineNotice,
  Input,
  Select,
  ValidationSummary,
  buttonClassName,
} from "@clockwork/ui";
import { useLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import { prepareContract, previewContract } from "./actions";
import { errorMessage, fieldMessage } from "./copy";
import {
  LineItemsEditor,
  initialTable,
  lineItemsFormValue,
} from "./line-items-editor";
import type { PrepareStart } from "./prepare-input";
import { SessionExpiredReload } from "../session-expiry";
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
  initialValues,
  start = null,
  demo = false,
}: {
  template: {
    id: string;
    version: string;
    requiresApproval: boolean;
    fields: readonly TemplateField[];
    sections: readonly TemplateSection[];
  };
  countersigners: readonly Countersigner[];
  ownerName: string;
  today: string;
  signingReady: boolean;
  /** Field values to start from; a line-item table starts its editor. */
  initialValues?: Readonly<Record<string, TemplateValue>>;
  /** An earlier contract's values, for a different counterparty signer. */
  start?: PrepareStart | null;
  /** The guided demo: the form previews the PDF and prepares nothing. */
  demo?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const formId = useId();
  const id = useRef(crypto.randomUUID());
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{
    url: string;
    fileName: string;
  } | null>(null);
  const local = (text: LocalizedText) => text[locale] ?? text.en;
  const toggles = template.sections.filter((section) => !section.when);
  const [ticked, setTicked] = useState<readonly string[]>(
    () =>
      start?.sections ??
      toggles.filter((section) => section.default).map(({ id }) => id),
  );
  // Choice values decide the sections a choice field turns on.
  const [choices, setChoices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      template.fields
        .filter((field) => field.kind === "choice")
        .map((field) => {
          const value = start?.values[field.id] ?? field.default ?? "";
          return [field.id, typeof value === "string" ? value : ""];
        }),
    ),
  );
  const included = useMemo(
    () => includedTemplateSections(template, ticked, choices),
    [template, ticked, choices],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const defaultSigner =
    countersigners.find((signer) => signer.id === start?.countersignerId) ??
    countersigners.find((signer) => signer.isDefault) ??
    countersigners[0];
  // An earlier contract's template values start the form: a line-item table
  // through its editor, the other fields set once by name below.
  const startValues = start?.values ?? initialValues;
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form || !start) return;
    for (const [id, value] of Object.entries(start.values)) {
      const control = form.elements.namedItem(`value.${id}`);
      if (
        typeof value === "string" &&
        (control instanceof HTMLInputElement ||
          control instanceof HTMLSelectElement ||
          control instanceof HTMLTextAreaElement)
      )
        control.value = value;
    }
  }, [start]);

  function payload(form: FormData) {
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const asked = template.fields.filter(
      (field) => !field.section || included.has(field.section),
    );
    return {
      id: id.current,
      templateId: template.id,
      templateVersion: template.version,
      counterpartyName: text("counterpartyName"),
      effectiveDate: text("effectiveDate"),
      signerName: text("signerName"),
      signerEmail: text("signerEmail"),
      signerTitle: text("signerTitle"),
      countersignerId: text("countersignerId"),
      ownerName: text("ownerName"),
      sections: [...ticked],
      values: Object.fromEntries(
        asked.map((field) => [
          field.id,
          field.kind === "line_items"
            ? lineItemsFormValue(text(`value.${field.id}`))
            : text(`value.${field.id}`),
        ]),
      ),
    };
  }

  function report(result: { code: string; fields?: Record<string, string> }) {
    if (result.fields) setProblems(result.fields);
    else {
      setProblems({});
      setError(result.code);
    }
  }

  async function showPreview() {
    const form = formRef.current;
    if (!form) return;
    setPreviewing(true);
    setError(null);
    const result = await previewContract(payload(new FormData(form)));
    setPreviewing(false);
    if (!result.ok) {
      report(result);
      return;
    }
    setProblems({});
    const bytes = Uint8Array.from(atob(result.value.pdf), (c) =>
      c.charCodeAt(0),
    );
    setPreview({
      url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      fileName: result.value.fileName,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) return;
    setBusy(true);
    setError(null);
    const result = await prepareContract(
      payload(new FormData(event.currentTarget)),
    );
    setBusy(false);
    if (result.ok) {
      router.push(`/internal/contracts/${result.value.id}` as Route);
      return;
    }
    report(result);
  }

  // A template value is worded by its kind; a standard field by its name.
  const fieldKey = (path: string) => {
    const field = template.fields.find((f) => `values.${f.id}` === path);
    return field ? `kind:${field.kind}` : path;
  };
  const fieldError = (path: string) =>
    problems[path]
      ? t(fieldMessage(problems[path], fieldKey(path)))
      : undefined;
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
      label: `${label}: ${t(fieldMessage(code, fieldKey(path)))}`,
      href: `#${formId}-${path.replace(".", "-")}`,
    };
  });

  return (
    <form
      ref={formRef}
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
          {...(error === "SESSION_EXPIRED"
            ? {
                action: (
                  <SessionExpiredReload onReloaded={() => setError(null)} />
                ),
              }
            : {})}
        />
      ) : null}
      {start ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.prepare.fromTitle")}
          description={t("operations.contracts.prepare.fromBody")}
        />
      ) : null}
      {demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.contractTemplates.prepare.demoTitle")}
          description={t("operations.contractTemplates.prepare.demoBody")}
        />
      ) : null}
      {template.requiresApproval ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.prepare.approvalTitle")}
          description={t("operations.contracts.prepare.approvalBody")}
        />
      ) : null}
      {!signingReady && !demo ? (
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
            defaultValue={start?.counterpartyName}
            error={fieldError("counterpartyName")}
          />
          <Input
            id={`${formId}-effectiveDate`}
            name="effectiveDate"
            type="date"
            label={t("operations.contracts.field.effectiveDate")}
            defaultValue={start?.effectiveDate ?? today}
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
      {toggles.length || template.sections.some((section) => section.when) ? (
        <Fieldset
          legend={t("operations.contractTemplates.prepare.sections")}
          description={t("operations.contractTemplates.prepare.sectionsHelp")}
        >
          {toggles.map((section) => (
            <Checkbox
              key={section.id}
              id={`${formId}-section-${section.id}`}
              label={local(section.label)}
              {...(section.help ? { description: local(section.help) } : {})}
              checked={ticked.includes(section.id)}
              onChange={(event) =>
                setTicked((current) =>
                  event.target.checked
                    ? [...current, section.id]
                    : current.filter((id) => id !== section.id),
                )
              }
            />
          ))}
          {template.sections
            .filter((section) => section.when)
            .map((section) => {
              const driver = template.fields.find(
                (field) => field.id === section.when?.field,
              );
              return (
                <p key={section.id} className={styles.muted}>
                  {t(
                    included.has(section.id)
                      ? "operations.contractTemplates.prepare.followsOn"
                      : "operations.contractTemplates.prepare.followsOff",
                    {
                      section: local(section.label),
                      field: driver ? local(driver.label) : "",
                    },
                  )}
                </p>
              );
            })}
        </Fieldset>
      ) : null}
      {template.fields.length ? (
        <Fieldset legend={t("operations.contracts.prepare.terms")}>
          <div className={styles.fieldGrid}>
            {template.fields.map((field) => {
              const shown = !field.section || included.has(field.section);
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
              // A field of a section left out stays mounted, hidden, so its
              // value comes back when the section is ticked again.
              const control =
                field.kind === "line_items" ? (
                  <LineItemsEditor
                    {...common}
                    initialValue={initialTable(startValues?.[field.id])}
                  />
                ) : field.kind === "choice" ? (
                  <Select
                    {...common}
                    defaultValue={field.default ?? ""}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [field.id]: event.target.value,
                      }))
                    }
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
                    {...common}
                    type={
                      field.kind === "email"
                        ? "email"
                        : field.kind === "date"
                          ? "date"
                          : "text"
                    }
                    defaultValue={field.default ?? ""}
                    {...(field.kind === "number"
                      ? { inputMode: "numeric" as const }
                      : field.kind === "decimal" || field.kind === "percent"
                        ? { inputMode: "decimal" as const }
                        : {})}
                    {...(field.kind === "percent" ? { trailing: "%" } : {})}
                    maxLength={field.maxLength ?? 200}
                  />
                );
              return (
                <div
                  key={field.id}
                  hidden={!shown}
                  className={styles.fieldSlot}
                >
                  {control}
                </div>
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
            defaultValue={start?.ownerName ?? ownerName}
            maxLength={120}
            required
            error={fieldError("ownerName")}
          />
        </div>
      </Fieldset>
      {preview ? (
        <InlineNotice
          tone="success"
          title={t("operations.contractTemplates.prepare.previewReady")}
          description={t("operations.contractTemplates.prepare.previewBody")}
          action={
            <a
              className={buttonClassName({ variant: "secondary" })}
              href={preview.url}
              target="_blank"
              rel="noreferrer"
              download={preview.fileName}
            >
              {t("operations.contractTemplates.prepare.openPreview")}
            </a>
          }
        />
      ) : null}
      <div className={styles.formActions}>
        {demo ? null : (
          <Button
            type="submit"
            loading={busy}
            loadingLabel={t("operations.contracts.prepare.preparing")}
          >
            {t("operations.contracts.prepare.submit")}
          </Button>
        )}
        <Button
          type="button"
          variant={demo ? "primary" : "secondary"}
          loading={previewing}
          loadingLabel={t("operations.contractTemplates.prepare.previewing")}
          onClick={() => void showPreview()}
        >
          {t("operations.contractTemplates.prepare.preview")}
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
