"use client";

import Link from "next/link";
import type { Route } from "next";
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
  X,
  Button,
  Checkbox,
  Fieldset,
  IconButton,
  InlineNotice,
  Input,
  RadioGroup,
  Select,
  Textarea,
  ValidationSummary,
  buttonClassName,
} from "@clockwork/ui";
import {
  contractCurrencies,
  contractPapers,
  contractStatuses,
  contractTypes,
  contractValueToMinor,
  uploadableContractFileKinds,
  type ContractCurrency,
  type ContractInput,
  type ContractPaper,
  type ContractRecord,
  type ContractStatus,
  type ContractType,
  type UploadableContractFileKind,
} from "@clockwork/contracts";
import { contractTermSchedule } from "@clockwork/domain/contract-terms";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import { findContractDuplicates, saveContract } from "./actions";
import type { MndaDuplicates } from "../mnda/actions";
import {
  DuplicateWarning,
  noDuplicateMatches,
} from "../mnda/duplicate-warning";
import {
  contractFileKindLabels,
  contractPaperLabels,
  contractStatusLabels,
  contractTypeLabels,
  errorMessage,
  fieldMessage,
  formatContractDate,
  formatFileSize,
} from "./copy";
import { SessionExpiredReload } from "../session-expiry";
import type { ContractFormMnda } from "./loaders";
import { localFileProblem, uploadContractFile } from "./upload-client";
import styles from "./contracts.module.css";

interface Draft {
  counterpartyName: string;
  title: string;
  contractType: ContractType;
  paper: ContractPaper;
  status: ContractStatus;
  effectiveDate: string;
  initialTermMonths: string;
  autoRenew: boolean;
  renewalTermMonths: string;
  noticePeriodDays: string;
  value: string;
  currency: ContractCurrency;
  pricingNotes: string;
  ownerName: string;
  internalNotes: string;
  tags: string;
}

interface PendingFile {
  key: string;
  file: File;
  kind: UploadableContractFileKind;
  problem: string | null;
}

const fieldLabels: Readonly<Record<string, MessageId>> = {
  counterpartyName: "operations.contracts.field.counterparty",
  title: "operations.contracts.field.title",
  contractType: "operations.contracts.field.type",
  paper: "operations.contracts.field.paper",
  status: "operations.contracts.field.status",
  effectiveDate: "operations.contracts.field.effectiveDate",
  initialTermMonths: "operations.contracts.field.initialTerm",
  renewalTermMonths: "operations.contracts.field.renewalTerm",
  noticePeriodDays: "operations.contracts.field.noticePeriod",
  valueMinor: "operations.contracts.field.value",
  value: "operations.contracts.field.value",
  currency: "operations.contracts.field.currency",
  pricingNotes: "operations.contracts.field.pricingNotes",
  ownerName: "operations.contracts.field.owner",
  internalNotes: "operations.contracts.field.internalNotes",
  tags: "operations.contracts.field.tags",
};

function draftFrom(
  contract: ContractRecord | null,
  ownerName: string,
  type: ContractType | undefined,
  mnda: ContractFormMnda | undefined,
): Draft {
  return {
    counterpartyName: contract?.counterpartyName ?? mnda?.company ?? "",
    title: contract?.title ?? "",
    contractType: contract?.contractType ?? type ?? "customer_msa",
    paper: contract?.paper ?? "theirs",
    status: contract?.status ?? "executed",
    effectiveDate: contract?.effectiveDate ?? "",
    initialTermMonths: contract?.initialTermMonths?.toString() ?? "",
    autoRenew: contract?.autoRenew ?? false,
    renewalTermMonths: contract?.renewalTermMonths?.toString() ?? "",
    noticePeriodDays: contract?.noticePeriodDays?.toString() ?? "",
    value:
      contract?.valueMinor === null || contract?.valueMinor === undefined
        ? ""
        : (contract.valueMinor / 100).toFixed(2).replace(/\.00$/, ""),
    currency: contract?.currency ?? "USD",
    pricingNotes: contract?.pricingNotes ?? "",
    ownerName: contract?.ownerName ?? ownerName,
    internalNotes: contract?.internalNotes ?? "",
    tags: contract?.tags.join(", ") ?? "",
  };
}

const wholeNumber = (text: string) =>
  text.trim() === "" ? null : /^\d+$/.test(text.trim()) ? Number(text) : NaN;

/** Turns the form into register input, or field problems to show. */
function toInput(
  id: string,
  draft: Draft,
): { input: ContractInput } | { problems: Record<string, string> } {
  const problems: Record<string, string> = {};
  const numbers = {
    initialTermMonths: wholeNumber(draft.initialTermMonths),
    renewalTermMonths: wholeNumber(draft.renewalTermMonths),
    noticePeriodDays: wholeNumber(draft.noticePeriodDays),
  };
  for (const [key, value] of Object.entries(numbers))
    if (Number.isNaN(value)) problems[key] = "number";
  let valueMinor: number | null = null;
  if (draft.value.trim()) {
    try {
      valueMinor = contractValueToMinor(draft.value);
    } catch {
      problems.value = "value_format";
    }
  }
  if (!draft.counterpartyName.trim()) problems.counterpartyName = "required";
  if (!draft.ownerName.trim()) problems.ownerName = "required";
  if (Object.keys(problems).length) return { problems };
  return {
    input: {
      id,
      counterpartyName: draft.counterpartyName,
      title: draft.title,
      contractType: draft.contractType,
      paper: draft.paper,
      status: draft.status,
      effectiveDate: draft.effectiveDate || null,
      initialTermMonths: numbers.initialTermMonths,
      autoRenew: draft.autoRenew,
      renewalTermMonths: draft.autoRenew
        ? (numbers.renewalTermMonths ?? numbers.initialTermMonths)
        : null,
      noticePeriodDays: numbers.noticePeriodDays,
      valueMinor,
      currency: valueMinor === null ? null : draft.currency,
      pricingNotes: draft.pricingNotes,
      ownerName: draft.ownerName,
      internalNotes: draft.internalNotes,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    },
  };
}

function defaultKind(
  draft: Pick<Draft, "status" | "paper">,
  index: number,
): UploadableContractFileKind {
  if (draft.status === "executed" || draft.status === "out_for_signature")
    return index === 0 ? "main" : "attachment";
  if (draft.paper === "theirs") return "counterparty_draft";
  return index === 0 ? "main" : "attachment";
}

export function ContractForm({
  contract,
  ownerName,
  today,
  initialType,
  fromMnda,
}: {
  contract: ContractRecord | null;
  ownerName: string;
  today: string;
  initialType?: ContractType;
  /** A signed MNDA with the same counterparty, which fills the name. */
  fromMnda?: ContractFormMnda;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const formId = useId();
  const id = useRef(contract?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState(() =>
    draftFrom(contract, ownerName, initialType, fromMnda),
  );
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [failedUploads, setFailedUploads] = useState<
    { name: string; code: string }[]
  >([]);
  const [matches, setMatches] = useState<MndaDuplicates>(noDuplicateMatches);
  const busy = progress !== null;
  const editing = contract !== null;
  const fromMndaId = fromMnda?.id;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const schedule = useMemo(() => {
    const parsed = toInput(id.current, draft);
    if (!("input" in parsed) || !parsed.input.effectiveDate) return null;
    try {
      return contractTermSchedule(parsed.input, today);
    } catch {
      return null;
    }
  }, [draft, today]);

  // A new contract shows what already exists for the same counterparty,
  // as the MNDA form does. It never blocks the save.
  const counterparty = draft.counterpartyName;
  useEffect(() => {
    if (editing || counterparty.trim().length < 2) {
      setMatches(noDuplicateMatches);
      return;
    }
    // A response for a name the seller has since changed is dropped.
    let live = true;
    const timer = setTimeout(() => {
      void findContractDuplicates({
        counterpartyName: counterparty,
        ...(fromMndaId ? { excludeMndaId: fromMndaId } : {}),
      })
        .then((result) => {
          if (live) setMatches(result.ok ? result.value : noDuplicateMatches);
        })
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [editing, counterparty, fromMndaId]);

  const fieldError = (key: string) =>
    problems[key] ? t(fieldMessage(problems[key])) : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFailedUploads([]);
    const parsed = toInput(id.current, draft);
    if ("problems" in parsed) {
      setProblems(parsed.problems);
      return;
    }
    if (files.some((file) => file.problem)) return;
    setProblems({});
    setProgress(t("operations.contracts.form.saving"));
    const saved = await saveContract({
      contract: parsed.input,
      ...(contract ? { expectedVersion: contract.version } : {}),
    });
    if (!saved.ok) {
      setProgress(null);
      if (saved.fields) {
        const next: Record<string, string> = {};
        for (const [path, code] of Object.entries(saved.fields))
          next[
            path.split(".")[0] === "valueMinor"
              ? "value"
              : (path.split(".")[0] ?? "_")
          ] = code;
        setProblems(next);
      } else setError(saved.code);
      return;
    }
    const failed: { name: string; code: string }[] = [];
    for (const [index, pending] of files.entries()) {
      setProgress(
        t("operations.contracts.form.uploading", {
          name: pending.file.name,
          index: index + 1,
          total: files.length,
        }),
      );
      const uploaded = await uploadContractFile(
        saved.value.id,
        pending.file,
        pending.kind,
      );
      if (!uploaded.ok)
        failed.push({ name: pending.file.name, code: uploaded.code });
    }
    setProgress(null);
    if (failed.length) {
      // The contract exists now; keep the same id so a resubmit is harmless,
      // and point to the contract where the files can be added again.
      setFiles([]);
      setFailedUploads(failed);
      return;
    }
    router.push(`/internal/contracts/${saved.value.id}` as Route);
    router.refresh();
  }

  const issues = Object.entries(problems).map(([key, code]) => ({
    id: key,
    label: `${t(fieldLabels[key] ?? "operations.contracts.form.check")}: ${t(fieldMessage(code))}`,
    href: `#${formId}-${key}`,
  }));

  if (failedUploads.length)
    return (
      <InlineNotice
        tone="warning"
        title={t("operations.contracts.form.partialTitle")}
        description={
          <ul className={styles.changeList}>
            {failedUploads.map((failure) => (
              <li key={failure.name}>
                {failure.name}: {t(errorMessage(failure.code))}
              </li>
            ))}
          </ul>
        }
        action={
          <Link
            className={buttonClassName()}
            href={`/internal/contracts/${id.current}` as Route}
          >
            {t("operations.contracts.form.openContract")}
          </Link>
        }
        live="assertive"
      />
    );

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
          title={t("operations.contracts.form.notSaved")}
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

      {fromMnda ? (
        <InlineNotice
          tone="info"
          title={t("operations.contracts.new.fromMnda", {
            signer: fromMnda.signerName,
            date: formatContractDate(fromMnda.signedOn, locale),
          })}
        />
      ) : null}
      <Fieldset legend={t("operations.contracts.form.parties")}>
        <div className={styles.fieldGrid}>
          <Input
            id={`${formId}-counterpartyName`}
            label={t("operations.contracts.field.counterparty")}
            help={t("operations.contracts.field.counterpartyHelp")}
            value={draft.counterpartyName}
            onChange={(e) => set("counterpartyName", e.target.value)}
            maxLength={200}
            required
            autoComplete="organization"
            error={fieldError("counterpartyName")}
          />
          <Input
            id={`${formId}-title`}
            label={t("operations.contracts.field.title")}
            optionalLabel={t("operations.contracts.form.optional")}
            help={t("operations.contracts.field.titleHelp")}
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={200}
            error={fieldError("title")}
          />
          <Select
            id={`${formId}-contractType`}
            label={t("operations.contracts.field.type")}
            value={draft.contractType}
            onChange={(e) =>
              set("contractType", e.target.value as ContractType)
            }
            options={contractTypes.map((type) => ({
              value: type,
              label: t(contractTypeLabels[type]),
            }))}
          />
          <Select
            id={`${formId}-status`}
            label={t("operations.contracts.field.status")}
            value={draft.status}
            onChange={(e) => set("status", e.target.value as ContractStatus)}
            options={contractStatuses
              // An executed contract can only expire or be terminated.
              .filter(
                (status) =>
                  !contract?.executedAt ||
                  ["executed", "expired", "terminated"].includes(status),
              )
              .map((status) => ({
                value: status,
                label: t(contractStatusLabels[status]),
              }))}
            {...(contract?.executedAt
              ? { help: t("operations.contracts.field.statusExecutedHelp") }
              : {})}
            error={fieldError("status")}
          />
        </div>
        <DuplicateWarning matches={matches} />
        <RadioGroup
          legend={t("operations.contracts.field.paper")}
          name={`${formId}-paper`}
          value={draft.paper}
          onChange={(e) => set("paper", e.target.value as ContractPaper)}
          options={contractPapers.map((paper) => ({
            value: paper,
            label: t(contractPaperLabels[paper]),
            description: t(
              paper === "ours"
                ? "operations.contracts.paper.oursHelp"
                : "operations.contracts.paper.theirsHelp",
            ),
          }))}
        />
      </Fieldset>

      <Fieldset
        legend={t("operations.contracts.form.term")}
        description={t("operations.contracts.form.termHelp")}
      >
        <div className={styles.fieldGrid}>
          <Input
            id={`${formId}-effectiveDate`}
            type="date"
            label={t("operations.contracts.field.effectiveDate")}
            value={draft.effectiveDate}
            onChange={(e) => set("effectiveDate", e.target.value)}
            error={fieldError("effectiveDate")}
          />
          <Input
            id={`${formId}-initialTermMonths`}
            inputMode="numeric"
            label={t("operations.contracts.field.initialTerm")}
            help={t("operations.contracts.field.monthsHelp")}
            value={draft.initialTermMonths}
            onChange={(e) => set("initialTermMonths", e.target.value)}
            error={fieldError("initialTermMonths")}
          />
          <Input
            id={`${formId}-noticePeriodDays`}
            inputMode="numeric"
            label={t("operations.contracts.field.noticePeriod")}
            help={t("operations.contracts.field.noticeHelp")}
            value={draft.noticePeriodDays}
            onChange={(e) => set("noticePeriodDays", e.target.value)}
            error={fieldError("noticePeriodDays")}
          />
        </div>
        <Checkbox
          label={t("operations.contracts.field.autoRenew")}
          description={t("operations.contracts.field.autoRenewHelp")}
          checked={draft.autoRenew}
          onChange={(e) => set("autoRenew", e.target.checked)}
        />
        {draft.autoRenew ? (
          <div className={styles.fieldGrid}>
            <Input
              id={`${formId}-renewalTermMonths`}
              inputMode="numeric"
              label={t("operations.contracts.field.renewalTerm")}
              help={t("operations.contracts.field.renewalTermHelp")}
              value={draft.renewalTermMonths}
              placeholder={draft.initialTermMonths}
              onChange={(e) => set("renewalTermMonths", e.target.value)}
              error={fieldError("renewalTermMonths")}
            />
          </div>
        ) : null}
        {schedule?.termEndDate ? (
          <p className={styles.termPreview} aria-live="polite">
            <span>
              {t("operations.contracts.field.termEnds")}:{" "}
              <strong>
                {formatContractDate(schedule.termEndDate, locale)}
              </strong>
            </span>
            {schedule.renewalDate ? (
              <span>
                {t("operations.contracts.field.renewsOn")}:{" "}
                <strong>
                  {formatContractDate(schedule.renewalDate, locale)}
                </strong>
              </span>
            ) : null}
            {schedule.noticeDeadline ? (
              <span>
                {t("operations.contracts.field.noticeDeadline")}:{" "}
                <strong>
                  {formatContractDate(schedule.noticeDeadline, locale)}
                </strong>
              </span>
            ) : null}
          </p>
        ) : null}
      </Fieldset>

      <Fieldset legend={t("operations.contracts.form.commercial")}>
        <div className={styles.fieldGrid}>
          <Input
            id={`${formId}-value`}
            inputMode="decimal"
            label={t("operations.contracts.field.value")}
            optionalLabel={t("operations.contracts.form.optional")}
            help={t("operations.contracts.field.valueHelp")}
            value={draft.value}
            onChange={(e) => set("value", e.target.value)}
            error={fieldError("value") ?? fieldError("currency")}
          />
          <Select
            id={`${formId}-currency`}
            label={t("operations.contracts.field.currency")}
            value={draft.currency}
            onChange={(e) =>
              set("currency", e.target.value as ContractCurrency)
            }
            options={contractCurrencies.map((currency) => ({
              value: currency,
              label: currency,
            }))}
          />
        </div>
        <Textarea
          id={`${formId}-pricingNotes`}
          label={t("operations.contracts.field.pricingNotes")}
          optionalLabel={t("operations.contracts.form.optional")}
          help={t("operations.contracts.field.pricingNotesHelp")}
          value={draft.pricingNotes}
          onChange={(e) => set("pricingNotes", e.target.value)}
          maxLength={2000}
          rows={3}
          error={fieldError("pricingNotes")}
        />
      </Fieldset>

      <Fieldset legend={t("operations.contracts.form.ownership")}>
        <div className={styles.fieldGrid}>
          <Input
            id={`${formId}-ownerName`}
            label={t("operations.contracts.field.owner")}
            help={t("operations.contracts.field.ownerHelp")}
            value={draft.ownerName}
            onChange={(e) => set("ownerName", e.target.value)}
            maxLength={120}
            required
            error={fieldError("ownerName")}
          />
          <Input
            id={`${formId}-tags`}
            label={t("operations.contracts.field.tags")}
            optionalLabel={t("operations.contracts.form.optional")}
            help={t("operations.contracts.field.tagsHelp")}
            value={draft.tags}
            onChange={(e) => set("tags", e.target.value)}
            error={fieldError("tags")}
          />
        </div>
        <Textarea
          id={`${formId}-internalNotes`}
          label={t("operations.contracts.field.internalNotes")}
          optionalLabel={t("operations.contracts.form.optional")}
          help={t("operations.contracts.field.internalNotesHelp")}
          value={draft.internalNotes}
          onChange={(e) => set("internalNotes", e.target.value)}
          maxLength={10_000}
          rows={4}
          error={fieldError("internalNotes")}
        />
      </Fieldset>

      {editing ? null : (
        <Fieldset
          legend={t("operations.contracts.form.documents")}
          description={t("operations.contracts.form.documentsHelp")}
        >
          <label className={styles.fileInput}>
            {t("operations.contracts.form.chooseFiles")}
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                const chosen = [...(event.target.files ?? [])];
                setFiles((current) => [
                  ...current,
                  ...chosen.map((file, index) => ({
                    key: crypto.randomUUID(),
                    file,
                    kind: defaultKind(draft, current.length + index),
                    problem: localFileProblem(file),
                  })),
                ]);
                event.target.value = "";
              }}
            />
            <span className={styles.hint}>
              {t("operations.contracts.form.fileRules")}
            </span>
          </label>
          {files.length ? (
            <ul className={styles.selectedFiles}>
              {files.map((pending) => (
                <li className={styles.selectedFile} key={pending.key}>
                  <span className={styles.documentName}>
                    <strong title={pending.file.name}>
                      {pending.file.name}
                    </strong>
                    <span
                      className={
                        pending.problem
                          ? styles.fileError
                          : styles.secondaryText
                      }
                      role={pending.problem ? "alert" : undefined}
                    >
                      {pending.problem
                        ? t(errorMessage(pending.problem))
                        : formatFileSize(pending.file.size, locale)}
                    </span>
                  </span>
                  <Select
                    label={t("operations.contracts.form.documentKind")}
                    value={pending.kind}
                    onChange={(e) =>
                      setFiles((current) =>
                        current.map((item) =>
                          item.key === pending.key
                            ? {
                                ...item,
                                kind: e.target
                                  .value as UploadableContractFileKind,
                              }
                            : item,
                        ),
                      )
                    }
                    options={uploadableContractFileKinds.map((kind) => ({
                      value: kind,
                      label: t(contractFileKindLabels[kind]),
                    }))}
                  />
                  <IconButton
                    variant="quiet"
                    label={t("operations.contracts.form.removeFile", {
                      name: pending.file.name,
                    })}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((item) => item.key !== pending.key),
                      )
                    }
                  >
                    <X size={16} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : null}
        </Fieldset>
      )}

      <div className={styles.formActions}>
        <Button
          type="submit"
          loading={busy}
          loadingLabel={progress ?? undefined}
        >
          {t(
            editing
              ? "operations.contracts.form.saveChanges"
              : "operations.contracts.form.save",
          )}
        </Button>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href={
            (editing
              ? `/internal/contracts/${contract.id}`
              : "/internal/contracts") as Route
          }
        >
          {t("operations.contracts.form.cancel")}
        </Link>
        {busy ? (
          <span className={styles.progress} role="status">
            {progress}
          </span>
        ) : null}
      </div>
    </form>
  );
}
