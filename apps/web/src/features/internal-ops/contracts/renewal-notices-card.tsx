import Link from "next/link";
import { contractToday } from "@clockwork/domain/contract-terms";
import { buttonClassName } from "@clockwork/ui";
import { getRequestCommerceSession } from "@/src/auth/session";
import { demoNow } from "@/src/features/experience-server/demo-clock";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { formatContractDate } from "./copy";
import { contractReader, contractRegisterReader } from "./demo-access";
import styles from "./contracts.module.css";

export interface RenewalSummary {
  within30: number;
  within60: number;
  within90: number;
  /** Notice deadline passed; the contract renews automatically. */
  passed: number;
  nextDeadline: string | null;
}

/** The card itself, for any page that already holds the summary. */
export async function RenewalNoticesSummary({
  summary,
}: {
  summary: RenewalSummary;
}) {
  const [t, locale] = await Promise.all([
    getTranslations(),
    getFormattingLocale(),
  ]);
  return (
    <section className={styles.card} aria-labelledby="renewal-notices-card">
      <div className={styles.cardHeader}>
        <div>
          <h2 id="renewal-notices-card">
            {t("operations.contracts.home.title")}
          </h2>
          {summary.within90 === 0 ? (
            <p>{t("operations.contracts.home.none")}</p>
          ) : (
            <>
              <p className={summary.within30 > 0 ? styles.urgent : undefined}>
                {t("operations.contracts.home.within", {
                  count: summary.within30,
                  days: 30,
                })}
              </p>
              <p>
                {t("operations.contracts.home.within", {
                  count: summary.within90,
                  days: 90,
                })}
              </p>
              {summary.nextDeadline ? (
                <p>
                  {t("operations.contracts.home.next", {
                    date: formatContractDate(summary.nextDeadline, locale),
                  })}
                </p>
              ) : null}
            </>
          )}
          {summary.passed > 0 ? (
            <p className={styles.urgent}>
              {t("operations.contracts.home.passed", {
                count: summary.passed,
              })}
            </p>
          ) : null}
        </div>
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/internal/contracts/notices"
        >
          {t("operations.contracts.home.open")}
        </Link>
      </div>
    </section>
  );
}

/**
 * The renewal notices card for the staff home. It shows nothing to anyone
 * who cannot read contracts, and nothing when the register cannot be read,
 * so it never stands in the way of the rest of the page.
 */
export async function RenewalNoticesCard() {
  let summary: RenewalSummary;
  try {
    const session = await contractReader(
      "contract:read",
      getRequestCommerceSession,
    );
    summary = await contractRegisterReader(session).renewalSummary(
      contractToday(demoNow()),
    );
  } catch {
    return null;
  }
  return <RenewalNoticesSummary summary={summary} />;
}
