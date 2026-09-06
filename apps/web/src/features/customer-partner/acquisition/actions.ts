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
import { DemoCustomerAcquisitionRepository } from "./demo";

const messages: Record<string, string> = {
  ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED:
    "An owner or administrator of this organization must submit the request.",
  ACQUISITION_ACCOUNT_BLOCKED:
    "Your account needs review before a new service request can proceed.",
  ACQUISITION_OFFER_CHANGED:
    "This offer changed or is no longer effective. Refresh and review the current terms before accepting.",
  ACQUISITION_OFFER_UNAVAILABLE:
    "Customer terms are not available for this offer. Contact your account team.",
  ACQUISITION_KIND_UNAVAILABLE:
    "This offer is not currently accepting that kind of request.",
  ACQUISITION_REQUEST_PENDING:
    "Your organization already has a pending request. Review its status below.",
  ACQUISITION_TRIAL_ALREADY_USED:
    "This organization has already used its trial. Trial eligibility cannot be reset.",
  ACQUISITION_TRIAL_MISMATCH:
    "The trial is not available for conversion in this organization.",
  ACQUISITION_ENROLLMENT_MISMATCH:
    "The enrollment is not current or does not belong to this organization.",
  ACQUISITION_REQUEST_CHANGED:
    "This request has already changed. Refresh before recording a decision.",
  ACQUISITION_VERIFIED_RESULT_REQUIRED:
    "Record and verify the matching trial, PAYG enrollment, cancellation or conversion first. It must match the request’s account, organization and approved offer.",
  ACQUISITION_REPLAY_CONFLICT:
    "This request identifier was already used with different details. Refresh before retrying.",
};
function failure(error: unknown) {
  return {
    ok: false,
    ...(error instanceof Error && messages[error.message]
      ? { code: error.message }
      : {}),
    message:
      (error instanceof Error ? messages[error.message] : undefined) ??
      "The request was not saved. Refresh and check your access before retrying.",
  };
}
export async function submitCustomerAcquisition(
  value: unknown,
): Promise<{ ok: boolean; message: string; code?: string }> {
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
        message:
          "Use your own customer owner or administrator session to accept these terms.",
      };
    const parsed = CustomerAcquisitionCommandSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message:
          "Review the offer, organization and required acceptance before submitting.",
      };
    if (
      parsed.data.accountId !== session.selectedAccountId ||
      !session.roles.some((role) => ["owner", "admin"].includes(role))
    )
      return {
        ok: false,
        message:
          messages.ACQUISITION_ACCOUNT_AUTHORITY_REQUIRED ??
          "An owner or administrator must submit this request.",
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
      message:
        parsed.data.kind === "cancel_payg"
          ? "Cancellation requested. Service and billing continue until the provider confirms the service end."
          : "Terms recorded and request submitted. Provider setup and billing activation are pending verified handoff.",
    };
  } catch (error) {
    return failure(error);
  }
}
export async function resolveCustomerAcquisition(
  value: unknown,
): Promise<{ ok: boolean; message: string; code?: string }> {
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
        message:
          "Use a direct finance session with current MFA to resolve this request.",
      };
    const parsed = ResolveAcquisitionCommandSchema.safeParse(value);
    if (!parsed.success)
      return {
        ok: false,
        message: "Select the request, decision, verified source and a reason.",
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
      message: demo
        ? "Fictional handoff recorded in demo state. No provider or billing action occurred."
        : parsed.data.decision === "fulfilled"
          ? "Request linked to its verified service record. No new provider or billing effect was dispatched."
          : "Request declined with the recorded reason.",
    };
  } catch (error) {
    return failure(error);
  }
}
