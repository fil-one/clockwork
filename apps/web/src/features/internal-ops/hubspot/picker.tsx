import type { Route } from "next";
import Link from "next/link";

import {
  Breadcrumbs,
  Button,
  EmptyState,
  InlineNotice,
  Input,
  PageHeader,
  StatusBadge,
  buttonClassName,
} from "@clockwork/ui";

import { breadcrumbsLabel } from "@/src/features/shared/ui-kit-labels";
import type { Translator } from "@/src/i18n";

import { partnerHref, partnersPath } from "../partners/model";
import { handoffHref, hubspotPickerPath } from "./model";
import type { HubSpotSearch } from "./server";
import styles from "./hubspot.module.css";

/**
 * Search-first: nothing loads until someone searches, so the CRM directory
 * is never listed wholesale. Results name the company's domain and owner and
 * say when it is already linked in Commerce.
 */
export function HubSpotPicker({
  t,
  q,
  deal,
  partner,
  result,
  portalId,
  canImport,
  demo,
}: {
  t: Translator;
  q: string;
  deal: string | null;
  partner: string | null;
  result: HubSpotSearch;
  portalId: string;
  canImport: boolean;
  demo: boolean;
}) {
  const count =
    result.kind === "results"
      ? result.companies.length + (deal ? 0 : result.deals.length)
      : 0;
  return (
    <main className={styles.main} id="main-content">
      <Breadcrumbs
        label={breadcrumbsLabel(t)}
        items={[
          { label: t("operations.partners.title"), href: partnersPath },
          { label: t("operations.hubspot.picker.title") },
        ]}
        renderLink={(href, label) => <Link href={href as Route}>{label}</Link>}
      />
      <PageHeader
        title={t("operations.hubspot.picker.title")}
        description={t(
          partner
            ? "operations.hubspot.picker.linkDescription"
            : deal
              ? "operations.hubspot.picker.dealDescription"
              : "operations.hubspot.picker.description",
        )}
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.hubspot.demo")} />
      ) : !canImport ? (
        <InlineNotice tone="info" title={t("operations.hubspot.readOnly")} />
      ) : null}
      <form className={`${styles.card} ${styles.search}`} role="search">
        {deal ? <input type="hidden" name="deal" value={deal} /> : null}
        {partner ? (
          <input type="hidden" name="partner" value={partner} />
        ) : null}
        <Input
          label={t("operations.hubspot.picker.searchLabel")}
          help={t("operations.hubspot.picker.searchHelp")}
          name="q"
          type="search"
          defaultValue={q}
          maxLength={200}
          autoComplete="off"
        />
        <Button type="submit">{t("operations.hubspot.picker.search")}</Button>
      </form>
      <p className="cw-sr-only" role="status" aria-live="polite">
        {result.kind === "results"
          ? t("operations.hubspot.picker.announce", { count, query: q })
          : ""}
      </p>
      {result.kind === "foreign_portal" ? (
        <InlineNotice
          tone="warning"
          title={t("operations.hubspot.picker.foreignTitle")}
          description={t("operations.hubspot.picker.foreignBody", {
            linked: result.portalId,
            connected: portalId,
          })}
        />
      ) : null}
      {result.kind === "results" && count === 0 ? (
        <EmptyState
          title={t("operations.hubspot.picker.noneTitle")}
          description={t("operations.hubspot.picker.noneBody", { query: q })}
          action={
            canImport ? (
              <Link
                className={buttonClassName({ variant: "secondary" })}
                href={"/internal/partners/new"}
              >
                {t("operations.hubspot.picker.manual")}
              </Link>
            ) : undefined
          }
        />
      ) : null}
      {result.kind === "results" && count > 0 ? (
        <div className={styles.results}>
          <section className={styles.card} aria-labelledby="hubspot-companies">
            <h2 id="hubspot-companies">
              {t("operations.hubspot.picker.companies")}
            </h2>
            {result.companies.length ? (
              <ul className={styles.list}>
                {result.companies.map((company) => (
                  <li key={company.id}>
                    <div className={styles.rowHeading}>
                      <h3>{company.name}</h3>
                      {company.partner ? (
                        <StatusBadge tone="info">
                          {t("operations.hubspot.picker.linked")}
                        </StatusBadge>
                      ) : null}
                    </div>
                    <span className={styles.secondary}>
                      {[
                        company.detail,
                        company.ownerName
                          ? t("operations.hubspot.ownerIs", {
                              name: company.ownerName,
                            })
                          : t("operations.hubspot.noOwner"),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {company.partner ? (
                      <span className={styles.secondary}>
                        {t("operations.hubspot.picker.linkedTo", {
                          name: company.partner.name,
                        })}
                      </span>
                    ) : null}
                    <div className={styles.actions}>
                      {company.partner ? (
                        <>
                          <Link
                            className={buttonClassName({
                              variant: "secondary",
                            })}
                            href={partnerHref(company.partner.id)}
                          >
                            {t("operations.hubspot.openPartner")}
                          </Link>
                          <Link
                            className={buttonClassName({ variant: "quiet" })}
                            href={handoffHref({ company: company.id, deal })}
                          >
                            {t("operations.hubspot.reviewUpdates")}
                          </Link>
                        </>
                      ) : (
                        <Link
                          className={buttonClassName()}
                          href={handoffHref({
                            company: company.id,
                            deal,
                            partner,
                          })}
                        >
                          {t("operations.hubspot.picker.review")}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                {t("operations.hubspot.picker.noCompanies")}
              </p>
            )}
          </section>
          {deal ? null : (
            <section className={styles.card} aria-labelledby="hubspot-deals">
              <h2 id="hubspot-deals">{t("operations.hubspot.picker.deals")}</h2>
              {result.deals.length ? (
                <ul className={styles.list}>
                  {result.deals.map((item) => (
                    <li key={item.id}>
                      <div className={styles.rowHeading}>
                        <h3>{item.name}</h3>
                      </div>
                      <span className={styles.secondary}>
                        {[
                          item.detail,
                          item.ownerName
                            ? t("operations.hubspot.ownerIs", {
                                name: item.ownerName,
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <div className={styles.actions}>
                        <Link
                          className={buttonClassName()}
                          href={handoffHref({ deal: item.id, partner })}
                        >
                          {t("operations.hubspot.picker.review")}
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>
                  {t("operations.hubspot.picker.noDeals")}
                </p>
              )}
            </section>
          )}
        </div>
      ) : null}
      {result.kind === "empty" ? (
        <p className={styles.muted}>{t("operations.hubspot.picker.start")}</p>
      ) : null}
      <p className={styles.secondary}>
        <Link href={hubspotPickerPath}>
          {t("operations.hubspot.picker.clear")}
        </Link>
      </p>
    </main>
  );
}
