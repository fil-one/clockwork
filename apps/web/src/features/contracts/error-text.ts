import type { MessageId, Translator } from "@/src/i18n";

import { CommerceApiError } from "./commerce-client";
import { ExperienceClientError } from "./experience-client";
import { ExternalGateClientError } from "./external-gates-client";

/**
 * The reader's-language sentence for a failed API call.
 *
 * The error classes keep an English `message` for logs and tests; that text is
 * never the reader's. A surface shows what these return instead. They word the
 * failure from facts the client has (the status class, a client-side refusal)
 * rather than quoting the server's English `detail`, so the sentence is in the
 * reader's language and cannot overstate what happened.
 */
export function commerceErrorText(error: unknown, t: Translator): string {
  return t(commerceErrorMessage(error));
}

export function commerceErrorMessage(error: unknown): MessageId {
  if (!(error instanceof CommerceApiError)) return "platform.api.failed";
  if (error.clientReason === "token") return "platform.api.tokenUnavailable";
  if (error.clientReason === "network") return "platform.api.unreachable";
  if (error.clientReason === "version") return "platform.api.versionUnresolved";
  if (error.code === "forbidden") return "platform.api.forbidden";
  if (error.code === "conflict") return "platform.api.conflict";
  if (error.code === "validation") return "platform.api.validation";
  if (error.code === "unavailable") return "platform.api.unavailable";
  return "platform.api.failed";
}

export function experienceErrorText(error: unknown, t: Translator): string {
  if (!(error instanceof ExperienceClientError))
    return t("platform.api.failed");
  if (error.code === "CSRF_MISSING") return t("platform.api.tokenUnavailable");
  if (error.code === "ARTIFACT_RESPONSE_INVALID")
    return t("platform.api.documentUnverified");
  if (error.status === 403) return t("platform.api.forbidden");
  if (error.status === 409) return t("platform.api.conflict");
  if (error.status === 422) return t("platform.api.validation");
  if (error.status === 503) return t("platform.api.unavailable");
  return t("platform.api.failed");
}

export function externalGateErrorText(error: unknown, t: Translator): string {
  if (!(error instanceof ExternalGateClientError))
    return t("platform.api.gate.failed");
  if (error.clientReason === "token")
    return t("platform.api.gate.tokenUnavailable");
  if (error.status === 409) return t("platform.api.gate.conflict");
  if (error.status === 403) return t("platform.api.gate.forbidden");
  if (error.status === 422) return t("platform.api.gate.policyDenied");
  return t("platform.api.gate.failed");
}
