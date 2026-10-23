"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  AccountDocumentInputSchema,
  accountDocumentKinds,
  type AccountDocumentKind,
  type AccountDocumentRecord,
  type AccountDocumentTarget,
  type RemovedAccountDocumentRecord,
} from "@clockwork/contracts";
import {
  Button,
  EmptyState,
  FileText,
  InlineNotice,
  Input,
  Select,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MessageId } from "@/src/i18n";
import {
  errorMessage,
  formatContractDate,
  formatFileSize,
} from "../contracts/copy";
import { localFileProblem, postDocumentForm } from "../contracts/upload-client";
import { LocalTimestamp } from "../local-timestamp";
import { SessionExpiredReload } from "../session-expiry";
import { removeAccountDocument, restoreAccountDocument } from "./actions";
import styles from "../contracts/contracts.module.css";
import attachmentStyles from "./documents.module.css";

const noSubscription = () => () => {};
const onClient = () => true;
const onServer = () => false;

const kindLabels: Record<AccountDocumentKind, MessageId> = {
  mnda: "operations.accountDocuments.kind.mnda",
  agreement: "operations.accountDocuments.kind.agreement",
  other: "operations.accountDocuments.kind.other",
};
const errors: Record<string, MessageId> = {
  ATTACHMENT_ALREADY_EXISTS: "operations.accountDocuments.duplicate",
  ATTACHMENT_RETRY_CONFLICT: "operations.accountDocuments.retry",
  ATTACHMENT_TARGET_NOT_FOUND: "operations.accountDocuments.missing",
  ATTACHMENT_NOT_FOUND: "operations.accountDocuments.missing",
  CONTRACT_FORBIDDEN: "operations.accountDocuments.forbidden",
  INVALID_INPUT: "operations.accountDocuments.invalid",
  ATTACHMENT_VERSION_CONFLICT: "operations.accountDocuments.changed",
};

export function AccountDocuments({
  target,
  files,
  removed = [],
  canWrite,
  demo = false,
}: {
  target: AccountDocumentTarget;
  files: readonly AccountDocumentRecord[];
  /** Documents taken off this record, kept as history. */
  removed?: readonly RemovedAccountDocumentRecord[];
  canWrite: boolean;
  demo?: boolean;
}) {
  const hydrated = useSyncExternalStore(noSubscription, onClient, onServer);
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const heading = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const requestId = useRef<string | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<AccountDocumentKind>("mnda");
  const [signedOn, setSignedOn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Keep the new row visible immediately, even while the server refresh runs.
  const [added, setAdded] = useState<AccountDocumentRecord[]>([]);
  // Removals and restores show at once too, ahead of the refresh.
  const [removedNow, setRemovedNow] = useState<RemovedAccountDocumentRecord[]>(
    [],
  );
  const [restoredNow, setRestoredNow] = useState<string[]>([]);
  const [removing, setRemoving] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const [undo, setUndo] = useState<RemovedAccountDocumentRecord | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const gone = new Set(
    removedNow.filter((row) => !restoredNow.includes(row.id)).map((r) => r.id),
  );
  const visible = [
    ...added.filter((row) => !files.some((f) => f.id === row.id)),
    ...files,
  ].filter((row) => !gone.has(row.id));
  const history = [
    ...removedNow,
    ...removed.filter((row) => !removedNow.some((r) => r.id === row.id)),
  ].filter(
    (row) =>
      !restoredNow.includes(row.id) ||
      // Removed again after a restore on this page.
      gone.has(row.id),
  );
  const announce = () =>
    requestAnimationFrame(() => noticeRef.current?.focus());
  async function remove(document: AccountDocumentRecord, reason: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await removeAccountDocument({
        target,
        id: document.id,
        expectedVersion: document.version,
        reason,
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (!result.ok) {
        setError(result.code);
        return;
      }
      setRemoving(null);
      setRestoredNow((ids) => ids.filter((id) => id !== document.id));
      setRemovedNow((rows) => [
        result.value,
        ...rows.filter((row) => row.id !== document.id),
      ]);
      setUndo(result.value);
      setNotice(
        t("operations.accountDocuments.removed", { name: document.title }),
      );
      announce();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function restore(document: RemovedAccountDocumentRecord) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await restoreAccountDocument({
        target,
        id: document.id,
        expectedVersion: document.version,
      }).catch(() => ({ ok: false as const, code: "UNEXPECTED" }));
      if (!result.ok) {
        setError(result.code);
        return;
      }
      setUndo(null);
      setRestoredNow((ids) => [...ids, document.id]);
      setRemovedNow((rows) => rows.filter((row) => row.id !== document.id));
      setAdded((rows) => [
        result.value,
        ...rows.filter((row) => row.id !== document.id),
      ]);
      setNotice(
        t("operations.accountDocuments.restored", { name: document.title }),
      );
      announce();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  const base = `/internal/record-documents/${target.type}/${target.id}`;
  function changed() {
    requestId.current = null;
    setError(null);
    setNotice(null);
  }
  async function upload() {
    if (!file || uploading.current) return;
    const problem = localFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    requestId.current ??= crypto.randomUUID();
    const input = AccountDocumentInputSchema.safeParse({
      id: requestId.current,
      title,
      kind,
      signedOn,
    });
    if (!input.success) {
      setError("INVALID_INPUT");
      return;
    }
    uploading.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const form = new FormData();
    form.set("item", JSON.stringify(input.data));
    form.set("file", file);
    try {
      const result = await postDocumentForm<AccountDocumentRecord>(base, form);
      if (!result.ok) {
        setError(result.code);
        return;
      }
      setAdded((rows) => [
        result.value,
        ...rows.filter((row) => row.id !== result.value.id),
      ]);
      setNotice(
        t("operations.accountDocuments.uploaded", { name: result.value.title }),
      );
      setFile(null);
      setTitle("");
      setSignedOn("");
      requestId.current = null;
      if (fileInput.current) fileInput.current.value = "";
      router.refresh();
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.card} aria-labelledby={heading}>
      <div className={styles.cardHeader}>
        <div>
          <h2 id={heading}>{t("operations.accountDocuments.title")}</h2>
          <p>{t("operations.accountDocuments.description")}</p>
        </div>
      </div>
      {error ? (
        <InlineNotice
          tone="danger"
          live="assertive"
          title={t(errors[error] ?? errorMessage(error))}
          {...(error === "SESSION_EXPIRED"
            ? {
                action: (
                  <SessionExpiredReload onReloaded={() => setError(null)} />
                ),
              }
            : {})}
        />
      ) : null}
      <div ref={noticeRef} tabIndex={-1} className={attachmentStyles.notice}>
        {notice ? (
          <InlineNotice
            tone="success"
            live="polite"
            title={notice}
            {...(undo && canWrite
              ? {
                  action: (
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      disabled={busy}
                      onClick={() => void restore(undo)}
                    >
                      {t("operations.accountDocuments.undo")}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : null}
      </div>
      {demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.accountDocuments.demo")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={t("operations.accountDocuments.emptyTitle")}
          description={t("operations.accountDocuments.emptyBody")}
        />
      ) : (
        <ul className={styles.documentList}>
          {visible.map((document) => (
            <li className={styles.documentRow} key={document.id}>
              <span className={styles.documentIcon} aria-hidden="true">
                <FileText />
              </span>
              <span className={styles.documentName}>
                <strong title={document.title}>{document.title}</strong>
                <span
                  className={`${styles.secondaryText} ${attachmentStyles.filename}`}
                >
                  {document.fileName} ·{" "}
                  {formatFileSize(document.sizeBytes, locale)}
                </span>
                <span className={attachmentStyles.metadata}>
                  <StatusBadge tone="neutral">
                    {t(kindLabels[document.kind])}
                  </StatusBadge>
                  <span className={styles.secondaryText}>
                    {t("operations.accountDocuments.external")}
                  </span>
                  {document.signedOn ? (
                    <span className={styles.secondaryText}>
                      {t("operations.accountDocuments.signed", {
                        date: formatContractDate(document.signedOn, locale),
                      })}
                    </span>
                  ) : null}
                </span>
                <span className={styles.secondaryText}>
                  {document.uploadedByName} ·{" "}
                  <LocalTimestamp value={document.createdAt} locale={locale} />
                </span>
              </span>
              <span className={styles.documentActions}>
                <a
                  className={buttonClassName({
                    variant: "quiet",
                    size: "small",
                  })}
                  href={`${base}/${document.id}?view=1`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("operations.accountDocuments.viewNamed", {
                    name: document.title,
                  })}
                >
                  {t("operations.accountDocuments.view")}
                </a>
                <a
                  className={buttonClassName({
                    variant: "secondary",
                    size: "small",
                  })}
                  href={`${base}/${document.id}`}
                  download
                  aria-label={t("operations.accountDocuments.downloadNamed", {
                    name: document.title,
                  })}
                >
                  {t("operations.accountDocuments.download")}
                </a>
                {canWrite && !demo ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="small"
                    disabled={busy}
                    aria-expanded={removing?.id === document.id}
                    aria-controls={`${heading}-remove-${document.id}`}
                    aria-label={t("operations.accountDocuments.removeNamed", {
                      name: document.title,
                    })}
                    onClick={() =>
                      setRemoving((current) =>
                        current?.id === document.id
                          ? null
                          : { id: document.id, reason: "" },
                      )
                    }
                  >
                    {t("operations.accountDocuments.remove")}
                  </Button>
                ) : null}
              </span>
              {removing?.id === document.id ? (
                <form
                  className={attachmentStyles.removal}
                  id={`${heading}-remove-${document.id}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (removing.reason.trim())
                      void remove(document, removing.reason.trim());
                  }}
                >
                  <p className={attachmentStyles.removalText} role="alert">
                    {t("operations.accountDocuments.removeConfirm", {
                      name: document.title,
                    })}
                  </p>
                  <Input
                    label={t("operations.accountDocuments.removeReason")}
                    help={t("operations.accountDocuments.removeReasonHelp")}
                    value={removing.reason}
                    maxLength={500}
                    required
                    autoFocus
                    disabled={busy}
                    onChange={(event) =>
                      setRemoving({
                        id: document.id,
                        reason: event.currentTarget.value,
                      })
                    }
                  />
                  <span className={attachmentStyles.removalActions}>
                    <Button
                      type="submit"
                      variant="danger"
                      size="small"
                      disabled={busy || !removing.reason.trim()}
                      loading={busy}
                      loadingLabel={t("operations.accountDocuments.removing")}
                    >
                      {t("operations.accountDocuments.removeAction")}
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      size="small"
                      disabled={busy}
                      onClick={() => setRemoving(null)}
                    >
                      {t("operations.accountDocuments.removeCancel")}
                    </Button>
                  </span>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {history.length && !demo ? (
        <details className={attachmentStyles.history}>
          <summary>
            {t("operations.accountDocuments.removedTitle", {
              count: history.length,
            })}
          </summary>
          <p className={styles.hint}>
            {t("operations.accountDocuments.removedBody")}
          </p>
          <ul className={attachmentStyles.historyList}>
            {history.map((document) => (
              <li key={document.id}>
                <span className={styles.documentName}>
                  <strong>{document.title}</strong>
                  <span className={styles.secondaryText}>
                    {document.fileName} ·{" "}
                    {formatFileSize(document.sizeBytes, locale)}
                  </span>
                  <span className={styles.secondaryText}>
                    {t("operations.accountDocuments.removedBy", {
                      name: document.removedByName,
                      reason: document.removalReason,
                    })}{" "}
                    ·{" "}
                    <LocalTimestamp
                      value={document.removedAt}
                      locale={locale}
                    />
                  </span>
                </span>
                {canWrite ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    aria-label={t("operations.accountDocuments.restoreNamed", {
                      name: document.title,
                    })}
                    onClick={() => void restore(document)}
                  >
                    {t("operations.accountDocuments.restore")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {canWrite && !demo ? (
        <form
          className={attachmentStyles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <div className={attachmentStyles.fields}>
            <Input
              label={t("operations.accountDocuments.name")}
              value={title}
              maxLength={200}
              required
              disabled={!hydrated || busy}
              onChange={(e) => {
                changed();
                setTitle(e.target.value);
              }}
            />
            <Select
              label={t("operations.accountDocuments.kind")}
              value={kind}
              disabled={!hydrated || busy}
              options={accountDocumentKinds.map((value) => ({
                value,
                label: t(kindLabels[value]),
              }))}
              onChange={(e) => {
                changed();
                setKind(e.target.value as AccountDocumentKind);
              }}
            />
            <Input
              label={t("operations.accountDocuments.signedOn")}
              type="date"
              value={signedOn}
              disabled={!hydrated || busy}
              onChange={(e) => {
                changed();
                setSignedOn(e.target.value);
              }}
            />
          </div>
          <div className={attachmentStyles.fileRow}>
            <label className={styles.fileInput}>
              {t("operations.accountDocuments.choose")}
              <input
                ref={fileInput}
                type="file"
                accept="application/pdf,.pdf"
                disabled={!hydrated || busy}
                aria-describedby={`${heading}-rules`}
                onChange={(e) => {
                  changed();
                  const chosen = e.target.files?.[0] ?? null;
                  setFile(chosen);
                  if (chosen) {
                    setError(localFileProblem(chosen));
                    if (!title.trim())
                      setTitle(
                        chosen.name.replace(/\.pdf$/i, "").slice(0, 200),
                      );
                  }
                }}
              />
            </label>
            <Button
              type="submit"
              disabled={!file || !title.trim() || busy}
              loading={busy}
              loadingLabel={t("operations.accountDocuments.uploading")}
            >
              {t("operations.accountDocuments.upload")}
            </Button>
          </div>
          <p className={styles.hint} id={`${heading}-rules`}>
            {t("operations.accountDocuments.rules")}
          </p>
        </form>
      ) : null}
    </section>
  );
}
