import { defineStaffMessages, sameInAllLanguages } from "../define";

/**
 * Finance operations messages (lifecycle, billing reconciliation, revenue,
 * collections and corrections). Owned by the operations lane's finance half;
 * new IDs use the `operations.finance.` prefix. Staff-only, so English only.
 */
export const operationsFinanceMessages = defineStaffMessages({
  // ---------------------------------------------------------------------------
  // Frame shared by every internal finance surface
  // ---------------------------------------------------------------------------
  "operations.finance.frame.eyebrow": { en: "Internal operations" },
  "operations.finance.frame.provenance": { en: "Data status" },
  "operations.finance.frame.current": { en: "Up to date" },
  "operations.finance.frame.stale": { en: "Needs refresh" },
  "operations.finance.frame.unreadable": { en: "Temporarily unavailable" },
  "operations.finance.frame.unreadable.detail": {
    en: "Refresh the page or try again shortly.",
  },
  "operations.finance.frame.unwired": { en: "Not available in this workspace" },
  "operations.finance.frame.unwired.detail": {
    en: "This workflow is not enabled in the current environment.",
  },
  "operations.finance.frame.guided": { en: "Guided demo workspace" },
  "operations.finance.frame.guided.detail": {
    en: "Changes can be reset from the demo controls.",
  },

  // ---------------------------------------------------------------------------
  // Record evidence disclosures
  // ---------------------------------------------------------------------------
  "operations.finance.evidence.technical": { en: "Technical evidence" },
  "operations.finance.evidence.record": { en: "Record evidence" },
  "operations.finance.evidence.entry": { en: "{label}: {value}" },
  "operations.finance.evidence.sourceRecord": {
    en: "Source record: version {version}, updated {time}",
  },
  "operations.finance.evidence.orderId": { en: "Order ID: {id}" },
  "operations.finance.evidence.documentId": { en: "Document ID: {id}" },
  "operations.finance.evidence.invoiceId": { en: "Invoice ID: {id}" },
  "operations.finance.evidence.billingAccount": { en: "Billing account: {id}" },
  "operations.finance.evidence.recordId": { en: "Record ID: {id}" },

  // ---------------------------------------------------------------------------
  // Sales route (orders.sourcing), kept distinct from channel
  // ---------------------------------------------------------------------------
  "operations.finance.column.route": { en: "Route" },
  "operations.finance.route.direct": { en: "Direct" },
  "operations.finance.route.referral": { en: "Referral" },
  "operations.finance.route.resale": { en: "Resale" },
  "operations.finance.route.distributor": { en: "Distributor" },
  "operations.finance.route.marketplace": { en: "Marketplace" },

  // ---------------------------------------------------------------------------
  // Renewals
  // ---------------------------------------------------------------------------
  "operations.finance.renewals.title": { en: "Renewal notice windows" },
  "operations.finance.renewals.description": {
    en: "Orders grouped by the time left before their contractual notice date.",
  },
  "operations.finance.renewals.summaryLabel": { en: "Orders by notice window" },
  "operations.finance.renewals.window.passed": { en: "Notice date passed" },
  "operations.finance.renewals.window.passed.description": {
    en: "The contractual notice date has passed. Any renewal decision is now late.",
  },
  "operations.finance.renewals.window.within30": {
    en: "Notice within 30 days",
  },
  "operations.finance.renewals.window.within30.description": {
    en: "Notice must be given within a month.",
  },
  "operations.finance.renewals.window.within90": { en: "Notice in 31–90 days" },
  "operations.finance.renewals.window.within90.description": {
    en: "Planning window. The route and owner should be settled here.",
  },
  "operations.finance.renewals.window.within180": {
    en: "Notice in 91–180 days",
  },
  "operations.finance.renewals.window.within180.description": {
    en: "Visible, but nothing to act on yet.",
  },
  "operations.finance.renewals.window.unscheduled": {
    en: "No notice date recorded",
  },
  "operations.finance.renewals.window.unscheduled.description": {
    en: "The order records no notice date, so no renewal deadline can be derived from it.",
  },
  "operations.finance.renewals.windowMeta": {
    count: "count",
    en: {
      one: "{count} order · sorted by notice date",
      other: "{count} orders · sorted by notice date",
    },
  },
  "operations.finance.renewals.caption": { en: "Orders: {window}" },
  "operations.finance.renewals.column.notice": { en: "Notice date" },
  "operations.finance.renewals.column.serviceTerm": { en: "Service term" },
  "operations.finance.renewals.column.invoiced": { en: "Invoiced to date" },
  "operations.finance.renewals.riskUnrecorded": { en: "Risk not recorded" },
  "operations.finance.renewals.routeUnrecorded": { en: "Route not recorded" },
  "operations.finance.renewals.termUnrecorded": {
    en: "Service term not recorded",
  },
  "operations.finance.renewals.noInvoices": {
    en: "No invoices recorded against this order",
  },
  "operations.finance.renewals.invoiceCount": {
    count: "count",
    en: {
      one: "Sum of {count} invoice, not a forecast",
      other: "Sum of {count} invoices, not a forecast",
    },
  },
  "operations.finance.renewals.empty": { en: "No orders fall in this window." },

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------
  "operations.finance.collections.title": { en: "Collections priority" },
  "operations.finance.collections.description": {
    en: "Open invoices ordered by exposure and age, with the corrections a finance approver may raise against them.",
  },
  "operations.finance.collections.summaryLabel": { en: "Collections summary" },
  "operations.finance.collections.openTotal": { en: "Open invoice total" },
  "operations.finance.collections.openCount": {
    count: "count",
    en: { one: "{count} open invoice", other: "{count} open invoices" },
  },
  "operations.finance.collections.overdueTotal": { en: "Past due" },
  "operations.finance.collections.overdueCount": {
    count: "count",
    en: { one: "{count} invoice past due", other: "{count} invoices past due" },
  },
  "operations.finance.collections.oldest": { en: "Oldest past due" },
  "operations.finance.collections.days": {
    count: "count",
    en: { one: "{count} day", other: "{count} days" },
  },
  "operations.finance.collections.priorityBody": {
    en: "Highest open amount first, then days past due, then invoice reference. Amounts in a second currency are ranked but never added into a total.",
  },
  "operations.finance.collections.mixedCurrency": {
    count: "count",
    en: {
      one: "{count} invoice in another currency is excluded from these totals.",
      other:
        "{count} invoices in another currency are excluded from these totals.",
    },
  },
  "operations.finance.collections.tableHeading": { en: "Open invoices" },
  "operations.finance.collections.tableSubheading": {
    en: "Amount, age, status and the corrections available on each invoice.",
  },
  "operations.finance.collections.tableMeta": {
    count: "count",
    en: {
      one: "{count} invoice, highest priority first",
      other: "{count} invoices, highest priority first",
    },
  },
  "operations.finance.collections.empty": {
    en: "No open invoices need collections attention.",
  },
  "operations.finance.collections.caption": {
    en: "Open invoices ordered by amount, then days past due",
  },
  "operations.finance.collections.column.priority": {
    en: "Priority / customer",
  },
  "operations.finance.column.customer": { en: "Customer" },
  "operations.finance.billedTo": { en: "Billed to {name}" },
  "operations.finance.collections.column.age": { en: "Age" },
  "operations.finance.collections.priorityRank": { en: "Priority {rank}" },
  "operations.finance.collections.paidOn": { en: "Paid {date}" },
  "operations.finance.collections.noDueDate": { en: "No due date recorded" },

  // ---------------------------------------------------------------------------
  // Money corrections: credit note, refund, dispute
  // ---------------------------------------------------------------------------
  "operations.finance.corrections.heading": { en: "Corrections" },
  "operations.finance.corrections.creditNote.trigger": {
    en: "Issue credit note",
  },
  "operations.finance.corrections.creditNote.confirm": {
    en: "Issue this credit note",
  },
  "operations.finance.corrections.creditNote.effect": {
    en: "A credit note is approved against this invoice and a Stripe credit-note operation is created for it. The invoice amount is reduced by the credit the provider confirms; nothing is refunded to a card.",
  },
  "operations.finance.corrections.creditNote.reversible": {
    en: "Only by voiding the credit note through the provider. This surface cannot void one.",
  },
  "operations.finance.corrections.refund.trigger": { en: "Submit refund" },
  "operations.finance.corrections.refund.confirm": { en: "Submit this refund" },
  "operations.finance.corrections.refund.effect": {
    en: "A refund is approved against a settled payment and a Stripe refund operation is created for it. Money leaves the account when the provider executes it.",
  },
  "operations.finance.corrections.refund.reversible": {
    en: "No. A refund the provider has executed cannot be recalled.",
  },
  "operations.finance.corrections.dispute.trigger": { en: "Record dispute" },
  "operations.finance.corrections.dispute.confirm": {
    en: "Record this dispute",
  },
  "operations.finance.corrections.dispute.effect": {
    en: "A dispute Stripe already opened is recorded against a settled payment, with the evidence deadline it carries. Recording it does not answer it.",
  },
  "operations.finance.corrections.dispute.reversible": {
    en: "The record stays. The dispute's outcome arrives from the provider.",
  },
  "operations.finance.corrections.amount": { en: "Amount in minor units" },
  "operations.finance.corrections.amount.help": {
    en: "A whole number in the smallest unit of {currency}.",
  },
  "operations.finance.corrections.amount.helpWithTotal": {
    en: "A whole number in the smallest unit of {currency}. The invoice total is {total}.",
  },
  "operations.finance.corrections.amount.helpNoCurrency": {
    en: "A whole number in the smallest unit of the invoice currency.",
  },
  "operations.finance.corrections.providerReason": { en: "Provider reason" },
  "operations.finance.corrections.providerReason.help": {
    en: "Sent to Stripe. Credit notes and refunds accept different reasons; this list is the one this correction accepts.",
  },
  "operations.finance.corrections.reason.duplicate": { en: "Duplicate" },
  "operations.finance.corrections.reason.fraudulent": { en: "Fraudulent" },
  "operations.finance.corrections.reason.orderChange": { en: "Order change" },
  "operations.finance.corrections.reason.productUnsatisfactory": {
    en: "Product unsatisfactory",
  },
  "operations.finance.corrections.reason.requestedByCustomer": {
    en: "Requested by customer",
  },
  "operations.finance.corrections.internalReason": {
    en: "Internal reason code",
  },
  "operations.finance.corrections.internalReason.help": {
    en: "3 to 120 characters. Kept with your name in the audit trail.",
  },
  "operations.finance.corrections.payment": { en: "Payment identifier" },
  "operations.finance.corrections.payment.help": {
    en: "No page looks up payments, so this is the one value on this form that is not taken from the record you opened. Copy it from the settled payment; the server refuses a payment that does not belong to this account.",
  },
  "operations.finance.corrections.disputeReference": {
    en: "Stripe dispute identifier",
  },
  "operations.finance.corrections.disputeReference.help": {
    en: "The dp_… identifier from the Stripe dispute.",
  },
  "operations.finance.corrections.evidenceDue": { en: "Evidence due" },
  "operations.finance.corrections.evidenceDue.help": {
    en: "The deadline Stripe set for evidence on this dispute.",
  },
  "operations.finance.corrections.effect": { en: "Effect" },
  "operations.finance.corrections.reversible": { en: "Reversible" },
  "operations.finance.corrections.authority": {
    en: "Finance approval authority is required. The server re-checks your role against freshly read authorization, requires a recent sign-in for this command, and writes the audit row in the same transaction as the correction.",
  },
  "operations.finance.corrections.refusalsSummary": {
    en: "Everything this form refuses before sending",
  },
  "operations.finance.corrections.submitting": { en: "Sending…" },
  "operations.finance.corrections.recorded": {
    en: "Recorded. Reference {reference}.",
  },
  "operations.finance.corrections.serverCode": { en: "Server code: {code}" },
  "operations.finance.corrections.refusal.account": {
    en: "This invoice is not linked to an account available in your current workspace. Open its order or switch accounts before recording a correction.",
  },
  "operations.finance.corrections.refusal.amount": {
    en: "Enter the amount as a positive whole number in the smallest currency unit.",
  },
  "operations.finance.corrections.refusal.amountExceedsInvoice": {
    en: "The credit is larger than the invoice total. The server allows less than this: it credits only what is still owed, minus any credit note already raised.",
  },
  "operations.finance.corrections.refusal.currency": {
    en: "This invoice records no currency, so no amount can be built for it.",
  },
  "operations.finance.corrections.refusal.providerReason": {
    en: "Choose a provider reason this correction accepts.",
  },
  "operations.finance.corrections.refusal.internalReason": {
    en: "Give an internal reason code of 3 to 120 characters.",
  },
  "operations.finance.corrections.refusal.payment": {
    en: "Enter the identifier of the settled payment.",
  },
  "operations.finance.corrections.refusal.disputeReference": {
    en: "Enter the Stripe dispute identifier, which begins dp_.",
  },
  "operations.finance.corrections.refusal.evidenceDue": {
    en: "Enter the evidence deadline as a date and time.",
  },
  "operations.finance.corrections.failure.forbidden": {
    en: "Your role or current session cannot raise this correction. A recent sign-in is required for money commands.",
  },
  "operations.finance.corrections.failure.conflict": {
    en: "This record changed while you were working, or the same correction was already recorded. Reload before repeating it.",
  },
  "operations.finance.corrections.failure.validation": {
    en: "The server refused the correction, for example because the amount exceeds what can still be credited or refunded. Nothing was written.",
  },
  "operations.finance.corrections.failure.unavailable": {
    en: "The commerce service is unavailable. Nothing was written.",
  },
  "operations.finance.corrections.failure.unknown": {
    en: "The correction could not be sent. Nothing was written.",
  },

  // ---------------------------------------------------------------------------
  // Provisioning
  // ---------------------------------------------------------------------------
  "operations.finance.provisioning.title": { en: "Provisioning work" },
  "operations.finance.provisioning.description": {
    en: "Track provider work, service terminations, retry timing, and the items that need operator attention.",
  },
  "operations.finance.provisioning.summaryLabel": {
    en: "Provisioning work by type",
  },
  "operations.finance.provisioning.providerOperations": {
    en: "Provider operations",
  },
  "operations.finance.provisioning.providerOperations.detail": {
    en: "Provider calls the platform is driving to completion",
  },
  "operations.finance.provisioning.terminations": {
    en: "Service terminations",
  },
  "operations.finance.provisioning.terminations.detail": {
    en: "Services ending, with their teardown and final billing",
  },
  "operations.finance.provisioning.highRisk.detail": {
    en: "Items that need immediate operator attention",
  },
  "operations.finance.provisioning.retryTitle": {
    en: "Stopped work is handled in Recovery.",
  },
  "operations.finance.provisioning.retryBody": {
    en: "Open the recovery workspace to retry or abandon work that has used up its automatic attempts.",
  },
  "operations.finance.provisioning.recoveryLink": {
    en: "Open the recovery queue",
  },
  "operations.finance.provisioning.unclassified": {
    count: "count",
    en: {
      one: "{count} item needs classification before it can be routed.",
      other: "{count} items need classification before they can be routed.",
    },
  },
  "operations.finance.provisioning.tableHeading": {
    en: "Provisioning records",
  },
  "operations.finance.provisioning.recordCount": {
    count: "count",
    en: { one: "{count} record", other: "{count} records" },
  },
  "operations.finance.provisioning.empty": {
    en: "No provisioning work needs attention in this workspace.",
  },
  "operations.finance.provisioning.caption": {
    en: "Provisioning records ordered by risk, then attempts spent",
  },
  "operations.finance.provisioning.column.record": { en: "Record" },
  "operations.finance.provisioning.column.kind": { en: "Type" },
  "operations.finance.provisioning.column.provider": { en: "Provider" },
  "operations.finance.provisioning.column.attempts": { en: "Attempts" },
  "operations.finance.provisioning.kind.providerOperation": {
    en: "Provider operation",
  },
  "operations.finance.provisioning.kind.termination": {
    en: "Service termination",
  },
  "operations.finance.provisioning.kind.unclassified": { en: "Unclassified" },
  "operations.finance.provisioning.noAttempts": { en: "Not applicable" },
  "operations.finance.provisioning.nextAttempt": { en: "Next attempt {date}" },
  "operations.finance.provisioning.noRetry": { en: "No retry scheduled" },
  "operations.finance.provisioning.endsOn": { en: "Service ends {date}" },

  // ---------------------------------------------------------------------------
  // Accepted-order handoff to the demo provisioner
  // ---------------------------------------------------------------------------
  "operations.finance.handoff.label": { en: "Accepted order handoff" },
  "operations.finance.handoff.heading": {
    en: "Accepted orders for demo provisioning",
  },
  "operations.finance.handoff.intro": {
    en: "Orders appear here as soon as the customer accepts. Submit the saved entitlements to the demo provisioner; an operation reference confirms receipt. Real service activation needs a completion result from the provider.",
  },
  "operations.finance.handoff.serviceStarts": { en: "Service starts {date}" },
  "operations.finance.handoff.submitted": { en: "Request submitted {time}" },
  "operations.finance.handoff.submit": { en: "Submit to demo provisioner" },
  "operations.finance.handoff.submitting": { en: "Submitting…" },
  "operations.finance.handoff.historical": {
    en: "Historical demo order · provisioning source unavailable",
  },
  "operations.finance.handoff.empty": { en: "No accepted demo orders yet." },
  "operations.finance.handoff.received": {
    en: "The demo provisioner received the order. This is evidence of dispatch, not of service activation.",
  },
  "operations.finance.handoff.forbidden": {
    en: "Internal operations authority is required to submit provisioning.",
  },
  "operations.finance.handoff.refused": {
    en: "The demo provisioner refused this order. Reload the page to see its current state before trying again.",
  },
  "operations.finance.handoff.failed": {
    en: "The provisioning request could not be submitted. Try again.",
  },

  // ---------------------------------------------------------------------------
  // Migration matching
  // ---------------------------------------------------------------------------
  "operations.finance.migrations.title": { en: "Migration matching" },
  "operations.finance.migrations.description": {
    en: "Resolve source records against human-readable account candidates. An ambiguous match never creates a duplicate account.",
  },
  "operations.finance.migrations.unwired": {
    en: "Migration source data is not enabled for this workspace.",
  },
  "operations.finance.migrations.illustrativeTitle": {
    en: "Explore migration matching",
  },
  "operations.finance.migrations.illustrativeBody": {
    en: "Use the guided examples below to review confident, ambiguous, and unmatched account records.",
  },
  "operations.finance.migrations.summaryLabel": {
    en: "Migration matching summary",
  },
  "operations.finance.migrations.cards.toReview": { en: "Records to review" },
  "operations.finance.migrations.cards.toReview.detail": {
    en: "Representative source records for this guided workspace",
  },
  "operations.finance.migrations.cards.ambiguous": { en: "Ambiguous matches" },
  "operations.finance.migrations.cards.ambiguous.detail": {
    en: "Creating a duplicate account is blocked",
  },
  "operations.finance.migrations.cards.noMatch": { en: "No-match records" },
  "operations.finance.migrations.cards.noMatch.detail": {
    en: "New-account review, then screening and credit checks",
  },
  "operations.finance.migrations.ambiguityTitle": {
    en: "Ambiguity never creates an account.",
  },
  "operations.finance.migrations.ambiguityBody": {
    en: "Search by a human-readable name, route, or domain. The selected account ID is kept only after an exact candidate is chosen and reviewed.",
  },
  "operations.finance.migrations.candidatesLabel": {
    en: "Migration candidates",
  },
  "operations.finance.migrations.relationship.directBuyer": {
    en: "Direct buyer",
  },
  "operations.finance.migrations.relationship.subsidiary": { en: "Subsidiary" },
  "operations.finance.migrations.relationship.distributor": {
    en: "Distributor route",
  },
  "operations.finance.migrations.badge.decided": { en: "Decision recorded" },
  "operations.finance.migrations.badge.possibleMatches": {
    count: "count",
    en: { one: "{count} possible match", other: "{count} possible matches" },
  },
  "operations.finance.migrations.badge.single": { en: "Single candidate" },
  "operations.finance.migrations.badge.none": { en: "No candidate" },
  "operations.finance.migrations.confidenceLabel": {
    en: "Candidate match confidence",
  },
  "operations.finance.migrations.noMatch": {
    en: "No current account matched the verified legal name or domain.",
  },
  "operations.finance.migrations.search.label": {
    en: "Search and select an account",
  },
  "operations.finance.migrations.search.placeholder": {
    en: "Type an account name, route or domain",
  },
  "operations.finance.migrations.search.placeholderEmpty": {
    en: "No candidate account available",
  },
  "operations.finance.migrations.search.helpAmbiguous": {
    en: "Choose one verified legal entity. Selecting a candidate links the source record; it never creates another account.",
  },
  "operations.finance.migrations.search.helpSingle": {
    en: "The submitted value remains the selected account ID.",
  },
  "operations.finance.migrations.search.helpNone": {
    en: "A new-account request is available only after evidence review.",
  },
  "operations.finance.migrations.attestation": {
    en: "I compared the legal name, route, verified domain, and source evidence. This confirmation and my server-attributed identity will be retained.",
  },
  "operations.finance.migrations.evidenceSummary": {
    en: "Evidence and technical identifiers",
  },
  "operations.finance.migrations.id.migration": { en: "Migration: {id}" },
  "operations.finance.migrations.id.sourceReference": {
    en: "Source reference: {id}",
  },
  "operations.finance.migrations.id.submittedAccount": {
    en: "Submitted account ID: {id}",
  },
  "operations.finance.migrations.decision.linked": {
    en: "Linked to account {account}. Decision version {version}.",
  },
  "operations.finance.migrations.decision.staged": {
    en: "New-account review staged. Decision version {version}.",
  },
  "operations.finance.migrations.reason.ambiguous": {
    en: "Ambiguous match: select one verified account. Creating a new account stays blocked.",
  },
  "operations.finance.migrations.reason.selectAccount": {
    en: "Select the verified account before continuing.",
  },
  "operations.finance.migrations.reason.confirmEvidence": {
    en: "Confirm the legal-entity evidence before review.",
  },
  "operations.finance.migrations.reason.readyToLink": {
    en: "Ready to review the link to {account}. No new account will be created.",
  },
  "operations.finance.migrations.reason.newAccountReview": {
    en: "No candidate matched; creating a new account requires review.",
  },
  "operations.finance.migrations.review.linkAction": {
    en: "Link the migrated record to the existing account",
  },
  "operations.finance.migrations.review.createAction": {
    en: "Request a new account from the migration evidence",
  },
  "operations.finance.migrations.review.linkEntity": {
    en: "{source} → {target}",
  },
  "operations.finance.migrations.review.linkImpact": {
    en: "The source record will reference the verified current account. No account is created.",
  },
  "operations.finance.migrations.review.createImpact": {
    en: "An account-creation request with its own separate checks will be staged; creation is not automatic.",
  },
  "operations.finance.migrations.review.policyBasis": {
    en: "Migration identity policy §3 · verified legal entity and explicit resolution of ambiguity",
  },
  "operations.finance.migrations.review.linkDownstream": {
    en: "Orders and invoices remain on the existing account after reconciliation.",
  },
  "operations.finance.migrations.review.createDownstream": {
    en: "Screening and credit checks run before any account becomes available.",
  },
  "operations.finance.migrations.review.technicalId": {
    en: "{migration} · source {source}",
  },
  "operations.finance.migrations.review.technicalIdWithAccount": {
    en: "{migration} · source {source} · account {account}",
  },
  "operations.finance.migrations.review.actorAuthority": {
    en: "Internal operators may stage the review; the server authorizes linking or creation and records who acted.",
  },
  "operations.finance.migrations.review.linkTrigger": {
    en: "Review account link",
  },
  "operations.finance.migrations.review.createTrigger": {
    en: "Review new account",
  },
  "operations.finance.migrations.review.confirm": {
    en: "Complete migration review",
  },
  "operations.finance.migrations.review.blocked": { en: "Review blocked" },

  // ---------------------------------------------------------------------------
  // Review dialogs (migration review and demo migration decision)
  // ---------------------------------------------------------------------------
  "operations.finance.review.dialogTitle": { en: "Review: {action}" },
  "operations.finance.review.dialogDescription": {
    en: "Review the affected entity, evidence, policy and downstream effect before staging this action.",
  },
  "operations.finance.review.decisionDescription": {
    en: "Confirm the exact migration target and keep a reason with the operator decision.",
  },
  "operations.finance.review.term.entity": { en: "Affected entity" },
  "operations.finance.review.term.impact": { en: "Impact" },
  "operations.finance.review.term.evidence": { en: "Evidence" },
  "operations.finance.review.term.policy": { en: "Policy basis" },
  "operations.finance.review.term.downstream": { en: "Downstream effect" },
  "operations.finance.review.term.authority": { en: "Your authority" },
  "operations.finance.review.reasonLabel": { en: "Decision reason" },
  "operations.finance.review.reasonHelp": {
    en: "Required. The reason is kept with your name and the review evidence.",
  },
  "operations.finance.review.decisionReasonHelp": {
    en: "Required. Kept with the authenticated operator and the selected account.",
  },
  "operations.finance.review.reasonRequired": {
    en: "A decision reason is required.",
  },
  "operations.finance.review.actorNote": {
    en: "Your authority comes from your sign-in. Credit, screening, provider, retention and dual-control checks run again where they apply.",
  },
  "operations.finance.review.handoffTitle": { en: "Review only" },
  "operations.finance.review.handoffBody": {
    en: "Nothing is applied here. Continue through the server-authorized workflow to apply the action and revalidate every check.",
  },
  "operations.finance.review.complete": {
    en: "Review complete. Continue through the server-authorized workflow to apply the action; no lifecycle state changed here.",
  },
  "operations.finance.review.recording": { en: "Recording…" },
  "operations.finance.review.recorded": { en: "Recorded" },
  "operations.finance.review.recordDecision": { en: "Record decision" },
  "operations.finance.review.decisionRecorded": {
    en: "Migration decision recorded.",
  },
  "operations.finance.review.error.reasonRequired": {
    en: "Give a decision reason of at least 8 characters.",
  },
  "operations.finance.review.error.recentAuth": {
    en: "Sign in again to confirm this migration decision.",
  },
  "operations.finance.review.error.forbidden": {
    en: "Your migration authority has changed.",
  },
  "operations.finance.review.error.notFound": {
    en: "This migration record is no longer available.",
  },
  "operations.finance.review.error.invalid": {
    en: "The selected account no longer matches this migration record.",
  },
  "operations.finance.review.error.unavailable": {
    en: "Migration decisions are unavailable outside the guided demo.",
  },
  "operations.finance.review.error.failed": {
    en: "The migration decision could not be recorded. Nothing changed.",
  },

  // ---------------------------------------------------------------------------
  // Operational reports
  // ---------------------------------------------------------------------------
  "operations.finance.reports.title": { en: "Operational reports" },
  "operations.finance.reports.description": {
    en: "Exports already on record, and the reports you can export now.",
  },
  "operations.finance.reports.filtersLabel": { en: "Report filters" },
  "operations.finance.reports.column.report": { en: "Report" },
  "operations.finance.reports.allReports": { en: "All supported reports" },
  "operations.finance.reports.reportHelp": {
    en: "Filters the exports on record and the reports offered below.",
  },
  "operations.finance.reports.exportsHeading": {
    en: "Recorded report exports",
  },
  "operations.finance.reports.exportsCaption": {
    en: "Report exports, newest first",
  },
  "operations.finance.reports.exportCount": {
    count: "count",
    en: { one: "{count} export", other: "{count} exports" },
  },
  "operations.finance.reports.exportsEmpty": {
    en: "No report exports are projected into your operator scope. Generating an export below records one.",
  },
  "operations.finance.reports.exportsFilterEmpty": {
    en: "No recorded export is for {report}. Clear the report filter to see the others.",
  },
  "operations.finance.reports.column.document": { en: "Document" },
  "operations.finance.reports.column.recorded": { en: "Recorded" },
  "operations.finance.reports.documentPending": {
    en: "No document recorded yet",
  },
  "operations.finance.reports.documentStored": { en: "Stored" },
  "operations.finance.reports.catalogueHeading": { en: "Supported exports" },
  "operations.finance.reports.catalogueDescription": {
    en: "Each report is built fresh when you export it.",
  },
  "operations.finance.reports.scopeLabel": { en: "Export scope" },
  "operations.finance.reports.allAccounts": { en: "All accounts you can see" },
  "operations.finance.reports.accountHelp": {
    en: "Limit an export to one account, or keep all the accounts you can see.",
  },
  "operations.finance.reports.selectedAccountEvidence": {
    en: "Selected account evidence",
  },
  "operations.finance.reports.submittedAccount": {
    en: "{account} · submitted account ID {id}",
  },
  "operations.finance.reports.downloadedForAccount": {
    en: "{report} export downloaded for {account}.",
  },
  "operations.finance.reports.downloadedForScope": {
    en: "{report} export downloaded for all the accounts you can see.",
  },
  "operations.finance.reports.exportFailed": {
    en: "The export could not be generated. Nothing on this page changed.",
  },
  "operations.finance.reports.exporting": { en: "Exporting…" },
  "operations.finance.reports.exportCsv": { en: "Export CSV" },
  "operations.finance.report.revenueForecast": { en: "Revenue forecast" },
  "operations.finance.report.capacityPlanning": { en: "Capacity planning" },
  "operations.finance.report.renewalChurnExposure": {
    en: "Renewal and churn exposure",
  },
  "operations.finance.report.partnerPerformance": { en: "Partner performance" },
  "operations.finance.report.funnelCycleTime": { en: "Funnel cycle time" },
  "operations.finance.report.marginPocCost": { en: "Margin and POC cost" },
  "operations.finance.report.arrMrr": { en: "ARR and MRR" },
  "operations.finance.report.billingCollections": {
    en: "Billing and collections",
  },
  "operations.finance.report.commissionSettlement": {
    en: "Commission settlement",
  },
  "operations.finance.report.threeWayTieOut": { en: "Three-way tie-out" },
  "operations.finance.report.weeklyScorecard": { en: "Weekly scorecard" },

  // ---------------------------------------------------------------------------
  // Billing reconciliation
  // ---------------------------------------------------------------------------
  "operations.finance.reconciliation.title": { en: "Billing reconciliation" },
  "operations.finance.reconciliation.description": {
    en: "Review month-end close readiness, compare billing and ledger totals, and classify the variances that need follow-up.",
  },
  "operations.finance.reconciliation.summaryLabel": { en: "Close readiness" },
  "operations.finance.reconciliation.periods.heading": {
    en: "Tie-out periods",
  },
  "operations.finance.reconciliation.summary.periods.detail": {
    en: "Monthly periods available for review",
  },
  "operations.finance.reconciliation.untied": { en: "Not tied" },
  "operations.finance.reconciliation.summary.untied.detail": {
    en: "Periods where platform, billing and ledger totals differ",
  },
  "operations.finance.reconciliation.summary.blocking": {
    en: "Blocking variances",
  },
  "operations.finance.reconciliation.summary.blocking.detail": {
    en: "Cases that still prevent the period from closing",
  },
  "operations.finance.reconciliation.unreadable": {
    en: "Reconciliation is temporarily unavailable.",
  },
  "operations.finance.reconciliation.unreadable.detail": {
    en: "Refresh the page or try again shortly. No close decision was made.",
  },
  "operations.finance.reconciliation.periods.subheading": {
    en: "Platform against billing provider against general ledger.",
  },
  "operations.finance.reconciliation.periods.caption": {
    en: "Stored three-way tie-out periods and their variances",
  },
  "operations.finance.reconciliation.periods.empty": {
    en: "No tie-out periods are ready for review.",
  },
  "operations.finance.reconciliation.periods.count": {
    count: "count",
    en: { one: "{count} period", other: "{count} periods" },
  },
  "operations.finance.reconciliation.column.period": { en: "Period" },
  "operations.finance.reconciliation.column.platform": { en: "Platform" },
  "operations.finance.reconciliation.column.billing": {
    en: "Billing provider",
  },
  "operations.finance.reconciliation.column.ledger": { en: "General ledger" },
  "operations.finance.reconciliation.column.variance": { en: "Variance" },
  "operations.finance.reconciliation.column.state": { en: "State" },
  "operations.finance.reconciliation.ledgerVariance": {
    en: "Ledger: {amount}",
  },
  "operations.finance.reconciliation.tied": { en: "Tied" },
  "operations.finance.reconciliation.variances.heading": {
    en: "Reconciliation variances",
  },
  "operations.finance.reconciliation.variances.subheading": {
    en: "Exception cases raised by the usage and three-way reconciliation tasks.",
  },
  "operations.finance.reconciliation.variances.caption": {
    en: "Open reconciliation exception cases and their dispositions",
  },
  "operations.finance.reconciliation.variances.empty": {
    en: "No reconciliation exception is open. Neither reconciliation task has raised a variance that is still unresolved.",
  },
  "operations.finance.reconciliation.variances.count": {
    count: "count",
    en: { one: "{count} case", other: "{count} cases" },
  },
  "operations.finance.reconciliation.column.subject": { en: "Subject" },
  "operations.finance.reconciliation.column.opened": { en: "Opened" },
  "operations.finance.reconciliation.column.target": { en: "Response target" },
  "operations.finance.reconciliation.classification": { en: "Classification" },
  "operations.finance.reconciliation.column.disposition": { en: "Disposition" },
  "operations.finance.reconciliation.subject": { en: "{kind} {id}" },
  "operations.finance.reconciliation.caseId": { en: "Case {id}" },
  "operations.finance.reconciliation.unclassified": {
    en: "Not yet classified",
  },
  "operations.finance.reconciliation.clearing": {
    en: "Expected to clear in {period}",
  },
  "operations.finance.reconciliation.decision.trigger": { en: "Classify" },
  "operations.finance.reconciliation.decision.confirm": {
    en: "Record this classification",
  },
  "operations.finance.reconciliation.decision.title": {
    en: "Classify variance: {subject}",
  },
  "operations.finance.reconciliation.decision.description": {
    en: "Records the classification, the expected clearing period and the evidence against this case. The case stays open.",
  },
  "operations.finance.reconciliation.decision.case": { en: "Case" },
  "operations.finance.reconciliation.decision.effect": {
    en: "The disposition is written to the case and to its audit trail. No amount is moved, no status is closed and no accounting entry is created.",
  },
  "operations.finance.reconciliation.decision.clearing": {
    en: "Expected clearing period",
  },
  "operations.finance.reconciliation.decision.clearing.help": {
    en: "Optional. The period this variance should clear in, as YYYY-MM.",
  },
  "operations.finance.reconciliation.decision.evidence": {
    en: "Evidence reference",
  },
  "operations.finance.reconciliation.decision.evidence.help": {
    en: "Optional. The document, export hash or ticket that holds the evidence. Letters, digits, dot, dash, underscore, slash and colon, up to 120 characters.",
  },
  "operations.finance.reconciliation.decision.reason": {
    en: "Correction mechanism and reason",
  },
  "operations.finance.reconciliation.decision.reason.help": {
    en: "At least 8 characters. Kept with your name in the audit trail.",
  },
  "operations.finance.reconciliation.decision.recorded": { en: "Recorded." },
  "operations.finance.reconciliation.failure.reasonRequired": {
    en: "Give a reason of at least 8 characters.",
  },
  "operations.finance.reconciliation.failure.invalid": {
    en: "The disposition could not be read. Reload the page.",
  },
  "operations.finance.reconciliation.failure.classification": {
    en: "Choose one of the classifications the runbook lists.",
  },
  "operations.finance.reconciliation.failure.clearingPeriod": {
    en: "Give the expected clearing period as YYYY-MM, or leave it empty.",
  },
  "operations.finance.reconciliation.failure.evidence": {
    en: "The evidence reference contains characters that are not allowed.",
  },
  "operations.finance.reconciliation.failure.recentAuth": {
    en: "Sign in again to confirm it is you, then repeat the disposition.",
  },
  "operations.finance.reconciliation.failure.forbidden": {
    en: "Your permission to operate billing reconciliation has changed.",
  },
  "operations.finance.reconciliation.failure.unavailable": {
    en: "The reconciliation records cannot be reached.",
  },
  "operations.finance.reconciliation.failure.notFound": {
    en: "That case is no longer an open reconciliation variance. Reload the page.",
  },
  "operations.finance.reconciliation.failure.conflict": {
    en: "The case changed while this page was open. Reload and repeat the disposition.",
  },
  "operations.finance.reconciliation.failure.failed": {
    en: "The disposition could not be recorded.",
  },
  "operations.finance.reconciliation.classification.deliveryTiming": {
    en: "Delivery timing",
  },
  "operations.finance.reconciliation.classification.periodCutOff": {
    en: "Period cut-off",
  },
  "operations.finance.reconciliation.classification.currency": {
    en: "Currency",
  },
  "operations.finance.reconciliation.classification.tax": { en: "Tax" },
  "operations.finance.reconciliation.classification.accountMapping": {
    en: "Account mapping",
  },
  "operations.finance.reconciliation.classification.missingOrDuplicateEvent": {
    en: "Missing or duplicate event",
  },
  "operations.finance.reconciliation.classification.usageCorrection": {
    en: "Usage correction",
  },
  "operations.finance.reconciliation.classification.amendmentOrProration": {
    en: "Amendment or proration",
  },
  "operations.finance.reconciliation.classification.providerFee": {
    en: "Provider fee",
  },
  "operations.finance.reconciliation.classification.unexplained": {
    en: "Unexplained",
  },

  // ---------------------------------------------------------------------------
  // Revenue and channel
  // ---------------------------------------------------------------------------
  "operations.finance.revenue.title": { en: "Revenue & channel" },
  "operations.finance.revenue.description": {
    en: "Contracted backlog, the pipeline of unaccepted quotes, backlog by sales route, and the recurring run rate, read from the reporting views.",
  },
  "operations.finance.revenue.summaryLabel": { en: "Revenue report coverage" },
  "operations.finance.revenue.summary.forecast": { en: "Forecast rows" },
  "operations.finance.revenue.summary.forecast.detail": {
    en: "Quotes and orders included in the current forecast",
  },
  "operations.finance.revenue.summary.remaining": {
    en: "Remaining backlog rows",
  },
  "operations.finance.revenue.summary.remaining.detail": {
    en: "Committed rows dated this month or later",
  },
  "operations.finance.revenue.summary.recurring": { en: "Recurring contracts" },
  "operations.finance.revenue.summary.recurring.detail": {
    en: "Active contracts included in ARR and MRR",
  },
  "operations.finance.revenue.unreadable": {
    en: "Revenue reporting could not be read.",
  },
  "operations.finance.revenue.unreadable.detail": {
    en: "No figures are shown because no read completed. This is not a zero-revenue report.",
  },
  "operations.finance.revenue.groups": {
    count: "count",
    en: { one: "{count} group", other: "{count} groups" },
  },
  "operations.finance.revenue.stage.heading": { en: "Forecast by stage" },
  "operations.finance.revenue.stage.subheading": {
    en: "Contracted backlog and the pipeline of unaccepted quotes. The pipeline shows the full issued value and is not probability-weighted.",
  },
  "operations.finance.revenue.stage.caption": {
    en: "Forecast totals by stage, currency and revenue basis",
  },
  "operations.finance.revenue.stage.empty": {
    en: "No forecast rows were returned.",
  },
  "operations.finance.revenue.stage.committedBacklog": {
    en: "Contracted backlog",
  },
  "operations.finance.revenue.stage.pipeline": { en: "Pipeline" },
  "operations.finance.revenue.column.stage": { en: "Stage" },
  "operations.finance.revenue.column.basis": { en: "Revenue basis" },
  "operations.finance.revenue.column.quotes": { en: "Quotes" },
  "operations.finance.revenue.column.orders": { en: "Orders" },
  "operations.finance.revenue.column.merchant": { en: "Merchant of record" },
  "operations.finance.revenue.column.month": { en: "Month" },
  "operations.finance.revenue.column.mrr": sameInAllLanguages(
    "MRR",
    "Monthly recurring revenue: the acronym finance teams use unchanged in every interface language",
  ),
  "operations.finance.revenue.column.arr": sameInAllLanguages(
    "ARR",
    "Annual recurring revenue: the acronym finance teams use unchanged in every interface language",
  ),
  "operations.finance.revenue.column.contracts": { en: "Contracts" },
  "operations.finance.revenue.column.methodology": { en: "Methodology" },
  "operations.finance.revenue.route.heading": {
    en: "Remaining backlog by route",
  },
  "operations.finance.revenue.route.subheading": {
    en: "Committed rows whose forecast month is this month or later; past forecast months are excluded.",
  },
  "operations.finance.revenue.route.caption": {
    en: "Remaining committed backlog by route and revenue basis",
  },
  "operations.finance.revenue.route.empty": {
    en: "No remaining committed backlog rows were returned.",
  },
  "operations.finance.revenue.monthly.heading": {
    en: "Twelve-month committed schedule",
  },
  "operations.finance.revenue.monthly.subheading": {
    en: "This month plus the next eleven calendar months, without pipeline.",
  },
  "operations.finance.revenue.monthly.caption": {
    en: "Committed revenue scheduled for the next twelve months",
  },
  "operations.finance.revenue.monthly.empty": {
    en: "No committed revenue falls in the next twelve months.",
  },
  "operations.finance.revenue.recurring.subheading": {
    en: "Contracted run rate by currency, revenue basis and methodology version.",
  },
  "operations.finance.revenue.recurring.caption": {
    en: "Contracted recurring value by currency and methodology",
  },
  "operations.finance.revenue.recurring.empty": {
    en: "No contracted recurring run-rate rows were returned.",
  },
  "operations.finance.revenue.basis.gross": { en: "Gross" },
  "operations.finance.revenue.basis.transferPrice": {
    en: "Transfer price (the partner keeps the margin; not gross)",
  },
  "operations.finance.revenue.merchant.filOne": sameInAllLanguages(
    "Fil One",
    "Company name; Fil One is the merchant of record",
  ),
  "operations.finance.revenue.merchant.partner": { en: "Partner" },
  "operations.finance.revenue.merchant.marketplace": { en: "Marketplace" },
  "operations.finance.revenue.methodology.merchantOfRecord": {
    en: "Merchant-of-record basis",
  },
});
