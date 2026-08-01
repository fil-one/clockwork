import { createHash } from "node:crypto";
import http from "node:http";
import process from "node:process";

const argument = process.argv.find((value) => value.startsWith("--port="));
const port = Number.parseInt(
  argument?.slice("--port=".length) ??
    process.env.CLOCKWORK_PROVIDER_FAKE_PORT ??
    "34000",
  10,
);
if (!Number.isInteger(port) || port < 1024 || port > 65_535)
  throw new Error("Provider fake port must be an unprivileged TCP port.");

const deliveries = new Map();
const telemetryRequests = [];
let credentialBearingTelemetryRequests = 0;
const maximumBodyBytes = 256 * 1024;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}

function fingerprint(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function reply(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > maximumBodyBytes) {
      const error = new Error("Provider replay body exceeds the test limit.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBytes(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.byteLength;
    if (bytes > maximumBodyBytes) {
      const error = new Error("Telemetry body exceeds the test limit.");
      error.code = "BODY_TOO_LARGE";
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function hasCredentials(request) {
  return Boolean(request.headers.authorization || request.headers.cookie);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);
  if (request.method === "GET" && url.pathname === "/health") {
    reply(response, 200, { status: "ready" });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/traces") {
    if (hasCredentials(request)) {
      credentialBearingTelemetryRequests += 1;
      reply(response, 400, { code: "OTLP_CREDENTIALS_FORBIDDEN" });
      return;
    }
    if (request.headers["content-type"] !== "application/x-protobuf") {
      reply(response, 415, { code: "OTLP_CONTENT_TYPE_REQUIRED" });
      return;
    }
    try {
      const bytes = await readBytes(request);
      telemetryRequests.push(bytes.toString("base64"));
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "application/x-protobuf",
        "x-content-type-options": "nosniff",
      });
      response.end();
    } catch (error) {
      reply(response, error?.code === "BODY_TOO_LARGE" ? 413 : 400, {
        code: error?.code ?? "INVALID_OTLP",
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/telemetry") {
    reply(response, 200, {
      count: telemetryRequests.length,
      credentialBearingRequests: credentialBearingTelemetryRequests,
      requests: telemetryRequests,
    });
    return;
  }

  if (hasCredentials(request)) {
    reply(response, 400, {
      code: "CREDENTIALS_FORBIDDEN",
      credentialsReceived: true,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/replays") {
    try {
      const body = await readJson(request);
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.eventId !== "string" ||
        !/^[0-9a-f-]{36}$/i.test(body.eventId) ||
        typeof body.topic !== "string" ||
        body.topic.length < 1 ||
        body.topic.length > 160 ||
        !("payload" in body)
      ) {
        reply(response, 400, { code: "INVALID_REPLAY" });
        return;
      }
      const deliveryFingerprint = fingerprint({
        topic: body.topic,
        payload: body.payload,
      });
      const existing = deliveries.get(body.eventId);
      if (existing && existing.fingerprint !== deliveryFingerprint) {
        reply(response, 409, {
          code: "REPLAY_CONFLICT",
          credentialsReceived: false,
        });
        return;
      }
      if (existing) {
        reply(response, 200, {
          eventId: body.eventId,
          status: "duplicate",
          deliveryCount: 1,
          credentialsReceived: false,
        });
        return;
      }
      deliveries.set(body.eventId, {
        fingerprint: deliveryFingerprint,
        topic: body.topic,
      });
      reply(response, 202, {
        eventId: body.eventId,
        status: "processed",
        deliveryCount: 1,
        credentialsReceived: false,
      });
    } catch (error) {
      reply(response, error?.code === "BODY_TOO_LARGE" ? 413 : 400, {
        code: error?.code ?? "INVALID_JSON",
      });
    }
    return;
  }

  const match =
    request.method === "GET" &&
    url.pathname.match(/^\/v1\/replays\/([0-9a-f-]{36})$/i);
  if (match) {
    const eventId = match[1];
    const delivery = deliveries.get(eventId);
    if (!delivery) {
      reply(response, 404, { code: "REPLAY_NOT_FOUND" });
      return;
    }
    reply(response, 200, {
      eventId,
      topic: delivery.topic,
      payloadHash: delivery.fingerprint,
      deliveryCount: 1,
      credentialsReceived: false,
    });
    return;
  }

  reply(response, 404, { code: "NOT_FOUND" });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Provider fake ready on http://127.0.0.1:${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) throw error;
      process.exit(0);
    });
  });
}
