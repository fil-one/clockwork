"use server";
import { revalidatePath } from "next/cache";
import {
  CustomerAcquisitionCommandSchema,
  ResolveAcquisitionCommandSchema,
} from "@clockwork/domain/core";
import { DatabaseCustomerAcquisitionRepository } from "@clockwork/db";
import { requireRecentAuthentication } from "@/src/auth/session";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getServiceDatabase } from "@/src/db/service";
import type { MessageId, Translator } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";
import { DemoCustomerAcquisitionRepository } from "./demo";

/**
 * The repository's error codes a reader is told about, in their language. The
 * code travels with the message so the page can offer the one recovery that
 * depends on it (refreshing a changed offer).
 */
const messages: Readonly<Record<string, MessageId>> = {
  ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED:
    "customer.payg.error.accountAuthorityRequired",
  ACQUISITION_ACCOUNT_BLOCKED: "customer.payg.error.accountBlocked",
  ACQUISITION_OFFER_CHANGED: "customer.payg.error.offerChanged",
  ACQUISITION_OFFER_UNAVAILABLE: "customer.payg.error.offerUnavailable",
  ACQUISITION_KIND_UNAVAILABLE: "customer.payg.error.kindUnavailable",
  ACQUISITION_REQUEST_PENDING: "customer.payg.error.requestPending",
  ACQUISITION_TRIAL_ALREADY_USED: "customer.payg.error.trialAlreadyUsed",
  ACQUISITION_TRIAL_MISMATCH: "customer.payg.error.trialMismatch",
  ACQUISITION_ENROLLMENT_MISMATCH: "customer.payg.error.enrollmentMismatch",
  ACQUISITION_REQUEST_CHANGED: "customer.payg.error.requestChanged",
  ACQUISITION_VERIFIED_RESULT_REQUIRED:
    "customer.payg.error.verifiedResultRequired",
  ACQUISITION_REPLAY_CONFLICT: "customer.payg.error.replayConflict",
};
function knownCode(error: unknown): string | undefined {
  return error instanceof Error && Object.hasOwn(messages, error.message)
    ? error.message
    : undefined;
}
function failure(error: unknown, t: Translator) {
  const code = knownCode(error);
  const id = code ? messages[code] : undefined;
  return {
    ok: false,
    ...(code ? { code } : {}),
    message: t(id ?? "customer.payg.error.notSaved"),
  };
}
export async function submitCustomerAcquisition(
  value: unknown,
): Promise<{ ok: boolean; message: string; code?: string }> {
  const t = await getTranslations();
  try {
    const session = await requireRecentAuthentication();
    const demo = demoDeployIdentityEnabled(process.env);
    if (
      (!session.providerBacked && !demo) ||
      session.isInternalStaff ||
      session.impersonation ||
      session.assistedSession ||
      session.authenticationProviderImpersonator
    )
      return {
        ok: false,
        message: t("customer.payg.error.ownSessionRequired"),
      };
    const parsed = CustomerAcquisitionCommandSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message: t("customer.payg.error.reviewBeforeSubmitting"),
      };
    if (
      parsed.data.accountId !== session.selectedAccountId ||
      !session.roles.some((role) => ["owner", "admin"].includes(role))
    )
      return {
        ok: false,
        message: t("customer.payg.error.accountAuthorityRequired"),
      };
    const input = {
      command: parsed.data,
      userId: session.userId,
      now: new Date().toISOString(),
    };
    if (demo) await new DemoCustomerAcquisitionRepository().request(input);
    else
      await new DatabaseCustomerAcquisitionRepository(
        getServiceDatabase(),
      ).request(input);
    revalidatePath("/buy/payg");
    revalidatePath("/internal/payg-requests");
    return {
      ok: true,
      message: t(
        parsed.data.kind === "cancel_payg"
          ? "customer.payg.submitted.cancellation"
          : "customer.payg.submitted.request",
      ),
    };
  } catch (error) {
    return failure(error, t);
  }
}
export async function resolveCustomerAcquisition(
  value: unknown,
): Promise<{ ok: boolean; message: string; code?: string }> {
  const t = await getTranslations();
  try {
    const session = await requireRecentAuthentication();
    const demo = demoDeployIdentityEnabled(process.env);
    if (
      (!session.providerBacked && !demo) ||
      !session.isInternalStaff ||
      !session.roles.includes("finance_approver") ||
      !session.mfaVerified ||
      session.impersonation ||
      session.assistedSession ||
      session.authenticationProviderImpersonator
    )
      return {
        ok: false,
        message: t("customer.payg.error.financeSessionRequired"),
      };
    const parsed = ResolveAcquisitionCommandSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message: t("customer.payg.error.resolutionIncomplete"),
      };
    const input = {
      command: parsed.data,
      userId: session.userId,
      now: new Date().toISOString(),
    };
    if (demo) await new DemoCustomerAcquisitionRepository().resolve(input);
    else
      await new DatabaseCustomerAcquisitionRepository(
        getServiceDatabase(),
      ).resolve(input);
    revalidatePath("/buy/payg");
    revalidatePath("/internal/payg-requests");
    return {
      ok: true,
      message: t(
        demo
          ? "customer.payg.resolved.demo"
          : parsed.data.decision === "fulfilled"
            ? "customer.payg.resolved.linked"
            : "customer.payg.resolved.declined",
      ),
    };
  } catch (error) {
    return failure(error, t);
  }
}
