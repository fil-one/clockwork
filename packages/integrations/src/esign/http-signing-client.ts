import { Buffer } from "node:buffer";

import { z } from "zod";

const CreateEnvelopeResponseSchema = z.object({
  id: z.string().trim().min(1),
  signingUrl: z.url(),
  state: z.enum(["created", "sent"]),
});

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_048_576;

export interface EsignSigningClient {
  createEnvelope(input: {
    externalReference: string;
    accountId: string;
    documentId: string;
    documentBytes: Uint8Array;
    documentSha256: string;
    signerEmail: string;
    mode: "redirect" | "embedded";
    returnUrl: string;
    idempotencyKey: string;
  }): Promise<{ id: string; signingUrl: string; state: "created" | "sent" }>;
}

/** Provider-neutral HTTPS contract selected and activated through EXT-PROVIDER-01. */
export class HttpEsignSigningClient implements EsignSigningClient {
  private readonly endpoint: URL;
  private readonly signingOrigins: ReadonlySet<string>;
  private readonly timeoutMs: number;

  public constructor(
    private readonly configuration: {
      baseUrl: string;
      apiKey: string;
      signingOrigins: readonly string[];
      timeoutMs?: number;
      fetchImplementation?: typeof fetch;
    },
  ) {
    this.endpoint = trustedProviderEndpoint(configuration.baseUrl);
    if (!configuration.apiKey.trim())
      throw new Error("E-sign API key is required");
    this.signingOrigins = new Set(
      configuration.signingOrigins.map((origin) => trustedOrigin(origin)),
    );
    if (this.signingOrigins.size === 0)
      throw new Error("E-sign signing origin allow-list is required");
    this.timeoutMs = configuration.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 100 ||
      this.timeoutMs > 60_000
    )
      throw new Error("E-sign provider timeout is invalid");
  }

  public async createEnvelope(
    input: Parameters<EsignSigningClient["createEnvelope"]>[0],
  ) {
    // `fetch` is deliberately called unbound here: the receiver is undefined
    // and the global accepts it. The deadline, abort signal and response bound
    // below are what FetchJsonProviderTransport already does, and what this
    // client was missing -- a provider that accepts the POST and never answers
    // held the signing effect open for as long as the socket lived.
    const fetchImplementation = this.configuration.fetchImplementation ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(
        new URL("v1/envelopes", this.endpoint),
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.configuration.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({
            externalReference: input.externalReference,
            accountId: input.accountId,
            documentId: input.documentId,
            documentBase64: Buffer.from(input.documentBytes).toString("base64"),
            documentSha256: input.documentSha256,
            signerEmail: input.signerEmail.toLowerCase(),
            mode: input.mode,
            returnUrl: input.returnUrl,
          }),
        },
      );
    } catch (cause) {
      throw new Error(
        controller.signal.aborted
          ? "E-sign envelope request timed out"
          : "E-sign envelope request failed",
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok)
      throw new Error(
        `E-sign envelope request failed with status ${response.status}`,
      );
    const result = CreateEnvelopeResponseSchema.parse(
      parseBoundedJson(await boundedText(response)),
    );
    const signingUrl = new URL(result.signingUrl);
    if (
      signingUrl.protocol !== "https:" ||
      signingUrl.username ||
      signingUrl.password ||
      !this.signingOrigins.has(signingUrl.origin)
    )
      throw new Error("E-sign provider returned an untrusted signing URL");
    return { ...result, signingUrl: signingUrl.toString() };
  }
}

/**
 * Bounds the body twice, as the shared transport does: the declared length
 * refuses an oversized payload before it is read, and the read itself is
 * measured because content-length is provider-supplied and optional.
 */
async function boundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES)
    throw new Error("E-sign envelope response exceeded the maximum size");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES)
    throw new Error("E-sign envelope response exceeded the maximum size");
  return text;
}

function parseBoundedJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch (cause) {
    throw new Error("E-sign provider returned invalid JSON", { cause });
  }
}

function trustedOrigin(value: string): string {
  const url = trustedProviderEndpoint(value);
  if (url.pathname !== "/" || url.search || url.hash)
    throw new Error("E-sign signing origins cannot contain a path or query");
  return url.origin;
}

function trustedProviderEndpoint(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    privateIpv4(hostname)
  )
    throw new Error("E-sign provider endpoint must be a public HTTPS URL");
  return url;
}

function privateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}
