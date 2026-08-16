import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";

/**
 * The launch-gate identifiers, taken from the generated API contract rather
 * than retyped. `@clockwork/web` deliberately does not depend on
 * `@clockwork/domain`, and a hand-copied list of gate keys here would be the
 * second list this repository has already been burned by. This is type-only,
 * so the register carries no runtime dependency on the API client either.
 */
export type TrustGateKey = GeneratedExternalGate["gateKey"];

/**
 * The facts the trust surface publishes.
 *
 * WHY THIS IS DATA AND NOT PROSE IN A PAGE. A trust page is the one surface
 * where an invented sentence is worse than a missing one: it is read by a
 * security reviewer who will hold us to it, and by procurement who will paste
 * it into a contract. So no entry here is allowed to be an assertion on its
 * own. Every entry names a file in this repository and a literal string that
 * must appear in that file, and `trust-register.test.ts` reads both off disk.
 *
 * EXACTLY WHAT THE BUILD CHECKS, AND WHAT IT DOES NOT. This used to be written
 * up as though the suite refused a claim whose evidence "no longer contains what
 * the control claims". It did not, and the gap was demonstrated rather than
 * argued: two entirely invented controls -- AES-256 with customer-managed keys
 * in a FIPS 140-2 Level 3 HSM, and a three-zone 99.99 per cent uptime
 * commitment -- were appended citing `package.json` for the token "name", and
 * the whole suite passed. Binding a sentence to the presence of a common word
 * in an arbitrary file binds it to nothing.
 *
 * So the check is now four checks, and the page states all four rather than
 * summarising them into a promise:
 *
 *  1. CITATION EXISTS. `evidencePath` resolves in the working tree.
 *  2. CITATION IS LIVE. `evidencePath` still contains `token` verbatim.
 *  3. CITATION IS DISTINCTIVE. `token` occurs in no more than
 *     {@link tokenDistinctivenessCeiling} of the repository's tracked files, so
 *     it names one implementation rather than being a word that happens to be
 *     everywhere. "name" fails this; every token below passes it with room.
 *  4. NUMBERS ARE CORROBORATED. Every quantity a statement asserts -- AES-256,
 *     140-2, 99.99, SHA-256, 27001 -- must appear in a file the entry cites.
 *     This is the check that kills a fabricated specification outright, because
 *     an invented control is nearly always invented in numbers.
 *
 * WHAT NO CHECK HERE CAN DO. None of that establishes that the sentence is a
 * FAIR DESCRIPTION of the file it points at. A statement with no numbers in it,
 * citing a rare token in an unrelated file, still passes. That judgement is made
 * by the person who writes the entry and by whoever reviews the change, and the
 * page says so in those words rather than implying the build caught it.
 *
 * And that a control is present is still not that it is correct or switched on
 * in a given deployment. The suites that exercise these controls prove the
 * behaviour, and they are cited alongside where one exists. Read this register
 * as "the source tree contains this", never as "an auditor found this".
 */

/** Section a control is published under. Ordering here is display order. */
export const trustSections = [
  {
    id: "access-control",
    title: "Access control and tenant isolation",
    summary:
      "Who may act, inside which account, and what a request must prove before it changes anything.",
  },
  {
    id: "data-protection",
    title: "Data protection and retention",
    summary:
      "How records and documents are stored, held, screened, and reached.",
  },
  {
    id: "auditability",
    title: "Auditability",
    summary: "What is written when something changes, and how that is checked.",
  },
  {
    id: "application-security",
    title: "Application and transport security",
    summary:
      "The controls a browser and a calling system meet on every request.",
  },
  {
    id: "secure-development",
    title: "Secure development",
    summary: "What the standard verification suite refuses to let through.",
  },
] as const;

export type TrustSectionId = (typeof trustSections)[number]["id"];

/** A further file and string an entry rests on beyond its primary citation. */
export interface TrustCitation {
  readonly path: string;
  readonly token: string;
}

export interface TrustControl {
  readonly id: string;
  readonly section: TrustSectionId;
  /** What is true. Must be supported by `token` inside `evidencePath`. */
  readonly statement: string;
  /** Repository-relative path. Must exist. */
  readonly evidencePath: string;
  /** Literal substring that must appear in `evidencePath`. */
  readonly token: string;
  /**
   * Extra citations, checked exactly as strictly as the primary one. A control
   * that describes an exception -- "everything except X, because X is
   * authenticated a different way" -- has to cite the exception as well, or the
   * interesting half of the sentence is bound to nothing.
   */
  readonly alsoCites?: readonly TrustCitation[];
}

export interface TrustIntegration {
  readonly name: string;
  readonly purpose: string;
  readonly evidencePath: string;
  readonly token: string;
}

export interface TrustUnselectedIntegration {
  readonly capability: string;
  readonly gate: TrustGateKey;
  readonly evidencePath: string;
  readonly token: string;
}

export interface TrustGap {
  readonly id: string;
  readonly statement: string;
  /** Typed against the generated contract, so an invented gate does not compile. */
  readonly gate: TrustGateKey;
  readonly evidencePath: string;
  readonly token: string;
}

export const trustControls: readonly TrustControl[] = [
  {
    id: "scope-required",
    section: "access-control",
    statement:
      "Every API mutation names both the permission it needs and the account it acts inside. The scope argument has no undefined member, so a route that forgets to say which account it is acting in does not compile.",
    evidencePath: "packages/api/src/auth/authorize.ts",
    token: "scope: AccountScope<P>",
  },
  {
    id: "step-up-authentication",
    section: "access-control",
    statement:
      "Named money and policy actions -- voiding an invoice, approving a pricing exception, activating a price book, settling or clawing back a commission, and the rest of the same class -- additionally require a fresh re-authentication at the moment they are attempted.",
    evidencePath: "packages/api/src/routes/core/index.ts",
    token: "recentAuthenticationActions",
  },
  {
    id: "row-level-security",
    section: "access-control",
    statement:
      "Tenant isolation is enforced by PostgreSQL row-level security on the tables themselves, not only by application code. Security is forced rather than merely enabled, and the roles the application connects as cannot bypass it.",
    evidencePath: "supabase/tests/020_rls.test.sql",
    token: "rolbypassrls",
  },
  {
    id: "identity-fail-closed",
    section: "access-control",
    statement:
      "A production deployment with no configured identity provider refuses every request with a 503 rather than serving an unauthenticated page.",
    evidencePath: "apps/web/proxy.ts",
    token: "AUTHENTICATION_NOT_CONFIGURED",
  },
  {
    id: "object-lock",
    section: "data-protection",
    statement:
      "Executed agreements, signed documents and other evidence objects are written to object storage under a COMPLIANCE-mode Object Lock with a retain-until date and a legal-hold flag, so neither the application nor an operator can delete or overwrite them inside the retention window.",
    evidencePath: "packages/integrations/src/evidence-storage/index.ts",
    token: 'ObjectLockMode: "COMPLIANCE"',
  },
  {
    id: "evidence-metadata",
    section: "data-protection",
    statement:
      "Every evidence object carries a SHA-256 content hash, a storage version, a retention date, a legal-hold flag and a malware-scan status, and metadata that does not satisfy those requirements is rejected rather than stored.",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "malwareScanStatus",
  },
  {
    id: "denied-party-screening",
    section: "data-protection",
    statement:
      "Counterparties are screened at registration, before signature and at partner activation, and re-screened on expiry. Four embargoed jurisdictions are refused regardless of what the screening provider answers, and a non-clear decision cannot be recorded without a stored match-evidence document.",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "embargoedCountries",
  },
  {
    id: "evidence-access",
    section: "data-protection",
    statement:
      "Reading a stored document requires either ownership of the account the document belongs to or a named internal role, the purpose of the access is part of the decision, and an upload for a purpose that does not permit uploads is refused.",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "authorizeEvidenceAccess",
  },
  {
    id: "atomic-audit",
    section: "auditability",
    statement:
      "Every core mutation returns the identifiers of an audit event and an outbox message written by the same transaction that wrote the row, so there is no state change without a corresponding record of who made it and what it replaced.",
    evidencePath: "packages/api/src/routes/core/service.ts",
    token: "outboxMessageId",
  },
  {
    id: "chain-validation",
    section: "auditability",
    statement:
      "The integrity of the audit chain is asserted by tests that run against a real PostgreSQL instance rather than a mock.",
    evidencePath: "supabase/tests/903_secure_chain_validation.test.sql",
    token: "select plan(",
  },
  {
    id: "content-security-policy",
    section: "application-security",
    statement:
      "Every document is served with a per-request nonce Content-Security-Policy. Framing, plugin objects and base-URI rewriting are all set to none, and the application authors no inline script.",
    evidencePath: "apps/web/proxy.ts",
    token: "frame-ancestors 'none'",
  },
  {
    id: "response-headers",
    section: "application-security",
    statement:
      "Transport security, MIME-sniffing refusal, framing refusal, referrer policy and a permissions policy that denies camera, microphone and geolocation are set on every response.",
    evidencePath: "apps/web/next.config.ts",
    token: "Strict-Transport-Security",
  },
  {
    id: "csrf-origin",
    section: "application-security",
    /**
     * The previous wording -- "every state-changing API request passes a
     * same-origin and CSRF-token check before it reaches a handler" -- was
     * false as shipped, and false about the routes a reader most wants the
     * truth on. `security.ts` exempts the whole `/v1/webhooks/` namespace by
     * path prefix, and `idempotency.ts` exempts it again. The exemption is
     * correct; stating a blanket rule that the code does not implement was not.
     * The exemption is now cited, in both files, alongside the control it
     * qualifies.
     */
    statement:
      "Every state-changing API request must present a matching double-submit CSRF token and an origin the deployment allows before it reaches a handler, with one deliberate exception. Requests to the inbound provider webhook routes under /v1/webhooks/ are exempt from that check, and from the idempotency-key requirement, by path prefix. A provider posting a webhook is a server rather than a browser: it holds none of our cookies, so a CSRF token would only be a value we had handed it, and the check would prove nothing about who sent the request. Those routes are authenticated instead by verifying the provider's signature over the raw request body, which is the control that actually establishes the sender. Safe methods -- GET, HEAD and OPTIONS -- are exempt as well, because they change nothing.",
    evidencePath: "packages/api/src/middleware/security.ts",
    token: "createCsrfAndOriginMiddleware",
    alsoCites: [
      {
        path: "packages/api/src/middleware/security.ts",
        token: 'startsWith("/v1/webhooks/")',
      },
      {
        path: "packages/api/src/middleware/security.ts",
        token: 'new Set(["GET", "HEAD", "OPTIONS"])',
      },
      {
        path: "packages/api/src/middleware/security.ts",
        token: "Provide the double-submit CSRF token.",
      },
      {
        path: "packages/api/src/middleware/idempotency.ts",
        token: 'startsWith("/v1/webhooks/")',
      },
      {
        path: "packages/api/src/webhooks.ts",
        token: "verifyAndClaimWebhook",
      },
    ],
  },
  {
    id: "webhook-signatures",
    section: "application-security",
    statement:
      "An inbound provider webhook is refused unless its signature verifies against the raw request body, and a redelivered event is claimed and deduplicated rather than applied a second time.",
    evidencePath: "packages/api/src/webhooks.ts",
    token: "verifyAndClaimWebhook",
  },
  {
    id: "idempotency",
    section: "application-security",
    statement:
      "Mutations require an idempotency key, and a repeated key replays the stored first response instead of performing the operation twice. The inbound provider webhook routes are exempt from this requirement as well -- a provider chooses its own retry identifiers -- and are deduplicated instead by claiming the provider's event id. A response of 500 or above is never frozen for replay, so a dependency failure does not become a cached outage.",
    evidencePath: "packages/api/src/middleware/idempotency.ts",
    token: "idempotencyMiddleware",
    alsoCites: [
      {
        path: "packages/api/src/middleware/idempotency.ts",
        token: 'startsWith("/v1/webhooks/")',
      },
      {
        path: "packages/api/src/middleware/idempotency.ts",
        token: "status >= 200 && status < 500",
      },
      {
        path: "packages/api/src/webhooks.ts",
        token: "verifyAndClaimWebhook",
      },
    ],
  },
  {
    id: "secret-scanning",
    section: "secure-development",
    statement:
      "Secret scanning runs across the whole working tree as part of the standard verification suite.",
    evidencePath: "package.json",
    token: "scan:secrets",
  },
  {
    id: "dependency-advisories",
    section: "secure-development",
    statement:
      "Dependency advisories fail the suite at high severity and above.",
    evidencePath: "package.json",
    token: "--audit-level=high",
  },
  {
    id: "generated-contract",
    section: "secure-development",
    statement:
      "The published API contract is generated from the running application, and the suite fails if the committed contract has drifted from what the application actually serves.",
    evidencePath: "package.json",
    token: "check:generated",
  },
  {
    id: "schema-drift",
    section: "secure-development",
    statement:
      "The database schema is checked against its migrations for drift on every verification run.",
    evidencePath: "package.json",
    token: "check:schema-drift",
  },
];

/**
 * Third-party services this software is wired to in committed configuration.
 *
 * READ THE HEADING ON THE PAGE. This is not a subprocessor schedule -- see
 * `trustGaps`. It is the set of vendors a reader can verify for themselves by
 * opening the cited file, which is the only kind of vendor statement this
 * repository is in a position to make.
 */
export const trustIntegrations: readonly TrustIntegration[] = [
  {
    name: "WorkOS",
    purpose: "Browser identity, session issuance and step-up authentication.",
    evidencePath: "apps/web/package.json",
    token: "@workos-inc/authkit-nextjs",
  },
  {
    name: "Stripe",
    purpose:
      "Payment collection. Payment status is derived from verified webhooks, never entered by hand.",
    evidencePath: "packages/integrations/package.json",
    token: '"stripe"',
  },
  {
    name: "Amazon S3",
    purpose: "Immutable evidence and document storage under Object Lock.",
    evidencePath: "packages/integrations/package.json",
    token: "@aws-sdk/client-s3",
  },
  {
    name: "Supabase (PostgreSQL)",
    purpose: "Primary datastore, migrations and row-level security.",
    evidencePath: "package.json",
    token: '"supabase"',
  },
  {
    name: "Netlify",
    purpose: "Application hosting and build.",
    evidencePath: "netlify.toml",
    token: "@netlify/plugin-nextjs",
  },
  {
    name: "Trigger.dev",
    purpose: "Background workflow execution.",
    evidencePath: "trigger.config.ts",
    token: "@trigger.dev/sdk",
  },
];

/**
 * Capabilities that reach an external provider over a generic signed HTTP
 * transport, with no vendor named anywhere in the tree. Naming one here would
 * be the fabrication this register exists to prevent: the vendor is a
 * deployment setting, and this page reports the repository.
 */
export const trustUnselectedIntegrations: readonly TrustUnselectedIntegration[] =
  [
    {
      capability: "Electronic signature",
      gate: "EXT-PROVIDER-01",
      evidencePath: "packages/integrations/src/esign/http-signing-client.ts",
      token:
        "Provider-neutral HTTPS contract selected and activated through EXT-PROVIDER-01",
    },
    {
      capability: "Tax determination",
      gate: "EXT-TAX-01",
      evidencePath: "packages/integrations/src/core/tax/http-tax-adapter.ts",
      token: "Provider-neutral tax contract",
    },
    {
      capability: "Denied-party screening",
      gate: "EXT-PROVIDER-01",
      evidencePath:
        "packages/integrations/src/runtime/lifecycle-http-providers.ts",
      token: "Authenticated provider-neutral screening contract",
    },
    {
      capability: "Accounting export, notification delivery and usage ingest",
      gate: "EXT-PROVIDER-01",
      evidencePath: "packages/integrations/src/production-adapters.ts",
      token: "ProviderJsonTransport",
    },
  ];

export const trustGaps: readonly TrustGap[] = [
  {
    id: "no-certifications",
    statement:
      "No SOC 2 report, ISO 27001 certificate, PCI DSS attestation, HIPAA assurance or FedRAMP authorization is held, and none is claimed. The firm, scope and observation period for a SOC 2 Type II are not yet confirmed, the ISO 27001 body and scope are not yet chosen, and no independent penetration test has been started.",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/sprint-checklist.md",
    token: "Audit readiness and security policy pack",
  },
  {
    id: "no-policy-text",
    statement:
      "The Data Processing Addendum, security addendum, acceptable use policy, privacy policy, service-level agreement and support policy are counsel deliverables. The software models each of these document types and can execute and store them; the approved text is not in this repository, so this page publishes none of it.",
    gate: "EXT-LEGAL-01",
    evidencePath: "packages/domain/src/agreements/index.ts",
    token: '"security_addendum"',
  },
  {
    id: "not-a-subprocessor-schedule",
    statement:
      "The integrations listed above are a source-tree fact, not a subprocessor schedule. A subprocessor schedule names the entities that process personal data on a customer's behalf under the Data Processing Addendum, states what each processes and where, and is produced with counsel. Do not treat the list above as one.",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/external-gates.md",
    token: "EXT-LEGAL-01",
  },
  {
    id: "not-counsel-reviewed",
    statement:
      "Nothing on this page has been reviewed or approved by counsel, and nothing on it has been verified by an external auditor. Every statement above is derived from this repository's source at build time and is only as good as that source.",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/external-gates.md",
    token: "EXT-LEGAL-01",
  },
];

/**
 * Vocabulary a control or an integration may never use.
 *
 * These words are how a trust page goes wrong. They are not banned outright --
 * a `trustGaps` entry has to be able to say "no SOC 2 report is held" -- they
 * are banned from any sentence that reads as an assertion of capability.
 */
export const attestationVocabulary: readonly RegExp[] = [
  /\bSOC ?2\b/i,
  /\bISO ?27001\b/i,
  /\bPCI(?:[ -]DSS)?\b/i,
  /\bHIPAA\b/i,
  /\bFedRAMP\b/i,
  /\bGDPR\b/i,
  /\bcertifi(?:ed|cation)\b/i,
  /\baccredit(?:ed|ation)\b/i,
  /\battestation\b/i,
  /\baudit(?:ed|or)\b/i,
  /\bpenetration test\b/i,
  /\bsubprocessor\b/i,
];

export function attestationVocabularyHits(
  statement: string,
): readonly string[] {
  return attestationVocabulary
    .filter((pattern) => pattern.test(statement))
    .map((pattern) => pattern.source);
}

/** Every path this register asks a reader to be able to open. */
export function trustEvidencePaths(): readonly string[] {
  return [
    ...trustControls.flatMap((control) => [
      control.evidencePath,
      ...(control.alsoCites ?? []).map((citation) => citation.path),
    ]),
    ...trustIntegrations.map((entry) => entry.evidencePath),
    ...trustUnselectedIntegrations.map((entry) => entry.evidencePath),
    ...trustGaps.map((entry) => entry.evidencePath),
  ];
}

/**
 * The share of tracked files a cited token may appear in and still count as
 * naming one implementation.
 *
 * DERIVED, NOT PICKED TO PASS. Measured across the register as it stands, the
 * least distinctive token in use is `select plan(` at 34 of 1187 tracked files,
 * or 2.9 per cent; every other token is under 2.5 per cent and most are under
 * 0.5. A ceiling of 5 per cent leaves that headroom and still refuses the word
 * that made the fabricated controls pass -- `name`, which occurs in roughly 520
 * files, about 44 per cent of the tree. It is expressed as a proportion rather
 * than a count so that it does not drift as the repository grows.
 */
export const tokenDistinctivenessCeiling = 0.05;

/**
 * The quantities a statement asserts, which a cited file has to corroborate.
 *
 * A run of two or more digits, with any letters and hyphens attached to its
 * front, is a specification: AES-256, FIPS 140-2, ISO 27001, SHA-256, 99.99,
 * 503. Single digits are skipped deliberately -- "three availability zones",
 * "/v1/", "SOC 2" -- because a lone digit matches by accident in almost any
 * file and a check that passes by accident is the thing being replaced here.
 * A statement wanting to assert a single-digit quantity has to spell it in a
 * way this can see, or it is not a checkable claim and does not belong.
 */
export function quantitativeClaims(statement: string): readonly string[] {
  return [...new Set(statement.match(/[A-Za-z]*-?\d{2,}(?:[.-]\d+)*/g) ?? [])];
}

/**
 * Whether `evidence` corroborates `claim`.
 *
 * Hyphens and spaces are removed from both sides before comparing, because a
 * statement writes "SHA-256" where the source writes "sha256" and refusing that
 * would push the register towards vaguer sentences rather than truer ones.
 */
export function corroboratesClaim(evidence: string, claim: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replaceAll(/[\s-]/g, "");
  return normalise(evidence).includes(normalise(claim));
}

/**
 * Files a named gate must appear in for the page to be allowed to name it: the
 * operator-facing register, and the generated API contract that the running
 * system serves. Naming a gate that only exists on this page fails.
 */
export const gateCorroborationPaths: readonly string[] = [
  "docs/external-gates.md",
  "packages/api/src/generated/openapi.json",
];
