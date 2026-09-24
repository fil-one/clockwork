import { EmptyState, Table } from "@clockwork/ui";

import { ProjectionActionButtons } from "./projection-action-buttons";
import { loadPortalRecords } from "./portal-view-loader";
import type { ProjectionChannel, ProjectionRecord } from "./model";
import { EvidenceUploadControl } from "./evidence-upload-control";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { formatOperationalTimestamp } from "@/src/features/internal-ops/presentation";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { richText } from "@/src/i18n/rich";
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
  const [projection, roles, formattingLocale, t] = await Promise.all([
    loadPortalRecords("internal", channel),
    getRouteRoles("internal"),
    getFormattingLocale(),
    getTranslations(),
  ]);
  const notRecorded = t("common.notRecorded");
  return (
    <main className={styles.main} id="main-content">
      <header className={styles.header}>
        <p className={styles.eyebrow}>{t("experience.workspace.internal")}</p>
        <h1>{title}</h1>
        <p className={styles.description}>{description}</p>
        <p
          className={projection.stale ? styles.stale : styles.freshness}
          role={projection.stale ? "alert" : "status"}
        >
          {richText(
            t,
            projection.stale
              ? "experience.internal.freshness.stale"
              : "experience.internal.freshness.current",
            {
              time: (
                <time dateTime={projection.generatedAt}>
                  {formatOperationalTimestamp(
                    projection.generatedAt,
                    formattingLocale,
                  )}
                </time>
              ),
            },
          )}
        </p>
      </header>
      {projection.records.length === 0 ? (
        <EmptyState
          title={t("experience.internal.empty.title")}
          description={t("experience.internal.empty.description")}
        />
      ) : (
        <Table
          className={styles.records ?? ""}
          caption={title}
          captionHidden
          headers={[
            t("experience.internal.column.record"),
            t("common.status"),
            t("common.owner"),
            t("experience.internal.column.nextTask"),
            t("common.actions"),
          ]}
          rowKeys={projection.records.map((record) => record.id)}
          rows={projection.records.map((record) => [
            <>
              {value(
                record,
                ["title", "name", "label", "account"],
                record.recordKey,
              )}
              <small className={styles.recordKey}>{record.recordKey}</small>
            </>,
            value(record, ["statusLabel"], notRecorded),
            value(record, ["owner", "assignee", "requestedBy"], notRecorded),
            value(record, ["nextAction", "task", "decision"], notRecorded),
            <>
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
                  label={t("experience.evidence.attachException")}
                  headingLevel={2}
                />
              ) : channel === "approvals" ? (
                <EvidenceUploadControl
                  journey="approval"
                  targetId={record.aggregateId}
                  kind="approval"
                  label={t("experience.evidence.attachApproval")}
                  headingLevel={2}
                />
              ) : null}
            </>,
          ])}
        />
      )}
    </main>
  );
}
