import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { uuidV7 } from "@clockwork/contracts";
import {
  parseTraceparent,
  type TelemetrySpanRecord,
} from "@clockwork/integrations/telemetry";

import {
  redactTelemetryAttributes,
  type OpenTelemetryRecord,
} from "@/src/features/performance/client-telemetry";
import {
  runtimeBoundaryInstrumentation,
  runtimeTelemetrySink,
} from "@/src/telemetry/runtime";

export const runtime = "nodejs";

const signalNames = new Set([
  "browser.error",
  "browser.unhandled_rejection",
  "document.load",
  "web_vital.cls",
  "web_vital.fcp",
  "web_vital.inp",
  "web_vital.lcp",
  "web_vital.ttfb",
]);
const traceId = /^[0-9a-f]{32}$/;
const spanId = /^[0-9a-f]{16}$/;
const unixNano = /^\d{16,22}$/;

function object(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function telemetryRecord(value: unknown): OpenTelemetryRecord | undefined {
  const record = object(value);
  const trace = object(record?.trace);
  const resource = object(record?.resource);
  const scope = object(record?.scope);
  const attributes = object(record?.attributes);
  if (
    !record ||
    record.schemaUrl !== "https://opentelemetry.io/schemas/1.30.0" ||
    (record.signal !== "metric" && record.signal !== "span") ||
    typeof record.name !== "string" ||
    !signalNames.has(record.name) ||
    typeof record.timeUnixNano !== "string" ||
    !unixNano.test(record.timeUnixNano) ||
    !trace ||
    typeof trace.traceId !== "string" ||
    !traceId.test(trace.traceId) ||
    /^0+$/.test(trace.traceId) ||
    typeof trace.spanId !== "string" ||
    !spanId.test(trace.spanId) ||
    /^0+$/.test(trace.spanId) ||
    (trace.traceFlags !== "00" && trace.traceFlags !== "01") ||
    (trace.parentSpanId !== undefined &&
      (typeof trace.parentSpanId !== "string" ||
        !spanId.test(trace.parentSpanId) ||
        /^0+$/.test(trace.parentSpanId))) ||
    !resource ||
    resource["service.name"] !== "clockwork-web" ||
    typeof resource["service.version"] !== "string" ||
    typeof resource["deployment.environment.name"] !== "string" ||
    !scope ||
    scope.name !== "@clockwork/web" ||
    scope.version !== "1" ||
    !attributes ||
    (record.value !== undefined &&
      (typeof record.value !== "number" || !Number.isFinite(record.value)))
  )
    return undefined;
  return record as unknown as OpenTelemetryRecord;
}

function csrfAuthorized(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  const token = request.headers.get("x-clockwork-csrf");
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("clockwork-csrf="))
    ?.slice("clockwork-csrf=".length);
  if (
    !token ||
    !cookie ||
    !/^[0-9a-f]{32}$/.test(token) ||
    !/^[0-9a-f]{32}$/.test(cookie)
  )
    return false;
  const tokenBytes = Buffer.from(token, "ascii");
  const cookieBytes = Buffer.from(cookie, "ascii");
  return (
    tokenBytes.length === cookieBytes.length &&
    timingSafeEqual(tokenBytes, cookieBytes)
  );
}

const maximumTelemetryBytes = 32_768;

async function readTelemetryJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Telemetry body is required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumTelemetryBytes) {
      await reader.cancel();
      throw new RangeError("Telemetry payload is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

function asSpan(record: OpenTelemetryRecord): TelemetrySpanRecord {
  const attributes = {
    ...redactTelemetryAttributes(record.attributes),
    "clockwork.operation": record.name,
    "browser.signal": record.signal,
    ...(record.value === undefined
      ? {}
      : { "browser.metric.value": record.value }),
  };
  return {
    traceId: record.trace.traceId,
    spanId: record.trace.spanId,
    ...(record.trace.parentSpanId
      ? { parentSpanId: record.trace.parentSpanId }
      : {}),
    traceFlags: record.trace.traceFlags,
    name: record.name,
    boundary: "browser",
    startTimeUnixNano: record.timeUnixNano,
    endTimeUnixNano: (BigInt(record.timeUnixNano) + 1n).toString(),
    status: "ok",
    attributes,
  };
}

// The sink swallows delivery failures, so the receiver span would end "ok"
// while the caller sees 503. Raising this instead carries the failed outcome
// onto the span, and the boundary maps it back to the same response.
class TelemetrySinkUnavailableError extends Error {
  public readonly code = "TELEMETRY_SINK_UNAVAILABLE";

  public constructor() {
    super("Telemetry delivery unavailable");
    this.name = "TelemetrySinkUnavailableError";
  }
}

async function ingest(request: Request): Promise<NextResponse> {
  if (!csrfAuthorized(request))
    return NextResponse.json(
      { title: "Forbidden", status: 403 },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json(
      { title: "Unsupported media type", status: 415 },
      { status: 415 },
    );
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumTelemetryBytes
  )
    return NextResponse.json(
      { title: "Payload too large", status: 413 },
      { status: 413 },
    );
  let record: OpenTelemetryRecord | undefined;
  try {
    record = telemetryRecord(await readTelemetryJson(request));
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json(
        { title: "Payload too large", status: 413 },
        { status: 413 },
      );
    record = undefined;
  }
  if (!record)
    return NextResponse.json(
      { title: "Invalid telemetry envelope", status: 422 },
      { status: 422 },
    );
  try {
    await runtimeTelemetrySink.export([asSpan(record)]);
  } catch {
    throw new TelemetrySinkUnavailableError();
  }
  return new NextResponse(null, { status: 202 });
}

export async function POST(request: Request) {
  // The traceparent header joins this receiver span to the browser trace. The
  // browser span travels in the body and keeps the parent it arrived with.
  const parent = parseTraceparent(request.headers.get("traceparent"));
  try {
    return await runtimeBoundaryInstrumentation.api({
      name: "api.telemetry_ingest",
      correlation: { requestId: uuidV7() },
      attributes: {
        "clockwork.operation": "api.telemetry_ingest",
        "http.request.method": request.method,
        "http.route": "/api/telemetry",
      },
      ...(parent ? { parent } : {}),
      operation: () => ingest(request),
    });
  } catch (error) {
    if (error instanceof TelemetrySinkUnavailableError)
      return NextResponse.json(
        { title: "Telemetry delivery unavailable", status: 503 },
        { status: 503 },
      );
    throw error;
  }
}
