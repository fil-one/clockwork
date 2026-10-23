import Link from "next/link";

import { StatusBadge } from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";

import { hubspotPickerPath, pipelinePath } from "./model";
import styles from "./hubspot.module.css";

/**
 * The read-only scopes the HubSpot service key (or a legacy private app)
 * needs, as HubSpot names them.
 */
export const hubspotReadScopes = [
  "crm.objects.companies.read",
  "crm.objects.deals.read",
  "crm.objects.contacts.read",
  "crm.objects.owners.read",
  "crm.schemas.companies.read",
  "crm.schemas.deals.read",
  "crm.schemas.contacts.read",
] as const;

export type HubSpotSetupStep = "token" | "deploy" | "approve" | "use";

/**
 * Where an environment stands: no token, a token the deployment cannot use,
 * a working token waiting for approval, or connected.
 */
export function hubspotSetupStage(input: {
  tokenConfigured: boolean;
  portalReachable: boolean;
  active: boolean;
}): HubSpotSetupStep {
  if (input.active && input.portalReachable) return "use";
  if (input.portalReachable) return "approve";
  if (input.tokenConfigured) return "deploy";
  return "token";
}

const order: readonly HubSpotSetupStep[] = [
  "token",
  "deploy",
  "approve",
  "use",
];

const titles: Readonly<Record<HubSpotSetupStep, MessageId>> = {
  token: "operations.hubspot.setup.tokenTitle",
  deploy: "operations.hubspot.setup.deployTitle",
  approve: "operations.hubspot.setup.approveTitle",
  use: "operations.hubspot.setup.useTitle",
};

/**
 * How to connect HubSpot, step by step, with where this environment stands.
 * Administrators see it on the connection page until HubSpot is in use; the
 * token itself is never shown or typed into Commerce.
 */
export function HubSpotSetupGuide({
  t,
  stage,
}: {
  t: Translator;
  stage: HubSpotSetupStep;
}) {
  const current = order.indexOf(stage);
  const state = (step: HubSpotSetupStep) => {
    const index = order.indexOf(step);
    return index < current || (step === "use" && stage === "use")
      ? "done"
      : index === current
        ? "current"
        : "upcoming";
  };
  const badge = (step: HubSpotSetupStep) => {
    const value = state(step);
    return (
      <StatusBadge
        tone={
          value === "done"
            ? "success"
            : value === "current"
              ? "info"
              : "neutral"
        }
      >
        {t(
          value === "done"
            ? "operations.hubspot.setup.done"
            : value === "current"
              ? "operations.hubspot.setup.current"
              : "operations.hubspot.setup.upcoming",
        )}
      </StatusBadge>
    );
  };
  return (
    <section className={styles.card} aria-labelledby="hubspot-setup">
      <div className={styles.cardHeading}>
        <h2 id="hubspot-setup">{t("operations.hubspot.setup.title")}</h2>
      </div>
      <p className={styles.muted}>{t("operations.hubspot.setup.body")}</p>
      <ol className={styles.list}>
        <li aria-current={state("token") === "current" ? "step" : undefined}>
          <div className={styles.rowHeading}>
            <h3>1. {t(titles.token)}</h3>
            {badge("token")}
          </div>
          <p className={styles.muted}>
            {t("operations.hubspot.setup.tokenBody")}
          </p>
          <p className={styles.secondary}>
            {t("operations.hubspot.setup.scopes")}
          </p>
          <ul className={styles.tags}>
            {hubspotReadScopes.map((scope) => (
              <li key={scope}>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
          <p className={styles.secondary}>
            {t("operations.hubspot.setup.filesScope")}
          </p>
        </li>
        <li aria-current={state("deploy") === "current" ? "step" : undefined}>
          <div className={styles.rowHeading}>
            <h3>2. {t(titles.deploy)}</h3>
            {badge("deploy")}
          </div>
          <p className={styles.muted}>
            {t("operations.hubspot.setup.deployBody")}
          </p>
          {stage === "deploy" ? (
            <p className={styles.secondary}>
              {t("operations.hubspot.setup.deployCheck")}
            </p>
          ) : null}
        </li>
        <li aria-current={state("approve") === "current" ? "step" : undefined}>
          <div className={styles.rowHeading}>
            <h3>3. {t(titles.approve)}</h3>
            {badge("approve")}
          </div>
          <p className={styles.muted}>
            {t("operations.hubspot.setup.approveBody")}
          </p>
        </li>
        <li aria-current={state("use") === "current" ? "step" : undefined}>
          <div className={styles.rowHeading}>
            <h3>4. {t(titles.use)}</h3>
            {badge("use")}
          </div>
          <p className={styles.muted}>
            {t("operations.hubspot.setup.useBody")}
          </p>
          {stage === "use" ? (
            <div className={styles.actions}>
              <Link href={hubspotPickerPath}>
                {t("operations.hubspot.setup.openPicker")}
              </Link>
              <Link href={pipelinePath}>
                {t("operations.hubspot.setup.openPipeline")}
              </Link>
              <Link href={"/internal/partners"}>
                {t("operations.hubspot.setup.openPartners")}
              </Link>
            </div>
          ) : null}
        </li>
      </ol>
    </section>
  );
}
