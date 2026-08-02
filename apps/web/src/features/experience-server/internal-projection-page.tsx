import { EmptyState } from "@clockwork/ui";

import { ProjectionActionButtons } from "./projection-action-buttons";
import { loadPortalRecords } from "./portal-view-loader";
import type { ProjectionChannel, ProjectionRecord } from "./model";
import { EvidenceUploadControl } from "./evidence-upload-control";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { plural } from "@/src/i18n/en";
import styles from "./internal-projection-page.module.css";

function value(
  record: ProjectionRecord,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const candidate = record.data[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return fallback;
}

function actions(record: ProjectionRecord): readonly string[] {
  const candidate = record.data.allowedActions;
  return Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string")
    : [];
}

export async function InternalProjectionPage({
  channel,
  title,
  description,
}: {
  channel: ProjectionChannel;
  title: string;
  description: string;
}) {
  const [projection, roles] = await Promise.all([
    loadPortalRecords("internal", channel),
    getRouteRoles("internal"),
  ]);
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <p className={styles.eyebrow}>Operator workspace</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        <p
          className={projection.stale ? styles.stale : styles.freshness}
          role={projection.stale ? "alert" : "status"}
        >
          {projection.stale
            ? "Some records are stale"
            : "Projection is current"}{" "}
          · Updated{" "}
          <time dateTime={projection.generatedAt}>
            {projection.generatedAt}
          </time>{" "}
          ·{" "}
          {plural(
            projection.pagesRead,
            "{count} server page",
            "{count} server pages",
          )}
        </p>
      </header>
      {projection.records.length === 0 ? (
        <EmptyState
          title="No work in this queue"
          description="Work authorized for your operator scope appears here."
        />
      ) : (
        <div
          className={styles.tableRegion}
          tabIndex={0}
          role="region"
          aria-label={`${title} records`}
        >
          <table className={styles.table}>
            <caption>{title} · session-scoped records</caption>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Status</th>
                <th scope="col">Owner</th>
                <th scope="col">Next task</th>
                <th scope="col">Version-bound actions</th>
              </tr>
            </thead>
            <tbody>
              {projection.records.map((record) => (
                <tr key={record.id}>
                  <th scope="row">
                    {value(
                      record,
                      ["title", "name", "label", "account"],
                      record.recordKey,
                    )}
                    <small className={styles.recordKey}>
                      {record.recordKey}
                    </small>
                  </th>
                  <td>
                    {value(
                      record,
                      ["statusLabel", "status", "state"],
                      "Not recorded",
                    )}
                  </td>
                  <td>
                    {value(
                      record,
                      ["owner", "assignee", "requestedBy"],
                      "Not recorded",
                    )}
                  </td>
                  <td>
                    {value(
                      record,
                      ["nextAction", "task", "decision"],
                      "Not recorded",
                    )}
                  </td>
                  <td>
                    <ProjectionActionButtons
                      audience="internal"
                      channel={channel}
                      recordKey={record.recordKey}
                      projectionId={record.id}
                      version={record.version}
                      actions={actions(record)}
                      roles={roles}
                    />
                    {channel === "queues" ? (
                      <EvidenceUploadControl
                        journey="exception"
                        targetId={record.aggregateId}
                        kind="screening"
                        label="Attach exception evidence"
                        headingLevel={2}
                      />
                    ) : channel === "approvals" ? (
                      <EvidenceUploadControl
                        journey="approval"
                        targetId={record.aggregateId}
                        kind="approval"
                        label="Attach approval evidence"
                        headingLevel={2}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
