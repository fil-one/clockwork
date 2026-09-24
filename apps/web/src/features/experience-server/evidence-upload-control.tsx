"use client";

import { useEffect, useId, useState } from "react";

import { Button, buttonClassName } from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import { richText } from "@/src/i18n/rich";

import {
  completeEvidenceUpload,
  createEvidenceUpload,
  evidenceDownload,
  readEvidenceUpload,
} from "@/src/features/contracts/experience-client";

import type {
  EvidenceJourney,
  EvidenceKind,
  EvidenceUploadRecord,
  EvidenceUploadState,
} from "./model";
import { problemFacts, problemText } from "@/src/features/contracts/error-text";
import styles from "./evidence-upload-control.module.css";

const storagePrefix = "clockwork:evidence:";

const maxEvidenceMegabytes = 50;
const maxEvidenceBytes = maxEvidenceMegabytes * 1024 * 1024;

/** "50 MB" as the reader writes it ("50 Mo" in French, "50 ميغابايت" in Arabic). */
function maxEvidenceSize(locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
  }).format(maxEvidenceMegabytes);
}

const stateLabels: Readonly<Record<EvidenceUploadState, MessageId>> = {
  pending: "experience.evidence.state.pending",
  uploaded: "experience.evidence.state.uploaded",
  scanning: "experience.evidence.state.scanning",
  quarantined: "experience.evidence.state.quarantined",
  promoted: "experience.evidence.state.promoted",
  expired: "experience.evidence.state.expired",
  failed: "experience.evidence.state.failed",
};

function stateLabel(state: EvidenceUploadState, t: Translator): string {
  const id = stateLabels[state] as MessageId | undefined;
  return id ? t(id) : state;
}

/** The storage provider refused the bytes; nothing reached the API. */
class ProviderRejected extends Error {
  public constructor() {
    super("EVIDENCE_PROVIDER_REJECTED");
    this.name = "ProviderRejected";
  }
}

/**
 * What the reader sees while and after a step runs. Kept as the step, not the
 * sentence, so a language change re-renders it in the new language.
 */
type Progress =
  | { readonly kind: "preparing" | "uploading" | "scanning" | "stored" }
  | { readonly kind: "status"; readonly state: EvidenceUploadState }
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "downloadFailed"; readonly error: unknown };

function progressText(progress: Progress, t: Translator, size: string): string {
  switch (progress.kind) {
    case "preparing":
      return t("experience.evidence.preparing");
    case "uploading":
      return t("experience.evidence.uploading");
    case "scanning":
      return t("experience.evidence.scanning");
    case "stored":
      return t("experience.evidence.stored");
    case "status":
      return t("experience.evidence.statusMessage", {
        status: stateLabel(progress.state, t),
      });
    case "failed":
      if (progress.error instanceof ProviderRejected)
        return t("common.join.sentences", {
          first: t("experience.evidence.providerRejected"),
          second: t("experience.evidence.failed"),
        });
      if (problemFacts(progress.error)?.code === "EVIDENCE_SIZE_INVALID")
        return t("experience.evidence.tooLarge", { size });
      return problemText(progress.error, t, {
        fallback: t("experience.evidence.failed"),
      });
    case "downloadFailed":
      return problemText(progress.error, t, {
        fallback: t("experience.evidence.downloadUnavailable"),
        notFound: t("experience.evidence.downloadUnavailable"),
      });
  }
}

function storageKey(
  journey: EvidenceJourney,
  targetId: string,
  kind: EvidenceKind,
) {
  return `${storagePrefix}${journey}:${targetId}:${kind}`;
}

function purge(store: Storage) {
  for (const key of Object.keys(store))
    if (key.startsWith(storagePrefix)) store.removeItem(key);
}

/**
 * Drops every resume key. Sign-out is a server action and cannot reach web
 * storage, so this is exported for any client boundary that observes the end of
 * a session.
 */
export function clearEvidenceUploadState() {
  purge(window.sessionStorage);
  purge(window.localStorage);
}

async function hash(file: File): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(value), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function EvidenceUploadControl({
  journey,
  targetId,
  kind,
  label,
  headingLevel = 3,
}: {
  journey: EvidenceJourney;
  targetId: string;
  kind: EvidenceKind;
  /** Already in the reader's language; defaults to "Attach evidence". */
  label?: string;
  headingLevel?: 2 | 3;
}) {
  const t = useTranslations();
  const size = maxEvidenceSize(useFormattingLocale());
  const inputId = useId();
  const [upload, setUpload] = useState<EvidenceUploadRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const message = progress ? progressText(progress, t, size) : "";
  const error = tooLarge ? t("experience.evidence.tooLarge", { size }) : "";

  useEffect(() => {
    // A resume key is session scoped: a durable copy outlives the upload and
    // stays readable by the next person to use a shared browser.
    purge(window.localStorage);
    const uploadId = window.sessionStorage.getItem(
      storageKey(journey, targetId, kind),
    );
    if (!uploadId) return;
    let active = true;
    void readEvidenceUpload(uploadId)
      .then((record) => {
        if (active) setUpload(record);
      })
      .catch(() => {
        if (active)
          window.sessionStorage.removeItem(storageKey(journey, targetId, kind));
      });
    return () => {
      active = false;
    };
  }, [journey, kind, targetId]);

  async function submit(file: File) {
    if (file.size > maxEvidenceBytes) {
      setTooLarge(true);
      return;
    }
    setTooLarge(false);
    setPending(true);
    setProgress({ kind: "preparing" });
    try {
      const created = await createEvidenceUpload({
        journey,
        targetId,
        kind,
        contentHash: await hash(file),
        mimeType: file.type || "application/octet-stream",
        byteLength: file.size,
      });
      window.sessionStorage.setItem(
        storageKey(journey, targetId, kind),
        created.upload.uploadId,
      );
      setUpload(created.upload);
      setProgress({ kind: "uploading" });
      const uploadResponse = await fetch(created.uploadUrl, {
        method: created.method,
        headers: created.headers,
        body: file,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!uploadResponse.ok) throw new ProviderRejected();
      setProgress({ kind: "scanning" });
      const completed = await completeEvidenceUpload(created.upload.uploadId);
      setUpload(completed.upload);
      setProgress(
        completed.upload.status === "promoted"
          ? { kind: "stored" }
          : { kind: "status", state: completed.upload.status },
      );
    } catch (error) {
      setProgress({ kind: "failed", error });
    } finally {
      setPending(false);
    }
  }

  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div role="group" aria-labelledby={`${inputId}-title`}>
      <Heading id={`${inputId}-title`}>
        {label ?? t("experience.evidence.attach")}
      </Heading>
      <p id={`${inputId}-hint`}>{t("experience.evidence.hint", { size })}</p>
      <label htmlFor={inputId}>{t("experience.evidence.fileLabel")}</label>
      {/*
        The browser draws a file input's own button and "no file" text in the
        browser's language, not the page's. The input stays the focusable,
        labelled control; what the reader sees beside it is ours.
      */}
      <div className={styles.picker}>
        <input
          id={inputId}
          className={styles.input}
          type="file"
          accept="application/pdf,image/png,image/jpeg,text/plain"
          disabled={pending}
          aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setFileName(file?.name ?? null);
            if (file) void submit(file);
          }}
        />
        <label
          htmlFor={inputId}
          aria-hidden="true"
          className={buttonClassName({
            variant: "secondary",
            size: "small",
            className: styles.choose ?? "",
          })}
        >
          {t("experience.evidence.choose")}
        </label>
        <span className={styles.fileName} aria-hidden="true">
          {fileName ?? t("experience.evidence.noFile")}
        </span>
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {!pending && message ? (
        <p role={upload?.status === "quarantined" ? "alert" : "status"}>
          {message}
        </p>
      ) : null}
      {upload ? (
        <p>
          {richText(t, "experience.evidence.uploadStatus", {
            status: <strong>{stateLabel(upload.status, t)}</strong>,
            uploadId: upload.uploadId,
          })}
        </p>
      ) : null}
      {upload?.status === "promoted" ? (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void evidenceDownload(upload.uploadId)
              .then(({ url }) => {
                window.location.assign(url);
              })
              .catch((error: unknown) => {
                setProgress({ kind: "downloadFailed", error });
              });
          }}
        >
          {t("experience.evidence.download")}
        </Button>
      ) : null}
    </div>
  );
}
