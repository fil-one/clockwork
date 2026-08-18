import { createClockworkClient } from "@clockwork/api/client";
import { coreReportNames, type CoreReportName } from "@clockwork/contracts";

/**
 * Compatibility names for the web surfaces, bound to the contract catalogue.
 *
 * These used to be a fourth hand-written report vocabulary and silently left
 * three contract reports out of both operator export surfaces. Keep the local
 * names while making the contract tuple the value and type authority.
 */
export { coreReportNames };
export type { CoreReportName };
export const reportNames = coreReportNames;
export type ReportName = CoreReportName;
export interface ReportResult {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}
export type CoreCommandResource =
  | "accounts"
  | "procurement_profiles"
  | "price_books"
  | "quotes"
  | "orders"
  | "invoices"
  | "credit_notes"
  | "refunds"
  | "disputes"
  | "deal_registrations";

export interface RegistrationInput {
  legalName: string;
  country: string;
  registeredAddress: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode: string;
    country: string;
  };
  relationshipRoles: ("direct_client" | "partner" | "end_client")[];
  businessDomain: string;
  registrantEmail: string;
  registrationToken: string;
  taxIds: { jurisdiction: string; value: string }[];
  billingContact: { name: string; email: string };
  apContact: { name: string; email: string } | null;
  invoiceDeliveryEmail: string;
}

export interface ActiveAgreementTemplate {
  id: string;
  type: string;
  semanticVersion: string;
  jurisdiction: string;
  effectiveOn: string;
  canonicalDocumentId: string;
  exactText: string;
  exactTextHash: string;
  executionMode: "click_through" | "counter_signed";
}

export interface CommerceClientOptions {
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  csrfToken?: string;
  idempotencyKey?: string;
}

export class CommerceApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code:
      "validation" | "forbidden" | "conflict" | "unavailable" | "unknown",
    message: string,
    /**
     * The server's own problem code, when it sent one.
     *
     * `code` above is a coarse class the client chose from the status. That is
     * enough to decide whether to offer a retry, and not enough to tell an
     * outage from a refusal: a deliberate 503 -- the demo declining to contact a
     * payment provider -- and a service that fell over both arrive as
     * `unavailable`. Surfaces that must tell those apart read this.
     */
    public readonly problemCode?: string,
  ) {
    super(message);
    this.name = "CommerceApiError";
  }
}

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
}

function mutationHeaders(options: CommerceClientOptions) {
  const csrfToken = options.csrfToken ?? cookieValue("clockwork-csrf");
  if (!csrfToken || csrfToken.length < 32)
    throw new CommerceApiError(
      403,
      "forbidden",
      "The secure form token is unavailable. Refresh the page and try again.",
    );
  return {
    idempotencyKey: options.idempotencyKey ?? crypto.randomUUID(),
    headers: { "x-csrf-token": csrfToken },
  };
}

function client(options: CommerceClientOptions) {
  const defaultBaseUrl =
    typeof window === "undefined" ? "/api" : `${window.location.origin}/api`;
  return createClockworkClient(
    options.baseUrl ?? defaultBaseUrl,
    options.fetchImplementation ?? fetch,
  );
}

function problemDetail(error: unknown): string | undefined {
  if (
    !error ||
    typeof error !== "object" ||
    !("detail" in error) ||
    typeof error.detail !== "string"
  )
    return undefined;
  const detail = error.detail.trim();
  return detail.length > 0 && detail.length <= 500 ? detail : undefined;
}

/** The `code` member of an RFC 9457 problem document, when there is one. */
function problemCode(error: unknown): string | undefined {
  if (
    !error ||
    typeof error !== "object" ||
    !("code" in error) ||
    typeof error.code !== "string"
  )
    return undefined;
  const code = error.code.trim();
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(code) ? code : undefined;
}

function apiError(status: number, error: unknown): CommerceApiError {
  if (status === 403)
    return new CommerceApiError(
      status,
      "forbidden",
      "Your role or current session cannot perform this action.",
    );
  if (status === 409)
    return new CommerceApiError(
      status,
      "conflict",
      "This record changed while you were working. Review the latest version and try again.",
    );
  if (status === 422)
    return new CommerceApiError(
      status,
      "validation",
      problemDetail(error) ??
        "The request did not pass server validation. Review the highlighted information.",
    );
  if (status === 503)
    /**
     * A 503 that explains itself is quoted, not overwritten.
     *
     * This used to answer every 503 with "The commerce service is
     * unavailable." The demo's checkout refusal is a 503 -- it carries
     * `DEMO_PAYMENT_UNAVAILABLE` and the sentence "The demo never contacts a
     * payment provider, so no checkout session exists." -- and that sentence
     * was being thrown away and replaced with one that reads as an outage. A
     * prospect was shown breakage where the product had made a deliberate
     * refusal. The generic sentence remains the fallback for a 503 that says
     * nothing.
     */
    return new CommerceApiError(
      status,
      "unavailable",
      problemDetail(error) ?? "The commerce service is unavailable.",
      problemCode(error),
    );
  return new CommerceApiError(
    status,
    "unknown",
    "The request could not be completed. Nothing was changed.",
    problemCode(error),
  );
}

async function generatedCall<T>(
  operation: () => Promise<{
    data?: T;
    error?: unknown;
    response: Response;
  }>,
): Promise<T> {
  try {
    const result = await operation();
    if (result.error !== undefined || result.data === undefined)
      throw apiError(result.response.status, result.error);
    return result.data;
  } catch (error) {
    if (error instanceof CommerceApiError) throw error;
    throw new CommerceApiError(
      503,
      "unavailable",
      "The commerce service could not be reached.",
    );
  }
}

export interface CoreCommandInput {
  resource: CoreCommandResource;
  id: string;
  accountId?: string;
  action: string;
  expectedVersion?: number;
  payload: Record<string, unknown>;
}

export function sendCoreCommand(
  input: CoreCommandInput,
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/core/commands/{resource}", {
      params: {
        path: { resource: input.resource },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        id: input.id,
        ...(input.accountId ? { accountId: input.accountId } : {}),
        action: input.action,
        ...(input.expectedVersion === undefined
          ? {}
          : { expectedVersion: input.expectedVersion }),
        payload: input.payload,
      },
    }),
  );
}

/**
 * Reads the account aggregate immediately before an optimistic update. The
 * returned row version belongs to the core account itself, unlike an
 * experience projection version, and therefore is safe to send as
 * `expectedVersion`.
 */
export async function readCoreAccount(
  accountId: string,
  options: Pick<CommerceClientOptions, "baseUrl" | "fetchImplementation"> = {},
) {
  const result = await client(options).GET("/v1/core/records/{resource}", {
    params: {
      path: { resource: "accounts" },
      query: { accountId, limit: 2 },
    },
  });
  if (result.error !== undefined || result.data === undefined)
    throw apiError(result.response.status, result.error);
  const matches = result.data.items.filter(
    (record) => record.id === accountId && record.accountId === accountId,
  );
  const match = matches[0];
  if (matches.length !== 1 || !match)
    throw new CommerceApiError(
      409,
      "conflict",
      "The current account version could not be resolved safely.",
    );
  return match;
}

export function registerOrganization(
  input: RegistrationInput,
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/registrations", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: input,
    }),
  );
}

export function inviteOrganizationMember(
  input: {
    organizationId: string;
    accountId: string;
    email: string;
    role:
      | "owner"
      | "admin"
      | "billing"
      | "member"
      | "partner_admin"
      | "partner_seller";
    expiresAt: string;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST(
      "/v1/lifecycle/organizations/{organizationId}/invites",
      {
        params: {
          path: { organizationId: input.organizationId },
          header: { "idempotency-key": mutation.idempotencyKey },
        },
        headers: mutation.headers,
        body: {
          accountId: input.accountId,
          email: input.email,
          role: input.role,
          expiresAt: input.expiresAt,
        },
      },
    ),
  );
}

export function updateProcurementProfile(
  input: {
    accountId: string;
    apContact: { name: string; email: string };
    invoiceDeliveryEmail: string;
    poRequired: boolean;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).PUT(
      "/v1/lifecycle/accounts/{accountId}/procurement-profile",
      {
        params: {
          path: { accountId: input.accountId },
          header: { "idempotency-key": mutation.idempotencyKey },
        },
        headers: mutation.headers,
        body: {
          apContact: input.apContact,
          invoiceDeliveryEmail: input.invoiceDeliveryEmail,
          poRequired: input.poRequired,
          exemptions: [],
          supplierDocuments: [],
          buyerPortalTasks: [],
        },
      },
    ),
  );
}

export function publishAgreementTemplate(
  input: {
    type: string;
    semanticVersion: string;
    jurisdiction: string;
    effectiveOn: string;
    canonicalDocumentId: string;
    exactText: string;
    exactTextHash: string;
    executionMode: "click_through" | "counter_signed";
    approvalEvidenceDocumentId: string;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/agreement-templates", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: input,
    }),
  );
}

export function getActiveAgreementTemplate(
  input: { type: string; jurisdiction: string },
  options: CommerceClientOptions = {},
): Promise<ActiveAgreementTemplate> {
  return generatedCall(() =>
    client(options).GET("/v1/lifecycle/agreement-templates/active", {
      params: { query: input },
    }),
  );
}

export interface ClickAgreementInput {
  accountId: string;
  templateId: string;
  templateVersion: string;
  exactText: string;
  exactTextHash: string;
  authorityTitle: string;
}

export function executeClickAgreement(
  input: ClickAgreementInput,
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/agreements/click-through", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: {
        ...input,
        authorityAttested: true,
        uiContext: {
          surface: "agreements.execute",
          actionLabel: "Accept and execute",
          locale: "en",
        },
        previousAgreementId: null,
      },
    }),
  );
}

export function createInvoicePaymentSession(
  input: { accountId: string; invoiceId: string },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/core/payment-sessions", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: input,
    }),
  );
}

export function registerPartnerDomain(
  input: {
    accountId: string;
    domain: string;
    verificationToken: string;
    brandName: string;
    logoUrl: string | null;
    primaryColor: string;
    communicationOwner: "fil_one" | "partner";
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/partners/{accountId}/domains", {
      params: {
        path: { accountId: input.accountId },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        domain: input.domain,
        verificationToken: input.verificationToken,
        brandName: input.brandName,
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        communicationOwner: input.communicationOwner,
      },
    }),
  );
}

export function decideException(
  input: {
    caseId: string;
    decision: "approved" | "rejected";
    reason: string;
    evidenceDocumentId: string;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/exceptions/{caseId}/decisions", {
      params: {
        path: { caseId: input.caseId },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        decision: input.decision,
        reason: input.reason,
        evidenceDocumentId: input.evidenceDocumentId,
      },
    }),
  );
}

export interface PocRequestInput {
  accountId: string;
  partnerAccountId: string | null;
  workload: string;
  buyerUserId: string;
  permittedDataClass: string;
  successTests: { id: string; description: string; target: string }[];
  capacityCap: string;
  egressCap: string;
  expiresAt: string;
  supportOwnerId: string;
}

export function requestPoc(
  input: PocRequestInput,
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/pocs", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: input,
    }),
  );
}

export function convertPoc(
  input: { pocId: string; accountId: string; quoteId: string; orderId: string },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/pocs/{pocId}/conversion", {
      params: {
        path: { pocId: input.pocId },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        accountId: input.accountId,
        quoteId: input.quoteId,
        orderId: input.orderId,
      },
    }),
  );
}

export function requestRenewal(
  input: {
    orderId: string;
    accountId: string;
    requestedAction: "renew" | "change_term" | "request_change";
    requestedTermMonths: number | null;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/renewals/{orderId}/requests", {
      params: {
        path: { orderId: input.orderId },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        accountId: input.accountId,
        requestedAction: input.requestedAction,
        requestedTermMonths: input.requestedTermMonths,
      },
    }),
  );
}

export function declineRenewal(
  input: {
    orderId: string;
    accountId: string;
    reason: string;
    authorityTitle: string;
    evidenceDocumentId: string;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/renewals/{orderId}/declines", {
      params: {
        path: { orderId: input.orderId },
        header: { "idempotency-key": mutation.idempotencyKey },
      },
      headers: mutation.headers,
      body: {
        accountId: input.accountId,
        reason: input.reason,
        authorityTitle: input.authorityTitle,
        authorityAttested: true,
        evidenceDocumentId: input.evidenceDocumentId,
      },
    }),
  );
}

export function requestOffboarding(
  input: {
    accountId: string;
    orderId: string;
    reason:
      | "customer_request"
      | "non_renewal"
      | "partner_request"
      | "partner_default"
      | "material_breach";
    effectiveAt: string;
    retrievalDays: number;
    partnerAccountId: string | null;
  },
  options: CommerceClientOptions = {},
) {
  const mutation = mutationHeaders(options);
  return generatedCall(() =>
    client(options).POST("/v1/lifecycle/terminations", {
      params: { header: { "idempotency-key": mutation.idempotencyKey } },
      headers: mutation.headers,
      body: input,
    }),
  );
}

export function readReport(
  input: { report: ReportName; accountId?: string },
  options: CommerceClientOptions = {},
): Promise<ReportResult> {
  return generatedCall<unknown>(() =>
    client(options).GET("/v1/core/reports/{report}", {
      params: {
        path: { report: input.report },
        query: {
          format: "json",
          limit: 100,
          ...(input.accountId ? { accountId: input.accountId } : {}),
        },
      },
    }),
  ).then((result) => result as ReportResult);
}

export function downloadReportCsv(
  input: { report: ReportName; accountId?: string },
  options: CommerceClientOptions = {},
): Promise<string> {
  return generatedCall<unknown>(() =>
    client(options).GET("/v1/core/reports/{report}", {
      params: {
        path: { report: input.report },
        query: {
          format: "csv",
          limit: 100,
          ...(input.accountId ? { accountId: input.accountId } : {}),
        },
      },
      parseAs: "text",
    }),
  ).then((result) => result as string);
}
