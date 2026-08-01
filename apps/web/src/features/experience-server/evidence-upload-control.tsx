"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@clockwork/ui";

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
} from "./model";

const storagePrefix = "clockwork:evidence:";

const maxEvidenceBytes = 50 * 1024 * 1024;
const maxEvidenceLabel = `${maxEvidenceBytes / 1024 / 1024} MB`;

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
  label = "Attach evidence",
  headingLevel = 3,
}: {
  journey: EvidenceJourney;
  targetId: string;
  kind: EvidenceKind;
  label?: string;
  headingLevel?: 2 | 3;
}) {
  const inputId = useId();
  const [upload, setUpload] = useState<EvidenceUploadRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      setError(
        `This file is larger than the ${maxEvidenceLabel} maximum. Choose a smaller file.`,
      );
      return;
    }
    setError("");
    setPending(true);
    setMessage("Preparing evidence…");
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
      setMessage("Uploading to the isolated quarantine store…");
      const uploadResponse = await fetch(created.uploadUrl, {
        method: created.method,
        headers: created.headers,
        body: file,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!uploadResponse.ok)
        throw new Error("The evidence provider did not accept the upload.");
      setMessage("Scanning evidence before immutable promotion…");
      const completed = await completeEvidenceUpload(created.upload.uploadId);
      setUpload(completed.upload);
      setMessage(
        completed.upload.status === "promoted"
          ? "Evidence scanned and stored immutably."
          : `Evidence status: ${completed.upload.status}.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Evidence upload failed. Nothing was promoted.",
      );
    } finally {
      setPending(false);
    }
  }

  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div role="group" aria-labelledby={`${inputId}-title`}>
      <Heading id={`${inputId}-title`}>{label}</Heading>
      <p id={`${inputId}-hint`}>
        PDF, PNG, JPEG, or plain text · {maxEvidenceLabel} maximum · retention
        is server managed.
      </p>
      <label htmlFor={inputId}>Evidence file</label>
      <input
        id={inputId}
        type="file"
        accept="application/pdf,image/png,image/jpeg,text/plain"
        disabled={pending}
        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void submit(file);
        }}
      />
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
          Status: <strong>{upload.status}</strong> · upload {upload.uploadId}
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
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Evidence download is unavailable.",
                );
              });
          }}
        >
          Download verified evidence
        </Button>
      ) : null}
    </div>
  );
}
