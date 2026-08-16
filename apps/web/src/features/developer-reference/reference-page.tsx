import {
  InlineNotice,
  PageHeader,
  Section,
  StatusBadge,
  Table,
} from "@clockwork/ui";

import styles from "./reference-page.module.css";
import {
  apiReferenceGroups,
  credentialReadiness,
  type ReferenceOperation,
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

function requiredParameters(operation: ReferenceOperation): string {
  const required = operation.parameters.filter(
    (parameter) => parameter.required,
  );
  if (required.length === 0) return "None";
  return required
    .map((parameter) => `${parameter.name} (${parameter.location})`)
    .join(", ");
}

function requestSummary(operation: ReferenceOperation): string {
  if (operation.requestContentTypes.length === 0) return "No body";
  return `${operation.requestBodyRequired ? "Required" : "Optional"}: ${operation.requestContentTypes.join(", ")}`;
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
 */
export function ApiReferencePage({ specHref }: { specHref: string }) {
  const groups = apiReferenceGroups();
  const readiness = credentialReadiness();
  const authenticationTable = authenticationClasses();
  const namedExceptions = enumerableAuthenticationClasses();
  // "42 by browser session, 6 by provider signature, ..." -- counted rather
  // than written, so a route moving between classes moves this sentence.
  const undeclaredClassSummary = authenticationTable
    .filter((entry) => entry.mechanism !== "declared-scheme")
    .map((entry) => `${entry.operations.length} by ${entry.shortLabel}`)
    .join(", ");
  const declaredSchemes =
    readiness.schemes.length === 0
      ? "none"
      : readiness.schemes
          .map(
            (scheme) =>
              `${scheme.name} (${scheme.type}${scheme.location ? ` in ${scheme.location}` : ""})`,
          )
          .join(", ");
  return (
    <main id="main-content" className={styles.main}>
      <div className={styles.column}>
        <div className={styles.intro}>
          <PageHeader
            eyebrow="Developers"
            title="API reference"
            description="Generated from the contract this application serves, not written alongside it."
          />
          <p className={styles.lede}>
            {readiness.operationCount} operations across {groups.length} groups.
            The machine-readable contract is at{" "}
            <a className={styles.mono} href={specHref}>
              {specHref}
            </a>
            , and it is the same document a typed client is generated from.
            Nothing on this page is maintained by hand, so it cannot fall behind
            the API.
          </p>
          {readiness.machineUsableSchemes.length === 0 ? (
            <InlineNotice
              tone="warning"
              title="There is no API credential you can hold yet."
              description={`The contract declares ${declaredSchemes}. A cookie is issued by an interactive sign-in and belongs to a browser, so there is no credential you could hold and present. Issuing, listing and revoking a machine credential is not built. The operations that do not need a session are not a way in either: they take a signature or a token this deployment issues, and they are named below. Read this reference as the shape of the API, not as an invitation to integrate against it today.`}
            />
          ) : (
            <InlineNotice
              tone="info"
              title="Machine credentials"
              description={`The contract declares ${readiness.machineUsableSchemes.map((scheme) => scheme.name).join(", ")} for callers that are not a browser.`}
            />
          )}
          <InlineNotice
            tone="info"
            title="Authorization is not visible in this contract."
            description={`${readiness.operationsWithNoDeclaredSecurity} of ${readiness.operationCount} operations attach no security requirement in the document at all. That is a gap in the published contract rather than a statement about the handlers -- but it is not one gap with one answer behind it. What each of those operations actually requires is set out below, class by class, and the classes are not interchangeable: ${undeclaredClassSummary}. Check the class before you decide what an operation needs.`}
          />
          <nav aria-label="Operation groups">
            <ul className={styles.contents}>
              {groups.map((group) => (
                <li key={group.tag}>
                  <a href={`#${slug(group.tag)}`}>
                    {group.tag} ({group.operations.length})
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <Section
          title="How each operation is authenticated"
          description="Derived from the contract and checked against the handlers. What stood here before was one hand-written sentence, and it was false for ten of these operations."
        >
          <Table
            caption="Authentication mechanism by route class"
            captionHidden
            headers={[
              "What the caller presents",
              "Operations",
              "What the handler does with it",
            ]}
            rowKeys={authenticationTable.map((entry) => entry.mechanism)}
            rows={authenticationTable.map((entry) => [
              <span key="t" className={styles.detail}>
                {entry.title}
              </span>,
              <span key="c" className={styles.detail}>
                {entry.operations.length}
              </span>,
              <span key="d" className={styles.detail}>
                {entry.detail}
              </span>,
            ])}
          />
          <p className={styles.note}>
            The classes below are small enough to name in full, so read them as
            the exceptions rather than as examples. An operation that is not in
            one of these lists and does not declare a scheme in the contract is
            in the browser-session row above.
          </p>
          <ul className={styles.exceptionList}>
            {namedExceptions.map((entry) => (
              <li key={entry.mechanism} className={styles.exception}>
                <StatusBadge
                  tone={entry.mechanism === "none" ? "warning" : "neutral"}
                >
                  {entry.title}
                </StatusBadge>
                <ul className={styles.exceptionOperations}>
                  {entry.operations.map((operation) => (
                    <li key={`${operation.method} ${operation.path}`}>
                      <span className={styles.endpoint}>
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
              title={group.tag}
              description={`${group.operations.length} operations`}
            >
              <Table
                caption={`${group.tag} operations`}
                captionHidden
                headers={[
                  "Operation",
                  "Tags",
                  "Required parameters",
                  "Request body",
                  "Responses",
                ]}
                rowKeys={group.operations.map(
                  (operation) => `${operation.method} ${operation.path}`,
                )}
                rows={group.operations.map((operation) => [
                  <span key="o" className={styles.endpoint}>
                    <span className={styles.method}>{operation.method}</span>
                    <span>{operation.path}</span>
                  </span>,
                  <span key="t" className={styles.detail}>
                    {operation.tags.join(", ") || "None"}
                  </span>,
                  <span key="p" className={styles.detail}>
                    {requiredParameters(operation)}
                  </span>,
                  <span key="b" className={styles.detail}>
                    {requestSummary(operation)}
                  </span>,
                  <span key="r" className={styles.detail}>
                    {operation.responses
                      .map((response) => response.status)
                      .join(", ") || "Not declared"}
                  </span>,
                ])}
              />
            </Section>
          </div>
        ))}

        <Section
          title="What is missing before you can integrate"
          description="Stated here rather than discovered after a contract is signed."
        >
          <ul>
            <li>
              <StatusBadge tone="warning">Not built</StatusBadge> Credential
              management. There is no way to issue, list or revoke a key scoped
              to an account, and no audit trail for one, because there is no
              store to hold a key hash in.
            </li>
            <li>
              <StatusBadge tone="warning">Not built</StatusBadge> A sandbox. No
              environment exists that a caller can exercise these operations
              against without touching real commercial records.
            </li>
            <li>
              <StatusBadge tone="neutral">Partial</StatusBadge> Security in the
              contract. {readiness.operationsWithDeclaredSecurity} of{" "}
              {readiness.operationCount} operations declare a scheme; the rest
              declare none, and what they require has to be read out of the
              table above rather than out of the document. Until the contract
              carries it, a generated client cannot present a credential
              automatically and cannot tell those classes apart.
            </li>
          </ul>
        </Section>

        <p className={styles.footnote}>
          Rendered from the contract at build time. If an operation is listed
          here, the application serves it; if the application stops serving it,
          this page loses it on the next build.
        </p>
      </div>
    </main>
  );
}
