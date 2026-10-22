import type { Route } from "next";
import Link from "next/link";

import {
  hubspotDealStates,
  hubspotLinkFilters,
  hubspotRecordUrl,
  type HubSpotPipelineDeal,
  type HubSpotPipelineQuery,
  type HubSpotPortal,
} from "@clockwork/contracts";
import {
  Button,
  EmptyState,
  InlineNotice,
  Input,
  PageHeader,
  Select,
  StatusBadge,
  Table,
  Tag,
  buttonClassName,
} from "@clockwork/ui";

import type { MessageId, Translator } from "@/src/i18n";

import { LocalTimestamp } from "../local-timestamp";
import { partnerHref } from "../partners/model";
import {
  formatHubSpotAmount,
  formatHubSpotDate,
  handoffHref,
  pipelineHref,
  pipelinePath,
} from "./model";
import { CopyViewLink, RefreshHubSpotButton } from "./pipeline-actions";
import type { PipelineView } from "./server";
import styles from "./hubspot.module.css";

const stateLabels: Readonly<Record<HubSpotPipelineQuery["state"], MessageId>> =
  {
    open: "operations.hubspot.pipeline.state.open",
    closed: "operations.hubspot.pipeline.state.closed",
    all: "operations.hubspot.pipeline.state.all",
  };

const linkLabels: Readonly<Record<HubSpotPipelineQuery["linked"], MessageId>> =
  {
    any: "operations.hubspot.pipeline.linked.any",
    linked: "operations.hubspot.pipeline.linked.linked",
    partly: "operations.hubspot.pipeline.linked.partly",
    none: "operations.hubspot.pipeline.linked.none",
  };

function amountText(
  deal: Pick<HubSpotPipelineDeal, "amount" | "currency">,
  t: Translator,
  locale: string,
) {
  if (deal.amount && deal.currency)
    return formatHubSpotAmount(deal.amount, deal.currency, locale);
  return t("operations.hubspot.notSet");
}

function LinkedCompanies({
  deal,
  t,
}: {
  deal: HubSpotPipelineDeal;
  t: Translator;
}) {
  const linked = deal.companies.filter((company) => company.partner).length;
  if (!deal.companies.length)
    return (
      <span className={styles.secondary}>
        {t("operations.hubspot.pipeline.noCompanies")}
      </span>
    );
  return (
    <span className={styles.secondary}>
      {t("operations.hubspot.pipeline.linkedCount", {
        linked,
        total: deal.companies.length,
      })}
    </span>
  );
}

/**
 * HubSpot's pipeline inside Commerce, read-only. Counts and totals come from
 * every deal that matches the filters, never from the visible page; amounts
 * stay in their own currencies, and missing amounts are counted, not zeroed.
 */
export function PipelinePage({
  t,
  locale,
  query,
  view,
  selected,
  people,
  portal,
  demo,
}: {
  t: Translator;
  locale: string;
  query: HubSpotPipelineQuery;
  view: PipelineView;
  selected: HubSpotPipelineDeal | null;
  people: readonly {
    id: string;
    name: string;
    role: string;
    labels: readonly string[];
  }[];
  portal: Pick<HubSpotPortal, "portalId" | "uiDomain">;
  demo: boolean;
}) {
  const stageLabel = new Map(view.pipeline.stages.map((s) => [s.id, s.label]));
  const totals = (list: PipelineView["summary"]["totals"]) =>
    list
      .map((total) => formatHubSpotAmount(total.amount, total.currency, locale))
      .join(" · ");
  const largest = Math.max(
    1,
    ...view.summary.stages.map((stage) => stage.deals),
  );
  // The panel's heading is the anchor, so opening a deal lower down the
  // list brings its details into view, above the table on a phone.
  const dealHref = (id: string) =>
    `${pipelineHref({ ...query, deal: id })}#deal-panel` as Route;
  const close = pipelineHref({ ...query, deal: undefined });
  return (
    <main className={styles.main} id="main-content">
      <PageHeader
        title={t("operations.hubspot.pipeline.title")}
        description={t("operations.hubspot.pipeline.description")}
        actions={
          <div className={styles.actions}>
            <RefreshHubSpotButton />
            <CopyViewLink />
          </div>
        }
      />
      {demo ? (
        <InlineNotice tone="info" title={t("operations.hubspot.demo")} />
      ) : null}
      <p className={styles.secondary}>
        {t("operations.hubspot.pipeline.checked")}{" "}
        <LocalTimestamp value={view.checkedAt} locale={locale} />
        {view.stale ? (
          <>
            {" "}
            <StatusBadge tone="warning">
              {t("operations.hubspot.stale")}
            </StatusBadge>
          </>
        ) : null}
      </p>
      {view.stale ? (
        <InlineNotice
          tone="offline"
          title={t("operations.hubspot.pipeline.staleTitle")}
          description={t("operations.hubspot.pipeline.staleBody")}
        />
      ) : null}
      {!view.complete ? (
        <InlineNotice
          tone="warning"
          title={t("operations.hubspot.pipeline.partialTitle")}
          description={t("operations.hubspot.pipeline.partialBody", {
            read: view.read,
            total: view.total,
          })}
        />
      ) : null}

      <form
        className={`${styles.card} ${styles.filters}`}
        method="get"
        action={pipelinePath}
      >
        <Select
          label={t("operations.hubspot.pipeline.pipeline")}
          name="pipeline"
          defaultValue={view.pipeline.id}
          options={view.pipelines.map((pipeline) => ({
            value: pipeline.id,
            label: pipeline.label,
          }))}
        />
        <Select
          label={t("operations.hubspot.pipeline.state")}
          name="state"
          defaultValue={query.state}
          options={hubspotDealStates.map((value) => ({
            value,
            label: t(stateLabels[value]),
          }))}
        />
        <Select
          label={t("operations.hubspot.deal.stage")}
          name="stage"
          defaultValue={query.stage ?? ""}
          options={[
            { value: "", label: t("operations.hubspot.pipeline.anyStage") },
            ...view.pipeline.stages.map((stage) => ({
              value: stage.id,
              label: stage.label,
            })),
          ]}
        />
        <Select
          label={t("operations.hubspot.deal.owner")}
          name="owner"
          defaultValue={query.owner ?? ""}
          options={[
            { value: "", label: t("operations.hubspot.pipeline.anyOwner") },
            ...view.owners.map((owner) => ({
              value: owner.id,
              label: owner.name,
            })),
          ]}
        />
        <Input
          label={t("operations.hubspot.pipeline.closeFrom")}
          type="date"
          name="closeFrom"
          defaultValue={query.closeFrom ?? ""}
        />
        <Input
          label={t("operations.hubspot.pipeline.closeTo")}
          type="date"
          name="closeTo"
          defaultValue={query.closeTo ?? ""}
        />
        <Select
          label={t("operations.hubspot.pipeline.currency")}
          name="currency"
          defaultValue={query.currency ?? ""}
          options={[
            { value: "", label: t("operations.hubspot.pipeline.anyCurrency") },
            ...view.currencies.map((currency) => ({
              value: currency,
              label: currency,
            })),
          ]}
        />
        <Select
          label={t("operations.hubspot.pipeline.linkedLabel")}
          name="linked"
          defaultValue={query.linked}
          options={hubspotLinkFilters.map((value) => ({
            value,
            label: t(linkLabels[value]),
          }))}
        />
        <Input
          label={t("operations.hubspot.pipeline.search")}
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={100}
        />
        {query.view === "board" ? (
          <input type="hidden" name="view" value="board" />
        ) : null}
        <div className={styles.actions}>
          <Button type="submit">
            {t("operations.hubspot.pipeline.apply")}
          </Button>
          <Link
            className={buttonClassName({ variant: "quiet" })}
            href={pipelinePath}
          >
            {t("operations.hubspot.pipeline.clear")}
          </Link>
        </div>
      </form>

      <section className={styles.card} aria-labelledby="pipeline-summary">
        <div className={styles.cardHeading}>
          <h2 id="pipeline-summary">
            {t("operations.hubspot.pipeline.summary", {
              count: view.summary.deals,
            })}
          </h2>
          <nav
            aria-label={t("operations.hubspot.pipeline.viewLabel")}
            className={styles.actions}
          >
            <Link
              className={buttonClassName({
                variant: query.view === "table" ? "secondary" : "quiet",
              })}
              aria-current={query.view === "table" ? "page" : undefined}
              href={pipelineHref({ ...query, view: "table" })}
            >
              {t("operations.hubspot.pipeline.table")}
            </Link>
            <Link
              className={buttonClassName({
                variant: query.view === "board" ? "secondary" : "quiet",
              })}
              aria-current={query.view === "board" ? "page" : undefined}
              href={pipelineHref({ ...query, view: "board" })}
            >
              {t("operations.hubspot.pipeline.board")}
            </Link>
          </nav>
        </div>
        <p className={styles.muted}>
          {[
            view.summary.totals.length ? totals(view.summary.totals) : null,
            view.summary.missingAmounts
              ? t("operations.hubspot.pipeline.missing", {
                  count: view.summary.missingAmounts,
                })
              : null,
            view.summary.totals.length > 1
              ? t("operations.hubspot.pipeline.noCombined")
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || t("operations.hubspot.pipeline.noAmounts")}
        </p>
        <ol className={styles.stages}>
          {view.summary.stages.map((stage) => (
            <li className={styles.stage} key={stage.id}>
              <span className={styles.secondary}>{stage.label}</span>
              <strong>{stage.deals}</strong>
              <span className={styles.stageBar} aria-hidden="true">
                <span style={{ width: `${(stage.deals / largest) * 100}%` }} />
              </span>
              <span className={styles.secondary}>
                {[
                  stage.totals.length ? totals(stage.totals) : null,
                  stage.missingAmounts
                    ? t("operations.hubspot.pipeline.missing", {
                        count: stage.missingAmounts,
                      })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || " "}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div
        className={styles.workspace}
        {...(selected ? { "data-panel": "" } : {})}
      >
        {view.deals.length === 0 ? (
          <EmptyState
            title={t("operations.hubspot.pipeline.emptyTitle")}
            description={t("operations.hubspot.pipeline.emptyBody")}
          />
        ) : query.view === "board" ? (
          <div className={styles.board}>
            {view.pipeline.stages.map((stage) => {
              const deals = view.deals.filter(
                (deal) => deal.stageId === stage.id,
              );
              return (
                <section
                  className={styles.column}
                  key={stage.id}
                  aria-labelledby={`stage-${stage.id}`}
                >
                  <h3 id={`stage-${stage.id}`}>
                    {stage.label} · {deals.length}
                  </h3>
                  <ul className={styles.choices}>
                    {deals.map((deal) => (
                      <li className={styles.dealCard} key={deal.id}>
                        <Link
                          className={styles.rowLink}
                          href={dealHref(deal.id)}
                        >
                          {deal.name}
                        </Link>
                        <span className={styles.secondary}>
                          {deal.companies.map((c) => c.name).join(", ") ||
                            t("operations.hubspot.pipeline.noCompanies")}
                        </span>
                        <span>{amountText(deal, t, locale)}</span>
                        <LinkedCompanies deal={deal} t={t} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        ) : (
          <Table
            caption={t("operations.hubspot.pipeline.tableCaption")}
            captionHidden
            density="compact"
            stickyHeader
            headers={[
              t("operations.hubspot.pipeline.deal"),
              t("operations.hubspot.pipeline.companies"),
              t("operations.hubspot.deal.stage"),
              t("operations.hubspot.deal.amount"),
              t("operations.hubspot.deal.owner"),
              t("operations.hubspot.deal.close"),
              t("operations.hubspot.pipeline.commerce"),
            ]}
            numericColumns={[3]}
            rowKeys={view.deals.map((deal) => deal.id)}
            rows={view.deals.map((deal) => [
              <Link
                key="deal"
                className={styles.rowLink}
                href={dealHref(deal.id)}
                aria-current={selected?.id === deal.id ? "true" : undefined}
              >
                {deal.name}
              </Link>,
              deal.companies.map((c) => c.name).join(", ") || (
                <span className={styles.secondary}>
                  {t("operations.hubspot.pipeline.noCompanies")}
                </span>
              ),
              (deal.stageId && stageLabel.get(deal.stageId)) ??
                t("operations.hubspot.notSet"),
              amountText(deal, t, locale),
              deal.ownerName ?? t("operations.hubspot.noOwner"),
              formatHubSpotDate(deal.closeDate, locale) ??
                t("operations.hubspot.notSet"),
              <LinkedCompanies key="linked" deal={deal} t={t} />,
            ])}
          />
        )}
        {selected ? (
          <aside
            className={`${styles.card} ${styles.panel}`}
            aria-labelledby="deal-panel"
          >
            <div className={styles.cardHeading}>
              <h2 id="deal-panel" tabIndex={-1}>
                {selected.name}
              </h2>
              <Link
                className={buttonClassName({ variant: "quiet" })}
                href={close}
              >
                {t("operations.hubspot.pipeline.closePanel")}
              </Link>
            </div>
            <dl className={styles.facts}>
              <dt>{t("operations.hubspot.deal.stage")}</dt>
              <dd>
                {(selected.stageId && stageLabel.get(selected.stageId)) ??
                  t("operations.hubspot.notSet")}
              </dd>
              <dt>{t("operations.hubspot.deal.amount")}</dt>
              <dd>{amountText(selected, t, locale)}</dd>
              <dt>{t("operations.hubspot.deal.close")}</dt>
              <dd>
                {formatHubSpotDate(selected.closeDate, locale) ??
                  t("operations.hubspot.notSet")}
              </dd>
              <dt>{t("operations.hubspot.deal.owner")}</dt>
              <dd>{selected.ownerName ?? t("operations.hubspot.noOwner")}</dd>
              <dt>{t("operations.hubspot.section.updated")}</dt>
              <dd>
                {selected.updatedAt ? (
                  <LocalTimestamp value={selected.updatedAt} locale={locale} />
                ) : (
                  t("operations.hubspot.notSet")
                )}
              </dd>
            </dl>
            <h3>{t("operations.hubspot.pipeline.companies")}</h3>
            {selected.companies.length ? (
              <ul className={styles.list}>
                {selected.companies.map((company) => (
                  <li key={company.id}>
                    <strong>{company.name}</strong>
                    {company.labels.length ? (
                      <span className={styles.tags}>
                        {company.labels.map((label) => (
                          <Tag key={label}>{label}</Tag>
                        ))}
                      </span>
                    ) : null}
                    {company.partner ? (
                      <Link href={partnerHref(company.partner.id)}>
                        {t("operations.hubspot.pipeline.partnerLink", {
                          name: company.partner.name,
                        })}
                      </Link>
                    ) : (
                      <Link
                        className={buttonClassName({
                          variant: "secondary",
                          size: "small",
                        })}
                        href={handoffHref({
                          company: company.id,
                          deal: selected.id,
                        })}
                      >
                        {t("operations.hubspot.bring")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.actions}>
                <span className={styles.secondary}>
                  {t("operations.hubspot.pipeline.noCompanies")}
                </span>
                <Link
                  className={buttonClassName({
                    variant: "secondary",
                    size: "small",
                  })}
                  href={handoffHref({ deal: selected.id })}
                >
                  {t("operations.hubspot.bring")}
                </Link>
              </div>
            )}
            <h3>{t("operations.hubspot.group.people")}</h3>
            {people.length ? (
              <ul className={styles.list}>
                {people.map((person) => (
                  <li key={person.id}>
                    <span>{person.name}</span>
                    <span className={styles.secondary}>
                      {[person.role, person.labels.join(", ")]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>
                {t("operations.hubspot.people.none")}
              </p>
            )}
            <p className={styles.secondary}>
              {t("operations.hubspot.pipeline.registrationSeparate")}
            </p>
            <a
              className={buttonClassName({ variant: "quiet" })}
              href={hubspotRecordUrl(portal, "deal", selected.id)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t("operations.hubspot.openInHubSpot")}
            </a>
          </aside>
        ) : null}
      </div>
      <p className={styles.secondary}>
        <Link href={"/internal/partners"}>
          {t("operations.partners.backToList")}
        </Link>
      </p>
    </main>
  );
}
