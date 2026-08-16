import "server-only";

import { uuidV7 } from "@clockwork/contracts";

import {
  demoOrderAcceptance,
  type DemoOrderCommand,
} from "./demo-order-acceptance";
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
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    const body = record(await request.json());
    const action = requiredText(body, "action");
    if (action !== "prepare_artifact" && action !== "create")
      throw new ExperienceProblem(
        422,
        "ACTION_NOT_ALLOWED",
        `orders does not accept the action ${JSON.stringify(action)}`,
      );
    const command = commandFrom(body, record(body.payload));
    // Imported here rather than at module scope: the session module pulls in
    // the hosted identity provider's Next integration, and a malformed command
    // must be answerable without it -- which is also what lets this lane be
    // exercised without standing an identity provider up.
    const { getCommerceSession } = await import("@/src/auth/session");
    const session = await getCommerceSession();
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
    // The prepare pass writes no order, so the record it reports is the one
    // `artifactRequestResult` reports on the authoritative path: the order the
    // pass named, in `artifact_requested`, at row version 1.
    const result =
      action === "prepare_artifact"
        ? await acceptance.prepare(session, command).then((prepared) => ({
            status: "artifact_requested" as const,
            rowVersion: 1,
            data: {
              orderFormDocumentId: prepared.documentId,
              artifactRequestId: prepared.id,
              sourceHash: prepared.sourceHash,
              retainUntil: prepared.retainUntil,
            },
          }))
        : await acceptance.create(session, command).then((order) => ({
            status: "accepted" as const,
            rowVersion: 1,
            data: {
              quoteId: command.quoteId,
              orderFormDocumentId: order.orderFormDocumentId,
              serviceStartsOn: order.serviceStartsOn,
              serviceEndsOn: order.serviceEndsOn,
              acceptedAt: order.acceptedAt,
              immutableAt: order.immutableAt,
            },
          }));
    return Response.json(
      {
        record: {
          id: command.orderId,
          resource: "orders",
          accountId: command.accountId,
          rowVersion: result.rowVersion,
          data: { status: result.status, ...result.data },
        },
        auditEventId: uuidV7(),
        outboxEventId: uuidV7(),
      },
      { headers: { "cache-control": "private, no-store" } },
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
    if (error instanceof SyntaxError)
      return problem(
        422,
        "INVALID_BODY",
        "Request body is invalid",
        "The request body is not JSON.",
        requestId,
      );
    throw error;
  }
}
