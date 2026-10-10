"use client";
import { useEffect, useRef, useState } from "react";
import {
  mndaNoticeEmail,
  mndaSignerEmail,
  type MndaErrorCode,
  type MndaFieldError,
  type MndaRecord,
  type MndaSigner,
} from "@clockwork/contracts";
import {
  Button,
  buttonClassName,
  DescriptionList,
  Fieldset,
  FormActions,
  Input,
  RadioGroup,
  Select,
  StateBanner,
} from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import {
  findMndaDuplicates,
  operateMnda,
  prepareMnda,
  type MndaDuplicates,
} from "./actions";
import { contractStatusLabels, contractTypeLabels } from "../contracts/copy";
import {
  detailsModes,
  fieldLabels,
  formFieldOrder,
  inputFromValues,
  knownDetailFields,
  localErrors,
  partnerCompletes,
  type MndaFormField,
  type MndaFormValues,
  valuesFromRecord,
} from "./form-model";
import { mndaErrorLabels, mndaStateLabels } from "./labels";
import { formatMndaDate } from "./format";
import { mndaPdfHref } from "./register";
import styles from "./workspace.module.css";

const modeLabels = {
  mixed: "operations.mnda.mixedDetails",
  team: "operations.mnda.teamDetails",
} as const;
const modeHints = {
  mixed: "operations.mnda.mixedHint",
  team: "operations.mnda.teamHint",
} as const;
const draftStates = ["draft", "preparing", "ready", "sending"];

export type ComposerStart =
  | { kind: "form"; values: MndaFormValues }
  | { kind: "preview"; record: MndaRecord };

const noMatches: MndaDuplicates = { mndas: [], contracts: [] };

function DuplicateWarning({ matches }: { matches: MndaDuplicates }) {
  return (
    <>
      <MndaMatches matches={matches.mndas} />
      <ContractMatches matches={matches.contracts} />
    </>
  );
}

function MndaMatches({ matches }: { matches: MndaDuplicates["mndas"] }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  if (!matches.length) return null;
  return (
    <StateBanner
      tone="warning"
      live="polite"
      className={styles.inlineBanner ?? ""}
      title={t("operations.mnda.duplicate.title")}
      description={
        <ul className={styles.matchList}>
          {matches.map((match) => (
            <li key={match.id}>
              <a
                href={`/internal/mndas?q=${encodeURIComponent(match.company)}`}
                target="_blank"
                rel="noreferrer"
              >
                {match.company}
              </a>{" "}
              {t("operations.mnda.duplicate.detail", {
                status: t(mndaStateLabels[match.state]),
                date: formatMndaDate(
                  match.completedAt ?? match.createdAt,
                  locale,
                ),
                owner: match.ownerName,
              })}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/** Register contracts with the same company, NDAs or any other type. */
function ContractMatches({
  matches,
}: {
  matches: MndaDuplicates["contracts"];
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  if (!matches.length) return null;
  return (
    <StateBanner
      tone="warning"
      live="polite"
      className={styles.inlineBanner ?? ""}
      title={t("operations.mnda.duplicate.contractsTitle")}
      description={
        <ul className={styles.matchList}>
          {matches.map((match) => {
            const values = {
              type: t(contractTypeLabels[match.contractType]),
              status: t(contractStatusLabels[match.status]),
              owner: match.ownerName,
            };
            return (
              <li key={match.id}>
                <a
                  href={`/internal/contracts/${match.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {match.counterpartyName}
                </a>{" "}
                {match.effectiveDate
                  ? t("operations.mnda.duplicate.contractDetail", {
                      ...values,
                      date: formatMndaDate(match.effectiveDate, locale),
                    })
                  : t(
                      "operations.mnda.duplicate.contractDetailUndated",
                      values,
                    )}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}

/** The new-MNDA form and its preview. Editing a preview reopens the filled
 * form; the next preview replaces the previous unsent draft. */
export function MndaComposer({
  start,
  signers,
  noticeEmail,
  ready,
  canEdit,
  onClose,
  onChanged,
  onSent,
}: {
  start: ComposerStart;
  signers: readonly MndaSigner[];
  noticeEmail: string;
  ready: boolean;
  canEdit: (record: MndaRecord) => boolean;
  onClose: () => void;
  onChanged: () => void;
  onSent: (record: MndaRecord) => void;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const [values, setValues] = useState<MndaFormValues | null>(
    start.kind === "form" ? start.values : null,
  );
  const [preview, setPreview] = useState<MndaRecord | null>(
    start.kind === "preview" ? start.record : null,
  );
  // The draft this form replaces when it is previewed again.
  const [supersedes, setSupersedes] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<MndaFieldError[]>([]);
  const [failure, setFailure] = useState<MndaErrorCode | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | "discard" | null>(null);
  const [matches, setMatches] = useState<MndaDuplicates>(noMatches);
  // One id per form session: a retried preview reuses it, so a lost response
  // cannot create a second draft.
  const formId = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);

  const company = values?.company ?? preview?.input.company ?? "";
  const excludeId = preview?.id ?? supersedes;
  useEffect(() => {
    if (company.trim().length < 2) {
      setMatches(noMatches);
      return;
    }
    const timer = setTimeout(() => {
      void findMndaDuplicates({
        company,
        ...(excludeId ? { excludeId } : {}),
      }).then((result) => setMatches(result.ok ? result.value : noMatches));
    }, 400);
    return () => clearTimeout(timer);
  }, [company, excludeId]);
  useEffect(() => heading.current?.focus(), [preview]);

  const errorFor = (field: MndaFormField) => {
    const error = fieldErrors.find((e) => e.field === field);
    return error ? t(mndaErrorLabels[error.code]) : undefined;
  };
  const showErrors = (errors: MndaFieldError[]) => {
    setFieldErrors(errors);
    const first = formFieldOrder.find((f) => errors.some((e) => e.field === f));
    if (first)
      requestAnimationFrame(() =>
        document.getElementById(`mnda-field-${first}`)?.focus(),
      );
  };
  const set = (field: keyof MndaFormValues, value: string | null) => {
    setValues((current) =>
      current ? { ...current, [field]: value } : current,
    );
    setFieldErrors((errors) => errors.filter((e) => e.field !== field));
  };

  async function submit(form: MndaFormValues) {
    setFailure(null);
    const local = localErrors(form, signers);
    if (local.length) return showErrors(local);
    setBusy("preview");
    try {
      let result = await prepareMnda({
        input: inputFromValues(formId.current, form),
        ...(supersedes ? { supersedes: [supersedes] } : {}),
      });
      if (!result.ok && result.code === "conflict") {
        // A previous attempt with this id was stored before its response was
        // lost. Prepare a fresh draft that replaces both it and the draft
        // this form was already replacing.
        const lost = formId.current;
        formId.current = crypto.randomUUID();
        result = await prepareMnda({
          input: inputFromValues(formId.current, form),
          supersedes: supersedes ? [supersedes, lost] : [lost],
        });
      }
      if (!result.ok) {
        if (result.fields?.length) showErrors(result.fields);
        else setFailure(result.code);
        return;
      }
      setPreview(result.value);
      setValues(null);
      setFieldErrors([]);
      onChanged();
    } finally {
      setBusy(null);
    }
  }
  function edit(record: MndaRecord, current: MndaFormValues) {
    formId.current = crypto.randomUUID();
    setSupersedes(record.id);
    setValues(current);
    setPreview(null);
    setFailure(null);
    requestAnimationFrame(() =>
      document.getElementById("mnda-field-signerName")?.focus(),
    );
  }
  async function send(record: MndaRecord) {
    setFailure(null);
    setBusy("send");
    try {
      const result = await operateMnda({ id: record.id, operation: "send" });
      if (!result.ok) {
        setFailure(result.code);
        onChanged();
        return;
      }
      onSent(result.value);
    } finally {
      setBusy(null);
    }
  }
  async function discard(record: MndaRecord) {
    setFailure(null);
    setBusy("discard");
    try {
      const result = await operateMnda({ id: record.id, operation: "cancel" });
      if (!result.ok) return setFailure(result.code);
      onChanged();
      onClose();
    } finally {
      setBusy(null);
    }
  }

  const failureBanner = failure ? (
    <StateBanner
      tone="danger"
      live="assertive"
      className={styles.inlineBanner ?? ""}
      title={t(mndaErrorLabels[failure])}
    />
  ) : null;

  if (preview) {
    const record = preview;
    // Only the preparer or a signatory manager edits or discards a draft.
    const unsent =
      canEdit(record) &&
      !record.providerId &&
      draftStates.includes(record.state);
    const canSend = draftStates.includes(record.state);
    const completes = partnerCompletes(record.input);
    const recipientMode = record.input.detailsMode === "recipient";
    return (
      <section className={styles.panel} aria-labelledby="mnda-preview-heading">
        <h2 id="mnda-preview-heading" ref={heading} tabIndex={-1}>
          {t("operations.mnda.preview.title")}
        </h2>
        <p className={styles.muted}>{t("operations.mnda.review")}</p>
        {failureBanner}
        <DuplicateWarning matches={matches} />
        <DescriptionList
          columns={2}
          items={[
            {
              term: t("operations.mnda.preview.partner"),
              detail: (
                <>
                  {record.input.signerName}
                  <br />
                  <span className={styles.muted}>
                    {mndaSignerEmail(record)}
                  </span>
                </>
              ),
            },
            {
              term: t(
                recipientMode
                  ? "operations.mnda.partnerReference"
                  : "operations.mnda.company",
              ),
              detail: record.input.company,
            },
            {
              term: t("operations.mnda.countersigner"),
              detail: (
                <>
                  {record.countersigner.name}
                  <br />
                  <span className={styles.muted}>
                    {record.countersigner.title}
                  </span>
                </>
              ),
            },
            {
              term: t("operations.mnda.preview.notices"),
              detail: mndaNoticeEmail(record),
            },
            {
              term: t("operations.mnda.effectiveDate"),
              detail: formatMndaDate(record.input.effectiveDate, locale),
            },
            {
              term: t("operations.mnda.preview.partnerCompletes"),
              detail: completes.length
                ? completes.map((field) => t(fieldLabels[field])).join(", ")
                : t("operations.mnda.preview.nothingToComplete"),
            },
          ]}
        />
        <p className={styles.muted}>
          {t("operations.mnda.preview.order", {
            countersigner: record.countersigner.name,
          })}
        </p>
        <FormActions className={styles.actions ?? ""}>
          {canSend ? (
            <Button
              disabled={!ready || busy !== null}
              loading={busy === "send"}
              loadingLabel={t("operations.mnda.sending")}
              onClick={() => void send(record)}
            >
              {t(
                record.error
                  ? "operations.mnda.retrySend"
                  : "operations.mnda.send",
              )}
            </Button>
          ) : null}
          <a
            className={buttonClassName({ variant: "secondary" })}
            href={mndaPdfHref(record.id, "original")}
            target="_blank"
            rel="noreferrer"
          >
            {t("operations.mnda.openPdf")}
          </a>
          <a
            className={buttonClassName({ variant: "quiet" })}
            href={mndaPdfHref(record.id, "original", true)}
          >
            {t("operations.mnda.downloadPdf")}
          </a>
          {unsent ? (
            <Button
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                edit(
                  record,
                  valuesFromRecord(record, signers, { keepDate: true }),
                )
              }
            >
              {t("operations.mnda.editDetails")}
            </Button>
          ) : null}
          {unsent ? (
            <Button
              variant="quiet"
              disabled={busy !== null}
              loading={busy === "discard"}
              onClick={() => void discard(record)}
            >
              {t("operations.mnda.discardDraft")}
            </Button>
          ) : null}
          <Button variant="quiet" disabled={busy !== null} onClick={onClose}>
            {t("common.close")}
          </Button>
        </FormActions>
        {!ready ? (
          <p className={styles.muted}>{t("operations.mnda.notReady")}</p>
        ) : null}
      </section>
    );
  }

  if (!values) return null;
  const mode = values.detailsMode;
  const optional = mode === "mixed" ? t("operations.mnda.ifKnown") : undefined;
  const text = (
    field: Exclude<MndaFormField, "countersignerId">,
    props: { type?: string; help?: string; required?: boolean } = {},
  ) => {
    const value =
      field === "shortName"
        ? (values.shortName ?? values.company)
        : values[field];
    const error = errorFor(field);
    return (
      <Input
        key={field}
        id={`mnda-field-${field}`}
        name={field}
        label={t(fieldLabels[field])}
        value={value ?? ""}
        type={props.type ?? "text"}
        required={props.required}
        maxLength={props.type === "email" ? 254 : 180}
        autoComplete="off"
        {...(props.help ? { help: props.help } : {})}
        {...(error ? { error } : {})}
        {...(!props.required && optional && field !== "shortName"
          ? { optionalLabel: optional }
          : {})}
        onChange={(e) => set(field, e.target.value)}
        {...(field === "shortName"
          ? {
              onBlur: () => {
                if (!values.shortName?.trim()) set("shortName", null);
              },
            }
          : {})}
      />
    );
  };
  return (
    <section className={styles.panel} aria-labelledby="mnda-form-heading">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit(values);
        }}
      >
        <h2 id="mnda-form-heading">
          {t(supersedes ? "operations.mnda.editTitle" : "operations.mnda.new")}
        </h2>
        {failureBanner}
        {fieldErrors.length > 1 ? (
          <p className={styles.errorSummary} role="alert">
            {t("operations.mnda.error.summary", { count: fieldErrors.length })}
          </p>
        ) : null}
        <Fieldset legend={t("operations.mnda.section.signer")}>
          <div className={styles.fields}>
            {text("signerName", { required: true })}
            {text("signerEmail", { type: "email", required: true })}
          </div>
        </Fieldset>
        <Fieldset legend={t("operations.mnda.section.company")}>
          <div className={styles.fields}>
            {text("company", { required: true })}
            {text("shortName", { help: t("operations.mnda.shortNameHint") })}
          </div>
          <DuplicateWarning matches={matches} />
        </Fieldset>
        <RadioGroup
          legend={t("operations.mnda.detailsMode")}
          name="detailsMode"
          value={mode}
          className={styles.modes ?? ""}
          options={detailsModes.map((option) => ({
            value: option,
            label: t(modeLabels[option]),
            description: t(modeHints[option]),
          }))}
          onChange={(e) => set("detailsMode", e.target.value)}
        />
        <Fieldset
          legend={t(
            mode === "mixed"
              ? "operations.mnda.section.knownDetails"
              : "operations.mnda.section.details",
          )}
          description={t("operations.mnda.latin")}
        >
          <div className={styles.fields}>
            {knownDetailFields.map((field) =>
              text(field, {
                required: mode === "team",
                ...(field === "noticesEmail" ? { type: "email" } : {}),
              }),
            )}
          </div>
        </Fieldset>
        <Fieldset legend={t("operations.mnda.section.agreement")}>
          <div className={styles.fields}>
            {text("effectiveDate", { type: "date", required: true })}
            <Select
              id="mnda-field-countersignerId"
              name="countersignerId"
              label={t("operations.mnda.countersigner")}
              value={values.countersignerId}
              required
              options={signers
                .filter((s) => s.active)
                .map((s) => ({ value: s.id, label: `${s.name}, ${s.title}` }))}
              {...(errorFor("countersignerId")
                ? { error: errorFor("countersignerId") }
                : {})}
              onChange={(e) => set("countersignerId", e.target.value)}
            />
          </div>
          <p className={styles.muted}>
            {t("operations.mnda.noticeLine", { email: noticeEmail })}
          </p>
        </Fieldset>
        <p className={styles.muted}>{t("operations.mnda.order")}</p>
        <FormActions className={styles.actions ?? ""}>
          <Button
            type="submit"
            loading={busy === "preview"}
            loadingLabel={t("operations.mnda.preparing")}
            disabled={busy !== null}
          >
            {t("operations.mnda.preview")}
          </Button>
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
        </FormActions>
      </form>
    </section>
  );
}
