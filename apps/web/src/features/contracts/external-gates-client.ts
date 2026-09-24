import { createClockworkClient } from "@clockwork/api/client";

export async function readGeneratedExternalGates(
  baseUrl: string,
  fetchImplementation: typeof fetch = fetch,
) {
  const client = createClockworkClient(baseUrl, fetchImplementation);
  const response = await client.GET("/v1/system/external-gates");
  if (response.error || !response.data)
    throw new Error("External-gate register unavailable"); // i18n-exempt: server-side read failure for logs; the caller renders its own fallback
  return response.data.items;
}

export type GeneratedExternalGate = Awaited<
  ReturnType<typeof readGeneratedExternalGates>
>[number];

export interface ExternalGateMutationOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  csrfToken?: string;
  idempotencyKey?: string;
}

export interface ExternalGateUpdate {
  expectedRowVersion: number;
  owner: string;
  inputRequired: string;
  configuredStatus: GeneratedExternalGate["configuredStatus"];
  reviewOn: string | null;
  statusReason: string;
}

export class ExternalGateClientError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    /** Set when the client refused before sending: no form token was present. */
    public readonly clientReason?: "token",
  ) {
    super(message);
    this.name = "ExternalGateClientError";
  }
}

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)
    ?.slice(1)
    .join("=");
}

function mutation(options: ExternalGateMutationOptions) {
  const csrfToken = options.csrfToken ?? cookieValue("clockwork-csrf");
  if (!csrfToken || csrfToken.length < 32)
    throw new ExternalGateClientError(
      403,
      "Recent authentication and a secure form token are required.", // i18n-exempt: English diagnostic; surfaces render externalGateErrorText(error, t)
      "token",
    );
  return {
    client: createClockworkClient(
      options.baseUrl ?? "/api",
      options.fetchImplementation ?? fetch,
    ),
    headers: { "x-csrf-token": csrfToken },
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
  };
}

function operationError(status: number): ExternalGateClientError {
  if (status === 409)
    return new ExternalGateClientError(
      status,
      "This gate changed on the server. Reload before retrying.", // i18n-exempt: English diagnostic; surfaces render externalGateErrorText(error, t)
    );
  if (status === 403)
    return new ExternalGateClientError(
      status,
      "Your authority or recent authentication could not be verified.", // i18n-exempt: English diagnostic; surfaces render externalGateErrorText(error, t)
    );
  if (status === 422)
    return new ExternalGateClientError(
      status,
      "Activation policy denied this change. Configuration alone cannot activate a gate.", // i18n-exempt: English diagnostic; surfaces render externalGateErrorText(error, t)
    );
  return new ExternalGateClientError(
    status,
    "The gate operation is unavailable. Nothing was changed.", // i18n-exempt: English diagnostic; surfaces render externalGateErrorText(error, t)
  );
}

export async function updateGeneratedExternalGate(
  gateKey: GeneratedExternalGate["gateKey"],
  input: ExternalGateUpdate,
  options: ExternalGateMutationOptions = {},
) {
  const request = mutation(options);
  const response = await request.client.PUT(
    "/v1/system/external-gates/{gateKey}",
    {
      params: {
        path: { gateKey },
        header: { "idempotency-key": request.idempotencyKey },
      },
      headers: request.headers,
      body: input,
    },
  );
  if (response.error || !response.data)
    throw operationError(response.response.status);
  return response.data;
}

export async function runGeneratedExternalGateActivationTest(
  gateKey: GeneratedExternalGate["gateKey"],
  expectedRowVersion: number,
  options: ExternalGateMutationOptions = {},
) {
  const request = mutation(options);
  const response = await request.client.POST(
    "/v1/system/external-gates/{gateKey}/activation-tests",
    {
      params: {
        path: { gateKey },
        header: { "idempotency-key": request.idempotencyKey },
      },
      headers: request.headers,
      body: { expectedRowVersion },
    },
  );
  if (response.error || !response.data)
    throw operationError(response.response.status);
  return response.data;
}
