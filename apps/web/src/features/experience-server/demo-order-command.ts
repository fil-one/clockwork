import "server-only";
// i18n-exempt-file: demo mirror of /v1/core/commands/orders: problem+json titles are the API contract; the interface maps `code`.

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";

import {
  demoAccessConfiguration,
  demoAccessCookieName,
  verifyDemoAccessCookie,
} from "@/src/auth/demo-access";

import {
  demoOrderAcceptance,
  type DemoOrderCommand,
} from "./demo-order-acceptance";
import { idempotencyKey } from "./authorization";
import { ExperienceProblem } from "./model";

/**
 * The demo's `/v1/core/commands/orders`.
 *
 * It answers in the generated contract's shape, exactly as the simulator it
 * replaces did, so nothing about the client changes. What changed is that the
 * answer now describes something the server did: the prepare pass records an
 * artifact request the create pass is checked against, and the create pass
 * writes an order the orders channel then serves.
 *
 * Only `prepare_artifact` and `create` are answered, which is the same pair
 * `packages/api/src/routes/core/service.ts` allows on `orders`. A demo that
 * accepted verbs the product refuses would be teaching a prospect an API that
 * does not exist.
 */

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function problem(
  status: number,
  code: string,
  title: string,
  detail: string,
  requestId: string,
): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      detail,
      code,
      requestId,
      retryable: status >= 500,
    },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/problem+json",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function cookieValue(cookie: string | null, name: string): string | undefined {
  for (const part of cookie?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name)
      return part.slice(separator + 1).trim();
  }
  return undefined;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ExperienceProblem(422, "INVALID_BODY", "Body must be an object");
  return value as Readonly<Record<string, unknown>>;
}

function requiredUuid(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const raw = value[key];
  if (typeof raw !== "string" || !uuidPattern.test(raw))
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} must be a UUID`);
  return raw;
}

function requiredText(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim())
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is required`);
  return raw;
}

function optionalText(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = value[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !raw.trim())
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is invalid`);
  return raw;
}

function requiredDate(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const raw = requiredText(value, key);
  if (!datePattern.test(raw))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be a calendar date`,
    );
  return raw;
}

function optionalDate(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const raw = optionalText(value, key);
  if (raw === undefined) return undefined;
  if (!datePattern.test(raw))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be a calendar date`,
    );
  return raw;
}

function requiredInstant(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const raw = requiredText(value, key);
  if (!Number.isFinite(Date.parse(raw)))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be a timestamp`,
    );
  return raw;
}

function commandFrom(
  body: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): DemoOrderCommand {
  const lineIds = payload.orderLineIds;
  if (
    !Array.isArray(lineIds) ||
    lineIds.length === 0 ||
    lineIds.some((item) => typeof item !== "string" || !uuidPattern.test(item))
  )
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      "orderLineIds must be a non-empty list of UUIDs",
    );
  const authorityAttested = payload.authorityAttested;
  if (authorityAttested !== true)
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      "authorityAttested must be true",
    );
  const poNumber = optionalText(payload, "poNumber");
  const serviceEndsOn = optionalDate(payload, "serviceEndsOn");
  const coTerminateOn = optionalDate(payload, "coTerminateOn");
  const noticeOn = optionalDate(payload, "noticeOn");
  const retainUntil = optionalText(payload, "retainUntil");
  const orderFormDocumentId =
    payload.orderFormDocumentId === undefined
      ? undefined
      : requiredUuid(payload, "orderFormDocumentId");
  return {
    orderId: requiredUuid(body, "id"),
    accountId: requiredUuid(body, "accountId"),
    quoteId: requiredUuid(payload, "quoteId"),
    signerUserId: requiredUuid(payload, "signerUserId"),
    authorityTitle: requiredText(payload, "authorityTitle"),
    authorityAttested: true,
    ...(poNumber ? { poNumber } : {}),
    serviceStartsOn: requiredDate(payload, "serviceStartsOn"),
    ...(serviceEndsOn ? { serviceEndsOn } : {}),
    ...(coTerminateOn ? { coTerminateOn } : {}),
    ...(noticeOn ? { noticeOn } : {}),
    acceptedAt: requiredInstant(payload, "acceptedAt"),
    orderLineIds: lineIds as readonly string[],
    ...(retainUntil ? { retainUntil } : {}),
    ...(orderFormDocumentId ? { orderFormDocumentId } : {}),
  };
}

export async function handleDemoOrderCommand(
  request: Request,
  session: SessionClaims,
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    const demoAccessSecret = demoAccessConfiguration(process.env);
    if (
      demoAccessSecret &&
      !(await verifyDemoAccessCookie(
        cookieValue(request.headers.get("cookie"), demoAccessCookieName),
        demoAccessSecret,
      ))
    )
      throw new ExperienceProblem(
        403,
        "DEMO_ACCESS_REQUIRED",
        "A valid demo access grant is required",
      );
    const requestUrl = new URL(request.url);
    // Read the serverless request body exactly once. Some deployment adapters
    // do not preserve the original stream after a clone is drained, even
    // though the browser's request bytes and content type are valid. Hash and
    // parse the same immutable byte array so the idempotency binding cannot
    // disagree with the command we execute.
    const requestBody = new Uint8Array(await request.arrayBuffer());
    const requestHash = createHash("sha256")
      .update(request.method)
      .update(requestUrl.pathname.replace(/^\/api/u, ""))
      .update(requestUrl.search)
      .update(requestBody)
      .digest("hex");
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(new TextDecoder().decode(requestBody));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ExperienceProblem(
          422,
          "INVALID_BODY",
          "The request body is not JSON.",
        );
      throw error;
    }
    const body = record(parsedBody);
    const action = requiredText(body, "action");
    if (action !== "prepare_artifact" && action !== "create")
      throw new ExperienceProblem(
        422,
        "ACTION_NOT_ALLOWED",
        `orders does not accept the action ${JSON.stringify(action)}`,
      );
    const command = commandFrom(body, record(body.payload));
    if (!session.roles.some((role) => hasPermission(role, "order:write")))
      throw new ExperienceProblem(
        403,
        "ORDER_AUTHORITY_FORBIDDEN",
        "The acting user cannot accept orders",
      );
    if (
      !session.accountIds.includes(command.accountId) &&
      session.impersonation?.accountId !== command.accountId
    )
      throw new ExperienceProblem(
        403,
        "ACCOUNT_SCOPE_FORBIDDEN",
        "The order account is outside the authorized scope",
      );
    const acceptance = demoOrderAcceptance();
    const execution = await acceptance.execute({
      session,
      action,
      command,
      idempotencyKey: idempotencyKey(request),
      requestHash,
    });
    const result = execution.result;
    return Response.json(
      {
        record: {
          id: command.orderId,
          resource: "orders",
          accountId: command.accountId,
          rowVersion: result.rowVersion,
          data: { status: result.status, ...result.data },
        },
        auditEventId: result.auditEventId,
        outboxEventId: result.outboxEventId,
      },
      {
        headers: {
          "cache-control": "private, no-store",
          "idempotency-replayed": execution.replayed ? "true" : "false",
        },
      },
    );
  } catch (error) {
    if (error instanceof ExperienceProblem)
      return problem(
        error.status,
        error.code,
        error.code === "INVALID_BODY"
          ? "Request body is invalid"
          : "The order command was refused",
        error.message,
        requestId,
      );
    throw error;
  }
}
