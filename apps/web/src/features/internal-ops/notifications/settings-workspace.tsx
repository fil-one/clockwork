"use client";

import { useState } from "react";

import {
  staffNotificationKindList,
  type StaffNotificationKind,
  type StaffNotificationSettings,
} from "@clockwork/contracts";
import {
  Button,
  Checkbox,
  FormActions,
  InlineNotice,
  Input,
  PageHeader,
  StateBanner,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import { useTranslations } from "@/src/i18n/client";

import { LocalTimestamp } from "../local-timestamp";
import { SessionExpiredReload } from "../session-expiry";
import { saveNotificationSettings, sendNotificationTest } from "./actions";
import {
  deliveryReasonIds,
  deliveryStatusIds,
  groupedKinds,
  notificationGroupIds,
  notificationLabel,
} from "./model";
import type { NotificationSettingsData } from "./page-data";
import type { ChannelStatus } from "./server";
import styles from "./notifications.module.css";

type Message = { tone: "success" | "danger"; text: string; expired?: boolean };

const editable = (
  settings: NotificationSettingsData["settings"],
): StaffNotificationSettings => ({
  emailEnabled: settings.emailEnabled,
  slackEnabled: settings.slackEnabled,
  emailDisabledKinds: [...settings.emailDisabledKinds],
  slackKinds: [...settings.slackKinds],
  slackChannelLabel: settings.slackChannelLabel,
});

const same = (a: StaffNotificationSettings, b: StaffNotificationSettings) =>
  JSON.stringify({
    ...a,
    emailDisabledKinds: [...a.emailDisabledKinds].sort(),
    slackKinds: [...a.slackKinds].sort(),
  }) ===
  JSON.stringify({
    ...b,
    emailDisabledKinds: [...b.emailDisabledKinds].sort(),
    slackKinds: [...b.slackKinds].sort(),
  });

/**
 * Notification settings for commerce administrators: whether email and
 * Slack are on, which kinds each carries and the Slack channel's name. The
 * secrets that connect each channel live in the deployment; this page says
 * whether they are there and can send a test.
 */
export function NotificationSettingsWorkspace({
  initial,
}: {
  initial: NotificationSettingsData;
}) {
  const t = useTranslations();
  const [record, setRecord] = useState(initial.settings);
  const [draft, setDraft] = useState(editable(initial.settings));
  const [busy, setBusy] = useState<"save" | "email" | "slack" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const kinds = staffNotificationKindList;

  async function save() {
    setMessage(null);
    setBusy("save");
    try {
      const result = await saveNotificationSettings(draft, record.version);
      if (!result.ok) {
        if (result.code === "STAFF_NOTIFICATION_SETTINGS_CONFLICT") {
          setMessage({
            tone: "danger",
            text: t("operations.notifications.settings.conflict"),
          });
          return;
        }
        setMessage({
          tone: "danger",
          text: t("operations.notifications.error"),
          ...(result.code === "SESSION_EXPIRED" ? { expired: true } : {}),
        });
        return;
      }
      setRecord(result.value);
      setDraft(editable(result.value));
      setMessage({
        tone: "success",
        text: t("operations.notifications.settings.saved"),
      });
    } finally {
      setBusy(null);
    }
  }

  async function test(channel: "email" | "slack") {
    setMessage(null);
    setBusy(channel);
    try {
      const result = await sendNotificationTest(channel);
      if (!result.ok) {
        setMessage({
          tone: "danger",
          text: t("operations.notifications.error"),
          ...(result.code === "SESSION_EXPIRED" ? { expired: true } : {}),
        });
        return;
      }
      setMessage(
        result.value.delivered
          ? {
              tone: "success",
              text:
                channel === "email"
                  ? t("operations.notifications.settings.testEmailSent", {
                      email: initial.adminEmail,
                    })
                  : t("operations.notifications.settings.testSlackSent"),
            }
          : {
              tone: "danger",
              text: t("operations.notifications.settings.testFailed", {
                code: result.value.code,
              }),
            },
      );
    } finally {
      setBusy(null);
    }
  }

  const setKind = (
    list: "emailDisabledKinds" | "slackKinds",
    kind: StaffNotificationKind,
    included: boolean,
  ) =>
    setDraft((current) => {
      // Email lists the kinds turned off; Slack lists the kinds turned on.
      const present = list === "slackKinds" ? included : !included;
      const without = current[list].filter((k) => k !== kind);
      return { ...current, [list]: present ? [...without, kind] : without };
    });

  return (
    <main className={styles.main} id="main-content">
      <div>
        <a className={styles.back} href="/internal/notifications">
          {t("operations.notifications.settings.back")}
        </a>
        <PageHeader
          title={t("operations.notifications.settings.title")}
          description={t("operations.notifications.settings.description")}
        />
      </div>
      {initial.demo ? (
        <InlineNotice
          tone="info"
          title={t("operations.notifications.settings.demo")}
        />
      ) : null}
      {message ? (
        <StateBanner
          tone={message.tone}
          live={message.tone === "danger" ? "assertive" : "polite"}
          title={message.text}
          {...(message.expired
            ? {
                action: (
                  <SessionExpiredReload onReloaded={() => setMessage(null)} />
                ),
              }
            : {})}
        />
      ) : null}
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset className={styles.card} disabled={initial.demo}>
          <Channel
            title={t("operations.notifications.settings.email")}
            status={initial.channels.email}
            missing={t("operations.notifications.settings.emailMissing")}
            target={(target) =>
              t("operations.notifications.settings.emailSender", {
                sender: target,
              })
            }
            enabled={draft.emailEnabled}
            onTest={() => void test("email")}
            testing={busy === "email"}
            disabled={busy !== null || initial.demo}
          />
          <Checkbox
            label={t("operations.notifications.settings.emailEnabled")}
            description={t(
              "operations.notifications.settings.emailEnabledHelp",
            )}
            checked={draft.emailEnabled}
            onChange={(event) =>
              setDraft({ ...draft, emailEnabled: event.target.checked })
            }
          />
          {draft.emailEnabled ? (
            <Kinds
              legend={t("operations.notifications.settings.emailKinds")}
              kinds={kinds}
              included={(kind) => !draft.emailDisabledKinds.includes(kind)}
              onChange={(kind, on) => setKind("emailDisabledKinds", kind, on)}
            />
          ) : null}
        </fieldset>
        <fieldset className={styles.card} disabled={initial.demo}>
          <Channel
            title={t("operations.notifications.settings.slack")}
            status={initial.channels.slack}
            missing={t("operations.notifications.settings.slackMissing")}
            target={() => draft.slackChannelLabel}
            enabled={draft.slackEnabled}
            onTest={() => void test("slack")}
            testing={busy === "slack"}
            disabled={busy !== null || initial.demo}
          />
          <Checkbox
            label={t("operations.notifications.settings.slackEnabled")}
            description={t(
              "operations.notifications.settings.slackEnabledHelp",
            )}
            checked={draft.slackEnabled}
            onChange={(event) =>
              setDraft({ ...draft, slackEnabled: event.target.checked })
            }
          />
          <div className={styles.narrow}>
            <Input
              id="notification-slack-channel"
              label={t("operations.notifications.settings.slackChannel")}
              help={t("operations.notifications.settings.slackChannelHelp")}
              value={draft.slackChannelLabel}
              maxLength={80}
              onChange={(event) =>
                setDraft({ ...draft, slackChannelLabel: event.target.value })
              }
            />
          </div>
          {draft.slackEnabled ? (
            <Kinds
              legend={t("operations.notifications.settings.slackKinds")}
              kinds={kinds}
              included={(kind) => draft.slackKinds.includes(kind)}
              onChange={(kind, on) => setKind("slackKinds", kind, on)}
            />
          ) : null}
        </fieldset>
        {!initial.demo ? (
          <FormActions>
            <Button
              type="submit"
              loading={busy === "save"}
              disabled={busy !== null || same(draft, editable(record))}
            >
              {t("common.save")}
            </Button>
          </FormActions>
        ) : null}
        <p className={styles.muted}>
          {t("operations.notifications.settings.lastChanged")}{" "}
          <LocalTimestamp value={record.updatedAt} />
        </p>
      </form>
      <section
        className={styles.card}
        aria-labelledby="notification-deliveries"
      >
        <h2 id="notification-deliveries">
          {t("operations.notifications.settings.recent")}
        </h2>
        {initial.recent.length === 0 ? (
          <p className={styles.muted}>
            {t("operations.notifications.settings.recentEmpty")}
          </p>
        ) : (
          <Table
            caption={t("operations.notifications.settings.recent")}
            captionHidden
            density="compact"
            headers={[
              t("operations.notifications.settings.recentWhen"),
              t("operations.notifications.settings.recentChannel"),
              t("operations.notifications.settings.recentKind"),
              t("operations.notifications.settings.recentStatus"),
            ]}
            rowKeys={initial.recent.map(
              (row, index) => `${row.updatedAt}-${index}`,
            )}
            rows={initial.recent.map((row) => [
              <LocalTimestamp key="when" value={row.updatedAt} />,
              t(
                row.channel === "email"
                  ? "operations.notifications.settings.email"
                  : "operations.notifications.settings.slack",
              ),
              (kinds as readonly string[]).includes(row.kind)
                ? notificationLabel(row.kind as StaffNotificationKind, t)
                : row.kind,
              deliveryOutcome(row, t),
            ])}
          />
        )}
      </section>
    </main>
  );
}

function deliveryOutcome(
  row: NotificationSettingsData["recent"][number],
  t: ReturnType<typeof useTranslations>,
) {
  const status = t(deliveryStatusIds[row.status]);
  const reason = row.reason ? deliveryReasonIds[row.reason] : undefined;
  if (!reason) return status;
  return row.providerCode
    ? t("operations.notifications.settings.outcomeWithCode", {
        status,
        reason: t(reason),
        code: row.providerCode,
      })
    : t("operations.notifications.settings.outcome", {
        status,
        reason: t(reason),
      });
}

function Channel({
  title,
  status,
  missing,
  target,
  enabled,
  onTest,
  testing,
  disabled,
}: {
  title: string;
  status: ChannelStatus;
  missing: string;
  target: (target: string) => string;
  enabled: boolean;
  onTest: () => void;
  testing: boolean;
  disabled: boolean;
}) {
  const t = useTranslations();
  const configured = status.state === "configured";
  return (
    <>
      <div className={styles.channelHeader}>
        <h2>{title}</h2>
        <StatusBadge tone={configured ? "success" : "neutral"}>
          {t(
            configured
              ? "operations.notifications.settings.configured"
              : status.state === "invalid_configuration"
                ? "operations.notifications.settings.invalid"
                : status.state === "demo"
                  ? "operations.notifications.settings.demoChannel"
                  : "operations.notifications.settings.notConfigured",
          )}
        </StatusBadge>
      </div>
      {configured ? (
        target(status.target) ? (
          <p className={styles.muted}>{target(status.target)}</p>
        ) : null
      ) : status.state !== "demo" ? (
        <p className={styles.muted}>
          {status.state === "invalid_configuration"
            ? t("operations.notifications.settings.invalidHelp")
            : missing}
        </p>
      ) : null}
      {enabled && !configured && status.state !== "demo" ? (
        <InlineNotice
          tone="warning"
          title={t("operations.notifications.settings.notConfiguredWarning")}
        />
      ) : null}
      {configured ? (
        <div>
          <Button
            variant="secondary"
            size="small"
            loading={testing}
            disabled={disabled}
            onClick={onTest}
          >
            {t("operations.notifications.settings.sendTest")}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Kinds({
  legend,
  kinds,
  included,
  onChange,
}: {
  legend: string;
  kinds: readonly StaffNotificationKind[];
  included: (kind: StaffNotificationKind) => boolean;
  onChange: (kind: StaffNotificationKind, on: boolean) => void;
}) {
  const t = useTranslations();
  return (
    <fieldset className={styles.kinds}>
      <legend className="sr-only">{legend}</legend>
      {groupedKinds(kinds).map(({ group, kinds: groupKinds }) => (
        <fieldset key={group}>
          <legend>{t(notificationGroupIds[group])}</legend>
          {groupKinds.map((kind) => (
            <Checkbox
              key={kind}
              label={notificationLabel(kind, t)}
              checked={included(kind)}
              onChange={(event) => onChange(kind, event.target.checked)}
            />
          ))}
        </fieldset>
      ))}
    </fieldset>
  );
}
