import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { createDirectMigrationClient } from "@clockwork/db/migration-client";

import { authoritativeQuoteProof } from "./production-proof.setup";
import { drainProductionExperienceOutbox } from "./production-workflow-proof";

interface ProjectionRecord {
  id: string;
  recordKey: string;
  version: number;
  data: Readonly<Record<string, unknown>>;
}

interface BrowserResponse<T = unknown> {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: T;
}

interface ProjectionActionReceipt {
  id: string;
  projectionId: string;
  aggregateType: string;
  aggregateId: string;
  action: string;
  expectedVersion: number;
  status: "queued" | "applied" | "rejected" | "failed";
  resultReference: string | null;
  resultCode: string | null;
  authoritativeVersion: number | null;
  commandReplayed: boolean | null;
  createdAt: string;
  completedAt: string | null;
  auditEventId: string;
  outboxMessageId: string;
  code?: string;
}

interface ExpectedDurableAction {
  receipt: ProjectionActionReceipt;
  idempotencyKey: string;
}

interface DurableActionRow {
  id: string;
  projection_id: string;
  aggregate_type: string;
  aggregate_id: string;
  action: string;
  expected_version: number;
  actor_user_id: string;
  audit_event_id: string;
  outbox_message_id: string;
  joined_audit_event_id: string;
  audit_aggregate_type: string;
  audit_aggregate_id: string;
  event_type: string;
  audit_actor: Readonly<Record<string, unknown>>;
  audit_after: Readonly<Record<string, unknown>>;
  audit_metadata: Readonly<Record<string, unknown>>;
  joined_outbox_message_id: string;
  outbox_event_id: string;
  outbox_topic: string;
  outbox_payload: Readonly<Record<string, unknown>>;
}

const customerAccount = "10000000-0000-4000-8000-000000000001";
const partnerAccount = "10000000-0000-4000-8000-000000000002";

function expectProductionRequestShape(page: Page) {
  const forbidden: string[] = [];
  page.on("request", (request) => {
    const headers = request.headers();
    for (const name of ["x-clockwork-persona", "x-clockwork-account-id"]) {
      if (headers[name]) forbidden.push(name);
    }
  });
  return () =>
    expect(forbidden, "persona/account headers must never be sent").toEqual([]);
}

async function expectProofCookie(context: BrowserContext, url: string) {
  const cookies = await context.cookies(url);
  const proof = cookies.find(
    (cookie) => cookie.name === "__Host-clockwork-proof",
  );
  expect(proof).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: "Strict",
  });
}

async function browserRequest<T>(
  page: Page,
  path: string,
  init?: { method?: string; idempotencyKey?: string; body?: unknown },
): Promise<BrowserResponse<T>> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim().split("="))
        .find(([name]) => name === "clockwork-csrf")
        ?.slice(1)
        .join("=");
      const response = await fetch(requestPath, {
        method: requestInit?.method ?? "GET",
        credentials: "same-origin",
        cache: "no-store",
        ...(requestInit?.body !== undefined
          ? {
              headers: {
                "content-type": "application/json",
                "x-csrf-token": csrf ?? "",
                "idempotency-key":
                  requestInit.idempotencyKey ?? crypto.randomUUID(),
              },
              body: JSON.stringify(requestInit.body),
            }
          : {}),
      });
      const headers = Object.fromEntries(response.headers.entries());
      const body = (await response.json()) as T;
      return { status: response.status, headers, body };
    },
    { requestPath: path, requestInit: init },
  );
}

async function projection(
  page: Page,
  audience: "customer" | "partner" | "internal",
  channel: string,
  recordKey: string,
  accountId?: string,
) {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  const response = await browserRequest<ProjectionRecord>(
    page,
    `/api/experience/projections/${audience}/${channel}/${encodeURIComponent(recordKey)}${query}`,
  );
  expect(response.status).toBe(200);
  return response.body;
}

async function projectionAction(
  page: Page,
  input: {
    audience: "customer" | "partner" | "internal";
    channel: string;
    recordKey: string;
    projectionId: string;
    action: string;
    expectedVersion: number;
    idempotencyKey: string;
    accountId?: string;
    payload?: Readonly<Record<string, unknown>>;
  },
) {
  const query = input.accountId
    ? `?accountId=${encodeURIComponent(input.accountId)}`
    : "";
  return browserRequest<ProjectionActionReceipt>(
    page,
    `/api/experience/projections/${input.audience}/${input.channel}/${encodeURIComponent(input.recordKey)}/actions${query}`,
    {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        projectionId: input.projectionId,
        action: input.action,
        expectedVersion: input.expectedVersion,
        payload: input.payload ?? {},
      },
    },
  );
}

async function projectionActionReceipt(
  page: Page,
  input: {
    audience: "customer" | "partner" | "internal";
    channel: string;
    recordKey: string;
    actionRequestId: string;
    accountId?: string;
  },
) {
  const query = input.accountId
    ? `?accountId=${encodeURIComponent(input.accountId)}`
    : "";
  return browserRequest<ProjectionActionReceipt>(
    page,
    `/api/experience/projections/${input.audience}/${input.channel}/${encodeURIComponent(input.recordKey)}/actions/${input.actionRequestId}${query}`,
  );
}

async function expectDurableActions(
  userId: string,
  actions: readonly ExpectedDurableAction[],
): Promise<readonly DurableActionRow[]> {
  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DIRECT_DATABASE_URL is required for release proof");
  const sql = createDirectMigrationClient(databaseUrl);
  try {
    const durable: DurableActionRow[] = [];
    for (const expected of actions) {
      const receipt = expected.receipt;
      const rows = await sql<DurableActionRow[]>`
        select
          request.id::text,
          request.projection_id::text,
          request.aggregate_type,
          request.aggregate_id::text,
          request.action,
          request.expected_version,
          request.actor_user_id::text,
          request.audit_event_id::text,
          request.outbox_message_id::text,
          audit.id::text as joined_audit_event_id,
          audit.aggregate_type as audit_aggregate_type,
          audit.aggregate_id::text as audit_aggregate_id,
          audit.event_type,
          audit.actor as audit_actor,
          audit.after as audit_after,
          audit.metadata as audit_metadata,
          outbox.id::text as joined_outbox_message_id,
          outbox.event_id::text as outbox_event_id,
          outbox.topic as outbox_topic,
          outbox.payload as outbox_payload
        from public.experience_projection_action_requests request
        join public.audit_events audit on audit.id = request.audit_event_id
        join public.outbox_messages outbox on outbox.id = request.outbox_message_id
          and outbox.event_id = audit.id
        where request.id = ${receipt.id}::uuid
          and request.actor_user_id = ${userId}::uuid
      `;
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row).toBeDefined();
      if (!row) throw new Error(`Durable action ${receipt.id} was not found`);
      expect(row).toMatchObject({
        id: receipt.id,
        projection_id: receipt.projectionId,
        aggregate_type: receipt.aggregateType,
        aggregate_id: receipt.aggregateId,
        action: receipt.action,
        expected_version: receipt.expectedVersion,
        actor_user_id: userId,
        audit_event_id: receipt.auditEventId,
        outbox_message_id: receipt.outboxMessageId,
        joined_audit_event_id: receipt.auditEventId,
        audit_aggregate_type: "experience_action_request",
        audit_aggregate_id: receipt.id,
        event_type: "experience.projection_action.queued",
        joined_outbox_message_id: receipt.outboxMessageId,
        outbox_event_id: receipt.auditEventId,
        outbox_topic: "experience.projection_action.queued",
      });
      expect(row.audit_actor).toMatchObject({ kind: "user", id: userId });
      expect(row.audit_after).toEqual({
        actionRequestId: receipt.id,
        projectionId: receipt.projectionId,
        aggregateType: receipt.aggregateType,
        aggregateId: receipt.aggregateId,
        action: receipt.action,
        expectedVersion: receipt.expectedVersion,
        status: "queued",
      });
      expect(row.audit_metadata).toMatchObject({
        idempotencyKey: expected.idempotencyKey,
      });
      expect(row.audit_metadata.commandResource).toEqual(expect.any(String));
      expect(row.outbox_payload).toEqual({
        eventId: receipt.auditEventId,
        actionRequestId: receipt.id,
        projectionId: receipt.projectionId,
        aggregateType: receipt.aggregateType,
        aggregateId: receipt.aggregateId,
        action: receipt.action,
        expectedVersion: receipt.expectedVersion,
      });
      durable.push(row);
    }
    return durable;
  } finally {
    await sql.end();
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

function providerPayloadHash(
  topic: string,
  payload: Readonly<Record<string, unknown>>,
) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize({ topic, payload })))
    .digest("hex");
}

async function providerRequest(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<BrowserResponse<Readonly<Record<string, unknown>>>> {
  const providerURL = process.env.CLOCKWORK_PROVIDER_FAKE_URL;
  if (!providerURL)
    throw new Error(
      "CLOCKWORK_PROVIDER_FAKE_URL is required for release proof",
    );
  const response = await fetch(new URL(path, providerURL), {
    method: init?.method ?? "GET",
    cache: "no-store",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: (await response.json()) as Readonly<Record<string, unknown>>,
  };
}

async function expectOtlpCorrelation(input: {
  navigationTraceparent: string;
  apiTraceparent: string;
}) {
  await expect
    .poll(
      async () => {
        const response = await providerRequest("/v1/telemetry");
        return Number(response.body.count ?? 0);
      },
      { timeout: 10_000 },
    )
    .toBeGreaterThan(8);
  const response = await providerRequest("/v1/telemetry");
  expect(response.status).toBe(200);
  expect(response.body.credentialBearingRequests).toBe(0);
  const encoded = response.body.requests;
  if (
    !Array.isArray(encoded) ||
    !encoded.every((item) => typeof item === "string")
  )
    throw new Error("OTLP proof collector returned an invalid inventory");
  const payloads = encoded.map((item) => Buffer.from(item, "base64"));
  const text = Buffer.concat(payloads).toString("utf8");
  for (const boundary of [
    "server.request",
    "document.load",
    "api.request",
    "db.authorized_transaction",
    "workflow.experience_outbox.drain",
    "queue.outbox.claim",
    "queue.outbox.deliver",
    "outbox.dispatch",
  ])
    expect(text, `captured OTLP boundary ${boundary}`).toContain(boundary);

  const assertTrace = (traceparent: string, minimumPayloads: number) => {
    const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/.exec(traceparent);
    if (!match?.[1] || !match[2])
      throw new Error(
        `Release proof returned invalid traceparent ${traceparent}`,
      );
    const traceId = Buffer.from(match[1], "hex");
    const spanId = Buffer.from(match[2], "hex");
    expect(
      payloads.filter((payload) => payload.includes(traceId)).length,
    ).toBeGreaterThanOrEqual(minimumPayloads);
    expect(
      payloads.filter((payload) => payload.includes(spanId)).length,
    ).toBeGreaterThanOrEqual(minimumPayloads);
  };
  assertTrace(input.navigationTraceparent, 2);
  assertTrace(input.apiTraceparent, 2);

  for (const forbidden of [
    "__Host-clockwork-proof",
    "clockwork-csrf",
    "proof-customer-authoritative-expire-0001",
    process.env.CLOCKWORK_PROOF_AUTH_SECRET,
    process.env.AUTHORIZATION_CONTEXT_SECRET,
  ].filter((value): value is string => Boolean(value)))
    expect(text).not.toContain(forbidden);
}

async function expectProviderReplay(row: DurableActionRow) {
  expect(row.action).toBe("replay_provider_event");
  const eventId = row.outbox_payload.eventId;
  expect(eventId).toBe(row.audit_event_id);
  if (typeof eventId !== "string")
    throw new Error("Persisted recovery event ID is invalid");
  const delivery = {
    eventId,
    topic: row.outbox_topic,
    payload: row.outbox_payload,
  };

  const processed = await providerRequest("/v1/replays", {
    method: "POST",
    body: delivery,
  });
  expect(processed).toMatchObject({
    status: 202,
    body: {
      eventId,
      status: "processed",
      deliveryCount: 1,
      credentialsReceived: false,
    },
  });

  const duplicate = await providerRequest("/v1/replays", {
    method: "POST",
    body: delivery,
  });
  expect(duplicate).toMatchObject({
    status: 200,
    body: {
      eventId,
      status: "duplicate",
      deliveryCount: 1,
      credentialsReceived: false,
    },
  });

  const altered = await providerRequest("/v1/replays", {
    method: "POST",
    body: {
      ...delivery,
      payload: { ...row.outbox_payload, expectedVersion: 999_999 },
    },
  });
  expect(altered).toMatchObject({
    status: 409,
    body: {
      code: "REPLAY_CONFLICT",
      credentialsReceived: false,
    },
  });

  const readback = await providerRequest(
    `/v1/replays/${encodeURIComponent(eventId)}`,
  );
  expect(readback).toMatchObject({
    status: 200,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: {
      eventId,
      topic: row.outbox_topic,
      payloadHash: providerPayloadHash(row.outbox_topic, row.outbox_payload),
      deliveryCount: 1,
      credentialsReceived: false,
    },
  });
}

async function expectAxeClean(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("@customer proves authoritative quote completion and the remaining queue contracts", async ({
  context,
  page,
}) => {
  const assertHeaders = expectProductionRequestShape(page);
  const initialDrain = await drainProductionExperienceOutbox(
    "release-proof-authoritative-quote-materialize",
  );
  expect(initialDrain.delivered).toBeGreaterThanOrEqual(2);
  const navigation = await page.goto("/dashboard");
  const navigationTraceparent = navigation?.headers()["traceparent"];
  if (!navigationTraceparent)
    throw new Error("Production navigation did not return traceparent");
  await expectProofCookie(context, page.url());
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Needs attention" }),
  ).toBeVisible();

  const authoritativeProjection = await projection(
    page,
    "customer",
    "quotes",
    authoritativeQuoteProof.recordKey,
  );
  expect(authoritativeProjection.version).toBe(1);
  expect(authoritativeProjection.data).toMatchObject({
    status: "open",
    allowedActions: ["expire"],
  });
  const authoritativeIdempotencyKey =
    "proof-customer-authoritative-expire-0001";
  const queuedAuthoritative = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: authoritativeQuoteProof.recordKey,
    projectionId: authoritativeProjection.id,
    action: "expire",
    expectedVersion: 1,
    idempotencyKey: authoritativeIdempotencyKey,
  });
  expect(queuedAuthoritative).toMatchObject({
    status: 202,
    body: { status: "queued", expectedVersion: 1 },
  });
  const terminalDrain = await drainProductionExperienceOutbox(
    "release-proof-authoritative-quote-expire",
  );
  expect(terminalDrain.delivered).toBeGreaterThanOrEqual(4);
  const terminalAuthoritative = await projectionActionReceipt(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: authoritativeQuoteProof.recordKey,
    actionRequestId: queuedAuthoritative.body.id,
  });
  expect(terminalAuthoritative).toMatchObject({
    status: 200,
    body: {
      id: queuedAuthoritative.body.id,
      status: "applied",
      resultCode: "PORTAL_ACTION_APPLIED",
      authoritativeVersion: 2,
      commandReplayed: false,
    },
  });
  expect(terminalAuthoritative.body.resultReference).toBe(
    `core:quotes:${authoritativeQuoteProof.quoteId}:version:2`,
  );
  expect(terminalAuthoritative.body.completedAt).not.toBeNull();

  const databaseUrl = process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DIRECT_DATABASE_URL is required for release proof");
  const authoritativeSql = createDirectMigrationClient(databaseUrl);
  try {
    const rows = await authoritativeSql<
      {
        quote_status: string;
        quote_version: number;
        action_status: string;
        action_outbox_processed: boolean;
        terminal_outbox_processed: boolean;
        expire_outbox_processed: boolean;
        materialized_version_two: boolean;
      }[]
    >`
      select quote.status as quote_status,
             quote.row_version as quote_version,
             action.status as action_status,
             action_outbox.processed_at is not null as action_outbox_processed,
             exists (
               select 1 from public.outbox_messages terminal_outbox
               join public.audit_events terminal_event
                 on terminal_event.id = terminal_outbox.event_id
               where terminal_event.aggregate_type = 'experience_action_request'
                 and terminal_event.aggregate_id = action.id
                 and terminal_event.event_type = 'experience.projection_action.applied'
                 and terminal_outbox.processed_at is not null
             ) as terminal_outbox_processed,
             exists (
               select 1 from public.outbox_messages expire_outbox
               join public.audit_events expire_event
                 on expire_event.id = expire_outbox.event_id
               where expire_event.aggregate_type = 'quote'
                 and expire_event.aggregate_id = quote.id
                 and expire_event.event_type = 'core.quotes.expire'
                 and expire_outbox.processed_at is not null
             ) as expire_outbox_processed,
             exists (
               select 1
               from public.experience_projection_materialization_receipts receipt
               where receipt.aggregate_type = 'quote'
                 and receipt.aggregate_id = quote.id
                 and receipt.aggregate_version = 2
             ) as materialized_version_two
      from public.quotes quote
      join public.experience_projection_action_requests action
        on action.id = ${queuedAuthoritative.body.id}::uuid
      join public.outbox_messages action_outbox
        on action_outbox.id = action.outbox_message_id
      where quote.id = ${authoritativeQuoteProof.quoteId}::uuid
    `;
    expect(rows).toEqual([
      {
        quote_status: "expired",
        quote_version: 2,
        action_status: "applied",
        action_outbox_processed: true,
        terminal_outbox_processed: true,
        expire_outbox_processed: true,
        materialized_version_two: true,
      },
    ]);
  } finally {
    await authoritativeSql.end();
  }

  const rematerialized = await projection(
    page,
    "customer",
    "quotes",
    authoritativeQuoteProof.recordKey,
  );
  expect(rematerialized.version).toBe(2);
  expect(rematerialized.data).toMatchObject({
    status: "canceled",
    allowedActions: [],
  });
  const terminalReplay = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: authoritativeQuoteProof.recordKey,
    projectionId: authoritativeProjection.id,
    action: "expire",
    expectedVersion: 1,
    idempotencyKey: authoritativeIdempotencyKey,
  });
  expect(terminalReplay.status).toBe(202);
  expect(terminalReplay.body).toEqual(terminalAuthoritative.body);
  const staleAuthoritative = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: authoritativeQuoteProof.recordKey,
    projectionId: rematerialized.id,
    action: "expire",
    expectedVersion: 1,
    idempotencyKey: "proof-customer-authoritative-expire-stale-0001",
  });
  expect(staleAuthoritative).toMatchObject({
    status: 409,
    body: { code: "VERSION_CONFLICT" },
  });

  const chain = [
    ["agreements", "AGR-PROOF-0001", "execute_agreement"],
    ["quotes", "Q-PROOF-0001", "create_quote"],
    ["orders", "ORD-PROOF-0001", "create_order"],
    ["billing", "INV-PROOF-0001", "confirm_payment"],
  ] as const;
  const durableActions: ExpectedDurableAction[] = [];
  for (const [channel, recordKey, action] of chain) {
    const record = await projection(page, "customer", channel, recordKey);
    const idempotencyKey = `proof-customer-${action}-0001`;
    const response = await projectionAction(page, {
      audience: "customer",
      channel,
      recordKey,
      projectionId: record.id,
      action,
      expectedVersion: record.version,
      idempotencyKey,
    });
    expect(response.status).toBe(202);
    expect(response.body.id).toBeTruthy();
    durableActions.push({ receipt: response.body, idempotencyKey });
  }

  const quote = await projection(page, "customer", "quotes", "Q-PROOF-0001");
  const duplicate = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: quote.recordKey,
    projectionId: quote.id,
    action: "create_quote",
    expectedVersion: quote.version,
    idempotencyKey: "proof-customer-create_quote-0001",
  });
  expect(duplicate.status).toBe(202);
  expect(duplicate.body).toEqual(durableActions[1]?.receipt);

  const replayConflict = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: quote.recordKey,
    projectionId: quote.id,
    action: "create_quote",
    expectedVersion: quote.version,
    idempotencyKey: "proof-customer-create_quote-0001",
    payload: { altered: true },
  });
  expect(replayConflict).toMatchObject({
    status: 409,
    body: { code: "IDEMPOTENCY_CONFLICT" },
  });

  const stale = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: quote.recordKey,
    projectionId: quote.id,
    action: "create_quote",
    expectedVersion: quote.version + 1,
    idempotencyKey: "proof-customer-stale-0001",
  });
  expect(stale).toMatchObject({
    status: 409,
    body: { code: "VERSION_CONFLICT" },
  });

  const forged = await projectionAction(page, {
    audience: "customer",
    channel: "quotes",
    recordKey: quote.recordKey,
    projectionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    action: "create_quote",
    expectedVersion: quote.version,
    idempotencyKey: "proof-customer-forged-0001",
  });
  expect(forged).toMatchObject({
    status: 404,
    body: { code: "PROJECTION_NOT_FOUND" },
  });

  const crossScope = await browserRequest(
    page,
    `/api/experience/projections/customer/quotes?accountId=${partnerAccount}`,
  );
  expect(crossScope).toMatchObject({
    status: 403,
    body: { code: "ACCOUNT_SCOPE_FORBIDDEN" },
  });

  const artifact = await browserRequest<{
    filename: string;
    mimeType: string;
    version: string;
  }>(
    page,
    "/api/experience/artifacts/direct_quote/92000000-0000-4000-8000-000000000002?representation=json",
  );
  expect(artifact).toMatchObject({
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
    body: {
      filename: "direct-quote-proof-v1.pdf",
      mimeType: "application/pdf",
      version: "proof-v1",
    },
  });

  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectDurableActions(
    "20000000-0000-4000-8000-000000000002",
    durableActions,
  );
  const apiTraceparent = queuedAuthoritative.headers.traceparent;
  if (!apiTraceparent)
    throw new Error("Authoritative API response did not return traceparent");
  await expectOtlpCorrelation({ navigationTraceparent, apiTraceparent });
  assertHeaders();
});

test("@partner drives only authorized resale records and cannot read customer truth", async ({
  context,
  page,
}) => {
  const assertHeaders = expectProductionRequestShape(page);
  await page.goto("/partner");
  await expectProofCookie(context, page.url());
  await expect(
    page.getByRole("heading", { name: "Partner desk" }),
  ).toBeVisible();

  const chain = [
    ["portfolio", "ACCOUNT-PROOF-0001", "create_resale_quote"],
    ["quotes", "PQ-PROOF-0001", "issue_resale_quote"],
  ] as const;
  const durableActions: ExpectedDurableAction[] = [];
  for (const [channel, recordKey, action] of chain) {
    const record = await projection(page, "partner", channel, recordKey);
    const idempotencyKey = `proof-partner-${action}-0001`;
    const response = await projectionAction(page, {
      audience: "partner",
      channel,
      recordKey,
      projectionId: record.id,
      action,
      expectedVersion: record.version,
      idempotencyKey,
    });
    expect(response.status).toBe(202);
    durableActions.push({ receipt: response.body, idempotencyKey });
  }

  const confidential = await browserRequest(
    page,
    `/api/experience/projections/customer/quotes?accountId=${customerAccount}`,
  );
  expect(confidential).toMatchObject({
    status: 403,
    body: { code: "AUDIENCE_FORBIDDEN" },
  });
  const customerArtifact = await browserRequest(
    page,
    "/api/experience/artifacts/direct_quote/92000000-0000-4000-8000-000000000002?representation=json",
  );
  expect(customerArtifact.status).toBe(404);

  await page.goto("/partner/portfolio");
  const authorizedAccountRow = page
    .getByRole("row")
    .filter({ hasText: "ACCOUNT-PROOF-0001" });
  await expect(authorizedAccountRow).toBeVisible();
  await page.reload();
  await expect(authorizedAccountRow).toBeVisible();
  await expectDurableActions(
    "20000000-0000-4000-8000-000000000003",
    durableActions,
  );
  assertHeaders();
});

test("@internal drives exception and replay-safe recovery with accessibility", async ({
  context,
  page,
}) => {
  const assertHeaders = expectProductionRequestShape(page);
  await page.goto("/internal/queues");
  await expectProofCookie(context, page.url());
  await expect(
    page.getByRole("heading", { name: "Operational queues" }),
  ).toBeVisible();

  const chain = [
    ["queues", "EXC-PROOF-0001", "review_exception"],
    ["provisioning", "PRV-PROOF-0001", "replay_provider_event"],
  ] as const;
  const durableActions: ExpectedDurableAction[] = [];
  let replayReceipt: ProjectionActionReceipt | undefined;
  for (const [channel, recordKey, action] of chain) {
    const record = await projection(page, "internal", channel, recordKey);
    const idempotencyKey = `proof-internal-${action}-0001`;
    const response = await projectionAction(page, {
      audience: "internal",
      channel,
      recordKey,
      projectionId: record.id,
      action,
      expectedVersion: record.version,
      idempotencyKey,
    });
    expect(response.status).toBe(202);
    durableActions.push({ receipt: response.body, idempotencyKey });
    if (action === "replay_provider_event") replayReceipt = response.body;
  }
  const recovery = await projection(
    page,
    "internal",
    "provisioning",
    "PRV-PROOF-0001",
  );
  const duplicateReplay = await projectionAction(page, {
    audience: "internal",
    channel: "provisioning",
    recordKey: recovery.recordKey,
    projectionId: recovery.id,
    action: "replay_provider_event",
    expectedVersion: recovery.version,
    idempotencyKey: "proof-internal-replay_provider_event-0001",
  });
  expect(duplicateReplay).toMatchObject({
    status: 202,
    body: replayReceipt,
  });

  const forgedCustomerScope = await browserRequest(
    page,
    `/api/experience/projections/customer/quotes?accountId=${partnerAccount}`,
  );
  expect(forgedCustomerScope).toMatchObject({
    status: 403,
    body: { code: "ASSISTED_SESSION_REQUIRED" },
  });

  await page.goto("/internal/provisioning");
  await expect(page.getByText("PRV-PROOF-0001")).toBeVisible();
  await page.reload();
  await expect(page.getByText("PRV-PROOF-0001")).toBeVisible();
  await expectAxeClean(page);
  const durable = await expectDurableActions(
    "20000000-0000-4000-8000-000000000001",
    durableActions,
  );
  const recoveryAction = durable.find(
    ({ action }) => action === "replay_provider_event",
  );
  expect(recoveryAction).toBeDefined();
  if (!recoveryAction)
    throw new Error("Persisted recovery outbox event was not found");
  await expectProviderReplay(recoveryAction);
  assertHeaders();
});
