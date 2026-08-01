import { ProjectionActionButtons } from "./projection-action-buttons";
import Link from "next/link";
import type { Route } from "next";
import { EvidenceUploadControl } from "./evidence-upload-control";
import {
  ArtifactDeliveryList,
  type ProjectedArtifact,
} from "./artifact-delivery-list";
import {
  artifactKinds,
  type ArtifactKind,
  type ExperienceAudience,
  type ProjectionChannel,
  type ProjectionRecord,
} from "./model";
import { loadPortalRecords } from "./portal-view-loader";

function label(record: ProjectionRecord): string {
  for (const key of ["title", "name", "label", "account"]) {
    const value = record.data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return record.recordKey;
}

function allowedActions(record: ProjectionRecord): readonly string[] {
  return Array.isArray(record.data.allowedActions)
    ? record.data.allowedActions.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
}

function scalarEntries(record: ProjectionRecord) {
  return Object.entries(record.data).filter(
    ([key, value]) =>
      key !== "allowedActions" &&
      ["string", "number", "boolean"].includes(typeof value),
  );
}

function artifacts(record: ProjectionRecord): readonly ProjectedArtifact[] {
  if (!Array.isArray(record.data.artifacts)) return [];
  return record.data.artifacts.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const kind = item.kind;
    const id = item.id;
    const state = item.state;
    const label = item.label;
    if (
      typeof kind !== "string" ||
      !artifactKinds.includes(kind as ArtifactKind) ||
      typeof id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(id) ||
      typeof label !== "string" ||
      (state !== "stored" && state !== "pending" && state !== "missing")
    )
      return [];
    return [{ kind: kind as ArtifactKind, id, label, state }];
  });
}

export async function ProjectionDetailPage({
  audience,
  channel,
  title,
  description,
  recordKey,
}: {
  audience: ExperienceAudience;
  channel: ProjectionChannel;
  title: string;
  description: string;
  recordKey?: string;
}) {
  const projection = await loadPortalRecords(audience, channel);
  const records = recordKey
    ? projection.records.filter((record) => record.recordKey === recordKey)
    : projection.records;
  return (
    <main id="main-content">
      <header>
        <p>
          {audience === "internal"
            ? "Operator"
            : audience === "partner"
              ? "Partner"
              : "Customer"}{" "}
          workspace
        </p>
        <h1>{title}</h1>
        <p>{description}</p>
        <p role={projection.stale ? "alert" : "status"}>
          {projection.stale
            ? "Source refresh is overdue"
            : "Source projection is current"}{" "}
          ·{" "}
          <time dateTime={projection.generatedAt}>
            {projection.generatedAt}
          </time>
        </p>
      </header>
      {records.length === 0 ? (
        <section role="alert">
          <h2>{recordKey ? "Record unavailable" : "No records available"}</h2>
          <p>
            The record is missing or outside the authenticated account scope. No
            action was taken.
          </p>
        </section>
      ) : (
        <div>
          {records.map((record) => (
            <article key={record.id}>
              <header>
                <h2>{label(record)}</h2>
                <p>
                  Reference {record.recordKey} · version {record.version}
                </p>
              </header>
              <dl>
                {scalarEntries(record).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replaceAll(/([A-Z_])/g, " $1").trim()}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
              <ProjectionActionButtons
                audience={audience}
                channel={channel}
                recordKey={record.recordKey}
                projectionId={record.id}
                version={record.version}
                actions={allowedActions(record)}
              />
              <ArtifactDeliveryList artifacts={artifacts(record)} />
              {audience === "customer" && channel === "agreements" ? (
                <>
                  <Link
                    href={
                      `/signing/redirect?agreementId=${encodeURIComponent(record.aggregateId)}` as Route
                    }
                  >
                    Sign this authorized agreement
                  </Link>
                  <EvidenceUploadControl
                    journey="customer_paper"
                    targetId={record.aggregateId}
                    kind="agreement"
                  />
                </>
              ) : audience === "customer" && channel === "pocs" ? (
                <EvidenceUploadControl
                  journey="poc"
                  targetId={record.aggregateId}
                  kind="acceptance"
                />
              ) : audience === "customer" && channel === "procurement" ? (
                <EvidenceUploadControl
                  journey="procurement"
                  targetId={record.aggregateId}
                  kind="approval"
                />
              ) : audience === "internal" && channel === "approvals" ? (
                <EvidenceUploadControl
                  journey="approval"
                  targetId={record.aggregateId}
                  kind="approval"
                />
              ) : audience === "internal" && channel === "queues" ? (
                <EvidenceUploadControl
                  journey="exception"
                  targetId={record.aggregateId}
                  kind="screening"
                />
              ) : null}
              <details>
                <summary>Technical projection evidence</summary>
                <p>
                  Aggregate {record.aggregateType} · {record.aggregateId}
                </p>
                <p>Source updated {record.sourceUpdatedAt}</p>
              </details>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
