"use client";
import { useTranslations } from "@/src/i18n/client";

import { useEffect, useState } from "react";

import { artifactRepresentation } from "@/src/features/contracts/experience-client";

import type { ArtifactKind, ArtifactRepresentation } from "./model";
import { problemText } from "@/src/features/contracts/error-text";

export interface ProjectedArtifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  state: "stored" | "pending" | "missing";
}

export function ArtifactDeliveryList({
  artifacts,
}: {
  artifacts: readonly ProjectedArtifact[];
}) {
  const t = useTranslations();
  const [representations, setRepresentations] = useState<
    Readonly<Record<string, ArtifactRepresentation>>
  >({});
  /** The failure itself; its sentence is chosen at render, in the reader's language. */
  const [errors, setErrors] = useState<Readonly<Record<string, unknown>>>({});

  useEffect(() => {
    let active = true;
    for (const artifact of artifacts) {
      if (artifact.state !== "stored") continue;
      void artifactRepresentation(artifact.kind, artifact.id)
        .then((representation) => {
          if (active)
            setRepresentations((current) => ({
              ...current,
              [artifact.id]: representation,
            }));
        })
        .catch((error: unknown) => {
          if (active)
            setErrors((current) => ({
              ...current,
              [artifact.id]: error ?? new Error("ARTIFACT_UNAVAILABLE"),
            }));
        });
    }
    return () => {
      active = false;
    };
  }, [artifacts]);

  if (artifacts.length === 0)
    return <p role="status">{t("experience.artifacts.none")}</p>;
  return (
    <section aria-label={t("experience.artifacts.label")}>
      <h3>{t("common.documents")}</h3>
      <ul>
        {artifacts.map((artifact) => {
          const representation = representations[artifact.id];
          const error = Object.hasOwn(errors, artifact.id)
            ? problemText(errors[artifact.id], t, {
                fallback: t("experience.artifacts.unavailable"),
                notFound: t("experience.artifacts.unavailable"),
                forbidden: t("experience.artifacts.forbidden"),
              })
            : null;
          return (
            <li key={`${artifact.kind}:${artifact.id}`}>
              <strong>{artifact.label}</strong>{" "}
              {artifact.state === "pending" ? (
                <span role="status">{t("experience.artifacts.pending")}</span>
              ) : artifact.state === "missing" ? (
                <span role="alert">{t("experience.artifacts.missing")}</span>
              ) : error ? (
                <span role="alert">{error}</span>
              ) : representation ? (
                <>
                  <a href={representation.downloadHref}>
                    {t("experience.artifacts.download")}
                  </a>{" "}
                  <span>
                    {t("experience.artifacts.fileVersion", {
                      filename: representation.filename,
                      version: representation.version,
                    })}
                  </span>
                </>
              ) : (
                <span role="status">{t("experience.artifacts.checking")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
