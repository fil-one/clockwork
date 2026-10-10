"use client";
import { StateBanner } from "@clockwork/ui";
import { useFormattingLocale, useTranslations } from "@/src/i18n/client";
import type { MndaDuplicates } from "./actions";
import { contractStatusLabels, contractTypeLabels } from "../contracts/copy";
import { mndaStateLabels } from "./labels";
import { formatMndaDate } from "./format";
import styles from "./workspace.module.css";

/** No earlier MNDAs or contracts for the company. */
export const noDuplicateMatches: MndaDuplicates = { mndas: [], contracts: [] };

/**
 * Earlier MNDAs and register contracts for the same company, with links. The
 * MNDA form and the contract form both show it while a seller types; it never
 * blocks what they are doing.
 */
export function DuplicateWarning({ matches }: { matches: MndaDuplicates }) {
  return (
    <>
      <MndaMatches matches={matches.mndas} />
      <ContractMatches matches={matches.contracts} />
    </>
  );
}

function MndaMatches({ matches }: { matches: MndaDuplicates["mndas"] }) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  if (!matches.length) return null;
  return (
    <StateBanner
      tone="warning"
      live="polite"
      className={styles.inlineBanner ?? ""}
      title={t("operations.mnda.duplicate.title")}
      description={
        <ul className={styles.matchList}>
          {matches.map((match) => (
            <li key={match.id}>
              <a
                href={`/internal/mndas?q=${encodeURIComponent(match.company)}`}
                target="_blank"
                rel="noreferrer"
              >
                {match.company}
              </a>{" "}
              {t("operations.mnda.duplicate.detail", {
                status: t(mndaStateLabels[match.state]),
                date: formatMndaDate(
                  match.completedAt ?? match.createdAt,
                  locale,
                ),
                owner: match.ownerName,
              })}
            </li>
          ))}
        </ul>
      }
    />
  );
}

/** Register contracts with the same company, NDAs or any other type. */
function ContractMatches({
  matches,
}: {
  matches: MndaDuplicates["contracts"];
}) {
  const t = useTranslations();
  const locale = useFormattingLocale();
  if (!matches.length) return null;
  return (
    <StateBanner
      tone="warning"
      live="polite"
      className={styles.inlineBanner ?? ""}
      title={t("operations.mnda.duplicate.contractsTitle")}
      description={
        <ul className={styles.matchList}>
          {matches.map((match) => {
            const values = {
              type: t(contractTypeLabels[match.contractType]),
              status: t(contractStatusLabels[match.status]),
              owner: match.ownerName,
            };
            return (
              <li key={match.id}>
                <a
                  href={`/internal/contracts/${match.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {match.counterpartyName}
                </a>{" "}
                {match.effectiveDate
                  ? t("operations.mnda.duplicate.contractDetail", {
                      ...values,
                      date: formatMndaDate(match.effectiveDate, locale),
                    })
                  : t(
                      "operations.mnda.duplicate.contractDetailUndated",
                      values,
                    )}
              </li>
            );
          })}
        </ul>
      }
    />
  );
}
