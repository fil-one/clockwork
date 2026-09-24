import { use } from "react";

import {
  InlineNotice,
  PageHeader,
  Section,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import styles from "./trust-page.module.css";
import {
  tokenDistinctivenessCeiling,
  type TrustControl,
  trustControls,
  trustGaps,
  trustIntegrations,
  trustSections,
  trustStatement,
  trustUnselectedIntegrations,
} from "./trust-register";

/**
 * Every file a control rests on, deduplicated for display. A control that
 * describes an exception cites the exception too, and the reader is being asked
 * to open all of it, so the column lists all of it.
 */
function citedPaths(control: TrustControl): readonly string[] {
  return [
    ...new Set([
      control.evidencePath,
      ...(control.alsoCites ?? []).map((citation) => citation.path),
    ]),
  ];
}

/**
 * The trust, security and compliance surface.
 *
 * It renders `trust-register.ts` and nothing else. There is deliberately no
 * prose in this file that states a fact about the product: every sentence a
 * reader could rely on comes from the register, where it is bound to a file
 * and a token that `trust-register.test.ts` reads off the working tree. The
 * only free text here is navigational -- headings, and the notices that tell
 * the reader what kind of document this is.
 *
 * Every sentence is a message in the reader's interface language, read from
 * the language preference cookie. That is the only request input: a reader
 * in a given language receives the same bytes as every other reader in that
 * language. File paths, gate keys and vendor names are printed as they are.
 *
 * THE ONE PARAGRAPH THAT IS A CLAIM, AND WHY IT IS ALLOWED TO BE. The lede
 * describes what the build checks. That paragraph used to say the build "fails
 * if the file no longer contains what the control claims", which promised a
 * semantic check nothing performed -- two invented controls citing
 * `package.json` for the token "name" passed the suite untouched. It now
 * enumerates the four checks that exist, one clause each, and then says in as
 * many words that the fit between a sentence and the code it cites is a human
 * judgement the build does not make. The distinctiveness threshold is read out
 * of `tokenDistinctivenessCeiling` rather than typed, so the number on the page
 * cannot drift from the number the suite enforces; it is formatted as a
 * percentage in the reader's locale.
 *
 * Do not compress that paragraph back into one sentence. The compression is
 * what made it false the first time: any summary short enough to feel like a
 * guarantee describes a stronger check than the one that runs.
 *
 * NO PUBLICATION DATE, DELIBERATELY. The first version of this component
 * stamped a date and called it a build stamp. It was not one: `app/layout.tsx`
 * awaits `headers()` and `cookies()`, which makes every route in this
 * application server-rendered on demand, so the stamp was the clock at the
 * moment a reader loaded the page and said nothing about when the content was
 * last true. A date that looks like provenance and is not is worse on this page
 * than on any other, so it is gone and the mechanism is described instead.
 */
export function TrustPage() {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const share = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(tokenDistinctivenessCeiling);
  const evidenceHeader = t("platform.trust.header.evidence");
  const gapsTitle = t("platform.trust.gaps.title");
  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.column}>
        <div className={styles.intro}>
          <PageHeader
            eyebrow={t("platform.trust.eyebrow")}
            title={t("platform.trust.title")}
            description={t("platform.trust.description")}
          />
          <p className={styles.lede}>
            {t("platform.trust.lede.checks", { share })}
          </p>
          <p className={styles.lede}>{t("platform.trust.lede.numbers")}</p>
          <p className={styles.lede}>{t("platform.trust.lede.judgement")}</p>
          <InlineNotice
            tone="warning"
            title={t("platform.trust.notice.title")}
            description={t("platform.trust.notice.description", {
              section: gapsTitle,
            })}
          />
        </div>

        {trustSections.map((section) => {
          const controls = trustControls.filter(
            (control) => control.section === section.id,
          );
          const title = t(section.title);
          return (
            <Section
              key={section.id}
              title={title}
              description={t(section.summary)}
            >
              <Table
                caption={t("platform.trust.controls.caption", {
                  section: title,
                })}
                captionHidden
                headers={[
                  t("platform.trust.controls.header.control"),
                  evidenceHeader,
                ]}
                rowKeys={controls.map((control) => control.id)}
                rows={controls.map((control) => [
                  <span key="s" className={styles.statement}>
                    {trustStatement(control.statement, t)}
                  </span>,
                  <span key="e" className={styles.evidenceList}>
                    {citedPaths(control).map((path) => (
                      <code key={path} className={styles.evidence}>
                        {path}
                      </code>
                    ))}
                  </span>,
                ])}
              />
            </Section>
          );
        })}

        <Section
          title={t("platform.trust.integrations.title")}
          description={t("platform.trust.integrations.description")}
        >
          <Table
            caption={t("platform.trust.integrations.caption")}
            captionHidden
            headers={[
              t("platform.trust.integrations.header.service"),
              t("platform.trust.integrations.header.purpose"),
              evidenceHeader,
            ]}
            rowKeys={trustIntegrations.map((integration) => integration.name)}
            rows={trustIntegrations.map((integration) => [
              <bdi key="n">{integration.name}</bdi>,
              <span key="p" className={styles.statement}>
                {t(integration.purpose)}
              </span>,
              <code key="e" className={styles.evidence}>
                {integration.evidencePath}
              </code>,
            ])}
          />
        </Section>

        <Section
          title={t("platform.trust.unselected.title")}
          description={t("platform.trust.unselected.description")}
        >
          <Table
            caption={t("platform.trust.unselected.caption")}
            captionHidden
            headers={[
              t("platform.trust.unselected.header.capability"),
              t("platform.trust.unselected.header.gate"),
              evidenceHeader,
            ]}
            rowKeys={trustUnselectedIntegrations.map(
              (entry) => entry.capability,
            )}
            rows={trustUnselectedIntegrations.map((entry) => [
              t(entry.capability),
              <StatusBadge key="g" tone="neutral">
                {entry.gate}
              </StatusBadge>,
              <code key="e" className={styles.evidence}>
                {entry.evidencePath}
              </code>,
            ])}
          />
        </Section>

        <Section
          title={gapsTitle}
          description={t("platform.trust.gaps.description")}
        >
          <ul className={styles.gapList}>
            {trustGaps.map((gap) => (
              <li key={gap.id} className={styles.gap}>
                <div className={styles.gapHeader}>
                  <StatusBadge tone="warning">
                    {t("platform.trust.gaps.requires", { gate: gap.gate })}
                  </StatusBadge>
                  <code className={styles.evidence}>{gap.evidencePath}</code>
                </div>
                <p className={styles.gapStatement}>
                  {trustStatement(gap.statement, t)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <p className={styles.footnote}>{t("platform.trust.footnote")}</p>
      </div>
    </main>
  );
}
