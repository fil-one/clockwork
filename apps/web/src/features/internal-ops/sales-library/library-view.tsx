"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent } from "react";
import {
  ExternalLink,
  FileText,
  Link2,
  Button,
  Checkbox,
  EmptyState,
  Fieldset,
  InlineNotice,
  Input,
  PageHeader,
  RadioGroup,
  Select,
  StatusBadge,
  Textarea,
  buttonClassName,
} from "@clockwork/ui";
import {
  salesAudiences,
  salesCollateralKinds,
  salesCollateralStatuses,
  type SalesAudience,
  type SalesCollateralKind,
  type SalesCollateralRecord,
  type SalesCollateralStatus,
} from "@clockwork/contracts";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import {
  errorMessage,
  fieldMessage,
  formatContractDate,
  formatFileSize,
} from "../contracts/copy";
import { localFileProblem, postCollateral } from "../contracts/upload-client";
import { saveCollateral } from "./actions";
import styles from "../contracts/contracts.module.css";

const kindLabels: Readonly<Record<SalesCollateralKind, MessageId>> = {
  pitch_deck: "operations.salesLibrary.kind.pitchDeck",
  one_pager: "operations.salesLibrary.kind.onePager",
  pricing_sheet: "operations.salesLibrary.kind.pricingSheet",
  case_study: "operations.salesLibrary.kind.caseStudy",
  other: "operations.salesLibrary.kind.other",
};
const audienceLabels: Readonly<Record<SalesAudience, MessageId>> = {
  customer: "operations.salesLibrary.audience.customer",
  partner: "operations.salesLibrary.audience.partner",
};
const statusLabels: Readonly<Record<SalesCollateralStatus, MessageId>> = {
  current: "operations.salesLibrary.status.current",
  archived: "operations.salesLibrary.status.archived",
};

interface Draft {
  title: string;
  description: string;
  kind: SalesCollateralKind;
  audience: SalesAudience;
  status: SalesCollateralStatus;
  contentUpdatedOn: string;
  source: "file" | "link";
  linkUrl: string;
}

function ItemForm({
  item,
  today,
  onDone,
  onCancel,
}: {
  item: SalesCollateralRecord | null;
  today: string;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const id = useRef(item?.id ?? crypto.randomUUID());
  const [draft, setDraft] = useState<Draft>({
    title: item?.title ?? "",
    description: item?.description ?? "",
    kind: item?.kind ?? "pitch_deck",
    audience: item?.audience ?? "customer",
    status: item?.status ?? "current",
    contentUpdatedOn: item?.contentUpdatedOn ?? today,
    source: item ? (item.linkUrl ? "link" : "file") : "file",
    linkUrl: item?.linkUrl ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!draft.title.trim()) local.title = "required";
    if (draft.source === "link" && !/^https:\/\//i.test(draft.linkUrl.trim()))
      local.linkUrl = "https";
    if (draft.source === "file" && !item && !file) local.file = "required";
    const fileProblem = file ? localFileProblem(file) : null;
    if (Object.keys(local).length || fileProblem) {
      setProblems(local);
      setError(fileProblem);
      return;
    }
    setProblems({});
    setError(null);
    setBusy(true);
    const payload = {
      id: id.current,
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      audience: draft.audience,
      status: draft.status,
      contentUpdatedOn: draft.contentUpdatedOn,
      linkUrl: draft.source === "link" ? draft.linkUrl.trim() : "",
    };
    let result: { ok: boolean; code?: string; fields?: Record<string, string> };
    if (file) {
      const form = new FormData();
      form.set("item", JSON.stringify(payload));
      form.set("file", file);
      if (item) form.set("expectedVersion", String(item.version));
      result = await postCollateral(
        item
          ? `/internal/sales-library/items/${item.id}`
          : "/internal/sales-library/items",
        form,
      );
    } else
      result = await saveCollateral({
        item: payload,
        ...(item ? { expectedVersion: item.version } : {}),
      });
    setBusy(false);
    if (result.ok) {
      onDone(
        t(
          item
            ? "operations.salesLibrary.saved"
            : "operations.salesLibrary.added",
          { title: draft.title },
        ),
      );
      return;
    }
    if (result.fields) setProblems(result.fields);
    else setError(result.code ?? "UNEXPECTED");
  }

  const fieldError = (key: string) =>
    problems[key] ? t(fieldMessage(problems[key])) : undefined;

  return (
    <form
      className={`${styles.card} ${styles.form}`}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className={styles.cardHeader}>
        <h2>
          {t(
            item
              ? "operations.salesLibrary.form.editTitle"
              : "operations.salesLibrary.form.addTitle",
          )}
        </h2>
      </div>
      {error ? (
        <InlineNotice
          tone="danger"
          title={t(errorMessage(error))}
          live="assertive"
        />
      ) : null}
      <div className={styles.fieldGrid}>
        <Input
          label={t("operations.salesLibrary.form.title")}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={160}
          required
          error={fieldError("title")}
        />
        <Select
          label={t("operations.salesLibrary.form.kind")}
          value={draft.kind}
          onChange={(e) => set("kind", e.target.value as SalesCollateralKind)}
          options={salesCollateralKinds.map((kind) => ({
            value: kind,
            label: t(kindLabels[kind]),
          }))}
        />
        <Select
          label={t("operations.salesLibrary.form.audience")}
          value={draft.audience}
          onChange={(e) => set("audience", e.target.value as SalesAudience)}
          options={salesAudiences.map((audience) => ({
            value: audience,
            label: t(audienceLabels[audience]),
          }))}
        />
        <Select
          label={t("operations.salesLibrary.form.status")}
          value={draft.status}
          onChange={(e) =>
            set("status", e.target.value as SalesCollateralStatus)
          }
          options={salesCollateralStatuses.map((status) => ({
            value: status,
            label: t(statusLabels[status]),
          }))}
        />
        <Input
          type="date"
          label={t("operations.salesLibrary.form.updatedOn")}
          help={t("operations.salesLibrary.form.updatedOnHelp")}
          value={draft.contentUpdatedOn}
          onChange={(e) => set("contentUpdatedOn", e.target.value)}
          required
          error={fieldError("contentUpdatedOn")}
        />
      </div>
      <Textarea
        label={t("operations.salesLibrary.form.description")}
        optionalLabel={t("operations.contracts.form.optional")}
        help={t("operations.salesLibrary.form.descriptionHelp")}
        value={draft.description}
        onChange={(e) => set("description", e.target.value)}
        maxLength={1000}
        rows={3}
        error={fieldError("description")}
      />
      <Fieldset legend={t("operations.salesLibrary.form.source")}>
        {item ? null : (
          <RadioGroup
            legend={t("operations.salesLibrary.form.sourceKind")}
            name={`source-${id.current}`}
            value={draft.source}
            onChange={(e) => set("source", e.target.value as Draft["source"])}
            options={[
              {
                value: "file",
                label: t("operations.salesLibrary.form.sourceFile"),
              },
              {
                value: "link",
                label: t("operations.salesLibrary.form.sourceLink"),
              },
            ]}
          />
        )}
        {draft.source === "link" ? (
          <Input
            type="url"
            label={t("operations.salesLibrary.form.link")}
            help={t("operations.salesLibrary.form.linkHelp")}
            value={draft.linkUrl}
            onChange={(e) => set("linkUrl", e.target.value)}
            placeholder="https://"
            maxLength={2000}
            error={fieldError("linkUrl")}
          />
        ) : (
          <label className={styles.fileInput}>
            {t(
              item
                ? "operations.salesLibrary.form.replaceFile"
                : "operations.salesLibrary.form.file",
            )}
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-invalid={problems.file ? true : undefined}
            />
            <span className={styles.hint}>
              {item?.file
                ? t("operations.salesLibrary.form.currentFile", {
                    name: item.file.fileName,
                  })
                : t("operations.contracts.form.fileRules")}
            </span>
            {problems.file ? (
              <span className="cw-field__error" role="alert">
                {t(fieldMessage(problems.file))}
              </span>
            ) : null}
          </label>
        )}
      </Fieldset>
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          {t(
            item
              ? "operations.contracts.form.saveChanges"
              : "operations.salesLibrary.form.add",
          )}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t("operations.contracts.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function SalesLibraryView({
  items,
  canManage,
  today,
  demo = false,
}: {
  items: readonly SalesCollateralRecord[];
  canManage: boolean;
  today: string;
  /** Fictional demo items: no files are stored, so nothing downloads. */
  demo?: boolean;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<"" | SalesAudience>("");
  const [kind, setKind] = useState<"" | SalesCollateralKind>("");
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<SalesCollateralRecord | "new" | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (showArchived || item.status === "current") &&
          (!audience || item.audience === audience) &&
          (!kind || item.kind === kind) &&
          `${item.title} ${item.description}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [items, showArchived, audience, kind, query],
  );
  const archivedCount = items.filter(
    (item) => item.status === "archived",
  ).length;

  return (
    <main className={styles.page} id="main-content">
      <PageHeader
        title={t("operations.salesLibrary.title")}
        description={t("operations.salesLibrary.description")}
        actions={
          canManage && editing === null ? (
            <Button onClick={() => setEditing("new")}>
              {t("operations.salesLibrary.add")}
            </Button>
          ) : undefined
        }
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.salesLibrary.demo")} />
      ) : null}
      {notice ? (
        <InlineNotice tone="success" title={notice} live="polite" />
      ) : null}
      {editing !== null ? (
        <ItemForm
          item={editing === "new" ? null : editing}
          today={today}
          onCancel={() => setEditing(null)}
          onDone={(message) => {
            setEditing(null);
            setNotice(message);
            router.refresh();
          }}
        />
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title={t("operations.salesLibrary.empty.title")}
          description={t(
            canManage
              ? "operations.salesLibrary.empty.manageBody"
              : "operations.salesLibrary.empty.readBody",
          )}
          {...(canManage && editing === null
            ? {
                action: (
                  <Button onClick={() => setEditing("new")}>
                    {t("operations.salesLibrary.add")}
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <section className={styles.card} aria-labelledby="library-items">
          <h2 id="library-items" className="cw-sr-only">
            {t("operations.salesLibrary.title")}
          </h2>
          <div className={styles.filters} role="search">
            <Input
              type="search"
              label={t("operations.salesLibrary.filters.search")}
              placeholder={t("operations.salesLibrary.filters.placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              label={t("operations.salesLibrary.form.audience")}
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as "" | SalesAudience)
              }
              options={[
                {
                  value: "",
                  label: t("operations.salesLibrary.filters.allAudiences"),
                },
                ...salesAudiences.map((value) => ({
                  value,
                  label: t(audienceLabels[value]),
                })),
              ]}
            />
            <Select
              label={t("operations.salesLibrary.form.kind")}
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "" | SalesCollateralKind)
              }
              options={[
                {
                  value: "",
                  label: t("operations.salesLibrary.filters.allKinds"),
                },
                ...salesCollateralKinds.map((value) => ({
                  value,
                  label: t(kindLabels[value]),
                })),
              ]}
            />
            <Checkbox
              label={t("operations.salesLibrary.filters.showArchived", {
                count: archivedCount,
              })}
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
          </div>
          <p className={`${styles.muted} ${styles.spaced}`} role="status">
            {t("operations.salesLibrary.count", { count: visible.length })}
          </p>
          {visible.length === 0 ? (
            <p className={styles.muted}>
              {t("operations.salesLibrary.noMatches")}
            </p>
          ) : (
            <ul className={`${styles.libraryList} ${styles.spaced}`}>
              {visible.map((item) => (
                <li className={styles.libraryItem} key={item.id}>
                  <span className={styles.documentIcon} aria-hidden="true">
                    {item.linkUrl ? <Link2 /> : <FileText />}
                  </span>
                  <div>
                    <h3>{item.title}</h3>
                    {item.description ? <p>{item.description}</p> : null}
                    <div className={styles.libraryMeta}>
                      <StatusBadge tone="info">
                        {t(kindLabels[item.kind])}
                      </StatusBadge>
                      <StatusBadge>
                        {t(audienceLabels[item.audience])}
                      </StatusBadge>
                      {item.status === "archived" ? (
                        <StatusBadge tone="warning">
                          {t(statusLabels.archived)}
                        </StatusBadge>
                      ) : null}
                      <span>
                        {t("operations.salesLibrary.updatedOn", {
                          date: formatContractDate(
                            item.contentUpdatedOn,
                            locale,
                          ),
                        })}
                      </span>
                      {item.file ? (
                        <span>
                          {formatFileSize(item.file.sizeBytes, locale)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.documentActions}>
                    {item.linkUrl ? (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "small",
                        })}
                        href={item.linkUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        aria-label={t("operations.salesLibrary.openNamed", {
                          title: item.title,
                        })}
                      >
                        <ExternalLink aria-hidden="true" size={14} />
                        {t("operations.salesLibrary.open")}
                      </a>
                    ) : demo ? (
                      <Button variant="secondary" size="small" disabled>
                        {t("operations.contracts.documents.download")}
                      </Button>
                    ) : (
                      <a
                        className={buttonClassName({
                          variant: "secondary",
                          size: "small",
                        })}
                        href={
                          `/internal/sales-library/items/${item.id}` as Route
                        }
                        download
                        aria-label={t("operations.salesLibrary.downloadNamed", {
                          title: item.title,
                        })}
                      >
                        {t("operations.contracts.documents.download")}
                      </a>
                    )}
                    {canManage ? (
                      <Button
                        variant="quiet"
                        size="small"
                        onClick={() => {
                          setNotice(null);
                          setEditing(item);
                        }}
                        aria-label={t("operations.salesLibrary.editNamed", {
                          title: item.title,
                        })}
                      >
                        {t("operations.contracts.action.edit")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
