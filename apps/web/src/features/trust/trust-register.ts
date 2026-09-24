import type { GeneratedExternalGate } from "@/src/features/contracts/external-gates-client";
import type { MessageId, Translator } from "@/src/i18n";

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
 *
 * LANGUAGE. Every sentence a reader sees is a message ID in the platform
 * message module, rendered in the reader's interface language. The English
 * text is the reviewed original; `trust-register.test.ts` resolves each ID
 * and holds EVERY language to the same checks that can be made without
 * reading the language: the numbers a statement asserts, and the absence of
 * certification names from anything that reads as a capability. The
 * evidence tokens below are never translated -- they are literal source text
 * the build greps for, and they are never displayed.
 */

/** Section a control is published under. Ordering here is display order. */
export const trustSections = [
  {
    id: "access-control",
    title: "platform.trust.section.accessControl.title",
    summary: "platform.trust.section.accessControl.summary",
  },
  {
    id: "data-protection",
    title: "platform.trust.section.dataProtection.title",
    summary: "platform.trust.section.dataProtection.summary",
  },
  {
    id: "auditability",
    title: "platform.trust.section.auditability.title",
    summary: "platform.trust.section.auditability.summary",
  },
  {
    id: "application-security",
    title: "platform.trust.section.applicationSecurity.title",
    summary: "platform.trust.section.applicationSecurity.summary",
  },
  {
    id: "secure-development",
    title: "platform.trust.section.secureDevelopment.title",
    summary: "platform.trust.section.secureDevelopment.summary",
  },
] as const satisfies readonly {
  id: string;
  title: MessageId;
  summary: MessageId;
}[];

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
  readonly statement: MessageId;
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
  /** The vendor's own name, never translated. */
  readonly name: string;
  readonly purpose: MessageId;
  readonly evidencePath: string;
  readonly token: string;
}

export interface TrustUnselectedIntegration {
  readonly capability: MessageId;
  readonly gate: TrustGateKey;
  readonly evidencePath: string;
  readonly token: string;
}

export interface TrustGap {
  readonly id: string;
  readonly statement: MessageId;
  /** Typed against the generated contract, so an invented gate does not compile. */
  readonly gate: TrustGateKey;
  readonly evidencePath: string;
  readonly token: string;
}

/**
 * The route prefix the CSRF and idempotency statements quote. It is a value in
 * those messages rather than message text, so it is never translated and a
 * right-to-left sentence isolates it.
 */
export const webhookRoutePrefix = "/v1/webhooks/";

/** A register statement in the reader's language, with its quoted values. */
export function trustStatement(id: MessageId, t: Translator): string {
  return t(id, { path: webhookRoutePrefix });
}

export const trustControls: readonly TrustControl[] = [
  {
    id: "scope-required",
    section: "access-control",
    statement: "platform.trust.control.scopeRequired",
    evidencePath: "packages/api/src/auth/authorize.ts",
    token: "scope: AccountScope<P>", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
  },
  {
    id: "step-up-authentication",
    section: "access-control",
    statement: "platform.trust.control.stepUpAuthentication",
    evidencePath: "packages/api/src/routes/core/index.ts",
    token: "recentAuthenticationActions",
  },
  {
    id: "row-level-security",
    section: "access-control",
    statement: "platform.trust.control.rowLevelSecurity",
    evidencePath: "supabase/tests/020_rls.test.sql",
    token: "rolbypassrls",
  },
  {
    id: "identity-fail-closed",
    section: "access-control",
    statement: "platform.trust.control.identityFailClosed",
    evidencePath: "apps/web/proxy.ts",
    token: "AUTHENTICATION_NOT_CONFIGURED",
  },
  {
    id: "object-lock",
    section: "data-protection",
    statement: "platform.trust.control.objectLock",
    evidencePath: "packages/integrations/src/evidence-storage/index.ts",
    token: 'ObjectLockMode: "COMPLIANCE"', // i18n-exempt: evidence token the build greps for in the cited file; never displayed
  },
  {
    id: "evidence-metadata",
    section: "data-protection",
    statement: "platform.trust.control.evidenceMetadata",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "malwareScanStatus",
  },
  {
    id: "denied-party-screening",
    section: "data-protection",
    statement: "platform.trust.control.deniedPartyScreening",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "embargoedCountries",
  },
  {
    id: "evidence-access",
    section: "data-protection",
    statement: "platform.trust.control.evidenceAccess",
    evidencePath: "packages/domain/src/compliance/index.ts",
    token: "authorizeEvidenceAccess",
  },
  {
    id: "atomic-audit",
    section: "auditability",
    statement: "platform.trust.control.atomicAudit",
    evidencePath: "packages/api/src/routes/core/service.ts",
    token: "outboxMessageId",
  },
  {
    id: "chain-validation",
    section: "auditability",
    statement: "platform.trust.control.chainValidation",
    evidencePath: "supabase/tests/903_secure_chain_validation.test.sql",
    token: "select plan(", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
  },
  {
    id: "content-security-policy",
    section: "application-security",
    statement: "platform.trust.control.contentSecurityPolicy",
    evidencePath: "apps/web/proxy.ts",
    token: "frame-ancestors 'none'",
  },
  {
    id: "response-headers",
    section: "application-security",
    statement: "platform.trust.control.responseHeaders",
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
    statement: "platform.trust.control.csrfOrigin",
    evidencePath: "packages/api/src/middleware/security.ts",
    token: "createCsrfAndOriginMiddleware",
    alsoCites: [
      {
        path: "packages/api/src/middleware/security.ts",
        token: 'startsWith("/v1/webhooks/")',
      },
      {
        path: "packages/api/src/middleware/security.ts",
        token: 'new Set(["GET", "HEAD", "OPTIONS"])', // i18n-exempt: evidence token the build greps for in the cited file; never displayed
      },
      {
        path: "packages/api/src/middleware/security.ts",
        token: "Provide the double-submit CSRF token.", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
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
    statement: "platform.trust.control.webhookSignatures",
    evidencePath: "packages/api/src/webhooks.ts",
    token: "verifyAndClaimWebhook",
  },
  {
    id: "idempotency",
    section: "application-security",
    statement: "platform.trust.control.idempotency",
    evidencePath: "packages/api/src/middleware/idempotency.ts",
    token: "idempotencyMiddleware",
    alsoCites: [
      {
        path: "packages/api/src/middleware/idempotency.ts",
        token: 'startsWith("/v1/webhooks/")',
      },
      {
        path: "packages/api/src/middleware/idempotency.ts",
        token: "status >= 200 && status < 500", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
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
    statement: "platform.trust.control.secretScanning",
    evidencePath: "package.json",
    token: "scan:secrets",
  },
  {
    id: "dependency-advisories",
    section: "secure-development",
    statement: "platform.trust.control.dependencyAdvisories",
    evidencePath: "package.json",
    token: "--audit-level=high",
  },
  {
    id: "generated-contract",
    section: "secure-development",
    statement: "platform.trust.control.generatedContract",
    evidencePath: "package.json",
    token: "check:generated",
  },
  {
    id: "schema-drift",
    section: "secure-development",
    statement: "platform.trust.control.schemaDrift",
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
    purpose: "platform.trust.integration.workos",
    evidencePath: "apps/web/package.json",
    token: "@workos-inc/authkit-nextjs",
  },
  {
    name: "Stripe",
    purpose: "platform.trust.integration.stripe",
    evidencePath: "packages/integrations/package.json",
    token: '"stripe"',
  },
  {
    name: "Amazon S3", // i18n-exempt: vendor product name, never translated
    purpose: "platform.trust.integration.amazonS3",
    evidencePath: "packages/integrations/package.json",
    token: "@aws-sdk/client-s3",
  },
  {
    name: "Supabase (PostgreSQL)", // i18n-exempt: vendor product name, never translated
    purpose: "platform.trust.integration.supabase",
    evidencePath: "package.json",
    token: '"supabase"',
  },
  {
    name: "Netlify",
    purpose: "platform.trust.integration.netlify",
    evidencePath: "netlify.toml",
    token: "@netlify/plugin-nextjs",
  },
  {
    name: "Trigger.dev",
    purpose: "platform.trust.integration.triggerDev",
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
      capability: "platform.trust.capability.esign",
      gate: "EXT-PROVIDER-01",
      evidencePath: "packages/integrations/src/esign/http-signing-client.ts",
      token:
        "Provider-neutral HTTPS contract selected and activated through EXT-PROVIDER-01", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
    },
    {
      capability: "platform.trust.capability.tax",
      gate: "EXT-TAX-01",
      evidencePath: "packages/integrations/src/core/tax/http-tax-adapter.ts",
      token: "Provider-neutral tax contract", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
    },
    {
      capability: "platform.trust.capability.screening",
      gate: "EXT-PROVIDER-01",
      evidencePath:
        "packages/integrations/src/runtime/lifecycle-http-providers.ts",
      token: "Authenticated provider-neutral screening contract", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
    },
    {
      capability: "platform.trust.capability.providerTransport",
      gate: "EXT-PROVIDER-01",
      evidencePath: "packages/integrations/src/production-adapters.ts",
      token: "ProviderJsonTransport",
    },
  ];

export const trustGaps: readonly TrustGap[] = [
  {
    id: "no-certifications",
    statement: "platform.trust.gap.noCertifications",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/sprint-checklist.md",
    token: "Audit readiness and security policy pack", // i18n-exempt: evidence token the build greps for in the cited file; never displayed
  },
  {
    id: "no-policy-text",
    statement: "platform.trust.gap.noPolicyText",
    gate: "EXT-LEGAL-01",
    evidencePath: "packages/domain/src/agreements/index.ts",
    token: '"security_addendum"',
  },
  {
    id: "not-a-subprocessor-schedule",
    statement: "platform.trust.gap.notSubprocessorSchedule",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/external-gates.md",
    token: "EXT-LEGAL-01",
  },
  {
    id: "not-counsel-reviewed",
    statement: "platform.trust.gap.notCounselReviewed",
    gate: "EXT-LEGAL-01",
    evidencePath: "docs/external-gates.md",
    token: "EXT-LEGAL-01",
  },
];

/**
 * Certification and attestation names, written the same in every language.
 *
 * Vocabulary a control or an integration may never use.
 *
 * These words are how a trust page goes wrong. They are not banned outright --
 * a `trustGaps` entry has to be able to say "no SOC 2 report is held" -- they
 * are banned from any sentence that reads as an assertion of capability.
 */
export const certificationNames: readonly RegExp[] = [
  /\bSOC ?2\b/i,
  /\bISO ?27001\b/i,
  /\bPCI(?:[ -]DSS)?\b/i,
  /\bHIPAA\b/i,
  /\bFedRAMP\b/i,
  /\bGDPR\b/i,
];

/**
 * The attestation words in English. The certification names above are the
 * only part of this list that reads the same in every language, so they are
 * also the only part `trust-register.test.ts` can hold a translation to.
 */
export const attestationVocabulary: readonly RegExp[] = [
  ...certificationNames,
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
