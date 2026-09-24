import { use, type ReactNode } from "react";

import {
  InlineNotice,
  PageHeader,
  Section,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import type { Translator } from "@/src/i18n";
import { richText } from "@/src/i18n/rich";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";

import styles from "./reference-page.module.css";
import {
  apiReferenceGroups,
  credentialReadiness,
  untaggedGroup,
  type ReferenceOperation,
  type ReferenceSecurityScheme,
} from "./api-reference";
import {
  authenticationClasses,
  enumerableAuthenticationClasses,
} from "./route-authentication";

function slug(tag: string): string {
  return `tag-${tag
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function requiredParameters(
  operation: ReferenceOperation,
  t: Translator,
): string {
  const required = operation.parameters.filter(
    (parameter) => parameter.required,
  );
  if (required.length === 0) return t("platform.developers.parameters.none");
  // Parameter names and their `in` locations are the contract's identifiers.
  return required
    .map((parameter) => `${parameter.name} (${parameter.location})`)
    .join(", ");
}

function requestSummary(operation: ReferenceOperation, t: Translator): string {
  if (operation.requestContentTypes.length === 0)
    return t("platform.developers.body.none");
  // Media types are identifiers, listed as the contract lists them.
  const types = operation.requestContentTypes.join(", ");
  return t(
    operation.requestBodyRequired
      ? "platform.developers.body.required"
      : "platform.developers.body.optional",
    { types },
  );
}

function schemeLabel(scheme: ReferenceSecurityScheme, t: Translator): string {
  // Scheme names, types and locations are the contract's own identifiers.
  return scheme.location
    ? t("platform.developers.scheme.located", {
        name: scheme.name,
        type: scheme.type,
        location: scheme.location,
      })
    : `${scheme.name} (${scheme.type})`;
}

/**
 * The published API reference.
 *
 * GROUPING. An operation is filed under its first tag, which partitions the
 * contract exactly -- every operation appears once and none is dropped. Several
 * operations carry more than one tag (`/v1/webhooks/stripe` is `core` and
 * `webhooks`), so the full tag set is a column rather than being thrown away by
 * the grouping. Grouping by every tag instead would list those operations twice
 * and make the counts wrong.
 *
 * Everything with a number in it comes out of `api-reference.ts`, which derives
 * it from the contract the application serves. The credential notice at the top
 * is the part worth reading twice: it is not a caveat someone wrote, it is a
 * count of what the contract declares, so it cannot be left behind by a change
 * that fixes the problem or by one that makes it worse.
 *
 * THE SENTENCE THAT WAS WITHDRAWN. The notice about operations with no security
 * block used to end: "That is a gap in the published contract, not an open
 * door: each handler resolves a permission and an account scope before it
 * runs." The count in front of it was derived and correct. The clause after the
 * colon was hand-written, and false for ten of the operations it covered -- the
 * six webhook routes, `POST /v1/lifecycle/registrations`, and the three lane
 * status endpoints, none of which call `requirePermission` at all. It is
 * replaced by the "How each operation is authenticated" section below, which
 * classifies every operation from `route-authentication.ts` and names the three
 * exceptional classes operation by operation, because an integrator needs to
 * check the endpoint in front of them rather than trust an adjective.
 *
 * If you are about to add a reassuring sentence here: it has to be derived from
 * the contract or checked against the handlers by
 * `route-authentication.test.ts`. A reassurance an integrator cannot check is
 * the exact defect this section exists to have fixed.
 *
 * LANGUAGE. The page's own words are messages (`platform-developers.ts`) in
 * the reader's interface language, read from the language cookie; counts and
 * lists are formatted with that language's locale. What the contract itself
 * says -- tags, paths, methods, parameter names and locations, media types,
 * status codes, scheme names -- is shown exactly as the contract writes it,
 * and the lede says so.
 */
export function ApiReferencePage({ specHref }: { specHref: string }) {
  const t = use(getTranslations());
  const locale = use(getFormattingLocale());
  const numbers = new Intl.NumberFormat(locale);
  const list = new Intl.ListFormat(locale, { type: "conjunction" });
  const groups = apiReferenceGroups();
  const readiness = credentialReadiness();
  const authenticationTable = authenticationClasses();
  const namedExceptions = enumerableAuthenticationClasses();
  const total = numbers.format(readiness.operationCount);
  // "42 by browser session, 6 by provider signature, ..." -- counted rather
  // than written, so a route moving between classes moves this sentence.
  const undeclaredClassSummary = list.format(
    authenticationTable
      .filter((entry) => entry.mechanism !== "declared-scheme")
      .map((entry) =>
        t(entry.summary, {
          count: numbers.format(entry.operations.length),
        }),
      ),
  );
  const declaredSchemes =
    readiness.schemes.length === 0
      ? t("platform.developers.credential.declaredNone")
      : t("platform.developers.credential.declared", {
          schemes: list.format(
            readiness.schemes.map((scheme) => schemeLabel(scheme, t)),
          ),
        });
  const sentences = (first: ReactNode, second: ReactNode): ReactNode =>
    richText(t, "common.join.sentences", { first, second });
  const groupLabel = (tag: string) =>
    tag === untaggedGroup ? t("platform.developers.group.untagged") : tag;
  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.column}>
        <div className={styles.intro}>
          <PageHeader
            eyebrow={t("platform.developers.eyebrow")}
            title={t("platform.developers.title")}
            description={t("platform.developers.description")}
          />
          <p className={styles.lede}>
            {sentences(
              t("platform.developers.lede.operations", {
                count: readiness.operationCount,
              }),
              sentences(
                t("platform.developers.lede.groups", { count: groups.length }),
                richText(t, "platform.developers.lede.spec", {
                  link: (
                    <a className={styles.mono} href={specHref} dir="ltr">
                      {specHref}
                    </a>
                  ),
                }),
              ),
            )}
          </p>
          {readiness.machineUsableSchemes.length === 0 ? (
            <InlineNotice
              tone="warning"
              title={t("platform.developers.credential.missing.title")}
              description={sentences(
                declaredSchemes,
                t("platform.developers.credential.missing.body"),
              )}
            />
          ) : (
            <InlineNotice
              tone="info"
              title={t("platform.developers.credential.machine.title")}
              description={t("platform.developers.credential.machine.body", {
                schemes: list.format(
                  readiness.machineUsableSchemes.map((scheme) => scheme.name),
                ),
              })}
            />
          )}
          <InlineNotice
            tone="info"
            title={t("platform.developers.authorization.title")}
            description={sentences(
              t("platform.developers.authorization.count", {
                count: readiness.operationsWithNoDeclaredSecurity,
                total,
              }),
              t("platform.developers.authorization.body", {
                classes: undeclaredClassSummary,
              }),
            )}
          />
          <nav aria-label={t("platform.developers.groups.label")}>
            <ul className={styles.contents}>
              {groups.map((group) => (
                <li key={group.tag}>
                  <a href={`#${slug(group.tag)}`}>
                    {groupLabel(group.tag)} (
                    {numbers.format(group.operations.length)})
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <Section
          title={t("platform.developers.authentication.title")}
          description={t("platform.developers.authentication.description")}
        >
          <Table
            caption={t("platform.developers.authentication.caption")}
            captionHidden
            headers={[
              t("platform.developers.authentication.header.presents"),
              t("platform.developers.authentication.header.operations"),
              t("platform.developers.authentication.header.handler"),
            ]}
            rowKeys={authenticationTable.map((entry) => entry.mechanism)}
            rows={authenticationTable.map((entry) => [
              <span key="t" className={styles.detail}>
                {t(entry.title)}
              </span>,
              <span key="c" className={styles.detail}>
                {numbers.format(entry.operations.length)}
              </span>,
              <span key="d" className={styles.detail}>
                {t(entry.detail)}
              </span>,
            ])}
          />
          <p className={styles.note}>
            {t("platform.developers.authentication.note")}
          </p>
          <ul className={styles.exceptionList}>
            {namedExceptions.map((entry) => (
              <li key={entry.mechanism} className={styles.exception}>
                <StatusBadge
                  tone={entry.mechanism === "none" ? "warning" : "neutral"}
                >
                  {t(entry.title)}
                </StatusBadge>
                <ul className={styles.exceptionOperations}>
                  {entry.operations.map((operation) => (
                    <li key={`${operation.method} ${operation.path}`}>
                      <span className={styles.endpoint} dir="ltr">
                        <span className={styles.method}>
                          {operation.method}
                        </span>
                        <span>{operation.path}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Section>

        {groups.map((group) => (
          <div key={group.tag} id={slug(group.tag)}>
            <Section
              title={groupLabel(group.tag)}
              description={t("platform.developers.group.count", {
                count: group.operations.length,
              })}
            >
              <Table
                caption={t("platform.developers.group.caption", {
                  tag: groupLabel(group.tag),
                })}
                captionHidden
                headers={[
                  t("platform.developers.header.operation"),
                  t("platform.developers.header.tags"),
                  t("platform.developers.header.parameters"),
                  t("platform.developers.header.body"),
                  t("platform.developers.header.responses"),
                ]}
                rowKeys={group.operations.map(
                  (operation) => `${operation.method} ${operation.path}`,
                )}
                rows={group.operations.map((operation) => [
                  <span key="o" className={styles.endpoint} dir="ltr">
                    <span className={styles.method}>{operation.method}</span>
                    <span>{operation.path}</span>
                  </span>,
                  <span key="t" className={styles.detail}>
                    {operation.tags.join(", ") ||
                      t("platform.developers.tags.none")}
                  </span>,
                  <span key="p" className={styles.detail}>
                    {requiredParameters(operation, t)}
                  </span>,
                  <span key="b" className={styles.detail}>
                    {requestSummary(operation, t)}
                  </span>,
                  <span key="r" className={styles.detail}>
                    {operation.responses
                      .map((response) => response.status)
                      .join(", ") || t("platform.developers.responses.none")}
                  </span>,
                ])}
              />
            </Section>
          </div>
        ))}

        <Section
          title={t("platform.developers.missing.title")}
          description={t("platform.developers.missing.description")}
        >
          <ul>
            <li>
              <StatusBadge tone="warning">
                {t("platform.developers.missing.status.notBuilt")}
              </StatusBadge>{" "}
              {t("platform.developers.missing.credentials")}
            </li>
            <li>
              <StatusBadge tone="warning">
                {t("platform.developers.missing.status.notBuilt")}
              </StatusBadge>{" "}
              {t("platform.developers.missing.sandbox")}
            </li>
            <li>
              <StatusBadge tone="neutral">
                {t("platform.developers.missing.status.partial")}
              </StatusBadge>{" "}
              {sentences(
                t("platform.developers.missing.security.lead"),
                sentences(
                  t("platform.developers.missing.security.count", {
                    count: readiness.operationsWithDeclaredSecurity,
                    total,
                  }),
                  t("platform.developers.missing.security.body"),
                ),
              )}
            </li>
          </ul>
        </Section>

        <p className={styles.footnote}>{t("platform.developers.footnote")}</p>
      </div>
    </main>
  );
}
