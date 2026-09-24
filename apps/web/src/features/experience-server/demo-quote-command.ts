import "server-only";
// i18n-exempt-file: demo mirror of /v1/core/commands/quotes: problem+json titles are the API contract; the interface maps `code`.

import { createHash } from "node:crypto";

import type { SessionClaims } from "@clockwork/api";
import { hasPermission, uuidV7 } from "@clockwork/contracts";

import { idempotencyKey } from "./authorization";
import {
  demoQuoteFlow,
  type DemoQuoteCommand,
  type DemoQuoteLineCommand,
} from "./demo-quote-flow";
import { ExperienceProblem } from "./model";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function problem(error: ExperienceProblem, requestId: string): Response {
  return Response.json(
    {
      type: `https://clockwork.test/problems/${error.code.toLowerCase().replaceAll("_", "-")}`,
      title: "The quote command was refused",
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

function text(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim())
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} is required`);
  return candidate;
}

function uuid(value: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = text(value, key);
  if (!uuidPattern.test(candidate))
    throw new ExperienceProblem(422, "INVALID_BODY", `${key} must be a UUID`);
  return candidate;
}

function instant(
  value: Readonly<Record<string, unknown>>,
  key: string,
): string {
  const candidate = text(value, key);
  if (!Number.isFinite(Date.parse(candidate)))
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      `${key} must be a timestamp`,
    );
  return candidate;
}

function positiveVersion(value: Readonly<Record<string, unknown>>): number {
  const candidate = value.expectedVersion;
  if (!Number.isInteger(candidate) || Number(candidate) < 1)
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      "expectedVersion must be a positive integer",
    );
  return Number(candidate);
}

function createLines(
  payload: Readonly<Record<string, unknown>>,
): DemoQuoteLineCommand[] {
  if (!Array.isArray(payload.lines) || payload.lines.length === 0)
    throw new ExperienceProblem(
      422,
      "INVALID_BODY",
      "lines must be a non-empty list",
    );
  return payload.lines.map((value) => {
    const line = record(value);
    const termMonths = line.termMonths;
    if (!Number.isInteger(termMonths) || Number(termMonths) < 1)
      throw new ExperienceProblem(
        422,
        "INVALID_BODY",
        "termMonths must be a positive integer",
      );
    const lineId = line.lineId === undefined ? undefined : uuid(line, "lineId");
    const discountBps = line.discountBps;
    if (
      discountBps !== undefined &&
      (!Number.isInteger(discountBps) ||
        Number(discountBps) < 0 ||
        Number(discountBps) > 10_000)
    )
      throw new ExperienceProblem(
        422,
        "INVALID_BODY",
        "discountBps must be between 0 and 10000",
      );
    return {
      ...(lineId ? { lineId } : {}),
      sku: text(line, "sku"),
      region: text(line, "region"),
      quantity: text(line, "quantity"),
      termMonths: Number(termMonths),
      ...(discountBps === undefined
        ? {}
        : { discountBps: Number(discountBps) }),
    };
  });
}

function commandFrom(
  body: Readonly<Record<string, unknown>>,
): DemoQuoteCommand {
  const action = text(body, "action");
  const quoteId = uuid(body, "id");
  const accountId = uuid(body, "accountId");
  const payload = record(body.payload);
  if (action === "create" || action === "revise") {
    if (text(payload, "route") !== "direct")
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "The customer demo only creates direct quotes",
      );
    return {
      action,
      ...(action === "revise"
        ? {
            expectedVersion: positiveVersion(body),
            revisionId: uuid(payload, "revisionId"),
          }
        : {}),
      quoteId,
      accountId,
      priceBookId: uuid(payload, "priceBookId"),
      seriesId: uuid(payload, "seriesId"),
      route: "direct",
      lines: createLines(payload),
      expiresAt: instant(payload, "expiresAt"),
    };
  }
  const expectedVersion = positiveVersion(body);
  if (action === "prepare_artifact") {
    if (text(payload, "audience") !== "end_client")
      throw new ExperienceProblem(
        422,
        "INVALID_STATE",
        "The direct quote document must be prepared for the end client",
      );
    return {
      action,
      quoteId,
      accountId,
      expectedVersion,
      audience: "end_client",
      issuedAt: instant(payload, "issuedAt"),
      retainUntil: instant(payload, "retainUntil"),
    };
  }
  if (action === "issue")
    return {
      action,
      quoteId,
      accountId,
      expectedVersion,
      artifactIssuedAt: instant(payload, "artifactIssuedAt"),
      renderedDocumentId: uuid(payload, "renderedDocumentId"),
    };
  throw new ExperienceProblem(
    422,
    "ACTION_NOT_ALLOWED",
    `quotes does not accept the action ${JSON.stringify(action)}`,
  );
}

export async function handleDemoQuoteCommand(
  request: Request,
  session: SessionClaims,
): Promise<Response> {
  const requestId = request.headers.get("x-request-id") ?? uuidV7();
  try {
    if (!session.roles.some((role) => hasPermission(role, "quote:write")))
      throw new ExperienceProblem(
        403,
        "QUOTE_AUTHORITY_FORBIDDEN",
        "The acting user cannot create quotes",
      );
    const bytes = new Uint8Array(await request.arrayBuffer());
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new ExperienceProblem(
          422,
          "INVALID_BODY",
          "The request body is not JSON.",
        );
      throw error;
    }
    const command = commandFrom(record(parsed));
    if (
      !session.accountIds.includes(command.accountId) &&
      session.impersonation?.accountId !== command.accountId
    )
      throw new ExperienceProblem(
        403,
        "ACCOUNT_SCOPE_FORBIDDEN",
        "The quote account is outside the authorized scope",
      );
    const url = new URL(request.url);
    const requestHash = createHash("sha256")
      .update(request.method)
      .update(url.pathname.replace(/^\/api/u, ""))
      .update(url.search)
      .update(bytes)
      .digest("hex");
    const execution = await demoQuoteFlow().execute({
      session,
      command,
      idempotencyKey: idempotencyKey(request),
      requestHash,
    });
    return Response.json(
      {
        record: {
          id: command.quoteId,
          resource: "quotes",
          accountId: command.accountId,
          rowVersion: execution.result.rowVersion,
          data: execution.result.data,
        },
        auditEventId: execution.result.auditEventId,
        outboxEventId: execution.result.outboxEventId,
      },
      {
        headers: {
          "cache-control": "private, no-store",
          "idempotency-replayed": execution.replayed ? "true" : "false",
        },
      },
    );
  } catch (error) {
    if (error instanceof ExperienceProblem) return problem(error, requestId);
    throw error;
  }
}
