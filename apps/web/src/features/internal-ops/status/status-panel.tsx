"use client";

import { useEffect, useState } from "react";

import { StatusBadge } from "@clockwork/ui";

import {
  readGeneratedLaneStatus,
  type LaneStatus,
} from "@/src/features/contracts/status-client";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { formatOperationalTimestamp } from "../presentation";
import { integrationStatusCopy } from "./copy";

type Lane = LaneStatus["lane"];
type LaneResult =
  | { state: "loading" }
  | { state: "ready"; value: LaneStatus; readAt: string }
  | { state: "unavailable"; readAt: string };

const lanes = ["core", "lifecycle", "system"] as const;
const laneLabels: Readonly<Record<Lane, string>> = {
  core: "Commerce",
  lifecycle: "Customer lifecycle",
  system: "Operations",
};

const detailLabels: Readonly<Record<string, string>> = {
  service: "Service store",
  stripeWebhook: "Stripe webhook",
  registration: "Registration provider",
  esign: "E-sign provider",
  provisioningWebhook: "Provisioning webhook",
  marketplaceWebhook: "Marketplace webhook",
  evidenceStorage: "Evidence storage",
  externalGates: "External gates",
  activationTestRunner: "Activation test runner",
  workosWebhook: "WorkOS webhook",
};

function detailValue(value: unknown): string {
  if (value === "database") return "Connected";
  if (value === "configured" || value === true) return "Configured";
  if (value === "unconfigured" || value === false) return "Not configured";
  return String(value).replaceAll("_", " ");
}

function tone(status: LaneStatus["status"]) {
  return status === "ready"
    ? ("success" as const)
    : status === "degraded"
      ? ("warning" as const)
      : ("danger" as const);
}

export function StatusPanel() {
  const [results, setResults] = useState<Readonly<Record<Lane, LaneResult>>>(
    () => ({
      core: { state: "loading" },
      lifecycle: { state: "loading" },
      system: { state: "loading" },
    }),
  );

  useEffect(() => {
    let current = true;
    const baseUrl = `${window.location.origin}/api`;
    void Promise.allSettled(
      lanes.map((lane) => readGeneratedLaneStatus(baseUrl, lane)),
    ).then((settled) => {
      if (!current) return;
      const readAt = new Date().toISOString();
      setResults({
        core:
          settled[0]?.status === "fulfilled"
            ? { state: "ready", value: settled[0].value, readAt }
            : { state: "unavailable", readAt },
        lifecycle:
          settled[1]?.status === "fulfilled"
            ? { state: "ready", value: settled[1].value, readAt }
            : { state: "unavailable", readAt },
        system:
          settled[2]?.status === "fulfilled"
            ? { state: "ready", value: settled[2].value, readAt }
            : { state: "unavailable", readAt },
      });
    });
    return () => {
      current = false;
    };
  }, []);

  return (
    <section className={styles.section} aria-labelledby="service-configuration">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="service-configuration">
            {integrationStatusCopy.lanes.heading}
          </h2>
          <p>{integrationStatusCopy.lanes.detail}</p>
        </div>
      </header>
      <div className={styles.reportList}>
        {lanes.map((lane) => {
          const result = results[lane];
          return (
            <article className={styles.reportCard} key={lane}>
              <div>
                <h3>{laneLabels[lane]}</h3>
                {result.state === "loading" ? (
                  <p role="status">{integrationStatusCopy.lanes.loading}</p>
                ) : result.state === "unavailable" ? (
                  <>
                    <p role="alert">
                      {integrationStatusCopy.lanes.unavailable}
                    </p>
                    <p>
                      {integrationStatusCopy.lanes.readAt(
                        formatOperationalTimestamp(result.readAt),
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <StatusBadge tone={tone(result.value.status)}>
                      {result.value.status}
                    </StatusBadge>
                    <dl className={styles.reviewGrid}>
                      {Object.entries(result.value.details).map(
                        ([key, value]) => (
                          <div key={key}>
                            <dt>{detailLabels[key] ?? key}</dt>
                            <dd>{detailValue(value)}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                    <p>
                      {integrationStatusCopy.lanes.readAt(
                        formatOperationalTimestamp(result.readAt),
                      )}
                    </p>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
