import type { MessageId } from "@/src/i18n";

import type {
  AgreementExecution,
  AgreementJurisdiction,
  AgreementVersionState,
  GateGroup,
  GateRecord,
  GateTestStatus,
} from "./data";

/**
 * Message IDs for the headings the administration and safety pages share.
 * Components render them with `t(...)`; nothing here is English text.
 */
export const adminSafetyCopy = {
  selectorHint: "adminGovernance.selector.hint",
  technicalEvidence: "adminGovernance.technicalEvidence",
  reviewSummary: "adminGovernance.review.summaryTitle",
  reviewLabels: {
    entity: "adminGovernance.review.entity",
    impact: "adminGovernance.review.impact",
    evidence: "adminGovernance.review.evidence",
    policy: "adminGovernance.review.policy",
    downstream: "adminGovernance.review.downstream",
    reason: "adminGovernance.review.reason",
  },
  approvals: {
    eyebrow: "adminGovernance.approvals.eyebrow",
    title: "adminGovernance.approvals.title",
    description: "adminGovernance.approvals.description",
  },
  agreements: {
    eyebrow: "adminGovernance.agreements.eyebrow",
    title: "adminGovernance.agreements.title",
    description: "adminGovernance.agreements.description",
  },
  gates: {
    eyebrow: "adminGovernance.gates.eyebrow",
    title: "adminGovernance.gates.title",
    description: "adminGovernance.gates.description",
  },
  gateVersionUnavailable: "adminGovernance.gates.versionUnavailable",
  assisted: {
    eyebrow: "adminGovernance.assisted.eyebrow",
    title: "adminGovernance.assisted.title",
    description: "adminGovernance.assisted.description",
  },
} as const satisfies Record<
  string,
  MessageId | Readonly<Record<string, MessageId>>
>;

/** The colour of a status chip. */
export type StatusTone = "success" | "warning" | "danger";

export const agreementJurisdictionLabels: Readonly<
  Record<AgreementJurisdiction, MessageId>
> = {
  us: "adminGovernance.jurisdiction.us",
  eu: "adminGovernance.jurisdiction.eu",
  uk: "adminGovernance.jurisdiction.uk",
};

export const agreementExecutionLabels: Readonly<
  Record<AgreementExecution, MessageId>
> = {
  click_through: "adminGovernance.agreements.execution.clickThrough",
  attached: "adminGovernance.agreements.execution.attached",
  counter_signed: "adminGovernance.agreements.execution.counterSigned",
};

/** Template-version states; the wording agrees with "version" or "template". */
export const agreementStateLabels: Readonly<
  Record<AgreementVersionState, MessageId>
> = {
  active: "adminGovernance.agreements.state.active",
  approved: "adminGovernance.agreements.state.approved",
  draft: "status.draft",
  retired: "adminGovernance.agreements.state.retired",
};

export const agreementStateTones: Readonly<
  Record<AgreementVersionState, StatusTone>
> = {
  active: "success",
  approved: "success",
  draft: "warning",
  retired: "danger",
};

export const gateGroupLabels: Readonly<Record<GateGroup, MessageId>> = {
  Provider: "adminGovernance.gates.group.provider",
  Legal: "adminGovernance.gates.group.legal",
  Brand: "adminGovernance.gates.group.brand",
  Operations: "adminGovernance.gates.group.operations",
};

export const gateGroupCaptions: Readonly<Record<GateGroup, MessageId>> = {
  Provider: "adminGovernance.gates.caption.provider",
  Legal: "adminGovernance.gates.caption.legal",
  Brand: "adminGovernance.gates.caption.brand",
  Operations: "adminGovernance.gates.caption.operations",
};

export const gateSeverityLabels: Readonly<
  Record<GateRecord["severity"], MessageId>
> = {
  "Launch blocker": "adminGovernance.gates.severity.launchBlocker",
  "Path blocker": "adminGovernance.gates.severity.pathBlocker",
  High: "risk.level.high",
  Medium: "risk.level.medium",
};

/** Severity colours: what blocks launch or is high risk reads as danger. */
export const gateSeverityTones: Readonly<
  Record<GateRecord["severity"], StatusTone>
> = {
  "Launch blocker": "danger",
  "Path blocker": "warning",
  High: "danger",
  Medium: "warning",
};

export const gateStateLabels: Readonly<Record<GateRecord["state"], MessageId>> =
  {
    Active: "status.active",
    Blocked: "status.blocked",
    Review: "status.inReview",
    Pending: "status.pending",
  };

export const gateStateTones: Readonly<Record<GateRecord["state"], StatusTone>> =
  {
    Active: "success",
    Blocked: "danger",
    Review: "warning",
    Pending: "warning",
  };

/** Configured and effective states as the gate registry stores them. */
export const gateStatusLabels: Readonly<Record<string, MessageId>> = {
  blocked: "status.blocked",
  review: "status.inReview",
  pending: "status.pending",
  active: "status.active",
  not_required: "adminGovernance.gates.status.notRequired",
};

export const gateTestStatusLabels: Readonly<Record<GateTestStatus, MessageId>> =
  {
    never: "adminGovernance.gates.test.never",
    passed: "adminGovernance.gates.test.passed",
    failed: "adminGovernance.gates.test.failed",
  };

/**
 * Why the registry denies activation. The domain's reason codes, plus the
 * fixture and loader codes; an unknown code is shown as the code itself.
 */
export const gateBlockedReasonLabels: Readonly<Record<string, MessageId>> = {
  owner_missing: "adminGovernance.gates.blocked.ownerMissing",
  input_missing: "adminGovernance.gates.blocked.inputMissing",
  emergency_disabled: "adminGovernance.gates.blocked.emergencyDisabled",
  simulator_not_ready: "adminGovernance.gates.blocked.simulatorNotReady",
  live_signed_input_missing:
    "adminGovernance.gates.blocked.liveSignedInputMissing",
  activation_test_not_passed:
    "adminGovernance.gates.blocked.activationTestNotPassed",
  activation_test_time_missing:
    "adminGovernance.gates.blocked.activationTestTimeMissing",
  activation_test_expired:
    "adminGovernance.gates.blocked.activationTestExpired",
  activation_tester_missing:
    "adminGovernance.gates.blocked.activationTesterMissing",
  activation_evidence_missing:
    "adminGovernance.gates.blocked.activationEvidenceMissing",
  review_missing_or_expired:
    "adminGovernance.gates.blocked.reviewMissingOrExpired",
  activation_test_missing:
    "adminGovernance.gates.blocked.activationTestMissing",
  evidence_missing: "adminGovernance.gates.blocked.evidenceMissing",
  registry_unavailable: "adminGovernance.gates.blocked.registryUnavailable",
};
