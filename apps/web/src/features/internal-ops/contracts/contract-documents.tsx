"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Trash2,
  Button,
  Dialog,
  EmptyState,
  InlineNotice,
  Select,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";
import {
  uploadableContractFileKinds,
  type ContractFileRecord,
  type UploadableContractFileKind,
} from "@clockwork/contracts";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { formatOperationalTimestamp } from "../presentation";
import { removeContractFile } from "./actions";
import { contractFileKindLabels, errorMessage, formatFileSize } from "./copy";
import { SessionExpiredReload } from "../session-expiry";
import { uploadContractFile } from "./upload-client";
import styles from "./contracts.module.css";

export function ContractDocuments({
  contractId,
  files,
  canWrite,
  locked,
  suggestedKind,
}: {
  contractId: string;
  files: readonly ContractFileRecord[];
  canWrite: boolean;
  /** Executed contracts keep their documents. */
  locked: boolean;
  suggestedKind: UploadableContractFileKind;
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  const router = useRouter();
  const [kind, setKind] = useState<UploadableContractFileKind>(suggestedKind);
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ContractFileRecord | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await uploadContractFile(contractId, file, kind);
    setBusy(false);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setNotice(
      t("operations.contracts.documents.uploaded", { name: file.name }),
    );
    setFile(null);
    setInputKey((key) => key + 1);
    router.refresh();
  }

  async function remove(target: ContractFileRecord) {
    setBusy(true);
    setError(null);
    const result = await removeContractFile({ contractId, fileId: target.id });
    setBusy(false);
    setRemoving(null);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    setNotice(
      t("operations.contracts.documents.removed", { name: target.fileName }),
    );
    router.refresh();
  }

  const href = (fileId: string, view = false) =>
    `/internal/contracts/${contractId}/files/${fileId}${view ? "?view=1" : ""}` as Route;

  return (
    <section className={styles.card} aria-labelledby="contract-documents">
      <div className={styles.cardHeader}>
        <div>
          <h2 id="contract-documents">
            {t("operations.contracts.documents.title")}
          </h2>
          <p>{t("operations.contracts.documents.description")}</p>
        </div>
      </div>
      {error ? (
        <InlineNotice
          tone="danger"
          title={t(errorMessage(error))}
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
      {notice ? (
        <InlineNotice tone="success" title={notice} live="polite" />
      ) : null}
      {files.length === 0 ? (
        <EmptyState
          title={t("operations.contracts.documents.emptyTitle")}
          description={t("operations.contracts.documents.emptyBody")}
        />
      ) : (
        <ul className={styles.documentList}>
          {files.map((document) => (
            <li className={styles.documentRow} key={document.id}>
              <span className={styles.documentIcon} aria-hidden="true">
                <FileText />
              </span>
              <span className={styles.documentName}>
                <strong title={document.fileName}>{document.fileName}</strong>
                <span className={styles.badges}>
                  <StatusBadge
                    tone={document.kind === "executed" ? "success" : "neutral"}
                  >
                    {t(contractFileKindLabels[document.kind])}
                  </StatusBadge>
                  <span className={styles.secondaryText}>
                    {t("operations.contracts.documents.meta", {
                      size: formatFileSize(document.sizeBytes, locale),
                      name: document.uploadedByName,
                      time: formatOperationalTimestamp(
                        document.createdAt,
                        locale,
                      ),
                    })}
                  </span>
                </span>
              </span>
              <span className={styles.documentActions}>
                <a
                  className={buttonClassName({
                    variant: "quiet",
                    size: "small",
                  })}
                  href={href(document.id, true)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("operations.contracts.documents.viewNamed", {
                    name: document.fileName,
                  })}
                >
                  <Eye aria-hidden="true" size={14} />
                  {t("operations.contracts.documents.view")}
                </a>
                <a
                  className={buttonClassName({
                    variant: "secondary",
                    size: "small",
                  })}
                  href={href(document.id)}
                  download
                  aria-label={t(
                    "operations.contracts.documents.downloadNamed",
                    {
                      name: document.fileName,
                    },
                  )}
                >
                  <Download aria-hidden="true" size={14} />
                  {t("operations.contracts.documents.download")}
                </a>
                {canWrite &&
                !locked &&
                (uploadableContractFileKinds as readonly string[]).includes(
                  document.kind,
                ) ? (
                  <Button
                    variant="quiet"
                    size="small"
                    disabled={busy}
                    onClick={() => setRemoving(document)}
                    aria-label={t(
                      "operations.contracts.documents.removeNamed",
                      {
                        name: document.fileName,
                      },
                    )}
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    {t("operations.contracts.documents.remove")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {locked && canWrite ? (
        <p className={styles.muted}>
          {t("operations.contracts.documents.locked")}
        </p>
      ) : null}
      {canWrite ? (
        <div className={styles.uploadRow}>
          <Select
            label={t("operations.contracts.form.documentKind")}
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as UploadableContractFileKind)
            }
            options={uploadableContractFileKinds.map((value) => ({
              value,
              label: t(contractFileKindLabels[value]),
            }))}
          />
          <label className={styles.fileInput}>
            {t("operations.contracts.documents.choose")}
            <input
              key={inputKey}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby={`${contractId}-file-rules`}
            />
          </label>
          <Button
            onClick={() => void upload()}
            disabled={!file}
            loading={busy && Boolean(file)}
            loadingLabel={t("operations.contracts.documents.uploading")}
          >
            {t("operations.contracts.documents.upload")}
          </Button>
        </div>
      ) : null}
      {canWrite ? (
        <p className={styles.hint} id={`${contractId}-file-rules`}>
          {t("operations.contracts.form.fileRules")}
        </p>
      ) : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("operations.contracts.documents.confirmTitle")}
        description={t("operations.contracts.documents.confirmBody", {
          name: removing?.fileName ?? "",
        })}
        closeLabel={t("operations.contracts.form.cancel")}
        trigger={<span hidden />}
        footer={
          <Button
            variant="danger"
            loading={busy}
            onClick={() => removing && void remove(removing)}
          >
            {t("operations.contracts.documents.remove")}
          </Button>
        }
      >
        {null}
      </Dialog>
    </section>
  );
}
