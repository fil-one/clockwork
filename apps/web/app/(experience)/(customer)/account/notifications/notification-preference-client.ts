import { createClockworkClient } from "@clockwork/api/client";

import { notificationChannel } from "./notification-preference-model";

/**
 * The browser half of `PUT /v1/notifications/preferences`.
 *
 * It carries the same two request-level controls every other mutation on this
 * portal carries -- the double-submit CSRF token and an idempotency key -- and
 * maps the one response this surface has to explain, the 422 the alert-kind
 * check constraint produces, back to the detail the server wrote rather than to
 * a generic failure.
 *
 * This deliberately duplicates the small header/error shape of
 * `@/src/features/contracts/commerce-client`; see the cross-lane note in the
 * handoff for folding the two notification calls into that module.
 */
export class NotificationPreferenceRequestError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "NotificationPreferenceRequestError";
  }
}

function cookieValue(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];
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

export interface StorePreferenceInput {
  accountId: string;
  alertKind: string;
  enabled: boolean;
}

export interface StoredPreferenceResult {
  alertKind: string;
  channel: string;
  enabled: boolean;
}

export async function storeNotificationPreference(
  input: StorePreferenceInput,
  options: {
    baseUrl?: string;
    fetchImplementation?: typeof fetch;
    csrfToken?: string;
    idempotencyKey?: string;
  } = {},
): Promise<StoredPreferenceResult> {
  const csrfToken = options.csrfToken ?? cookieValue("clockwork-csrf");
  if (!csrfToken || csrfToken.length < 32)
    throw new NotificationPreferenceRequestError(
      403,
      "The secure form token is unavailable. Refresh the page and try again.",
    );
  const baseUrl =
    options.baseUrl ??
    (typeof window === "undefined" ? "/api" : `${window.location.origin}/api`);
  const client = createClockworkClient(
    baseUrl,
    options.fetchImplementation ?? fetch,
  );
  let result;
  try {
    result = await client.PUT("/v1/notifications/preferences", {
      params: {
        header: {
          "idempotency-key": options.idempotencyKey ?? crypto.randomUUID(),
        },
      },
      headers: { "x-csrf-token": csrfToken },
      body: {
        accountId: input.accountId,
        alertKind: input.alertKind,
        channel: notificationChannel,
        enabled: input.enabled,
      },
    });
  } catch {
    throw new NotificationPreferenceRequestError(
      503,
      "The commerce service could not be reached. Nothing was changed.",
    );
  }
  if (result.error !== undefined || result.data === undefined) {
    const status = result.response.status;
    throw new NotificationPreferenceRequestError(
      status,
      status === 422
        ? (problemDetail(result.error) ??
            "This alert is not optional and cannot be switched off.")
        : status === 403
          ? "Your role or current session cannot change notification preferences."
          : status === 503
            ? "Notification preferences are unavailable. Nothing was changed."
            : "The preference could not be saved. Nothing was changed.",
    );
  }
  return {
    alertKind: result.data.alertKind,
    channel: result.data.channel,
    enabled: result.data.enabled,
  };
}
