import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

import { createDirectMigrationClient } from "@clockwork/db/migration-client";
import type { CommerceDocumentInput } from "@clockwork/documents";

import { releaseProofPlaywrightCookie } from "../src/auth/release-proof";
import {
  artifactSourceHash,
  verifyResolvedArtifactSource,
} from "../src/features/experience-server/artifact-sources";

export const proofIdentities = [
  {
    name: "customer",
    sessionId: "90000000-0000-4000-8000-000000000001",
    userId: "20000000-0000-4000-8000-000000000002",
    organizationId: "30000000-0000-4000-8000-000000000001",
  },
  {
    name: "partner",
    sessionId: "90000000-0000-4000-8000-000000000002",
    userId: "20000000-0000-4000-8000-000000000003",
    organizationId: "30000000-0000-4000-8000-000000000002",
  },
  {
    name: "internal",
    sessionId: "90000000-0000-4000-8000-000000000003",
    userId: "20000000-0000-4000-8000-000000000001",
    organizationId: "30000000-0000-4000-8000-000000000008",
  },
] as const;

const accounts = {
  customer: "10000000-0000-4000-8000-000000000001",
  partner: "10000000-0000-4000-8000-000000000002",
} as const;

const sourceTime = "2026-07-31T16:00:00.000Z";

const proofArtifact = {
  requestId: "92000000-0000-4000-8000-000000000001",
  deliveryId: "92000000-0000-4000-8000-000000000002",
  documentId: "40000000-0000-4000-8000-000000000003",
  kind: "direct_quote",
  subjectType: "quote",
  subjectId: "91000000-0000-4000-8000-000000000102",
  sourceVersion: "proof-v1",
} as const;

const proofArtifactDocumentDraft = {
  kind: proofArtifact.kind,
  documentId: "direct-quote-proof-v1",
  version: proofArtifact.sourceVersion,
  issuedAt: sourceTime,
  locale: "en-US",
  issuer: {
    legalName: "Fil One, Inc.",
    address: {
      line1: "451 Fictional Harbor Way",
      locality: "Wilmington",
      region: "DE",
      postalCode: "19801",
      countryCode: "US",
    },
  },
  recipient: {
    legalName: "Release Proof Customer, Inc.",
    address: {
      line1: "100 Deterministic Test Avenue",
      locality: "Boston",
      region: "MA",
      postalCode: "02110",
      countryCode: "US",
    },
  },
  verification: {
    objectVersion: proofArtifact.sourceVersion,
    recordHash: "0".repeat(64),
  },
  quoteNumber: "Q-PROOF-0001",
  validUntil: "2026-08-21",
  currency: "USD",
  lineItems: [
    {
      id: "proof-line-1",
      description: "Production-shaped release proof capacity",
      quantity: "1",
      unitLabel: "term",
      unitPrice: { currency: "USD", minorUnits: "1540000" },
      amount: { currency: "USD", minorUnits: "1540000" },
    },
  ],
  totals: {
    subtotal: { currency: "USD", minorUnits: "1540000" },
    tax: { currency: "USD", minorUnits: "0" },
    taxLabel: "Sales tax",
    total: { currency: "USD", minorUnits: "1540000" },
  },
  servicePeriod: { startDate: "2026-08-01", endDate: "2027-07-31" },
  paymentTerms: "Net 30 days",
} satisfies CommerceDocumentInput;

const proofArtifactSourceHash = artifactSourceHash({
  kind: proofArtifact.kind,
  subjectType: proofArtifact.subjectType,
  subjectId: proofArtifact.subjectId,
  sourceVersion: proofArtifact.sourceVersion,
  document: proofArtifactDocumentDraft,
});

const proofArtifactDocument = {
  ...proofArtifactDocumentDraft,
  verification: {
    ...proofArtifactDocumentDraft.verification,
    recordHash: proofArtifactSourceHash,
  },
} satisfies CommerceDocumentInput;

verifyResolvedArtifactSource({
  kind: proofArtifact.kind,
  subjectType: proofArtifact.subjectType,
  subjectId: proofArtifact.subjectId,
  sourceVersion: proofArtifact.sourceVersion,
  input: proofArtifactDocument,
  sourceHash: proofArtifactSourceHash,
});

export const authoritativeQuoteProof = {
  quoteId: "97000000-0000-4000-8000-000000000001",
  seriesId: "97000000-0000-4000-8000-000000000002",
  lineId: "97000000-0000-4000-8000-000000000003",
  eventId: "97000000-0000-4000-8000-000000000004",
  outboxMessageId: "97000000-0000-4000-8000-000000000005",
  recordKey: "quote-97000000-0000-4000-8000-000000000001",
} as const;

const customerCommercial = (
  kind: "agreements" | "quotes" | "orders" | "billing",
  id: string,
  title: string,
  allowedActions: readonly string[],
) => ({
  id,
  kind,
  title,
  description: `${title} · production release proof`,
  status: "open",
  statusLabel: "Open",
  tone: "warning",
  risk: "medium",
  owner: "Authorized account team",
  value: kind === "billing" ? "$15,400.00" : "Current record",
  valueLabel: kind === "billing" ? "Invoiced amount" : "Authoritative value",
  dateLabel: "Updated Jul 31",
  term: "Bound to the current account term",
  nextAction: allowedActions[0]?.replaceAll("_", " ") ?? "Review",
  allowedActions,
});

const proofProjections = [
  {
    id: "91000000-0000-4000-8000-000000000001",
    audience: "customer",
    accountId: accounts.customer,
    subjectAccountId: accounts.customer,
    channel: "dashboard",
    recordKey: "customer-home",
    commandResource: null,
    payload: {
      obligations: [
        {
          id: "proof-invoice",
          priority: 1,
          type: "Invoice",
          title: "$15,400 due Aug 15",
          detail: "Provider-confirmed payment is still required.",
          actionLabel: "Review invoice",
          href: "/billing",
          tone: "warning",
          state: "Action due",
          recordVersion: 1,
        },
      ],
      term: {
        title: "Current annual term",
        rangeLabel: "Jan 1 - Dec 31, 2026",
        progressPercent: 58,
        progressLabel: "58 percent of the commercial term elapsed",
        renewalState: "Auto-renews",
        noticeLabel: "Opens Nov 1",
        renewalLabel: "Jan 1, 2027",
        agreementLabel: "Cloud Service Agreement",
      },
      services: [
        {
          id: "proof-service",
          name: "Primary archive",
          detail: "500 TB · active · follows account term",
        },
      ],
      capacity: {
        committed: "500 TB",
        current: "311 TB · 62%",
        prior: "292 TB · up 19 TB",
        freshnessLabel: "Usage projection is current",
      },
      activity: [
        {
          id: "proof-activity",
          title: "Provider state reconciled",
          detail: "Replay-safe provider event",
          occurredAt: sourceTime,
          occurredLabel: "Current release fixture",
        },
      ],
      allowedActions: [],
    },
  },
  ...(
    [
      [
        "agreements",
        "AGR-PROOF-0001",
        "Authorized agreement",
        ["execute_agreement"],
      ],
      ["quotes", "Q-PROOF-0001", "Account-bound quote", ["create_quote"]],
      ["orders", "ORD-PROOF-0001", "Accepted order", ["create_order"]],
      [
        "billing",
        "INV-PROOF-0001",
        "Provider-confirmed invoice",
        ["confirm_payment"],
      ],
    ] as const
  ).map(([channel, recordKey, title, actions], index) => ({
    id: `91000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
    audience: "customer",
    accountId: accounts.customer,
    subjectAccountId: accounts.customer,
    channel,
    recordKey,
    commandResource: `experience:${channel}`,
    payload: customerCommercial(channel, recordKey, title, actions),
  })),
  {
    id: "91000000-0000-4000-8000-000000000201",
    audience: "partner",
    accountId: accounts.partner,
    subjectAccountId: accounts.partner,
    channel: "dashboard",
    recordKey: "partner-home",
    commandResource: null,
    payload: {
      agreement: {
        label: "Authorized channel agreement",
        start: "2026-01-01T00:00:00.000Z",
        noticeStart: "2026-09-01T00:00:00.000Z",
        end: "2026-12-31T00:00:00.000Z",
        now: sourceTime,
        renewalState: "auto-renews",
        authorityState: "Active · notice review due Sep 1",
        nextDecision: "Review channel authority by Sep 1",
        commercialRoute: "Authorized resale",
        merchantBoundary: "Partner remains merchant of record",
      },
      work: [
        {
          id: "partner-proof-work",
          account: "Authorized named account",
          task: "Prepare resale quote",
          evidence: "Named-account authority",
          due: "Today",
          href: "/partner/quotes",
          adminOnly: false,
          recordVersion: 1,
        },
      ],
      boundary: [
        { label: "Transfer price", value: "Partner confidential" },
        { label: "Merchant of record", value: "Authorized partner" },
      ],
      allowedActions: [],
    },
  },
  ...(
    [
      ["portfolio", "ACCOUNT-PROOF-0001", "create_resale_quote"],
      ["quotes", "PQ-PROOF-0001", "issue_resale_quote"],
    ] as const
  ).map(([channel, recordKey, action], index) => ({
    id: `91000000-0000-4000-8000-${String(index + 202).padStart(12, "0")}`,
    audience: "partner",
    accountId: accounts.partner,
    subjectAccountId: accounts.partner,
    channel,
    recordKey,
    commandResource: `experience:partner:${channel}`,
    payload: {
      id: recordKey,
      name: "Authorized named account",
      context: "Session-scoped partner record",
      status: "open",
      risk: "medium",
      owner: "Partner desk",
      value: "Confidential",
      secondary: "Record-bound resale authority",
      allowedActions: [action],
    },
  })),
  ...(
    [
      ["queues", "EXC-PROOF-0001", "review_exception"],
      ["approvals", "APR-PROOF-0001", "approve_exception"],
      ["provisioning", "PRV-PROOF-0001", "replay_provider_event"],
    ] as const
  ).map(([channel, recordKey, action], index) => ({
    id: `91000000-0000-4000-8000-${String(index + 301).padStart(12, "0")}`,
    audience: "internal",
    accountId: null,
    subjectAccountId: accounts.customer,
    channel,
    recordKey,
    commandResource: `experience:internal:${channel}`,
    payload: {
      id: recordKey,
      title: `${channel} release record`,
      status: "ready",
      statusLabel: "Ready for review",
      owner: "Authorized operator",
      nextAction: action.replaceAll("_", " "),
      allowedActions: [action],
    },
  })),
] as const;

async function seedProofProjections(
  sql: ReturnType<typeof createDirectMigrationClient>,
) {
  for (const projection of proofProjections) {
    const payload = JSON.stringify(projection.payload);
    const sourceHash = createHash("sha256").update(payload).digest("hex");
    const payloadParameter = sql.json(projection.payload);
    await sql`
      insert into public.experience_portal_projections (
        id, audience, audience_account_id, subject_account_id, channel,
        record_key, aggregate_type, aggregate_id, command_resource, payload,
        source_hash, source_aggregate_version, source_updated_at, projected_at,
        row_version
      ) values (
        ${projection.id}::uuid, ${projection.audience},
        ${projection.accountId}::uuid, ${projection.subjectAccountId}::uuid,
        ${projection.channel}, ${projection.recordKey}, ${projection.channel},
        ${projection.id}::uuid, ${projection.commandResource}, ${payloadParameter},
        ${sourceHash}, 1, ${sourceTime}::timestamptz, now(), 1
      )
      on conflict (id) do update set
        payload = excluded.payload,
        source_hash = excluded.source_hash,
        source_aggregate_version = excluded.source_aggregate_version,
        source_updated_at = excluded.source_updated_at,
        projected_at = excluded.projected_at,
        row_version = excluded.row_version
    `;
  }
  const proofArtifactInput = sql.json(proofArtifactDocument);
  await sql`
    insert into public.experience_document_render_requests (
      id, account_id, audience, audience_account_id, subject_type, subject_id,
      document_kind, input, source_hash, source_version, requested_by,
      retain_until, status, failure_code, row_version
    ) values (
      ${proofArtifact.requestId}::uuid,
      ${accounts.customer}::uuid, 'customer', ${accounts.customer}::uuid,
      ${proofArtifact.subjectType}, ${proofArtifact.subjectId}::uuid,
      ${proofArtifact.kind}, ${proofArtifactInput},
      ${proofArtifactSourceHash}, ${proofArtifact.sourceVersion},
      '20000000-0000-4000-8000-000000000002'::uuid,
      '2033-07-31T16:00:00.000Z'::timestamptz, 'stored', null, 1
    ) on conflict (id) do nothing
  `;
  await sql`
    insert into public.experience_artifact_deliveries (
      id, render_request_id, account_id, audience, audience_account_id,
      subject_type, subject_id, document_kind, document_id,
      immutable_version, source_hash, content_hash, storage_version_id,
      mime_type, byte_length, filename, retain_until
    ) values (
      ${proofArtifact.deliveryId}::uuid,
      ${proofArtifact.requestId}::uuid,
      ${accounts.customer}::uuid, 'customer', ${accounts.customer}::uuid,
      ${proofArtifact.subjectType}, ${proofArtifact.subjectId}::uuid,
      ${proofArtifact.kind}, ${proofArtifact.documentId}::uuid,
      ${proofArtifact.sourceVersion}, ${proofArtifactSourceHash},
      ${"c".repeat(64)}, 'demo-v1',
      'application/pdf', 2048, 'direct-quote-proof-v1.pdf',
      '2033-07-31T16:00:00.000Z'::timestamptz
    ) on conflict (id) do nothing
  `;
}

async function seedAuthoritativeQuoteProof(
  sql: ReturnType<typeof createDirectMigrationClient>,
) {
  const now = new Date();
  const createdAt = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const expiresAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  const issuedAt = new Date(now.getTime() - 10 * 60_000).toISOString();
  const payload = {
    eventId: authoritativeQuoteProof.eventId,
    eventType: "core.quotes.issue",
    aggregateType: "quote",
    aggregateId: authoritativeQuoteProof.quoteId,
    aggregateVersion: 1,
    occurredAt: issuedAt,
    requestId: "release-proof-authoritative-quote-issue",
    actor: {
      kind: "user",
      id: "20000000-0000-4000-8000-000000000002",
    },
    data: { status: "issued" },
  };
  await sql`
    insert into public.quotes (
      id, account_id, price_book_id, series_id, revision, status, currency,
      total_minor, margin_floor_result, expires_at, created_by,
      rendered_document_id, created_at, updated_at, row_version, immutable_at
    ) values (
      ${authoritativeQuoteProof.quoteId}::uuid, ${accounts.customer}::uuid,
      '60000000-0000-4000-8000-000000000001'::uuid,
      ${authoritativeQuoteProof.seriesId}::uuid, 1, 'issued', 'USD', 180000,
      'pass', ${expiresAt}::timestamptz,
      '20000000-0000-4000-8000-000000000002'::uuid,
      '40000000-0000-4000-8000-000000000003'::uuid,
      ${createdAt}::timestamptz, ${issuedAt}::timestamptz, 1,
      ${issuedAt}::timestamptz
    )
  `;
  await sql`
    insert into public.core_quote_commercial_profiles (
      quote_id, channel_shape, merchant_of_record, pricing_authority,
      billing_account_id, white_label_metadata, pricing_inputs,
      pricing_calculated_at
    ) values (
      ${authoritativeQuoteProof.quoteId}::uuid, 'direct', 'fil_one', 'fil_one',
      ${accounts.customer}::uuid, '{}'::jsonb,
      '{"exceptionReasons":[]}'::jsonb, ${createdAt}::timestamptz
    )
  `;
  await sql`
    insert into public.quote_lines (
      id, quote_id, rate_card_id, sku, quantity, term_months,
      unit_price_minor, overage_rate_minor, discount_bps, line_total_minor
    ) values (
      ${authoritativeQuoteProof.lineId}::uuid,
      ${authoritativeQuoteProof.quoteId}::uuid,
      '61000000-0000-4000-8000-000000000001'::uuid,
      'LOCKED-STORAGE-TB', 1, 12, 15000, 18000, 0, 180000
    )
  `;
  await sql`
    insert into public.audit_events (
      id, account_id, aggregate_type, aggregate_id, aggregate_version,
      event_type, event_version, actor, occurred_at, request_id, after, metadata
    ) values (
      ${authoritativeQuoteProof.eventId}::uuid, ${accounts.customer}::uuid,
      'quote', ${authoritativeQuoteProof.quoteId}::uuid, 1,
      'core.quotes.issue', 1,
      '{"kind":"user","id":"20000000-0000-4000-8000-000000000002"}'::jsonb,
      ${issuedAt}::timestamptz, 'release-proof-authoritative-quote-issue',
      '{"status":"issued"}'::jsonb, '{"proof":"authoritative"}'::jsonb
    )
  `;
  await sql`
    insert into public.outbox_messages (
      id, event_id, topic, payload, available_at
    ) values (
      ${authoritativeQuoteProof.outboxMessageId}::uuid,
      ${authoritativeQuoteProof.eventId}::uuid, 'core.quotes.issue',
      ${sql.json(payload)}, ${issuedAt}::timestamptz
    )
  `;
}

async function revokeProofSessions(
  sql: ReturnType<typeof createDirectMigrationClient>,
) {
  for (const identity of proofIdentities) {
    await sql`
      update public.experience_release_proof_sessions
      set revoked_at = now()
      where id = ${identity.sessionId}::uuid
    `;
  }
}

export default async function productionProofSetup(config: FullConfig) {
  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  const secret = process.env.CLOCKWORK_PROOF_AUTH_SECRET;
  const authorizationSecret = process.env.AUTHORIZATION_CONTEXT_SECRET;
  const projectUrl = config.projects[0]?.use.baseURL;
  if (!databaseUrl)
    throw new Error("DIRECT_DATABASE_URL is required for release proof");
  if (!secret || Buffer.byteLength(secret) < 32)
    throw new Error(
      "CLOCKWORK_PROOF_AUTH_SECRET is required for release proof",
    );
  if (!authorizationSecret || Buffer.byteLength(authorizationSecret) < 32)
    throw new Error(
      "AUTHORIZATION_CONTEXT_SECRET is required for release proof",
    );
  if (typeof projectUrl !== "string")
    throw new Error("Release proof requires a configured baseURL");

  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const artifactRoot = path.resolve(
    process.env.CLOCKWORK_ARTIFACT_DIR ?? "test-results/proof",
  );
  const stateRoot = path.join(artifactRoot, "auth");
  await mkdir(stateRoot, { recursive: true });
  const sql = createDirectMigrationClient(databaseUrl);
  const browser = await chromium.launch();
  try {
    await sql`
      update private.authorization_secrets
      set active = false, rotated_at = now()
      where active
    `;
    await sql`
      insert into private.authorization_secrets (id, secret, active)
      values ('release-proof', ${authorizationSecret}, true)
      on conflict (id) do update set
        secret = excluded.secret,
        active = true,
        rotated_at = now()
    `;
    await seedProofProjections(sql);
    await seedAuthoritativeQuoteProof(sql);
    for (const identity of proofIdentities) {
      const nonce = createHash("sha256")
        .update(`${identity.sessionId}:${expiresAt}:${secret}`)
        .digest("base64url");
      const nonceHash = createHash("sha256").update(nonce).digest("hex");
      await sql`
        insert into public.experience_release_proof_sessions (
          id, user_id, organization_id, nonce_hash, expires_at,
          mfa_verified, recent_authentication_verified, revoked_at
        ) values (
          ${identity.sessionId}::uuid,
          ${identity.userId}::uuid,
          ${identity.organizationId}::uuid,
          ${nonceHash},
          ${expiresAt}::timestamptz,
          true,
          true,
          null
        )
        on conflict (id) do update set
          user_id = excluded.user_id,
          organization_id = excluded.organization_id,
          nonce_hash = excluded.nonce_hash,
          expires_at = excluded.expires_at,
          mfa_verified = excluded.mfa_verified,
          recent_authentication_verified = excluded.recent_authentication_verified,
          revoked_at = null
      `;
      const context = await browser.newContext();
      const { path: cookiePath, ...proofCookie } = releaseProofPlaywrightCookie(
        {
          payload: { sessionId: identity.sessionId, expiresAt, nonce },
          origin: projectUrl,
          secret,
        },
      );
      if (cookiePath !== "/")
        throw new Error("Release-proof cookie must use the root path");
      const secureCookieURL = new URL(proofCookie.url);
      secureCookieURL.protocol = "https:";
      await context.addCookies([
        { ...proofCookie, url: secureCookieURL.toString() },
      ]);
      const persisted = await context.cookies(projectUrl);
      if (
        !persisted.some(
          (cookie) =>
            cookie.name === "__Host-clockwork-proof" &&
            cookie.secure &&
            cookie.httpOnly,
        )
      )
        throw new Error(
          "Secure release-proof cookie was not retained for localhost",
        );
      await context.storageState({
        path: path.join(stateRoot, `${identity.name}.json`),
      });
      await context.close();
    }
    await writeFile(
      path.join(artifactRoot, "proof-auth-lifecycle.json"),
      `${JSON.stringify(
        {
          activeSessionCount: proofIdentities.length,
          expiresAt,
          authStateRetention:
            "ephemeral until teardown; excluded from uploaded evidence",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    try {
      await revokeProofSessions(sql);
    } finally {
      await rm(stateRoot, { recursive: true, force: true });
    }
    throw error;
  } finally {
    try {
      await browser.close();
    } finally {
      await sql.end();
    }
  }
}
