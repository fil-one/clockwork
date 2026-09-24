import "server-only";
// i18n-exempt-file: demo mirror of the account-control API: problem+json titles are the API contract (the interface maps `code`); fixture billing addresses are identifiers.

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";
import type {
  DemoAdapterState,
  DemoAdapterStateStore,
} from "@clockwork/testing/demo-state";

import { demoPartyFor } from "./demo-artifact-catalog";
import { idempotencyKey } from "./authorization";
import { configuredDemoStateStore } from "./demo-state-store";
import { ExperienceProblem } from "./model";

const prefix = "demo-account-control:";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface DemoAccountRecord {
  readonly kind: "account";
  readonly id: string;
  readonly legalName: string;
  readonly invoiceDeliveryEmail: string;
  readonly billingContact: { readonly name: string; readonly email: string };
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface DemoNotificationPreference {
  readonly kind: "notification_preference";
  readonly accountId: string;
  readonly alertKind: string;
  readonly channel: "email";
  readonly enabled: boolean;
  readonly updatedAt: string;
}

export interface DemoMemberInvite {
  readonly kind: "member_invite";
  readonly id: string;
  readonly organizationId: string;
  readonly accountId: string;
  readonly email: string;
  readonly role: "owner" | "admin" | "billing" | "member";
  readonly status: "pending";
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface DemoProcurementProfile {
  readonly kind: "procurement_profile";
  readonly accountId: string;
  readonly apContact: { readonly name: string; readonly email: string };
  readonly invoiceDeliveryEmail: string;
  readonly poRequired: boolean;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

interface DemoControlReceipt {
  readonly kind: "receipt";
  readonly userId: string;
  readonly requestHash: string;
  readonly status: number;
  readonly response: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

function overrideData(
  state: DemoAdapterState,
  key: string,
): Readonly<Record<string, unknown>> | undefined {
  return state.projectionOverrides[`${prefix}${key}`]?.data;
}

function isAccount(value: unknown): value is DemoAccountRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "account"
  );
}

function isNotification(value: unknown): value is DemoNotificationPreference {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "notification_preference"
  );
}

function isInvite(value: unknown): value is DemoMemberInvite {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "member_invite"
  );
}

function isProcurement(value: unknown): value is DemoProcurementProfile {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "procurement_profile"
  );
}

function isReceipt(value: unknown): value is DemoControlReceipt {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "receipt"
  );
}

export function demoAccountRecord(
  state: DemoAdapterState,
  accountId: string,
): DemoAccountRecord {
  const stored = overrideData(state, `account:${accountId}`);
  if (isAccount(stored)) return structuredClone(stored);
  const party = demoPartyFor(accountId);
  return {
    kind: "account",
    id: accountId,
    legalName: party.legalName,
    invoiceDeliveryEmail: party.contactEmail ?? `billing@${accountId}.test`,
    billingContact: {
      name: party.contactName ?? party.legalName,
      email: party.contactEmail ?? `billing@${accountId}.test`,
    },
    rowVersion: 1,
    updatedAt: "2026-07-31T16:00:00.000Z",
  };
}

export function demoNotificationPreferences(
  state: DemoAdapterState,
  accountId: string,
): readonly DemoNotificationPreference[] {
  const preferences: DemoNotificationPreference[] = [];
  for (const [key, override] of Object.entries(state.projectionOverrides)) {
    if (!key.startsWith(`${prefix}notification:${accountId}:`)) continue;
    if (isNotification(override.data))
      preferences.push(structuredClone(override.data));
  }
  return preferences;
}

export function demoMemberInvites(
  state: DemoAdapterState,
  accountId: string,
): readonly DemoMemberInvite[] {
  const invites: DemoMemberInvite[] = [];
  for (const [key, override] of Object.entries(state.projectionOverrides)) {
    if (!key.startsWith(`${prefix}invite:`)) continue;
    if (isInvite(override.data) && override.data.accountId === accountId)
      invites.push(structuredClone(override.data));
  }
  return invites;
}

export function demoProcurementProfile(
  state: DemoAdapterState,
  accountId: string,
): DemoProcurementProfile | undefined {
  const stored = overrideData(state, `procurement:${accountId}`);
  return isProcurement(stored) ? structuredClone(stored) : undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(422, "INVALID_BODY", "Body must be an object");
  return value as Readonly<Record<string, unknown>>;
}

function text(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim())
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is required`);
  return candidate.trim();
}

function uuid(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = text(value, key);
  if (!uuidPattern.test(candidate))
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} must be a UUID`);
  return candidate;
}

function email(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = text(value, key).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(candidate))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be an email address`,
    );
  return candidate;
}

function accountScope(session: SessionClaims, accountId: string): void {
  if (
    !session.accountIds.includes(accountId) &&
    session.impersonation?.accountId !== accountId
  )
    throw new ExperienceProblem(
      403,
      "ACCOUNT_SCOPE_FORBIDDEN",
      "The account is outside the authorized scope",
    );
}

function permission(
  session: SessionClaims,
  name: "account:read" | "account:write",
): void {
  if (!session.roles.some((role) => hasPermission(role, name)))
    throw new ExperienceProblem(
      403,
      "ACCOUNT_AUTHORITY_FORBIDDEN",
      "The acting user cannot manage this account",
    );
}

function storeValue(
  state: DemoAdapterState,
  key: string,
  value: Readonly<Record<string, unknown>>,
  version: number,
  updatedAt: string,
): DemoAdapterState {
  return {
    ...state,
    projectionOverrides: {
      ...state.projectionOverrides,
      [`${prefix}${key}`]: { version, updatedAt, data: value },
    },
  };
}

function receiptKey(userId: string, key: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\0")
    .update(key)
    .digest("hex");
}

function requestHash(request: Request, bytes: Uint8Array): string {
  const url = new URL(request.url);
  return createHash("sha256")
    .update(request.method)
    .update("\0")
    .update(url.pathname)
    .update("\0")
    .update(url.search)
    .update("\0")
    .update(bytes)
    .digest("hex");
}

function problem(error: ExperienceProblem, requestId: string): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
      title: "The account request was refused",
      status: error.status,
      detail: error.message,
      code: error.code,
      requestId,
      retryable: error.status >= 500,
    },
    {
      status: error.status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
      },
    },
  );
}

type Mutation = (
  state: DemoAdapterState,
  body: Readonly<Record<string, unknown>>,
  now: string,
) => {
  state: DemoAdapterState;
  status: number;
  response: Readonly<Record<string, unknown>>;
};

async function executeMutation(input: {
  request: Request;
  session: SessionClaims;
  bytes: Uint8Array;
  body: Readonly<Record<string, unknown>>;
  mutate: Mutation;
  store: DemoAdapterStateStore;
}): Promise<Response> {
  const key = idempotencyKey(input.request);
  const hash = requestHash(input.request, input.bytes);
  const receiptId = receiptKey(input.session.userId, key);
  const now = new Date().toISOString();
  let replayed = false;
  const committed = await input.store.update((state) => {
    const existing = overrideData(state, `receipt:${receiptId}`);
    if (isReceipt(existing)) {
      if (
        existing.userId !== input.session.userId ||
        existing.requestHash !== hash
      )
        throw new ExperienceProblem(
          409,
          "IDEMPOTENCY_KEY_CONFLICT",
          "The idempotency key was already used for a different request",
        );
      replayed = true;
      return state;
    }
    const changed = input.mutate(state, input.body, now);
    const receipt: DemoControlReceipt = {
      kind: "receipt",
      userId: input.session.userId,
      requestHash: hash,
      status: changed.status,
      response: changed.response,
      createdAt: now,
    };
    const withReceipt = storeValue(
      changed.state,
      `receipt:${receiptId}`,
      receipt as unknown as Readonly<Record<string, unknown>>,
      1,
      now,
    );
    return { ...withReceipt, revision: state.revision + 1 };
  });
  const receipt = overrideData(committed, `receipt:${receiptId}`);
  if (!isReceipt(receipt))
    throw new Error("DEMO_ACCOUNT_CONTROL_RECEIPT_MISSING");
  return Response.json(receipt.response, {
    status: receipt.status,
    headers: {
      "cache-control": "private, no-store",
      "idempotency-replayed": replayed ? "true" : "false",
    },
  });
}

export async function handleDemoCustomerAccountControl(
  request: Request,
  session: SessionClaims,
  store: DemoAdapterStateStore = configuredDemoStateStore(),
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/u, "");
    if (request.method === "GET" && path === "/v1/core/records/accounts") {
      permission(session, "account:read");
      const accountId = url.searchParams.get("accountId") ?? "";
      if (!uuidPattern.test(accountId))
        throw new ExperienceProblem(
          422,
          "INVALID_QUERY",
          "accountId must be a UUID",
        );
      accountScope(session, accountId);
      const account = demoAccountRecord(await store.read(), accountId);
      return Response.json(
        {
          items: [
            {
              id: account.id,
              resource: "accounts",
              accountId: account.id,
              rowVersion: account.rowVersion,
              data: account,
              createdAt: "2026-07-31T16:00:00.000Z",
              updatedAt: account.updatedAt,
            },
          ],
          nextCursor: null,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    permission(session, "account:write");
    const bytes = new Uint8Array(await request.arrayBuffer());
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ExperienceProblem(
          422,
          "INVALID_BODY",
          "The request body is not JSON",
        );
      throw error;
    }
    const body = record(parsed);

    if (request.method === "POST" && path === "/v1/core/commands/accounts")
      return await executeMutation({
        request,
        session,
        bytes,
        body,
        store,
        mutate: (state, value, now) => {
          if (text(value, "action") !== "update")
            throw new ExperienceProblem(
              422,
              "ACTION_NOT_ALLOWED",
              "accounts accepts only update in the demo",
            );
          const accountId = uuid(value, "id");
          if (uuid(value, "accountId") !== accountId)
            throw new ExperienceProblem(
              422,
              "INVALID_STATE",
              "Account command identity does not match its scope",
            );
          accountScope(session, accountId);
          const expectedVersion = value.expectedVersion;
          if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1)
            throw new ExperienceProblem(
              422,
              "INVALID_BODY",
              "expectedVersion must be a positive integer",
            );
          const current = demoAccountRecord(state, accountId);
          if (current.rowVersion !== Number(expectedVersion))
            throw new ExperienceProblem(
              409,
              "VERSION_CONFLICT",
              "Account version is stale",
            );
          const payload = record(value.payload);
          const billing = record(payload.billingContact);
          const next: DemoAccountRecord = {
            ...current,
            legalName: text(payload, "legalName"),
            invoiceDeliveryEmail: email(payload, "invoiceDeliveryEmail"),
            billingContact: {
              name: text(billing, "name"),
              email: email(billing, "email"),
            },
            rowVersion: current.rowVersion + 1,
            updatedAt: now,
          };
          return {
            state: storeValue(
              state,
              `account:${accountId}`,
              next as unknown as Readonly<Record<string, unknown>>,
              next.rowVersion,
              now,
            ),
            status: 200,
            response: {
              record: {
                id: accountId,
                resource: "accounts",
                accountId,
                rowVersion: next.rowVersion,
                data: next,
                createdAt: "2026-07-31T16:00:00.000Z",
                updatedAt: now,
              },
              auditEventId: uuidV7(),
              outboxEventId: uuidV7(),
            },
          };
        },
      });

    if (request.method === "PUT" && path === "/v1/notifications/preferences")
      return await executeMutation({
        request,
        session,
        bytes,
        body,
        store,
        mutate: (state, value, now) => {
          const accountId = uuid(value, "accountId");
          accountScope(session, accountId);
          const alertKind = text(value, "alertKind");
          if (
            text(value, "channel") !== "email" ||
            typeof value.enabled !== "boolean"
          )
            throw new ExperienceProblem(
              422,
              "INVALID_BODY",
              "Notification preference is invalid",
            );
          if (
            !["renewal_term_window", "poc_milestone", "quote_expiry"].includes(
              alertKind,
            )
          )
            throw new ExperienceProblem(
              422,
              "NOTIFICATION_ALERT_KIND_NOT_MANAGEABLE",
              `${alertKind} is not an optional alert and cannot be switched off`,
            );
          const next: DemoNotificationPreference = {
            kind: "notification_preference",
            accountId,
            alertKind,
            channel: "email",
            enabled: value.enabled,
            updatedAt: now,
          };
          return {
            state: storeValue(
              state,
              `notification:${accountId}:${alertKind}:email`,
              next as unknown as Readonly<Record<string, unknown>>,
              1,
              now,
            ),
            status: 200,
            response: next as unknown as Readonly<Record<string, unknown>>,
          };
        },
      });

    const inviteMatch =
      /^\/v1\/lifecycle\/organizations\/([0-9a-f-]{36})\/invites$/iu.exec(path);
    if (request.method === "POST" && inviteMatch) {
      const organizationId = inviteMatch[1] ?? "";
      if (session.organizationId !== organizationId)
        throw new ExperienceProblem(
          403,
          "ORGANIZATION_SCOPE_FORBIDDEN",
          "The organization is outside the authorized scope",
        );
      return await executeMutation({
        request,
        session,
        bytes,
        body,
        store,
        mutate: (state, value, now) => {
          const accountId = uuid(value, "accountId");
          accountScope(session, accountId);
          const role = text(value, "role");
          if (
            !(["owner", "admin", "billing", "member"] as const).includes(
              role as "owner",
            )
          )
            throw new ExperienceProblem(
              422,
              "INVALID_BODY",
              "Invite role is invalid",
            );
          const expiresAt = text(value, "expiresAt");
          if (
            !Number.isFinite(Date.parse(expiresAt)) ||
            Date.parse(expiresAt) <= Date.parse(now)
          )
            throw new ExperienceProblem(
              422,
              "INVALID_BODY",
              "Invite expiry must be in the future",
            );
          const inviteEmail = email(value, "email");
          const id = createHash("sha256")
            .update(organizationId)
            .update("\0")
            .update(accountId)
            .update("\0")
            .update(inviteEmail)
            .digest("hex")
            .slice(0, 32);
          const inviteId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20)}`;
          const next: DemoMemberInvite = {
            kind: "member_invite",
            id: inviteId,
            organizationId,
            accountId,
            email: inviteEmail,
            role: role as DemoMemberInvite["role"],
            status: "pending",
            expiresAt,
            createdAt: now,
          };
          return {
            state: storeValue(
              state,
              `invite:${inviteId}`,
              next as unknown as Readonly<Record<string, unknown>>,
              1,
              now,
            ),
            status: 201,
            response: next as unknown as Readonly<Record<string, unknown>>,
          };
        },
      });
    }

    const procurementMatch =
      /^\/v1\/lifecycle\/accounts\/([0-9a-f-]{36})\/procurement-profile$/iu.exec(
        path,
      );
    if (request.method === "PUT" && procurementMatch) {
      const accountId = procurementMatch[1] ?? "";
      accountScope(session, accountId);
      return await executeMutation({
        request,
        session,
        bytes,
        body,
        store,
        mutate: (state, value, now) => {
          const ap = record(value.apContact);
          if (typeof value.poRequired !== "boolean")
            throw new ExperienceProblem(
              422,
              "INVALID_BODY",
              "poRequired must be boolean",
            );
          const current = demoProcurementProfile(state, accountId);
          const next: DemoProcurementProfile = {
            kind: "procurement_profile",
            accountId,
            apContact: { name: text(ap, "name"), email: email(ap, "email") },
            invoiceDeliveryEmail: email(value, "invoiceDeliveryEmail"),
            poRequired: value.poRequired,
            rowVersion: (current?.rowVersion ?? 1) + 1,
            updatedAt: now,
          };
          return {
            state: storeValue(
              state,
              `procurement:${accountId}`,
              next as unknown as Readonly<Record<string, unknown>>,
              next.rowVersion,
              now,
            ),
            status: 200,
            response: next as unknown as Readonly<Record<string, unknown>>,
          };
        },
      });
    }

    throw new ExperienceProblem(
      404,
      "NOT_FOUND",
      "Demo account control route was not found",
    );
  } catch (error) {
    if (error instanceof ExperienceProblem) return problem(error, requestId);
    throw error;
  }
}
