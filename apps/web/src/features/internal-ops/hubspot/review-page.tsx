import type { Route } from "next";
import Link from "next/link";

import {
  Breadcrumbs,
  Button,
  InlineNotice,
  PageHeader,
  StatusBadge,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { Translator } from "@/src/i18n";

import { partnerHref, partnersPath } from "../partners/model";
import { hubspotPickerPath, type DealCompanyChoice } from "./model";
import type { loadReview } from "./page-data";
import { HandoffReview } from "./review";
import styles from "./hubspot.module.css";

type Ready = Extract<Awaited<ReturnType<typeof loadReview>>, { kind: "ready" }>;

/**
 * A deal names its companies; which one becomes the Commerce partner is a
 * person's choice. Every option starts unselected, and a HubSpot "Primary"
 * label is shown as context, never as a default.
 */
function DealChoice({
  t,
  choice,
  partner,
}: {
  t: Translator;
  choice: DealCompanyChoice;
  partner: string | null;
}) {
  return (
    <form
      className={styles.card}
      method="get"
      action="/internal/hubspot/review"
    >
      <input type="hidden" name="deal" value={choice.deal.id} />
      {partner ? <input type="hidden" name="partner" value={partner} /> : null}
      {choice.companies.length ? (
        <fieldset className={styles.choices}>
          <legend>
            <strong>{t("operations.hubspot.choose.legend")}</strong>
          </legend>
          <p className={styles.muted}>{t("operations.hubspot.choose.body")}</p>
          {choice.companies.map((company) => (
            <label className={styles.choice} key={company.id}>
              <span className={styles.rowHeading}>
                <input
                  type="radio"
                  name="company"
                  value={company.id}
                  required
                />
                <strong>{company.name}</strong>
                {company.labels.map((label) => (
                  <Tag key={label}>{label}</Tag>
                ))}
                {company.partner ? (
                  <StatusBadge tone="info">
                    {t("operations.hubspot.picker.linked")}
                  </StatusBadge>
                ) : null}
              </span>
              {company.partner ? (
                <span className={styles.secondary}>
                  {t("operations.hubspot.picker.linkedTo", {
                    name: company.partner.name,
                  })}
                </span>
              ) : null}
            </label>
          ))}
          <div className={styles.actions}>
            <Button type="submit">
              {t("operations.hubspot.choose.continue")}
            </Button>
          </div>
        </fieldset>
      ) : (
        <>
          <InlineNotice
            tone="info"
            title={t("operations.hubspot.choose.noneTitle")}
            description={t("operations.hubspot.choose.noneBody")}
          />
          <div className={styles.actions}>
            <Link
              className={buttonClassName()}
              href={
                `${hubspotPickerPath}?deal=${choice.deal.id}${partner ? `&partner=${partner}` : ""}` as Route
              }
            >
              {t("operations.hubspot.choose.pick")}
            </Link>
          </div>
        </>
      )}
    </form>
  );
}

/** The handoff review page: a deal's company choice, or the review itself. */
export function ReviewPage({ t, loaded }: { t: Translator; loaded: Ready }) {
  const crumbs = [
    { label: t("operations.partners.title"), href: partnersPath },
    { label: t("operations.hubspot.picker.title"), href: hubspotPickerPath },
    { label: t("operations.hubspot.review.title") },
  ];
  if (loaded.step === "choose_company")
    return (
      <main className={styles.main} id="main-content">
        <Breadcrumbs
          label={breadcrumbsLabel(t)}
          items={crumbs}
          renderLink={(href, label) => (
            <Link href={href as Route}>{label}</Link>
          )}
        />
        <PageHeader
          title={t("operations.hubspot.choose.title", {
            deal: loaded.choice.deal.name,
          })}
          description={
            loaded.choice.deal.stageLabel
              ? t("operations.hubspot.choose.stage", {
                  stage: loaded.choice.deal.stageLabel,
                })
              : undefined
          }
          actions={
            <a
              className={buttonClassName({ variant: "quiet" })}
              href={loaded.choice.deal.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("operations.hubspot.openInHubSpot")}
            </a>
          }
        />
        <DealChoice t={t} choice={loaded.choice} partner={loaded.partner} />
      </main>
    );
  const destination = loaded.destination;
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={crumbs}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={
          destination
            ? loaded.alreadyLinked
              ? t("operations.hubspot.review.updateTitle", {
                  name: destination.name,
                })
              : t("operations.hubspot.review.linkTitle", {
                  name: destination.name,
                })
            : t("operations.hubspot.review.newTitle", {
                name: loaded.source.company.name,
              })
        }
        description={t(
          destination
            ? "operations.hubspot.review.updateDescription"
            : "operations.hubspot.review.newDescription",
        )}
      />
      {loaded.requestedOther && destination ? (
        <InlineNotice
          tone="info"
          title={t("operations.hubspot.review.exactLinkTitle")}
          description={t("operations.hubspot.review.exactLinkBody", {
            name: destination.name,
          })}
          action={
            <Link href={partnerHref(destination.id)}>
              {t("operations.hubspot.openPartner")}
            </Link>
          }
        />
      ) : null}
      <HandoffReview
        source={loaded.source}
        connection={loaded.connection}
        destination={destination}
        history={loaded.history}
        suggestions={loaded.suggestions}
        owners={loaded.owners}
        ownerProposal={loaded.ownerProposal}
        linkedElsewhere={loaded.linkedElsewhere}
        canImport={loaded.canImport}
        demo={loaded.demo}
      />
    </main>
  );
}
