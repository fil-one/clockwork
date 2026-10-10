import { defineStaffMessages, sameInAllLanguages } from "../define";

/**
 * Approvals, agreement templates, external gates, assisted mode,
 * capabilities, provider references and channel policy administration.
 * Owned by the adminGovernance lane. Staff-only, so English only.
 */
export const adminGovernanceMessages = defineStaffMessages({
  // ── Shared across the administration pages ─────────────────────────────
  "adminGovernance.readOnly": { en: "Read only" },
  "adminGovernance.upToDate": { en: "Up to date" },
  "adminGovernance.decisionReason": { en: "Decision reason" },
  "adminGovernance.technicalEvidence": { en: "Technical evidence" },
  "adminGovernance.selector.hint": {
    en: "Search by name or operational reference. The technical ID is submitted securely.",
  },
  "adminGovernance.review.summaryTitle": { en: "Decision review summary" },
  "adminGovernance.review.entity": { en: "Affected record" },
  "adminGovernance.review.impact": { en: "Impact" },
  "adminGovernance.review.evidence": { en: "Evidence" },
  "adminGovernance.review.policy": { en: "Policy basis" },
  "adminGovernance.review.downstream": { en: "Downstream effect" },
  "adminGovernance.review.reason": { en: "Reason" },

  // ── Identifier labels in technical evidence ─────────────────────────────
  "adminGovernance.identifier.exceptionCase": { en: "Exception case ID" },
  "adminGovernance.identifier.approvalCase": { en: "Approval case ID" },
  "adminGovernance.identifier.quote": { en: "Quote ID" },
  "adminGovernance.identifier.evidenceDocument": { en: "Evidence document ID" },
  "adminGovernance.identifier.agreement": { en: "Agreement ID" },
  "adminGovernance.identifier.canonicalDocument": {
    en: "Canonical document ID",
  },
  "adminGovernance.identifier.termination": { en: "Termination ID" },
  "adminGovernance.identifier.retentionEvidenceHash": {
    en: "Retention evidence hash",
  },
  "adminGovernance.identifier.template": { en: "Template ID" },
  "adminGovernance.identifier.textHash": { en: "Exact text hash" },
  "adminGovernance.identifier.effectiveAccount": { en: "Target account ID" },
  "adminGovernance.identifier.gateKey": { en: "Gate key" },
  "adminGovernance.identifier.activationEvidence": {
    en: "Activation evidence",
  },
  "adminGovernance.jurisdiction.us": { en: "United States" },
  "adminGovernance.jurisdiction.eu": { en: "European Union" },
  "adminGovernance.jurisdiction.uk": { en: "United Kingdom" },

  // ── Approvals (/internal/approvals and the approval workspace) ──────────
  "adminGovernance.approvals.page.title": { en: "Approval decisions" },
  "adminGovernance.approvals.page.description": {
    en: "Approve or reject exceptions against the latest case evidence.",
  },
  "adminGovernance.approvals.eyebrow": {
    en: "Internal operations · Approvals",
  },
  "adminGovernance.approvals.title": { en: "Approval review" },
  "adminGovernance.approvals.description": {
    en: "Review the affected record, evidence, policy basis and downstream effect before you record a decision and its reason.",
  },
  "adminGovernance.approvals.casesHeading": { en: "Cases to decide" },
  "adminGovernance.approvals.casesCount": {
    count: "count",
    en: {
      one: "{count} case shows how authority is segregated.",
      other: "{count} cases show how authority is segregated.",
    },
  },
  "adminGovernance.approvals.case.priceException": {
    en: "{percent} below floor · {amount} annual value",
  },
  "adminGovernance.approvals.ownerIs": { en: "Owner: {owner}" },
  "adminGovernance.approvals.kind.approval": { en: "Approval" },
  "adminGovernance.approvals.kind.rejection": { en: "Rejection" },
  "adminGovernance.approvals.kind.offboarding": { en: "Offboarding" },
  "adminGovernance.approvals.kind.destructive": { en: "Destructive action" },
  "adminGovernance.approvals.kindReview.approval": { en: "Approval review" },
  "adminGovernance.approvals.kindReview.rejection": { en: "Rejection review" },
  "adminGovernance.approvals.kindReview.offboarding": {
    en: "Offboarding review",
  },
  "adminGovernance.approvals.kindReview.destructive": {
    en: "Destructive-action review",
  },
  "adminGovernance.approvals.authorizedRole": { en: "Authorized role" },
  "adminGovernance.approvals.actorFallback": {
    en: "Authenticated staff member",
  },
  "adminGovernance.approvals.rejectImpact": {
    en: "Rejects the requested operation.",
  },
  "adminGovernance.approvals.rejectDownstream": {
    en: "The request remains blocked and returns to its owner with the recorded reason.",
  },
  "adminGovernance.approvals.affectedCase": { en: "Affected case" },
  "adminGovernance.approvals.requestedBy": { en: "Requested by" },
  "adminGovernance.approvals.authenticatedActor": { en: "Signed in as" },
  "adminGovernance.approvals.policyGates": { en: "Policy gates" },
  "adminGovernance.approvals.authority": { en: "Authority" },
  "adminGovernance.approvals.authorityDetail": {
    en: "Server session role, requester separation, recent authentication, and dual control are rechecked when the decision is submitted.",
  },
  "adminGovernance.approvals.decision": { en: "Decision" },
  "adminGovernance.approvals.approve": { en: "Approve" },
  "adminGovernance.approvals.reject": { en: "Reject" },
  "adminGovernance.approvals.reasonPlaceholder": {
    en: "State the evidence and policy rationale for this decision.",
  },
  "adminGovernance.approvals.reasonHint": {
    en: "Required for approvals and rejections; kept with your name.",
  },
  "adminGovernance.approvals.roleCannotDecide": {
    en: "This role cannot decide this case.",
  },
  "adminGovernance.approvals.roleCannotDecideDetail": {
    en: "You may inspect evidence, but the matching finance, legal, or destructive-action authority must record the decision.",
  },
  "adminGovernance.approvals.reviewApprove": { en: "Review approval" },
  "adminGovernance.approvals.reviewReject": { en: "Review rejection" },
  "adminGovernance.approvals.summaryApprove": { en: "Approval review summary" },
  "adminGovernance.approvals.summaryReject": { en: "Rejection review summary" },
  "adminGovernance.approvals.noDecisionRecorded": {
    en: "No decision recorded",
  },
  "adminGovernance.approvals.handoff": {
    en: "Submit the decision in the approval workflow, where your authority, the separation from the requester, the evidence, retention and policy are checked again.",
  },

  // ── Agreement templates (/internal/agreements) ──────────────────────────
  "adminGovernance.agreements.eyebrow": {
    en: "Administration · Legal controls",
  },
  "adminGovernance.agreements.title": { en: "Agreement templates" },
  "adminGovernance.agreements.description": {
    en: "Review canonical template versions, approval evidence, jurisdiction and execution mode. Nothing on this page changes agreement rules.",
  },
  "adminGovernance.agreements.scanHeading": { en: "Version scan" },
  "adminGovernance.agreements.scanMeta": {
    en: "Canonical records only · Updated {time}",
  },
  "adminGovernance.agreements.filtersLabel": {
    en: "Agreement version filters",
  },
  "adminGovernance.agreements.search": { en: "Search templates" },
  "adminGovernance.agreements.searchPlaceholder": {
    en: "Name, version, jurisdiction or scan result",
  },
  "adminGovernance.agreements.jurisdiction": { en: "Jurisdiction" },
  "adminGovernance.agreements.resultCount": {
    count: "count",
    en: {
      one: "{shown} of {count} version",
      other: "{shown} of {count} versions",
    },
  },
  "adminGovernance.agreements.sortedByEffective": {
    en: "Sorted by effective date, newest first",
  },
  "adminGovernance.agreements.tableCaption": {
    en: "Agreement template versions and approval scan results",
  },
  "adminGovernance.agreements.column.template": { en: "Template" },
  "adminGovernance.agreements.version": { en: "Version" },
  "adminGovernance.agreements.execution": { en: "Execution" },
  "adminGovernance.agreements.effective": { en: "Effective" },
  "adminGovernance.agreements.column.scan": { en: "Scan" },
  "adminGovernance.agreements.execution.clickThrough": { en: "Click-through" },
  "adminGovernance.agreements.execution.attached": { en: "Attached" },
  "adminGovernance.agreements.execution.counterSigned": {
    en: "Counter-signed",
  },
  "adminGovernance.agreements.state.active": { en: "In force" },
  "adminGovernance.agreements.state.approved": { en: "Approved" },
  "adminGovernance.agreements.state.retired": { en: "Retired" },
  "adminGovernance.agreements.scan.hashMatch": {
    en: "Canonical text and approval hash match",
  },
  "adminGovernance.agreements.scan.evidenceRequired": {
    en: "Counsel note and approval evidence required",
  },
  "adminGovernance.agreements.scan.futureActivation": {
    en: "Activation date is in the future",
  },
  "adminGovernance.agreements.exactTextRetained": {
    en: "Exact-text evidence retained",
  },
  "adminGovernance.agreements.noMatches": {
    en: "No agreement versions match these filters.",
  },
  "adminGovernance.agreements.reviewHeading": { en: "Legal activation review" },
  "adminGovernance.agreements.reviewIntro": {
    en: "Publication preserves the version, exact text, approval evidence and prior executions.",
  },
  "adminGovernance.agreements.legalAuthority": { en: "Legal authority" },
  "adminGovernance.agreements.review.impact": {
    en: "Makes this immutable, counsel-approved template eligible for activation on its effective date.",
  },
  "adminGovernance.agreements.review.textHash": {
    en: "Exact approved text hash: {hash}",
  },
  "adminGovernance.agreements.review.executionMode": {
    en: "Execution mode: {mode}",
  },
  "adminGovernance.agreements.review.policy": {
    en: "Agreement policy AG-2 requires counsel authority, semantic versioning, exact-text hashing and canonical-document evidence.",
  },
  "adminGovernance.agreements.review.downstream": {
    en: "New eligible executions resolve to this version. Existing signed agreements and domain rules are unchanged.",
  },
  "adminGovernance.agreements.templateSelector": { en: "Agreement template" },
  "adminGovernance.agreements.approvalScan": { en: "Approval scan" },
  "adminGovernance.agreements.counselReason": { en: "Counsel decision reason" },
  "adminGovernance.agreements.counselReasonPlaceholder": {
    en: "Explain why this exact version is approved for publication.",
  },
  "adminGovernance.agreements.demoReadOnly": {
    en: "Template evidence is read only in this demo.",
  },
  "adminGovernance.agreements.demoReadOnlyDetail": {
    en: "Publication needs counsel-approved canonical text and approval evidence from the production agreement registry.",
  },
  "adminGovernance.agreements.legalAuthorityRequired": {
    en: "Legal approval authority is required.",
  },
  "adminGovernance.agreements.legalAuthorityRequiredDetail": {
    en: "Other internal roles may scan versions and evidence but cannot approve or activate a template.",
  },
  "adminGovernance.agreements.reviewAction": { en: "Review template approval" },
  "adminGovernance.agreements.summaryTitle": {
    en: "Agreement publication review",
  },
  "adminGovernance.agreements.notPublished": { en: "Not published" },
  "adminGovernance.agreements.handoff": {
    en: "Publish through the template workflow. Counsel authority, exact text hash, approval evidence, and effective date are verified there.",
  },
  "adminGovernance.agreements.registry.eyebrow": { en: "Legal administration" },
  "adminGovernance.agreements.registry.description": {
    en: "Canonical versions, exact text hashes, effective dates and approval attribution from the agreement registry.",
  },
  "adminGovernance.agreements.registry.heading": {
    en: "Published and draft versions",
  },
  "adminGovernance.agreements.registry.unavailable": {
    en: "Agreement registry unavailable. Connect the service database to inspect canonical templates.",
  },
  "adminGovernance.agreements.registry.truncated": {
    count: "count",
    en: {
      one: "Showing the most recent template. Older versions remain in the registry.",
      other:
        "Showing the {count} most recent templates. Older versions remain in the registry.",
    },
  },
  "adminGovernance.agreements.registry.caption": {
    en: "Canonical agreement templates",
  },
  "adminGovernance.agreements.registry.evidenceSummary": {
    en: "Exact version evidence",
  },
  "adminGovernance.agreements.registry.templateId": { en: "Template: {id}" },
  "adminGovernance.agreements.registry.documentId": { en: "Document: {id}" },
  "adminGovernance.agreements.registry.textHash": { en: "Text hash: {hash}" },
  "adminGovernance.agreements.registry.approvedBy": {
    en: "Approved by: {approver}",
  },
  "adminGovernance.agreements.registry.notApproved": { en: "Not approved" },
  "adminGovernance.agreements.registry.empty": {
    en: "No canonical agreement templates have been published.",
  },

  // ── External gates (/internal/gates) ────────────────────────────────────
  "adminGovernance.gates.eyebrow": { en: "Administration · Activation" },
  "adminGovernance.gates.title": { en: "External gates" },
  "adminGovernance.gates.description": {
    en: "Operational readiness grouped by provider, legal, brand and operations, with owners and activation evidence.",
  },
  "adminGovernance.gates.source.system": { en: "System gate registry" },
  "adminGovernance.gates.source.demo": { en: "Demonstration gate registry" },
  "adminGovernance.gates.source.fallback": {
    en: "Fallback register, every gate closed",
  },
  "adminGovernance.gates.failClosedNotice": {
    en: "Activation is denied by default. A configured “active” state is not enough without a current passing test, evidence, an owner and a review date.",
  },
  "adminGovernance.gates.readOnlyTitle": { en: "Read-only gate register." },
  "adminGovernance.gates.readOnlyDetail": {
    en: "Only an internal operator with recent authentication may update a gate or run an activation test.",
  },
  "adminGovernance.gates.group.provider": { en: "Provider" },
  "adminGovernance.gates.group.legal": { en: "Legal" },
  "adminGovernance.gates.group.brand": { en: "Brand" },
  "adminGovernance.gates.group.operations": { en: "Operations" },
  "adminGovernance.gates.caption.provider": {
    en: "Provider gates for external activation",
  },
  "adminGovernance.gates.caption.legal": {
    en: "Legal gates for external activation",
  },
  "adminGovernance.gates.caption.brand": {
    en: "Brand gates for external activation",
  },
  "adminGovernance.gates.caption.operations": {
    en: "Operations gates for external activation",
  },
  "adminGovernance.gates.count": {
    count: "count",
    en: { one: "{count} gate", other: "{count} gates" },
  },
  "adminGovernance.gates.blockedCount": {
    count: "count",
    en: { one: "{count} blocked", other: "{count} blocked" },
  },
  "adminGovernance.gates.blockers": {
    count: "count",
    en: { one: "{count} blocker", other: "{count} blockers" },
  },
  "adminGovernance.gates.noBlockers": { en: "No blockers" },
  "adminGovernance.gates.column.gate": { en: "Gate" },
  "adminGovernance.gates.column.capability": { en: "Affected capability" },
  "adminGovernance.gates.column.activationTest": { en: "Activation test" },
  "adminGovernance.gates.column.severity": { en: "Severity" },
  "adminGovernance.gates.column.configuredEffective": {
    en: "Configured / effective",
  },
  "adminGovernance.gates.severity.launchBlocker": { en: "Launch blocker" },
  "adminGovernance.gates.severity.pathBlocker": { en: "Path blocker" },
  "adminGovernance.gates.status.notRequired": { en: "Not required" },
  "adminGovernance.gates.status.unknown": { en: "Unknown" },
  "adminGovernance.gates.configured": { en: "Configured: {state}" },
  "adminGovernance.gates.effective": { en: "Effective: {state}" },
  "adminGovernance.gates.activationAllowed": { en: "Activation allowed" },
  "adminGovernance.gates.activationDenied": { en: "Activation denied" },
  "adminGovernance.gates.blockedReasons": { en: "Blockers: {reasons}" },
  "adminGovernance.gates.empty": {
    en: "No gates are registered in this group.",
  },
  "adminGovernance.gates.freshness.fallback": {
    en: "Fallback record: not read from the gate registry",
  },
  "adminGovernance.gates.test.never": { en: "Not run yet" },
  "adminGovernance.gates.test.passed": { en: "Passed" },
  "adminGovernance.gates.test.failed": { en: "Failed" },
  "adminGovernance.gates.blocked.ownerMissing": { en: "No owner" },
  "adminGovernance.gates.blocked.inputMissing": {
    en: "Required input missing",
  },
  "adminGovernance.gates.blocked.emergencyDisabled": {
    en: "Disabled in an emergency",
  },
  "adminGovernance.gates.blocked.simulatorNotReady": {
    en: "Simulator not ready",
  },
  "adminGovernance.gates.blocked.liveSignedInputMissing": {
    en: "No live signed input",
  },
  "adminGovernance.gates.blocked.activationTestNotPassed": {
    en: "Activation test not passed",
  },
  "adminGovernance.gates.blocked.activationTestTimeMissing": {
    en: "Activation test time missing",
  },
  "adminGovernance.gates.blocked.activationTestExpired": {
    en: "Activation test expired",
  },
  "adminGovernance.gates.blocked.activationTesterMissing": {
    en: "Tester not recorded",
  },
  "adminGovernance.gates.blocked.activationEvidenceMissing": {
    en: "Activation evidence missing",
  },
  "adminGovernance.gates.blocked.reviewMissingOrExpired": {
    en: "Review date missing or past",
  },
  "adminGovernance.gates.blocked.activationTestMissing": {
    en: "No activation test",
  },
  "adminGovernance.gates.blocked.evidenceMissing": { en: "Evidence missing" },
  "adminGovernance.gates.blocked.registryUnavailable": {
    en: "Registry unavailable",
  },
  "adminGovernance.gates.unavailable.title": {
    en: "External-gate registry unavailable",
  },
  "adminGovernance.gates.unavailable.owner": { en: "Platform operations" },
  "adminGovernance.gates.unavailable.capability": {
    en: "All externally gated capabilities",
  },
  "adminGovernance.gates.unavailable.activationTest": {
    en: "Not available; activation is denied",
  },
  "adminGovernance.gates.unavailable.freshness": {
    en: "No registry read is available for this request",
  },
  "adminGovernance.gates.unavailable.reason": {
    en: "The persistent gate registry could not be read. No gate is active.",
  },
  "adminGovernance.gates.controls.summary": { en: "Update or test gate" },
  "adminGovernance.gates.controls.hint": {
    en: "Both operations require recent authentication. A configured “active” value never bypasses the server’s test, evidence, owner and review checks.",
  },
  "adminGovernance.gates.controls.inputRequired": {
    en: "Required activation input or evidence",
  },
  "adminGovernance.gates.controls.configuredState": { en: "Configured state" },
  "adminGovernance.gates.controls.activeStillChecked": {
    en: "Active (still policy checked)",
  },
  "adminGovernance.gates.controls.reviewDate": { en: "Review date" },
  "adminGovernance.gates.controls.save": { en: "Save configured state" },
  "adminGovernance.gates.controls.testing": { en: "Testing…" },
  "adminGovernance.gates.controls.runTest": {
    en: "Run server activation test",
  },
  "adminGovernance.gates.result.allowed": {
    en: "Server policy allows activation.",
  },
  "adminGovernance.gates.result.denied": {
    en: "Saved. Activation remains denied by server policy.",
  },
  "adminGovernance.gates.error.conflict": {
    en: "This gate changed on the server. Reload before retrying.",
  },
  "adminGovernance.gates.error.authority": {
    en: "Your authority or recent authentication could not be verified.",
  },
  "adminGovernance.gates.error.policyDenied": {
    en: "Activation policy denied this change. Configuration alone cannot activate a gate.",
  },
  "adminGovernance.gates.error.unavailable": {
    en: "The gate operation is unavailable. Nothing was changed.",
  },
  "adminGovernance.gates.versionUnavailable": {
    en: "This gate has no current version to update. Reload the register and try again.",
  },

  // ── Assisted mode (/internal/assisted) ──────────────────────────────────
  "adminGovernance.assisted.eyebrow": {
    en: "Internal operations · Assisted mode",
  },
  "adminGovernance.assisted.title": { en: "Assisted account action" },
  "adminGovernance.assisted.description": {
    en: "Act for an account you choose. Every action stays recorded under your name, and your permissions are still checked.",
  },
  "adminGovernance.assisted.authorityRequired": {
    en: "Assisted authority is required.",
  },
  "adminGovernance.assisted.noAccountsDetail": {
    en: "This session cannot load or select customer accounts for assisted action.",
  },
  "adminGovernance.assisted.sessionActive": {
    en: "An assisted session is already active.",
  },
  "adminGovernance.assisted.sessionActiveDetail": {
    en: "The target account stays locked to {account}. Use the active-session banner to exit before you start a different assisted session.",
  },
  "adminGovernance.assisted.demo.heading": {
    en: "How acting for an account works",
  },
  "adminGovernance.assisted.demo.intro": {
    en: "How the live workflow keeps you and the account you act for separate.",
  },
  "adminGovernance.assisted.demo.accountExample": { en: "Example account" },
  "adminGovernance.assisted.authenticatedActor": {
    en: "Signed-in staff member",
  },
  "adminGovernance.assisted.demo.sessionRequirement": { en: "What it needs" },
  "adminGovernance.assisted.demo.sessionRequirementDetail": {
    en: "Live sign-in and the production database",
  },
  "adminGovernance.assisted.demo.auditBoundary": { en: "What is recorded" },
  "adminGovernance.assisted.demo.auditBoundaryDetail": {
    en: "Who acted, for which account, why and until when, none of which can be changed",
  },
  "adminGovernance.assisted.demo.noSession": {
    en: "No assisted session is created in this demo.",
  },
  "adminGovernance.assisted.demo.noSessionDetail": {
    en: "Acting for an account is not available here. It needs a live sign-in that can open a time-limited session.",
  },
  "adminGovernance.assisted.actorFixed": { en: "You stay the person acting." },
  "adminGovernance.assisted.actorFixedDetail": {
    en: "The account you choose limits which customer records you see. Your name, role and permissions come from your sign-in and cannot be changed here.",
  },
  "adminGovernance.assisted.actionHeading": {
    en: "Assisted commercial action",
  },
  "adminGovernance.assisted.actionIntro": {
    en: "You must review the action before you can submit it.",
  },
  "adminGovernance.assisted.mayAct": { en: "Can act for accounts" },
  "adminGovernance.assisted.review.entity": {
    en: "{account} · target account",
  },
  "adminGovernance.assisted.review.actor": {
    en: "Signed-in staff member: {actor}",
  },
  "adminGovernance.assisted.review.reasonCaptured": {
    en: "Assisted-mode reason captured",
  },
  "adminGovernance.assisted.review.gatesShown": {
    en: "Screening, credit, provider and role gates shown for review",
  },
  "adminGovernance.assisted.effectiveAccount": { en: "Target account" },
  "adminGovernance.assisted.actionLabel": { en: "Assisted action" },
  "adminGovernance.assisted.reason": { en: "Assisted-mode reason" },
  "adminGovernance.assisted.reasonPlaceholder": {
    en: "State who asked for help and why staff access is needed.",
  },
  "adminGovernance.assisted.reasonHint": {
    en: "Required. Kept with the action under your name.",
  },
  "adminGovernance.assisted.staffActor": { en: "Staff member" },
  "adminGovernance.assisted.commercialGates": { en: "Commercial gates" },
  "adminGovernance.assisted.commercialGatesDetail": {
    en: "Pricing floors · finance approval · credit status · screening status",
  },
  "adminGovernance.assisted.operationalGates": { en: "Operational gates" },
  "adminGovernance.assisted.operationalGatesDetail": {
    en: "Provider readiness · retention · dual control · your name on every action",
  },
  "adminGovernance.assisted.roleCannotActDetail": {
    en: "This role may inspect the review model but cannot act for a target account.",
  },
  "adminGovernance.assisted.reviewAction": { en: "Review assisted action" },
  "adminGovernance.assisted.summaryTitle": { en: "Assisted action review" },
  "adminGovernance.assisted.handoff.reviewComplete": {
    en: "Assisted review complete",
  },
  "adminGovernance.assisted.handoff.notSubmitted": {
    en: "Assisted action not submitted",
  },
  "adminGovernance.assisted.handoff.blocked": {
    en: "Assisted action remains blocked",
  },
  "adminGovernance.assisted.handoff.demoDetail": {
    en: "The guided demo opens no session for an account. Staff can act for a customer only with a live sign-in and the production database.",
  },
  "adminGovernance.assisted.handoff.startDetail": {
    en: "Start a time-limited session. Each action stays under your name, and account, role, commercial, screening, credit, retention and provider checks run before every change.",
  },
  "adminGovernance.assisted.startSession": {
    en: "Start 15-minute assisted session",
  },
  "adminGovernance.assisted.action.quoteAdjustment.label": {
    en: "Prepare a quote adjustment",
  },
  "adminGovernance.assisted.action.quoteAdjustment.impact": {
    en: "Stages a commercial adjustment for the target account.",
  },
  "adminGovernance.assisted.action.quoteAdjustment.policy": {
    en: "Assisted action policy AS-3 and commercial approval policy CP-4.",
  },
  "adminGovernance.assisted.action.quoteAdjustment.downstream": {
    en: "Creates a reviewed draft only. Pricing floors and finance approval remain enforced on the server.",
  },
  "adminGovernance.assisted.action.invoiceDispute.label": {
    en: "Review invoice dispute",
  },
  "adminGovernance.assisted.action.invoiceDispute.impact": {
    en: "Stages an invoice-dispute note for finance review.",
  },
  "adminGovernance.assisted.action.invoiceDispute.policy": {
    en: "Assisted action policy AS-3 and collections policy CL-5.",
  },
  "adminGovernance.assisted.action.invoiceDispute.downstream": {
    en: "No credit, refund or invoice change happens until finance authority validates the request.",
  },
  "adminGovernance.assisted.action.offboarding.label": {
    en: "Request controlled offboarding",
  },
  "adminGovernance.assisted.action.offboarding.impact": {
    en: "Stages an offboarding request for the target account that respects retention.",
  },
  "adminGovernance.assisted.action.offboarding.policy": {
    en: "Assisted action policy AS-3 and retention and teardown policy RT-9.",
  },
  "adminGovernance.assisted.action.offboarding.downstream": {
    en: "Starts no teardown. Retrieval, credit, retention, recent-authentication and dual-control gates remain required.",
  },

  // ── Capabilities (/internal/capabilities) ───────────────────────────────
  "adminGovernance.capabilities.title": { en: "Capabilities" },
  "adminGovernance.capabilities.eyebrow": { en: "Production controls" },
  "adminGovernance.capabilities.description": {
    en: "Request activation with a distinct approver, or stop new work immediately. Recovery work has its own switch.",
  },
  "adminGovernance.capabilities.guidance": {
    en: "Activation requires current evidence and a different approver within 24 hours. External gates are enforced independently on every execution.",
  },
  "adminGovernance.capabilities.reviewGates": {
    en: "Review external gates and provider tests",
  },
  "adminGovernance.capabilities.unavailable": {
    en: "Capability registry unavailable",
  },
  "adminGovernance.capabilities.unavailableDetail": {
    en: "Connect the production control database and sign in with your staff identity to view or change stored capabilities. No activation is implied.",
  },
  "adminGovernance.capabilities.none": {
    en: "No capabilities are configured. All work remains disabled until the production bootstrap is complete.",
  },
  "adminGovernance.capabilities.key.newBusiness": { en: "New business" },
  "adminGovernance.capabilities.key.legal": { en: "Legal" },
  "adminGovernance.capabilities.key.billing": { en: "Billing" },
  "adminGovernance.capabilities.key.partner": { en: "Partners" },
  "adminGovernance.capabilities.key.marketplace": { en: "Marketplace" },
  "adminGovernance.capabilities.key.teardown": { en: "Teardown" },
  "adminGovernance.capabilities.versionChangedBy": {
    en: "Version {version} · Changed by {actor}",
  },
  "adminGovernance.capabilities.newWorkEnabled": { en: "New work enabled" },
  "adminGovernance.capabilities.newWorkDisabled": { en: "New work disabled" },
  "adminGovernance.capabilities.recoveryEnabled": {
    en: "Recovery work: enabled",
  },
  "adminGovernance.capabilities.recoveryDisabled": {
    en: "Recovery work: disabled",
  },
  "adminGovernance.capabilities.activationAuthority": {
    en: "Activation authority: {role}",
  },
  "adminGovernance.capabilities.pendingRecovery": {
    en: "Pending recovery activation",
  },
  "adminGovernance.capabilities.pendingNewWork": {
    en: "Pending new-work activation",
  },
  "adminGovernance.capabilities.requestedBy": {
    en: "Requested by {actor} · {time}",
  },
  "adminGovernance.capabilities.evidence": { en: "Evidence: {reference}" },
  "adminGovernance.capabilities.controlScope": { en: "Control scope" },
  "adminGovernance.capabilities.scope.newWork": { en: "New work" },
  "adminGovernance.capabilities.scope.recoveryWork": { en: "Recovery work" },
  "adminGovernance.capabilities.reasonPlaceholder": {
    en: "Explain the operational reason and evidence for this change.",
  },
  "adminGovernance.capabilities.evidenceReference": {
    en: "Activation evidence reference",
  },
  "adminGovernance.capabilities.evidenceReferencePlaceholder": {
    en: "Approved launch or recovery evidence reference",
  },
  "adminGovernance.capabilities.requestActivation": {
    en: "Request activation",
  },
  "adminGovernance.capabilities.approveActivation": {
    en: "Approve activation",
  },
  "adminGovernance.capabilities.rejectRequest": { en: "Reject request" },
  "adminGovernance.capabilities.disableNow": { en: "Disable immediately" },
  "adminGovernance.capabilities.result.directSessionRequired": {
    en: "Capability changes require a directly authenticated staff session with MFA.",
  },
  "adminGovernance.capabilities.result.invalid": {
    en: "Check the decision reason, evidence and current version, then try again.",
  },
  "adminGovernance.capabilities.result.selectPending": {
    en: "Select a pending activation request.",
  },
  "adminGovernance.capabilities.result.proposed": {
    en: "Activation requested. A distinct approver must review it within 24 hours.",
  },
  "adminGovernance.capabilities.result.disabled": {
    en: "Capability disabled. Earlier pending activation requests were canceled.",
  },
  "adminGovernance.capabilities.result.decided": { en: "Decision recorded." },
  "adminGovernance.capabilities.error.authority": {
    en: "Your current staff role cannot perform this action.",
  },
  "adminGovernance.capabilities.error.distinctApprover": {
    en: "A different authorized staff member must approve this request.",
  },
  "adminGovernance.capabilities.error.versionConflict": {
    en: "The capability changed. Refresh and review its latest state before trying again.",
  },
  "adminGovernance.capabilities.error.expired": {
    en: "This request expired. Reject it and request activation again with current evidence.",
  },
  "adminGovernance.capabilities.error.pending": {
    en: "An activation request is already awaiting review.",
  },
  "adminGovernance.capabilities.error.notPending": {
    en: "This request has already been decided or canceled. Refresh to see the latest state.",
  },
  "adminGovernance.capabilities.error.alreadyEnabled": {
    en: "This capability is already enabled.",
  },
  "adminGovernance.capabilities.error.reasonRequired": {
    en: "Provide a decision reason of at least eight characters.",
  },
  "adminGovernance.capabilities.error.generic": {
    en: "The change could not be recorded. Check the evidence reference and refresh before retrying.",
  },

  // ── Channel policy (/internal/channel-policy) ───────────────────────────
  "adminGovernance.channelPolicy.eyebrow": { en: "Commercial controls" },
  "adminGovernance.channelPolicy.title": { en: "Channel policy" },
  "adminGovernance.channelPolicy.description": {
    en: "Configure the sales handoff and the protection requested for deal registrations. Policies need two finance users and apply only from their approved effective date.",
  },
  "adminGovernance.channelPolicy.priceBooksLink": { en: "Price books" },
  "adminGovernance.channelPolicy.demoNotice": {
    en: "Fictional policy workspace. Approval changes only this resettable demo. The seeded proposal has a different author so that two people review it; live commercial policy and provider gates are unaffected.",
  },
  "adminGovernance.channelPolicy.unavailable": {
    en: "Policy administration unavailable",
  },
  "adminGovernance.channelPolicy.unavailableDetail": {
    en: "Connect the control database and sign in with your finance identity. Demo personas cannot approve live policy.",
  },
  "adminGovernance.channelPolicy.currentControls": { en: "Current controls" },
  "adminGovernance.channelPolicy.approvedVersion": {
    en: "Approved v{version}",
  },
  "adminGovernance.channelPolicy.legacyDefaults": { en: "Legacy defaults" },
  "adminGovernance.channelPolicy.salesHandoff": { en: "Sales handoff" },
  "adminGovernance.channelPolicy.salesHandoffDetail": {
    en: "Capacity routed to the full quote flow",
  },
  "adminGovernance.channelPolicy.requestedProtection": {
    en: "Requested protection",
  },
  "adminGovernance.channelPolicy.requestedProtectionDetail": {
    en: "Default window for new registrations",
  },
  "adminGovernance.channelPolicy.fromApproved": {
    en: "These controls come from approved policy v{version}.",
  },
  "adminGovernance.channelPolicy.fromLegacy": {
    en: "Legacy UI defaults apply until an approved policy becomes effective.",
  },
  "adminGovernance.channelPolicy.scopeNote": {
    en: "Protection remains subject to the registration decision. Prices, term minimums and external sales gates are separate.",
  },
  "adminGovernance.channelPolicy.policyVersion": {
    en: "Policy version {version}",
  },
  "adminGovernance.channelPolicy.status.proposed": { en: "Proposed" },
  "adminGovernance.channelPolicy.status.approved": { en: "Approved" },
  "adminGovernance.channelPolicy.effectiveFrom": {
    en: "Effective {date} (UTC); supersedes earlier effective policies for new requests.",
  },
  "adminGovernance.channelPolicy.days": {
    count: "count",
    en: { one: "{count} day", other: "{count} days" },
  },
  "adminGovernance.channelPolicy.protectionTerms": {
    en: "{default} by default; maximum {maximum}",
  },
  "adminGovernance.channelPolicy.extensions": { en: "Extensions" },
  "adminGovernance.channelPolicy.noExtensions": { en: "No extensions" },
  "adminGovernance.channelPolicy.extensionTerms": {
    count: "count",
    en: {
      one: "Up to {count} extension of at most {duration}, with recorded progress",
      other:
        "Up to {count} extensions, each at most {duration}, with recorded progress",
    },
  },
  "adminGovernance.channelPolicy.source": { en: "Source" },
  "adminGovernance.channelPolicy.decisionNote": { en: "Decision" },
  "adminGovernance.channelPolicy.editDraft": { en: "Edit this draft" },
  "adminGovernance.channelPolicy.immutable": {
    en: "Approved content and existing registration snapshots are immutable. Publish a new version to change future requests.",
  },
  "adminGovernance.channelPolicy.form.editDraft": { en: "Edit draft controls" },
  "adminGovernance.channelPolicy.form.newDraft": { en: "Draft a new policy" },
  "adminGovernance.channelPolicy.form.saveDraft": { en: "Save draft" },
  "adminGovernance.channelPolicy.field.version": { en: "Policy version" },
  "adminGovernance.channelPolicy.field.handoffThreshold": {
    en: "Sales handoff at capacity (TB)",
  },
  "adminGovernance.channelPolicy.field.defaultProtection": {
    en: "Default requested protection (days)",
  },
  "adminGovernance.channelPolicy.field.maximumProtection": {
    en: "Maximum initial requested protection (days)",
  },
  "adminGovernance.channelPolicy.field.extensionDays": {
    en: "Maximum days per extension",
  },
  "adminGovernance.channelPolicy.field.maximumExtensions": {
    en: "Maximum extensions",
  },
  "adminGovernance.channelPolicy.field.effectiveDate": {
    en: "Effective date (UTC)",
  },
  "adminGovernance.channelPolicy.field.source": {
    en: "Policy source or evidence reference",
  },
  "adminGovernance.channelPolicy.decision.proposeLegend": {
    en: "Propose for approval",
  },
  "adminGovernance.channelPolicy.decision.approveLegend": {
    en: "Approve policy",
  },
  "adminGovernance.channelPolicy.decision.returnLegend": {
    en: "Return for changes",
  },
  "adminGovernance.channelPolicy.decision.evidence": {
    en: "Approval evidence reference",
  },
  "adminGovernance.channelPolicy.decision.recording": { en: "Recording…" },
  "adminGovernance.channelPolicy.decision.propose": { en: "Propose policy" },
  "adminGovernance.channelPolicy.decision.approve": { en: "Approve policy" },
  "adminGovernance.channelPolicy.decision.return": { en: "Return draft" },
  "adminGovernance.channelPolicy.decision.otherApprover": {
    en: "A different finance approver must decide this version.",
  },
  "adminGovernance.channelPolicy.result.financeSessionRequired": {
    en: "Use a directly authenticated finance session with current MFA to change policy.",
  },
  "adminGovernance.channelPolicy.result.invalid": {
    en: "Check the dates, whole-day limits, version and evidence. Default protection must fit the maximum window.",
  },
  "adminGovernance.channelPolicy.result.approved": {
    en: "Policy approved. New requests use it from its effective date; existing registrations keep their snapshot.",
  },
  "adminGovernance.channelPolicy.result.returned": {
    en: "Returned to draft with the decision reason.",
  },
  "adminGovernance.channelPolicy.result.proposed": {
    en: "Proposed for a different finance approver. Content is frozen during review.",
  },
  "adminGovernance.channelPolicy.result.saved": { en: "Draft saved." },
  "adminGovernance.channelPolicy.error.distinctApprover": {
    en: "A finance approver who neither created, edited nor proposed this version must decide it.",
  },
  "adminGovernance.channelPolicy.error.versionConflict": {
    en: "This version changed. Refresh before retrying.",
  },
  "adminGovernance.channelPolicy.error.backdated": {
    en: "The effective date is now in the past. Return the draft for a current or future date.",
  },
  "adminGovernance.channelPolicy.error.immutable": {
    en: "Approved policies are immutable. Create a new version.",
  },
  "adminGovernance.channelPolicy.error.financeRequired": {
    en: "Your finance role or MFA enrollment does not permit this action.",
  },
  "adminGovernance.channelPolicy.error.generic": {
    en: "The policy could not be saved. Refresh and check that its version and approved effective date are unique.",
  },

  // ── Provider operating references (/internal/providers) ─────────────────
  "adminGovernance.providers.title": { en: "Provider operating references" },
  "adminGovernance.providers.eyebrow": { en: "Commercial administration" },
  "adminGovernance.providers.description": {
    en: "Maintain owners, secret-manager references and rotation review dates for the providers Commerce uses.",
  },
  "adminGovernance.providers.guidance": {
    en: "Rotate credentials in your secret manager and deployment first, then record the evidence here. These records are operator attestations; they do not connect a provider or prove its credentials work. Review {gates} and {capabilities}.",
  },
  "adminGovernance.providers.guidance.gatesLink": {
    en: "integration qualification gates",
  },
  "adminGovernance.providers.guidance.capabilitiesLink": {
    en: "capability controls",
  },
  "adminGovernance.providers.registryUnavailable": {
    en: "Provider reference registry unavailable. Check the control database connection and your current authority, then refresh.",
  },
  "adminGovernance.providers.demoUnavailable": {
    en: "Live provider references are not connected in this demo. Reference administration requires a verified staff session and the control database.",
  },
  "adminGovernance.providers.covered": {
    en: "Providers covered: {providers}.",
  },
  "adminGovernance.providers.name.billing": { en: "Billing" },
  "adminGovernance.providers.name.accounting": { en: "Accounting" },
  "adminGovernance.providers.name.notifications": { en: "Notifications" },
  "adminGovernance.providers.name.usage": { en: "Usage metering" },
  "adminGovernance.providers.name.workos": { en: "Identity (WorkOS)" },
  "adminGovernance.providers.name.evidence": { en: "Evidence storage" },
  "adminGovernance.providers.name.provisioning": { en: "Storage provisioning" },
  "adminGovernance.providers.name.screening": { en: "Screening" },
  "adminGovernance.providers.name.signature": { en: "Signatures" },
  "adminGovernance.providers.name.tax": { en: "Tax" },
  "adminGovernance.providers.name.crm": sameInAllLanguages(
    "CRM",
    "product-category acronym, kept as written in every language",
  ),
  "adminGovernance.providers.name.documentRenderer": {
    en: "Document rendering",
  },
  "adminGovernance.providers.state.notConfigured": { en: "Not configured" },
  "adminGovernance.providers.state.bootstrap": {
    en: "Bootstrap reference · owner review needed",
  },
  "adminGovernance.providers.state.reviewOverdue": {
    en: "Rotation review overdue",
  },
  "adminGovernance.providers.state.retained": { en: "Reference retained" },
  "adminGovernance.providers.owner": { en: "Operating owner" },
  "adminGovernance.providers.secretReference": {
    en: "Secret-manager reference",
  },
  "adminGovernance.providers.secretVersion": { en: "Secret version" },
  "adminGovernance.providers.lastRotation": { en: "Last recorded rotation" },
  "adminGovernance.providers.reviewDue": { en: "Rotation review due" },
  "adminGovernance.providers.reviewDueValue": {
    count: "count",
    en: {
      one: "{date} (interval: {count} day)",
      other: "{date} (interval: {count} days)",
    },
  },
  "adminGovernance.providers.evidenceReference": { en: "Evidence reference" },
  "adminGovernance.providers.bootstrapNote": {
    en: "Imported from the immutable bootstrap manifest. The 90-day review interval is a suggested default until an owner saves the operating policy.",
  },
  "adminGovernance.providers.registryVersion": {
    en: "Registry version {version} · last updated {time}.",
  },
  "adminGovernance.providers.noReference": {
    en: "No credential reference is retained for this provider. Record a reference after its deployment and evidence are available.",
  },
  "adminGovernance.providers.form.update": { en: "Update operating reference" },
  "adminGovernance.providers.form.add": { en: "Add operating reference" },
  "adminGovernance.providers.form.pathOnly": {
    en: "Enter the path only. Never paste a token, password, private key or connection URL.",
  },
  "adminGovernance.providers.form.rotatedAt": {
    en: "Actual rotation timestamp (UTC)",
  },
  "adminGovernance.providers.form.reviewInterval": {
    en: "Rotation review interval (days)",
  },
  "adminGovernance.providers.form.reviewIntervalHint": {
    en: "This sets the review due date shown here. It does not rotate credentials or send a reminder.",
  },
  "adminGovernance.providers.form.rotationEvidence": {
    en: "Rotation evidence reference",
  },
  "adminGovernance.providers.form.reason": { en: "Reason for change" },
  "adminGovernance.providers.save": { en: "Save provider reference" },
  "adminGovernance.providers.result.directSessionRequired": {
    en: "Changes require a directly authenticated operator or finance approver with recent MFA.",
  },
  "adminGovernance.providers.result.invalid": {
    en: "Check all fields. Use a secret-manager reference, an ISO rotation timestamp in UTC, a review interval of 1–730 days and an evidence reference.",
  },
  "adminGovernance.providers.result.saved": {
    en: "Reference saved. Deployed credentials and provider qualification are unchanged.",
  },
  "adminGovernance.providers.result.conflict": {
    en: "This reference changed while you were editing. Refresh and review the latest version before saving again.",
  },
  "adminGovernance.providers.result.futureRotation": {
    en: "Rotation must already have occurred. Enter its actual timestamp, not a planned future date.",
  },
  "adminGovernance.providers.result.failed": {
    en: "The reference could not be saved. Refresh and check your current authority and evidence.",
  },
  "adminGovernance.channelPolicy.selfApprovalSubject": {
    en: "channel policy version {version}",
  },
});
