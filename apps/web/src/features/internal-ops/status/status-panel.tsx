"use client";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";

import { useEffect, useState } from "react";

import { StatusBadge } from "@clockwork/ui";

import type { Translator } from "@/src/i18n";
import {
  readGeneratedLaneStatus,
  type LaneStatus,
} from "@/src/features/contracts/status-client";

import styles from "../finance-lifecycle/finance-lifecycle.module.css";
import { formatOperationalTimestamp } from "../presentation";
import {
  detailLabels,
  detailValueLabels,
  laneLabels,
  laneStatusLabels,
} from "./copy";

type Lane = LaneStatus["lane"];
type LaneResult =
  | { state: "loading" }
  | { state: "ready"; value: LaneStatus; readAt: string }
  | { state: "unavailable"; readAt: string };

const lanes = ["core", "lifecycle", "system"] as const;

/**
 * A detail value in the reader's language. A value outside the generated
 * contract is shown as the code the API sent, which is what support will ask
 * for.
 */
function detailValue(value: unknown, t: Translator): string {
  const code =
    value === true ? "configured" : value === false ? "missing" : String(value);
  const id = Object.hasOwn(detailValueLabels, code)
    ? detailValueLabels[code]
    : undefined;
  return id ? t(id) : code;
}

function detailLabel(key: string, t: Translator): string {
  const id = Object.hasOwn(detailLabels, key) ? detailLabels[key] : undefined;
  return id ? t(id) : key;
}

function tone(status: LaneStatus["status"]) {
  return status === "ready"
    ? ("success" as const)
    : status === "degraded"
      ? ("warning" as const)
      : ("danger" as const);
}

export function StatusPanel() {
  const t = useTranslations();
  const formattingLocale = useFormattingLocale();
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
            {t("operations.status.lanes.heading")}
          </h2>
          <p>{t("operations.status.lanes.detail")}</p>
        </div>
      </header>
      <div className={styles.reportList}>
        {lanes.map((lane) => {
          const result = results[lane];
          return (
            <article className={styles.reportCard} key={lane}>
              <div>
                <h3>{t(laneLabels[lane])}</h3>
                {result.state === "loading" ? (
                  <p role="status">{t("operations.status.lanes.loading")}</p>
                ) : result.state === "unavailable" ? (
                  <>
                    <p role="alert">
                      {t("operations.status.lanes.unavailable")}
                    </p>
                    <p>
                      {t("common.readAt", {
                        time: formatOperationalTimestamp(
                          result.readAt,
                          formattingLocale,
                        ),
                      })}
                    </p>
                  </>
                ) : (
                  <>
                    <StatusBadge tone={tone(result.value.status)}>
                      {t(laneStatusLabels[result.value.status])}
                    </StatusBadge>
                    <dl className={styles.reviewGrid}>
                      {Object.entries(result.value.details).map(
                        ([key, value]) => (
                          <div key={key}>
                            <dt>{detailLabel(key, t)}</dt>
                            <dd>{detailValue(value, t)}</dd>
                          </div>
                        ),
                      )}
                    </dl>
                    <p>
                      {t("common.readAt", {
                        time: formatOperationalTimestamp(
                          result.readAt,
                          formattingLocale,
                        ),
                      })}
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
