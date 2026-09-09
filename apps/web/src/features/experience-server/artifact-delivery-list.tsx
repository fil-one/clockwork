"use client";
import { useTranslations } from "@/src/i18n/client";

import { useEffect, useState } from "react";

import { artifactRepresentation } from "@/src/features/contracts/experience-client";

import type { ArtifactKind, ArtifactRepresentation } from "./model";

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
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

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
              [artifact.id]:
                error instanceof Error
                  ? error.message
                  : "Artifact is unavailable.",
            }));
        });
    }
    return () => {
      active = false;
    };
  }, [artifacts]);

  if (artifacts.length === 0)
    return (
      <p role="status">No generated artifacts are attached to this record.</p>
    );
  return (
    <section aria-label="Immutable document artifacts">
      <h3>{t("ui.97")}</h3>
      <ul>
        {artifacts.map((artifact) => {
          const representation = representations[artifact.id];
          const error = errors[artifact.id];
          return (
            <li key={`${artifact.kind}:${artifact.id}`}>
              <strong>{artifact.label}</strong>{" "}
              {artifact.state === "pending" ? (
                <span role="status">Generation pending</span>
              ) : artifact.state === "missing" ? (
                <span role="alert">Document missing</span>
              ) : error ? (
                <span role="alert">{error}</span>
              ) : representation ? (
                <>
                  <a href={representation.downloadHref}>
                    Download verified PDF
                  </a>{" "}
                  <span>
                    {representation.filename} · version {representation.version}
                  </span>
                </>
              ) : (
                <span role="status">Checking document integrity…</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
