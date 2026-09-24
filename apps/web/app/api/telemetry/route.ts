import { timingSafeEqual } from "node:crypto";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";

import { uuidV7 } from "@clockwork/contracts";
import {
  parseTraceparent,
  type TelemetrySpanRecord,
} from "@clockwork/integrations/telemetry";

import { getCommerceSession } from "@/src/auth/session";
import {
  redactTelemetryAttributes,
  type OpenTelemetryRecord,
} from "@/src/features/performance/client-telemetry";
import { requestId } from "@/src/features/experience-server/authorization";
import {
  runtimeBoundaryInstrumentation,
  runtimeTelemetrySink,
} from "@/src/telemetry/runtime";
import {
  newTelemetrySpanId,
  telemetryIngestCookieName,
  telemetryIngestSecret,
  verifyTelemetryIngestCookie,
  type TelemetryIngestGrant,
} from "@/src/telemetry/ingest-token";

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

/**
 * Envelope validation. The trace fields are still required to be well formed --
 * an envelope this route cannot parse is refused, not repaired -- but none of
 * the values survive: `asSpan` replaces the whole trace context with parentage
 * from the grant. Validating them and then discarding them is deliberate, so
 * that a caller sending nonsense gets a 422 rather than a silent rewrite.
 */
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

/**
 * Whether a presented Origin is this request's own. `new URL(request.url)` is
 * the server's internal URL -- under `next start` it is `http://localhost:PORT`
 * whatever host the browser asked for -- so comparing a real browser Origin
 * against that alone refused every beacon a deployed browser sent. The Host
 * header is the other half of the comparison: a browser sets it to the target
 * of the request and a document on another origin cannot change it, so an
 * Origin equal to it is same-origin by construction. Scheme is left to the
 * `sec-fetch-site` check above, which already reports an http-to-https
 * neighbour as `same-site` rather than `same-origin` and refuses it.
 */
function sameOrigin(request: Request, origin: string): boolean {
  let presented: URL;
  try {
    presented = new URL(origin);
  } catch {
    // Includes the literal "null" an opaque origin sends. Unparseable is a
    // refusal, never a pass.
    return false;
  }
  try {
    if (presented.origin === new URL(request.url).origin) return true;
  } catch {
    // An unreadable request URL contributes no match; the host header may.
  }
  const host = request.headers.get("host")?.trim().toLowerCase();
  return Boolean(host) && presented.host.toLowerCase() === host;
}

function csrfAuthorized(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin && !sameOrigin(request, origin)) return false;
  const token = request.headers.get("x-clockwork-csrf");
  const cookie = cookieValue(request, "clockwork-csrf");
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

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

const workosConfigured = () =>
  Boolean(
    process.env.WORKOS_API_KEY &&
    process.env.WORKOS_CLIENT_ID &&
    process.env.WORKOS_COOKIE_PASSWORD,
  );

/**
 * The one window every caller in a deployment without a trustworthy identity
 * model shares. It is a module constant on purpose: a constant cannot be
 * rotated, and rotation is exactly how the previous revision was defeated.
 */
const sharedDeploymentMeterKey = "deployment:unidentified";

/**
 * Identity gate, and separately the key the ingest meter counts against.
 *
 * WorkOS shape: the AuthKit session id. It travels in a cookie sealed with
 * `WORKOS_COOKIE_PASSWORD`, survives access-token refresh, and cannot be minted
 * without a real sign-in, so it is both a genuine authentication check and a
 * key the caller cannot rotate.
 *
 * Every other shape -- release proof, fixture demo, local -- has no trustworthy
 * per-caller identity to key on, and this route must stop pretending otherwise.
 * The previous revision keyed on whatever `getCommerceSession()` returned, and
 * in the demo shape that resolver fabricates a full session for a caller with
 * NO credential and takes the persona from the caller's own
 * `x-clockwork-persona` header (src/auth/session.ts:310-373 ->
 * src/auth/demo-persona.ts:44-53). The catalog holds nine personas, so a caller
 * rotated one header through nine independent windows and stepped out of every
 * window they filled; that was proven live. Those shapes now share ONE window
 * for the whole instance. It is deliberately blunt. The thing P0-66 is about is
 * third-party collector cost, a single window bounds it exactly, and a shared
 * window is the honest consequence of a deployment that cannot name its
 * callers.
 *
 * The resolver is still called, because where a real credential exists it
 * genuinely refuses without one -- a release-proof deploy has no session for a
 * caller with no proof cookie, and a deployment with no identity model at all
 * throws. Nothing it returns reaches the key.
 */
async function telemetryMeterKey(): Promise<string | undefined> {
  if (workosConfigured()) {
    try {
      const session = await withAuth();
      return session.user && session.sessionId
        ? `workos:${session.sessionId}`
        : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    await getCommerceSession();
  } catch {
    return undefined;
  }
  return sharedDeploymentMeterKey;
}

const maximumTelemetryBytes = 32_768;
const telemetryRateWindowMs = 60_000;
const telemetryRateLimit = 600;
const maximumMeteredCallers = 10_000;
const telemetryRateState = new Map<
  string,
  { startedAt: number; count: number }
>();

/**
 * Per-instance fixed window, keyed on `telemetryMeterKey` and on nothing a
 * caller supplies. Nothing in this repository meters anything yet, and a
 * Postgres-backed counter would add a write per beacon and a migration in
 * another lane's file, so this bounds what one caller can push through one
 * instance -- the part that turns third-party collector volume into an
 * unbounded bill.
 *
 * The ceiling is set to bound cost, not to police use. A document load emits
 * about six records (one `document.load` and up to five web vitals), so ten a
 * second is an order of magnitude above the fastest human navigation while
 * still cutting what a scripted loop can drive by roughly a hundredfold. It was
 * measured, not guessed: at ninety a minute a browser walking seventeen routes
 * in a production build tripped the limit, which would have read as a bug.
 *
 * Two known limits, both deliberate. A serverless deploy multiplies the ceiling
 * by its instance count; a shared ceiling needs a durable store and is worth
 * revisiting when one exists. And a WorkOS deployment holds up to
 * `maximumMeteredCallers` windows at once, so the instance ceiling is that
 * number times this one -- reachable only by that many genuine signed-in
 * sessions, which is a different problem from an anonymous loop.
 */
function meterTelemetry(key: string, now = Date.now()): boolean {
  for (const [candidate, window] of telemetryRateState)
    if (now - window.startedAt >= telemetryRateWindowMs)
      telemetryRateState.delete(candidate);
  const current = telemetryRateState.get(key);
  if (current) {
    if (current.count >= telemetryRateLimit) return false;
    current.count += 1;
    return true;
  }
  // A full table refuses rather than evicting a live window: dropping telemetry
  // costs a data point, while evicting would let a wide set of keys reset the
  // ceiling for everyone already being counted.
  if (telemetryRateState.size >= maximumMeteredCallers) return false;
  telemetryRateState.set(key, { startedAt: now, count: 1 });
  return true;
}

async function readTelemetryJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  // i18n-exempt: ingest parse error, mapped to a fixed problem response that the telemetry beacon never displays
  if (!reader) throw new Error("Telemetry body is required");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumTelemetryBytes) {
      await reader.cancel();
      // i18n-exempt: ingest parse error, mapped to a fixed problem response that the telemetry beacon never displays
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

/**
 * The accepted record, reparented onto the grant.
 *
 * Every field of the caller's trace context is dropped. The trace id is the
 * grant's, so a record cannot be grafted onto a trace the caller named; the
 * parent is the grant's span, so omitting `parentSpanId` no longer roots a
 * forged span at the top of a granted trace; and the span id is drawn fresh
 * here, so a caller cannot hand a browser span the id of a span this server
 * really emitted. The flags are the server's own -- the caller's sampling
 * decision is not this route's to take.
 *
 * The cost is real and is the trade the brief called for: the server cannot
 * know it emitted a span whose id a caller recites, so it stops honouring
 * recited parentage and issues its own instead.
 */
function asSpan(
  record: OpenTelemetryRecord,
  grant: TelemetryIngestGrant,
): TelemetrySpanRecord {
  const attributes = {
    ...redactTelemetryAttributes(record.attributes),
    "clockwork.operation": record.name,
    "browser.signal": record.signal,
    ...(record.value === undefined
      ? {}
      : { "browser.metric.value": record.value }),
  };
  return {
    traceId: grant.traceId,
    spanId: newTelemetrySpanId(),
    parentSpanId: grant.spanId,
    traceFlags: "01",
    name: record.name,
    boundary: "browser",
    startTimeUnixNano: record.timeUnixNano,
    endTimeUnixNano: (BigInt(record.timeUnixNano) + 1n).toString(),
    status: "ok",
    attributes,
  };
}

/**
 * Refusal codes are deliberately outside the canonical denial set. A canonical
 * code on a 403 is what `denialSpanAttributes` lifts onto an API-boundary span,
 * and `runtime-auth-anomaly` pages the on-call rota at five of those in five
 * minutes -- so emitting one here would let anybody with a browser pull the
 * alarm by beaconing without a session. The comment on `denialCodes` says a
 * boundary that refuses must emit one of them; nothing enforces that, and an
 * ingest boundary that doubles as a remote alarm-pull is the worse outcome.
 */
function problem(
  request: Request,
  status: 403 | 413 | 415 | 422 | 429 | 503,
  code: string,
  title: string,
): NextResponse {
  return NextResponse.json(
    {
      type: `https://clockwork.test/problems/${code.toLowerCase().replaceAll("_", "-")}`,
      title,
      status,
      code,
      requestId: requestId(request),
      // A throttle and an unreachable collector both clear on their own; a
      // refused origin, session, grant, or envelope never does.
      retryable: status >= 500 || status === 429,
    },
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
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

/**
 * Everything that can refuse, before anything that costs. Refusing used to be
 * billable: the boundary span wrapped the whole handler, so five anonymous
 * posts produced five exported span batches and the meter never saw them, which
 * made refusal itself a way to drive collector volume. Nothing here opens a
 * span, and the two async calls it does make -- the grant verification and the
 * identity resolution -- sit behind the csrf check and behind each other, in
 * increasing order of cost.
 */
async function screen(
  request: Request,
): Promise<{ refusal: NextResponse } | { span: TelemetrySpanRecord }> {
  if (!csrfAuthorized(request))
    return {
      refusal: problem(
        request,
        403,
        "TELEMETRY_ORIGIN_REJECTED",
        "Telemetry requires a same-origin, CSRF-bound request",
      ),
    };
  // Parentage is proven before the body is read, and before any identity work:
  // a caller without a grant this server minted for this browser has nothing
  // acceptable to say.
  const secret = telemetryIngestSecret(process.env);
  const grant: TelemetryIngestGrant | undefined = secret
    ? await verifyTelemetryIngestCookie({
        value: cookieValue(request, telemetryIngestCookieName),
        browserBinding: cookieValue(request, "clockwork-csrf"),
        secret,
      })
    : undefined;
  if (!grant)
    return {
      refusal: problem(
        request,
        403,
        "TELEMETRY_TRACE_UNVERIFIED",
        "Telemetry requires a server-issued trace grant",
      ),
    };
  // The csrf cookie is minted for anonymous callers too, and so is the grant,
  // so neither is an identity. Ingest costs money at a third-party collector,
  // so it takes a caller this deployment can meter.
  const meterKey = await telemetryMeterKey();
  if (!meterKey)
    return {
      refusal: problem(
        request,
        403,
        "TELEMETRY_SESSION_REQUIRED",
        "Telemetry requires an authenticated session",
      ),
    };
  if (!meterTelemetry(meterKey))
    return {
      refusal: problem(
        request,
        429,
        "TELEMETRY_RATE_LIMITED",
        "Telemetry quota for this session is exhausted",
      ),
    };
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return {
      refusal: problem(
        request,
        415,
        "TELEMETRY_MEDIA_TYPE",
        "Telemetry requires application/json",
      ),
    };
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumTelemetryBytes
  )
    return {
      refusal: problem(
        request,
        413,
        "TELEMETRY_PAYLOAD_TOO_LARGE",
        "Telemetry payload is too large",
      ),
    };
  let record: OpenTelemetryRecord | undefined;
  try {
    record = telemetryRecord(await readTelemetryJson(request));
  } catch (error) {
    if (error instanceof RangeError)
      return {
        refusal: problem(
          request,
          413,
          "TELEMETRY_PAYLOAD_TOO_LARGE",
          "Telemetry payload is too large",
        ),
      };
    record = undefined;
  }
  if (!record)
    return {
      refusal: problem(
        request,
        422,
        "TELEMETRY_ENVELOPE_INVALID",
        "Telemetry envelope is invalid",
      ),
    };
  return { span: asSpan(record, grant) };
}

export async function POST(request: Request) {
  const admitted = await screen(request);
  if ("refusal" in admitted) return admitted.refusal;
  // The traceparent header joins this receiver span to the caller's trace. The
  // browser span in the body carries the grant's parentage instead, so the two
  // are independent: a caller who names a trace here reaches the receiver span
  // only, which is a boundary span this server chose to emit for a request it
  // already admitted and metered.
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
      operation: async () => {
        try {
          await runtimeTelemetrySink.export([admitted.span]);
        } catch {
          throw new TelemetrySinkUnavailableError();
        }
        return new NextResponse(null, { status: 202 });
      },
    });
  } catch (error) {
    if (error instanceof TelemetrySinkUnavailableError)
      return problem(
        request,
        503,
        "TELEMETRY_SINK_UNAVAILABLE",
        "Telemetry delivery unavailable",
      );
    throw error;
  }
}
