import {
  durableHumanWait,
  type DurableHumanWait,
  workflowEffect,
  type WorkflowEffect,
  type WorkflowIdentity,
} from "../onboarding/durable";

export const pocTaskIds = Object.freeze({
  milestones: "lifecycle-pocs-milestones-v1",
  expiry: "lifecycle-pocs-expiry-v1",
  proposal: "lifecycle-pocs-proposal-v1",
  conversion: "lifecycle-pocs-conversion-v1",
});

export type PocEffect = WorkflowEffect<
  | "notify_poc_milestone"
  | "generate_poc_proposal"
  | "expire_poc"
  | "open_poc_qualification"
  | "upgrade_poc_entitlements"
  | "reparent_poc_to_order"
  | "publish_verified_results",
  Readonly<Record<string, unknown>>
>;

export interface PocWorkflowState {
  pocId: string;
  accountId: string;
  organizationId: string;
  version: number;
  status:
    "proposed" | "approved" | "active" | "expired" | "converted" | "closed";
  qualificationApproved: boolean;
  kickoffAt: string;
  midpointAt: string;
  finalReportAt: string;
  expiresAt: string;
  supportOwnerId: string;
  recipients: readonly string[];
}

function pocIdentity(
  pocId: string,
  version: number,
  operation = "poc-lifecycle",
): WorkflowIdentity {
  return {
    aggregateType: "poc",
    aggregateId: pocId,
    aggregateVersion: version,
    operation,
  };
}

function due(now: number, at: string): boolean {
  const value = Date.parse(at);
  if (!Number.isFinite(value)) throw new Error("POC_SCHEDULE_INVALID");
  return now >= value;
}

export function addBusinessDays(instant: string, businessDays: number): string {
  if (!Number.isInteger(businessDays) || businessDays < 0)
    throw new Error("BUSINESS_DAYS_INVALID");
  const result = new Date(instant);
  if (!Number.isFinite(result.getTime())) throw new Error("INSTANT_INVALID");
  let remaining = businessDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result.toISOString();
}

export function waitForPocQualification(input: {
  pocId: string;
  version: number;
  expiresAt: string;
}): { effect: PocEffect; wait: DurableHumanWait } {
  const identity = pocIdentity(input.pocId, input.version, "poc-qualification");
  return {
    effect: workflowEffect(identity, "queue", "open_poc_qualification", {
      pocId: input.pocId,
    }),
    wait: durableHumanWait({
      identity,
      discriminator: "decision",
      subjectType: "poc",
      subjectId: input.pocId,
      resumeEvents: [
        "poc.qualification-approved",
        "poc.qualification-rejected",
      ],
      expiresAt: input.expiresAt,
    }),
  };
}

export function planPocSchedule(input: {
  poc: PocWorkflowState;
  now: string;
  proposalLeadDays: number;
}): readonly PocEffect[] {
  if (!input.poc.qualificationApproved || input.poc.status !== "active")
    return [];
  if (!Number.isInteger(input.proposalLeadDays) || input.proposalLeadDays < 1)
    throw new Error("POC_PROPOSAL_LEAD_INVALID");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("NOW_INVALID");
  const identity = pocIdentity(input.poc.pocId, input.poc.version);
  const milestone = (
    name: "kickoff" | "midpoint" | "final_report",
    at: string,
  ): PocEffect =>
    workflowEffect(identity, `milestone:${name}`, "notify_poc_milestone", {
      pocId: input.poc.pocId,
      accountId: input.poc.accountId,
      milestone: name,
      scheduledAt: at,
      supportOwnerId: input.poc.supportOwnerId,
      recipients: [...new Set(input.poc.recipients)].sort(),
    });
  const effects: PocEffect[] = [];
  if (due(now, input.poc.kickoffAt))
    effects.push(milestone("kickoff", input.poc.kickoffAt));
  if (due(now, input.poc.midpointAt))
    effects.push(milestone("midpoint", input.poc.midpointAt));
  if (due(now, input.poc.finalReportAt))
    effects.push(milestone("final_report", input.poc.finalReportAt));
  const proposalAt =
    Date.parse(input.poc.expiresAt) - input.proposalLeadDays * 86_400_000;
  if (now >= proposalAt)
    effects.push(
      workflowEffect(identity, "proposal", "generate_poc_proposal", {
        pocId: input.poc.pocId,
        accountId: input.poc.accountId,
        organizationId: input.poc.organizationId,
        expiresAt: input.poc.expiresAt,
      }),
    );
  if (due(now, input.poc.expiresAt))
    effects.push(
      workflowEffect(identity, "expiry", "expire_poc", {
        pocId: input.poc.pocId,
        organizationId: input.poc.organizationId,
        preserveData: true,
      }),
    );
  return effects;
}

export function planPocConversion(input: {
  poc: PocWorkflowState;
  paidOrderId: string;
  paidOrganizationId: string;
  proposalQuoteId: string;
  convertedAt: string;
}): readonly PocEffect[] {
  if (!input.poc.qualificationApproved)
    throw new Error("POC_QUALIFICATION_REQUIRED");
  if (!["active", "expired"].includes(input.poc.status))
    throw new Error("POC_NOT_CONVERTIBLE");
  if (input.paidOrganizationId !== input.poc.organizationId)
    throw new Error("POC_CONVERSION_MUST_PRESERVE_ORGANIZATION");
  const identity = pocIdentity(
    input.poc.pocId,
    input.poc.version,
    "poc-conversion",
  );
  return [
    workflowEffect(
      identity,
      "upgrade-entitlements",
      "upgrade_poc_entitlements",
      {
        pocId: input.poc.pocId,
        orderId: input.paidOrderId,
        organizationId: input.poc.organizationId,
        liftCaps: true,
        preserveTenantAndData: true,
      },
    ),
    workflowEffect(identity, "reparent", "reparent_poc_to_order", {
      pocId: input.poc.pocId,
      orderId: input.paidOrderId,
      quoteId: input.proposalQuoteId,
      organizationId: input.poc.organizationId,
      convertedAt: input.convertedAt,
    }),
    workflowEffect(
      identity,
      "proof-publication",
      "publish_verified_results",
      { pocId: input.poc.pocId, onlyVerifiedResults: true },
      addBusinessDays(input.convertedAt, 5),
    ),
  ];
}
