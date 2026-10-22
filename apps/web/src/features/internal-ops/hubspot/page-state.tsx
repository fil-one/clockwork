import Link from "next/link";

import { ApplicationStatePanel, buttonClassName } from "@clockwork/ui";

import type { MessageId } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";

import { partnersPath } from "../partners/model";
import { hubspotSettingsPath } from "./model";
import type { HubSpotLoaded } from "./page-data";
import styles from "./hubspot.module.css";

type Unready = Exclude<HubSpotLoaded<object>, { kind: "ready" }>;

const unavailableCopy: Readonly<
  Record<string, { title: MessageId; body: MessageId }>
> = {
  HUBSPOT_NOT_CONFIGURED: {
    title: "operations.hubspot.state.notConfiguredTitle",
    body: "operations.hubspot.state.notConfiguredBody",
  },
  HUBSPOT_NOT_CONNECTED: {
    title: "operations.hubspot.state.notConnectedTitle",
    body: "operations.hubspot.state.notConnectedBody",
  },
  HUBSPOT_PORTAL_MISMATCH: {
    title: "operations.hubspot.state.portalTitle",
    body: "operations.hubspot.state.portalBody",
  },
  HUBSPOT_RATE_LIMITED: {
    title: "operations.hubspot.state.busyTitle",
    body: "operations.hubspot.state.busyBody",
  },
  HUBSPOT_SCOPE_DENIED: {
    title: "operations.hubspot.state.scopeTitle",
    body: "operations.hubspot.state.scopeBody",
  },
  HUBSPOT_NO_PIPELINES: {
    title: "operations.hubspot.state.noPipelinesTitle",
    body: "operations.hubspot.state.noPipelinesBody",
  },
  HUBSPOT_RECORD_ARCHIVED: {
    title: "operations.hubspot.state.archivedTitle",
    body: "operations.hubspot.state.archivedBody",
  },
  HUBSPOT_NOT_ASSOCIATED: {
    title: "operations.hubspot.state.notAssociatedTitle",
    body: "operations.hubspot.state.notAssociatedBody",
  },
};

const fallback = {
  title: "operations.hubspot.state.unavailableTitle",
  body: "operations.hubspot.state.unavailableBody",
} as const satisfies { title: MessageId; body: MessageId };

/**
 * What a HubSpot page shows when it cannot show HubSpot data, and where to
 * go instead. Manual partner creation always stays one click away.
 */
export async function HubSpotPageState({
  state,
  title,
}: {
  state: Unready;
  title: string;
}) {
  const t = await getTranslations();
  const copy =
    state.kind === "unavailable"
      ? (unavailableCopy[state.code] ?? fallback)
      : state.kind === "denied"
        ? state.code === "CONTRACT_MFA_REQUIRED"
          ? {
              title: "operations.partners.access.mfaTitle" as const,
              body: "operations.partners.access.mfaBody" as const,
            }
          : state.code === "CONTRACT_DEMO_UNAVAILABLE"
            ? {
                title: "operations.hubspot.state.demoTitle" as const,
                body: "operations.hubspot.state.demoBody" as const,
              }
            : {
                title: "operations.partners.access.forbiddenTitle" as const,
                body: "operations.partners.access.forbiddenBody" as const,
              }
        : state.kind === "missing"
          ? {
              title: "operations.hubspot.state.missingTitle" as const,
              body: "operations.hubspot.state.missingBody" as const,
            }
          : fallback;
  return (
    <main className={styles.main} id="main-content">
      <h1 className="cw-sr-only">{title}</h1>
      <ApplicationStatePanel
        state={
          state.kind === "error" ||
          (state.kind === "unavailable" &&
            ["HUBSPOT_UNAVAILABLE", "HUBSPOT_RATE_LIMITED"].includes(
              state.code,
            ))
            ? "recoverable-error"
            : state.kind === "missing"
              ? "empty"
              : "permission"
        }
        title={t(copy.title)}
        description={t(copy.body)}
        action={
          state.kind === "unavailable" &&
          state.canManage &&
          state.code !== "HUBSPOT_RECORD_ARCHIVED" ? (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={hubspotSettingsPath}
            >
              {t("operations.hubspot.state.settings")}
            </Link>
          ) : (
            <Link
              className={buttonClassName({ variant: "secondary" })}
              href={partnersPath}
            >
              {t("operations.partners.backToList")}
            </Link>
          )
        }
        secondaryAction={
          state.kind === "unavailable" || state.kind === "missing" ? (
            <Link
              className={buttonClassName({ variant: "quiet" })}
              href={"/internal/partners/new"}
            >
              {t("operations.hubspot.picker.manual")}
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}
