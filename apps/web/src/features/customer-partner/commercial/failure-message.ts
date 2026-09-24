import { CommerceApiError } from "@/src/features/contracts/commerce-client";
import { ExperienceClientError } from "@/src/features/contracts/experience-client";
import type { MessageId, MessageValues, Translator } from "@/src/i18n";

/**
 * A stop a commercial surface raises on purpose, carrying the sentence the
 * reader is shown as a message ID rather than as English text.
 *
 * The surfaces here used to throw `new Error("…")` and render
 * `caught.message`, which put English in front of every reader and let a
 * lookup's internal diagnostic ("The quote document lookup failed") reach the
 * page as if it were an explanation.
 */
export class CommercialStop extends Error {
  public constructor(
    public readonly messageId: MessageId,
    public readonly values: MessageValues = {},
  ) {
    super(messageId);
    this.name = "CommercialStop";
  }
}

const classMessages = {
  forbidden: "customer.commercial.failure.forbidden",
  conflict: "customer.commercial.failure.conflict",
  validation: "customer.commercial.failure.validation",
  unavailable: "customer.commercial.failure.unavailable",
  unknown: "customer.commercial.failure.unknown",
} as const satisfies Record<CommerceApiError["code"], MessageId>;

function statusClass(status: number): keyof typeof classMessages {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 409) return "conflict";
  if (status === 422) return "validation";
  if (status === 503) return "unavailable";
  return "unknown";
}

/**
 * What the reader is told when a commercial command or read fails.
 *
 * A deliberate stop says its own sentence. A server refusal is described by
 * its class -- forbidden, conflict, validation, unavailable -- because the
 * server's problem text is English written for integrators. Anything else,
 * including a server failure of no known class, gets the surface's own
 * fallback, which states what did and did not happen.
 */
export function commercialFailureText(
  caught: unknown,
  t: Translator,
  fallback: MessageId,
): string {
  if (caught instanceof CommercialStop)
    return t(caught.messageId, caught.values);
  const failure =
    caught instanceof CommerceApiError
      ? caught.code
      : caught instanceof ExperienceClientError
        ? statusClass(caught.status)
        : "unknown";
  return t(failure === "unknown" ? fallback : classMessages[failure]);
}
