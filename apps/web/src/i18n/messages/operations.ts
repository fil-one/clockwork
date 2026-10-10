import { defineStaffMessages, sameInAllLanguages } from "../define";

/**
 * Internal operations: queues, search, finance lifecycle, reconciliation, revenue, recovery, status. Owned by the operations lane.
 */
export const operationsMessages = defineStaffMessages({
  "operations.cases": {
    count: "count",
    en: { one: "{count} case", other: "{count} cases" },
  },
  "operations.priority": {
    count: "count",
    en: {
      one: "{count} case needs priority attention.",
      other: "{count} cases need priority attention.",
    },
  },
  "operations.records": {
    count: "count",
    en: { one: "{count} record", other: "{count} records" },
  },
  "operations.orders": {
    count: "count",
    en: { one: "{count} order", other: "{count} orders" },
  },
  "operations.exports": {
    count: "count",
    en: { one: "{count} export", other: "{count} exports" },
  },
  "ui.28": { en: "Internal operations" },
  "ui.29": { en: "Data status" },
  "ui.31": { en: "Needs refresh" },
  "ui.32": { en: "Temporarily unavailable" },
  "ui.33": { en: "Not available in this workspace" },
  "ui.34": { en: "At least one record is past its refresh window." },
  "ui.35": {
    en: "Verify anything you are about to act on against the source record before deciding it.",
  },
  "ui.36": { en: "Renewal notice windows" },
  "ui.37": {
    en: "Orders grouped by how long is left before their contractual notice date, with the route and the invoicing already recorded against them.",
  },
  "ui.38": { en: "About renewal value" },
  "ui.39": {
    en: "Invoiced to date shows billed value for each order. Forecast value remains separate from this renewal worklist.",
  },
  "ui.40": { en: "Invoiced to date" },
  "ui.41": { en: "No invoices recorded against this order" },
  "ui.42": { en: "Route not recorded" },
  "ui.43": { en: "No orders fall in this window." },
  "ui.44": { en: "Collections priority" },
  "ui.45": {
    en: "Open invoices ordered by exposure and age, with the corrections a finance approver may raise against them.",
  },
  "ui.46": { en: "Priority order" },
  "ui.47": {
    en: "Highest open amount, then days past due, then invoice reference. Amounts in a second currency are ranked but never added into a total.",
  },
  "ui.48": { en: "Collections actions" },
  "ui.49": {
    en: "Open each invoice to review its payment history, disputes, and available corrections.",
  },
  "ui.50": { en: "Open invoice total" },
  "ui.51": { en: "Past due" },
  "ui.52": { en: "Oldest past due" },
  "ui.54": { en: "Open invoices" },
  "ui.55": {
    en: "Amount, age, status and the corrections available on each invoice.",
  },
  "ui.56": { en: "Open invoices ordered by amount then days past due" },
  "ui.57": { en: "No open invoices need collections attention." },
  "ui.58": { en: "Provisioning work" },
  "ui.59": {
    en: "Track provider work, service terminations, retry timing, and the items that need operator attention.",
  },
  "ui.60": { en: "Stopped work is handled in recovery." },
  "ui.61": {
    en: "Open the recovery workspace to retry or abandon work that has exhausted its automatic attempts.",
  },
  "ui.62": { en: "Open the recovery queue" },
  "ui.63": { en: "Provider operations" },
  "ui.64": { en: "Service terminations" },
  "ui.65": { en: "High risk" },
  "ui.66": { en: "Provisioning records" },
  "ui.67": { en: "Provisioning records ordered by risk then attempts spent" },
  "ui.68": { en: "No provisioning work needs attention in this workspace." },
  "ui.69": { en: "Attempts" },
  "ui.70": { en: "Not applicable" },
  "ui.71": { en: "Operational reports" },
  "ui.72": {
    en: "Report exports recorded against your operator session, and the supported exports you can generate now.",
  },
  "ui.73": { en: "Recorded report exports" },
  "ui.74": { en: "Report exports newest first" },
  "ui.75": {
    en: "No report exports are projected into your operator scope. Generating an export below records one.",
  },
  "ui.76": { en: "All supported reports" },
  "ui.77": { en: "Document recorded" },
  "ui.78": { en: "No document recorded yet" },
  "ui.79": { en: "Supported exports" },
  "ui.80": {
    en: "The report registry in the commerce contract. Each one is generated on request; this page holds no cached result and states no freshness for one.",
  },
  "ui.81": { en: "ARR & MRR" },
  "ui.82": { en: "Billing & collections" },
  "ui.83": { en: "Commission settlement" },
  "ui.84": { en: "Exports are generated on demand" },
  "ui.85": {
    en: "Choose a report and account scope below. Completed exports remain available in the history list.",
  },
  "ui.116": { en: "Evidence" },
  "ui.119": { en: "Amount" },
  "ui.125": { en: "Retry" },
  "chart.axis.month": { en: "Month" },
  "operations.openInvoices": {
    count: "count",
    en: { one: "{count} open invoice", other: "{count} open invoices" },
  },
  "operations.pastDueInvoices": {
    count: "count",
    en: { one: "{count} invoice past due", other: "{count} invoices past due" },
  },
  "operations.invoices": {
    count: "count",
    en: { one: "{count} invoice", other: "{count} invoices" },
  },
  "operations.eyebrow": { en: "Internal operations" },
  "operations.queueWork": { en: "Queue work" },
  "operations.column.attempts": { en: "Attempts" },
  "operations.column.decision": { en: "Decision" },
  "operations.column.type": { en: "Type" },
  "operations.decision.effect": { en: "Effect" },
  "operations.decision.reason": { en: "Reason" },
  "operations.decision.reasonRequired": {
    en: "Give a reason of at least {min} characters.",
  },
  "operations.decision.recentAuth": {
    en: "Sign in again to confirm it is you, then repeat the decision.",
  },
  "operations.decision.permissionChanged": {
    en: "Your permission to operate system recovery has changed.",
  },
  "operations.decision.unreadable": {
    en: "The decision could not be read. Reload the page.",
  },
  "operations.decision.failed": { en: "The decision could not be recorded." },
  "operations.decision.recording": { en: "Recording…" },
  "operations.decision.recorded": { en: "Decision recorded." },
  "operations.home.title": { en: "Operational health" },
  "operations.home.description": {
    en: "The work that needs attention across approvals, collections, provisioning, renewals, and reporting.",
  },
  "operations.home.stale": {
    en: "Refresh needed for {channels}. Open the workspace before making a decision.",
  },
  "operations.home.area.approvals": { en: "Approvals" },
  "operations.home.area.provisioning": { en: "Provisioning" },
  "operations.home.area.collections": { en: "Collections" },
  "operations.home.area.renewals": { en: "Renewals" },
  "operations.home.area.reports": { en: "Reports" },
  "operations.home.overview.title": { en: "Work overview" },
  "operations.home.overview.description": {
    en: "Prioritized work across the teams you support, with a direct path to each workspace.",
  },
  "operations.home.overview.tableLabel": { en: "Operational work overview" },
  "operations.home.openMyQueue": { en: "Open my queue" },
  "operations.home.column.signal": { en: "Signal" },
  "operations.home.column.summary": { en: "Summary" },
  "operations.home.column.area": { en: "Area" },
  "operations.home.column.updated": { en: "Updated" },
  "operations.home.column.action": { en: "Action" },
  "operations.home.signal.stale": { en: "Out of date" },
  "operations.home.signal.queues.action": { en: "Open the queue" },
  "operations.home.signal.provisioning.action": { en: "Open provisioning" },
  "operations.home.signal.provisioning.detail": {
    en: "Provider operations: {operations}. Service terminations: {terminations}.",
  },
  "operations.home.signal.collections.action": { en: "Open collections" },
  "operations.home.signal.collections.noAmount": { en: "No amount recorded" },
  "operations.home.signal.collections.detail": {
    en: "Past-due invoices: {overdue}. Open invoices: {open}.",
  },
  "operations.home.signal.renewals": { en: "Renewal notice" },
  "operations.home.signal.renewals.detail": {
    en: "Orders whose contractual notice date has passed or falls inside 30 days.",
  },
  "operations.home.signal.renewals.action": { en: "Open renewals" },
  "operations.home.signal.reports": { en: "Report exports" },
  "operations.home.signal.reports.detail": { en: "Report exports on record." },
  "operations.home.signal.reports.action": { en: "Open reports" },
  "operations.queue.title": { en: "Operational queues" },
  "operations.queue.description": {
    en: "Prioritized policy, provider, and lifecycle work with clear ownership and evidence.",
  },
  "operations.queue.stale.title": { en: "This data may be out of date." },
  "operations.queue.stale.description": {
    en: "At least one record is past its refresh window. Verify it against the source before you decide.",
  },
  "operations.queue.stale.action": { en: "Refresh data" },
  "operations.queue.stale.refreshing": { en: "Refreshing…" },
  "operations.queue.stale.retry": { en: "Try refresh again" },
  "operations.queue.stale.failed": { en: "Data refresh failed. Try again." },
  "operations.queue.savedViews": { en: "Saved queue views" },
  "operations.queue.view.assigned": { en: "Assigned to me" },
  "operations.queue.view.assigned.description": {
    en: "Open work assigned to the signed-in operator",
  },
  "operations.queue.view.slaBreached": { en: "SLA breached" },
  "operations.queue.view.slaBreached.description": {
    en: "Items already outside their response policy",
  },
  "operations.queue.view.highRisk.description": {
    en: "Open items with high business or compliance risk",
  },
  "operations.queue.view.awaitingBackup": { en: "Awaiting backup" },
  "operations.queue.view.awaitingBackup.description": {
    en: "Items that still need a backup owner",
  },
  "operations.queue.view.all.description": { en: "All queue work" },
  "operations.queue.filters.title": { en: "Filter queue" },
  "operations.queue.filters.description": {
    en: "Search by name, work item or reference.",
  },
  "operations.queue.filters.clearAll": { en: "Clear all" },
  "operations.queue.search.label": { en: "Search work" },
  "operations.queue.search.placeholder": {
    en: "Entity, work item, or reference",
  },
  "operations.queue.filter.type": { en: "Type" },
  "operations.queue.filter.backup": { en: "Backup" },
  "operations.queue.filter.age": { en: "Age" },
  "operations.queue.unassigned": { en: "Unassigned" },
  "operations.queue.sla.breached": { en: "Breached" },
  "operations.queue.sla.dueSoon": { en: "Due soon" },
  "operations.queue.sla.healthy": { en: "Healthy" },
  "operations.queue.sla.chip.healthy": { en: "SLA healthy" },
  "operations.queue.sla.dueWithin24Hours": { en: "Due in 24 hours" },
  "operations.queue.age.upTo7Days": { en: "0–7 days" },
  "operations.queue.age.from8To30Days": { en: "8–30 days" },
  "operations.queue.age.over30Days": { en: "More than 30 days" },
  "operations.queue.sort.slaRiskAge": { en: "SLA, risk, age" },
  "operations.queue.sort.updated": { en: "Recently updated" },
  "operations.queue.activeFilter": { en: "{filter}: {value}" },
  "operations.queue.activeFilters": { en: "Active filters" },
  "operations.queue.noActiveFilters": { en: "No active filters" },
  "operations.queue.updating": { en: "Updating queue results…" },
  "operations.queue.results.label": { en: "Queue results" },
  "operations.queue.results.tableLabel": { en: "Queue results table" },
  "operations.queue.results.caption": {
    en: "Operational queue results sorted by SLA, risk, then age",
  },
  "operations.queue.column.workItem": { en: "Work item" },
  "operations.queue.row.showDetails": { en: "Show details for {title}" },
  "operations.queue.row.backup": { en: "Backup: {name}" },
  "operations.queue.row.noBackup": { en: "No backup" },
  "operations.queue.empty.title": { en: "No queue work yet" },
  "operations.queue.empty.description": {
    en: "New operational work will appear here when a policy or provider needs attention.",
  },
  "operations.queue.noMatch.title": { en: "No work matches these filters" },
  "operations.queue.noMatch.description": {
    en: "Clear one or more filters to broaden the result set.",
  },
  "operations.queue.detail.label": { en: "Selected queue item details" },
  "operations.queue.detail.queue": { en: "Queue: {queue}" },
  "operations.queue.detail.created": { en: "Created" },
  "operations.queue.detail.updated": { en: "Last updated" },
  "operations.queue.detail.deadline": { en: "Policy deadline" },
  "operations.queue.detail.reason": { en: "Why this needs a decision" },
  "operations.queue.detail.policyBasis": { en: "Policy basis:" },
  "operations.queue.detail.evidence": { en: "Evidence" },
  "operations.queue.detail.technicalId": { en: "Technical identifier" },
  "operations.queue.detail.sourceRecord": { en: "Source record" },
  "operations.queue.detail.sourceVersion": {
    en: "Version {version} · updated {time}",
  },
  "operations.queue.detail.related": { en: "Related records" },
  "operations.queue.detail.actions": { en: "Permitted actions" },
  "operations.queue.detail.restricted": {
    en: "Some decision actions are hidden because this session lacks the required role: {role}.",
  },
  "operations.queue.detail.reviewOnly": { en: "Review only" },
  "operations.queue.detail.reviewOnly.body": {
    en: "Nothing is submitted from this panel. Open the review to decide; your role and the approval policy are checked again when you submit.",
  },
  "operations.queue.detail.noActions": {
    en: "No actions are available for this role and record state.",
  },
  "operations.queue.type.pricing": { en: "Pricing" },
  "operations.queue.type.legal": { en: "Legal" },
  "operations.queue.type.creditCollections": { en: "Credit and collections" },
  "operations.queue.type.restrictedParties": { en: "Restricted parties" },
  "operations.queue.type.disputes": { en: "Disputes" },
  "operations.queue.type.dealRegistrationDisputes": {
    en: "Deal registration disputes",
  },
  "operations.queue.type.pocQualification": { en: "POC qualification" },
  "operations.queue.type.provisioningRecovery": { en: "Provisioning recovery" },
  "operations.queue.type.migrationReview": { en: "Migration review" },
  "operations.queue.type.offboardingDestructive": {
    en: "Offboarding and destructive actions",
  },
  "operations.queue.type.orderAcceptanceReview": {
    en: "Order acceptance review",
  },
  "operations.queue.type.billingOperations": { en: "Billing operations" },
  "operations.queue.type.commissions": { en: "Commissions" },
  "operations.queue.type.reconciliation": { en: "Reconciliation" },
  "operations.queue.type.reporting": { en: "Reporting" },
  "operations.queue.type.workflowOperations": { en: "Workflow operations" },
  "operations.queue.type.legalReview": { en: "Legal review" },
  "operations.queue.type.priceException": { en: "Price exception" },
  "operations.queue.subject.agreementDraft": { en: "Agreement draft" },
  "operations.queue.subject.migration": { en: "Migration" },
  "operations.queue.subject.reportExport": { en: "Report export" },
  "operations.queue.subject.taxRuleBook": { en: "Tax rule book" },
  "operations.queue.subject.termination": { en: "Termination" },
  "operations.queue.subject.workflowException": { en: "Workflow exception" },
  "operations.queue.action.reviewException": { en: "Review exception" },
  "operations.queue.action.approveException": { en: "Approve exception" },
  "operations.queue.action.rejectException": { en: "Reject exception" },
  "operations.queue.action.evaluateDunning": { en: "Evaluate dunning" },
  "operations.queue.action.prepareArtifact": { en: "Prepare document" },
  "operations.queue.action.replayProviderEvent": {
    en: "Replay provider event",
  },
  "operations.queueRecord.title": { en: "Queue record" },
  "operations.queueRecord.description": {
    en: "The evidence and the next step for this work item.",
  },
  "operations.account.title": { en: "Account operations" },
  "operations.account.description": {
    en: "Owner, relationship, value and documents for this account.",
  },
  "operations.account.openReports": { en: "Open reports" },
  "operations.copyId.label": { en: "Copy {label} {id}" },
  "operations.copyId.copied": { en: "{id} copied to the clipboard." },
  "operations.billingOff.title": {
    en: "Billing and provisioning are switched off",
  },
  "operations.billingOff.detail": {
    en: "New invoices are not issued and no new service is started while billing is off.",
  },
  "operations.billingOff.capabilities": { en: "Review capability switches" },
  "operations.search.title": { en: "Global search" },
  "operations.search.description": {
    en: "Find available commercial, account, lifecycle, queue, and policy records from one place.",
  },
  "operations.search.label": { en: "Search accounts, records, and documents" },
  "operations.search.placeholder": {
    en: "Try Northstar, an invoice number, or a policy",
  },
  "operations.search.keyboardHelp": {
    en: "{keys} move through results · Enter opens the focused result",
  },
  "operations.search.searching": { en: "Searching available records…" },
  "operations.search.scope.title": { en: "Search across operational records" },
  "operations.search.scope.description": {
    en: "Results are grouped by type and limited to records your role can open.",
  },
  "operations.search.scope.accounts": { en: "Accounts and end clients" },
  "operations.search.scope.agreements": { en: "Agreements and documents" },
  "operations.search.scope.commercial": { en: "Quotes, orders, and invoices" },
  "operations.search.clear": { en: "Clear search" },
  "operations.search.results": { en: "Search results" },
  "operations.search.grouped": {
    en: "Grouped by record type · availability reflects your role",
  },
  "operations.search.noResults.title": { en: "No results for “{query}”" },
  "operations.search.noResults.description": {
    en: "Check the spelling, use fewer terms, or search a known entity name instead of an identifier.",
  },
  "operations.search.contextEntry": { en: "{label}: {value}" },
  "operations.search.status.available": { en: "Available" },
  "operations.search.group.accounts": { en: "Accounts" },
  "operations.search.group.agreements": { en: "Agreements" },
  "operations.search.group.quotes": { en: "Quotes" },
  "operations.search.group.orders": { en: "Orders" },
  "operations.search.group.invoices": { en: "Invoices" },
  "operations.search.group.endClients": { en: "End clients" },
  "operations.search.group.queues": { en: "Queues" },
  "operations.search.group.documents": { en: "Documents" },
  "operations.recovery.title": { en: "Stopped work" },
  "operations.recovery.description": {
    en: "Dispatch, provisioning, and workflow tasks that ran out of attempts. Each one needs a retry or an abandonment before it moves.",
  },
  "operations.recovery.summary.label": { en: "Stopped work by engine" },
  "operations.recovery.engine.dispatch": { en: "Dispatch queue" },
  "operations.recovery.engine.provisioning": { en: "Provisioning" },
  "operations.recovery.engine.workflow": { en: "Workflow task" },
  "operations.recovery.summary.workflow.title": { en: "Workflow tasks" },
  "operations.recovery.summary.dispatch": {
    en: "Events that exhausted delivery attempts",
  },
  "operations.recovery.summary.provisioning": {
    en: "Provider attempts that stopped permanently",
  },
  "operations.recovery.summary.workflow": {
    en: "Runs the task runner gave up on",
  },
  "operations.recovery.unreadable.title": {
    en: "The queue could not be read.",
  },
  "operations.recovery.unreadable.detail": {
    en: "This page is showing nothing because no read completed, which is a different state from an empty queue. Check the service database connection before concluding there is no stopped work.",
  },
  "operations.recovery.retrying.title": {
    count: "count",
    en: {
      one: "{count} record is retrying.",
      other: "{count} records are retrying.",
    },
  },
  "operations.recovery.retrying.detail": {
    en: "A retried record stays here until it succeeds. Check the reason before deciding it again.",
  },
  "operations.recovery.table.subheading": {
    en: "Engine, failure, attempts, and how long it has been waiting.",
  },
  "operations.recovery.table.caption": {
    en: "Stopped work with its failure and the decisions available",
  },
  "operations.recovery.table.empty": {
    en: "Nothing has stopped. Every dispatch, provisioning attempt, and workflow task either succeeded or is still retrying on its own.",
  },
  "operations.recovery.column.engine": { en: "Engine" },
  "operations.recovery.column.work": { en: "Work" },
  "operations.recovery.column.record": { en: "Record" },
  "operations.recovery.column.failure": { en: "Failure" },
  "operations.recovery.column.waiting": { en: "Waiting" },
  "operations.recovery.waiting.underAnHour": { en: "Under an hour" },
  "operations.recovery.row.retrying": { en: "Retrying." },
  "operations.recovery.row.retryingWithReason": { en: "Retrying. {reason}" },
  "operations.recovery.subject": { en: "{kind} {reference}" },
  "operations.recovery.decision.retry": { en: "Retry" },
  "operations.recovery.decision.retry.confirm": { en: "Retry this work" },
  "operations.recovery.decision.retry.title": { en: "Retry {reference}" },
  "operations.recovery.decision.abandon": { en: "Abandon" },
  "operations.recovery.decision.abandon.confirm": { en: "Abandon this work" },
  "operations.recovery.decision.abandon.title": { en: "Abandon {reference}" },
  "operations.recovery.decision.reversible": { en: "Reversible" },
  "operations.recovery.decision.reasonHelp": {
    en: "At least {min} characters. Kept with your name on the audit record.",
  },
  "operations.recovery.effect.retry.dispatch": {
    en: "The event is queued for delivery again. Everything waiting on it runs once delivery succeeds.",
  },
  "operations.recovery.effect.retry.provisioning": {
    en: "A new provider attempt is issued for this order. The provider may create resources.",
  },
  "operations.recovery.effect.retry.workflow": {
    en: "The task runs again from the input already recorded on it.",
  },
  "operations.recovery.effect.abandon.dispatch": {
    en: "The event is closed and never delivered. Everything waiting on it stays undone.",
  },
  "operations.recovery.effect.abandon.provisioning": {
    en: "No further provider attempt is made. The order stays unprovisioned until someone raises a new command.",
  },
  "operations.recovery.effect.abandon.workflow": {
    en: "The run is cancelled and is never invoked again.",
  },
  "operations.recovery.reversible.retry.dispatch": {
    en: "Yes. The message can be abandoned later if it stops again.",
  },
  "operations.recovery.reversible.retry.provisioning": {
    en: "Yes. The attempt can be abandoned later if it stops again.",
  },
  "operations.recovery.reversible.retry.workflow": {
    en: "Yes. The run can be abandoned later if it stops again.",
  },
  "operations.recovery.reversible.abandon.dispatch": {
    en: "No. The dispatcher never claims a closed message, so nothing delivers it.",
  },
  "operations.recovery.reversible.abandon.provisioning": {
    en: "No provider attempt is issued again, and the attempt leaves this queue. The attempt row stays at dead_letter, because the state constraint has no abandoned value, so the decision is held on the audit trail.",
  },
  "operations.recovery.reversible.abandon.workflow": {
    en: "No. A cancelled run is not re-entered by a lease or a redrive.",
  },
  "operations.recovery.failure.authorizationExpired": {
    en: "This page has been open too long. Reload and repeat the decision.",
  },
  "operations.recovery.failure.idempotencyConflict": {
    en: "A different decision was already recorded under this key.",
  },
  "operations.recovery.failure.alreadyAbandoned": {
    en: "Another operator already abandoned this work.",
  },
  "operations.recovery.failure.notStopped": {
    en: "This work is no longer stopped.",
  },
  "operations.recovery.failure.notAddressable": {
    en: "This is the dispatch record for a queued message, not work you can decide. Reload the page and decide the message itself.",
  },
  "operations.recovery.failure.unavailable": {
    en: "The recovery queue cannot be reached.",
  },
  "operations.recovery.failure.redriveNotSubmitted": {
    en: "The decision is recorded. The task runner did not accept the redrive, so submit it again.",
  },
  "operations.recovery.failure.redriveUnmapped": {
    en: "The decision is recorded. No dispatch was found to re-invoke, so raise the work again from its own command.",
  },
  "operations.recovery.source.live": {
    en: "Dispatch queue, provisioning, and workflow tasks",
  },
  "operations.recovery.source.demo": { en: "Demonstration recovery ledger" },
  "operations.recovery.source.unavailable": {
    en: "No queue read is available",
  },
  "operations.status.title": { en: "Integration status" },
  "operations.status.description": {
    en: "Availability of commerce services and any stopped integration work that needs attention.",
  },
  "operations.status.source": { en: "Recovery and webhook processing queues" },
  "operations.status.source.unavailable": {
    en: "One or more operational queue reads are unavailable",
  },
  "operations.status.queues.label": { en: "Stopped work coverage" },
  "operations.status.queues.dispatch": { en: "Dispatch failures" },
  "operations.status.queues.provisioning": { en: "Provisioning failures" },
  "operations.status.queues.workflow": { en: "Workflow failures" },
  "operations.status.queues.webhook": { en: "Webhook callbacks" },
  "operations.status.queues.waiting": {
    en: "Items currently waiting for operator attention",
  },
  "operations.status.queues.incomplete": {
    en: "Operational queue read incomplete.",
  },
  "operations.status.queues.unreadable": {
    en: "At least one queue could not be read. A zero on this page is not evidence that the unreadable queue is empty.",
  },
  "operations.status.links.label": { en: "Queue actions" },
  "operations.status.links.title": { en: "Open the underlying records" },
  "operations.status.links.recovery": { en: "Open recovery" },
  "operations.status.links.webhookReplay": { en: "Open webhook replay" },
  "operations.status.lanes.heading": { en: "Service configuration" },
  "operations.status.lanes.detail": {
    en: "Current availability of core commerce, lifecycle, and system services.",
  },
  "operations.status.lanes.loading": { en: "Reading service status…" },
  "operations.status.lanes.unavailable": {
    en: "This service status check did not return a readable result.",
  },
  "operations.status.lane.core": { en: "Commerce" },
  "operations.status.lane.lifecycle": { en: "Customer lifecycle" },
  "operations.status.lane.system": { en: "Operations" },
  "operations.status.state.degraded": { en: "Degraded" },
  "operations.status.state.unavailable": { en: "Unavailable" },
  "operations.status.detail.service": { en: "Service store" },
  "operations.status.detail.stripeWebhook": { en: "Stripe webhook" },
  "operations.status.detail.stripePayment": { en: "Stripe payments" },
  "operations.status.detail.artifactStorage": { en: "Document storage" },
  "operations.status.detail.registration": { en: "Registration provider" },
  "operations.status.detail.esign": { en: "E-sign provider" },
  "operations.status.detail.provisioningWebhook": {
    en: "Provisioning webhook",
  },
  "operations.status.detail.marketplaceWebhook": { en: "Marketplace webhook" },
  "operations.status.detail.partnerDomainOwnership": {
    en: "Partner domain verification",
  },
  "operations.status.detail.supportWebhook": { en: "Support webhook" },
  "operations.status.detail.evidenceStorage": { en: "Evidence storage" },
  "operations.status.detail.externalGates": { en: "External gates" },
  "operations.status.detail.activationTestRunner": {
    en: "Activation test runner",
  },
  "operations.status.detail.workosWebhook": { en: "WorkOS webhook" },
  "operations.status.value.connected": { en: "Connected" },
  "operations.status.value.memory": { en: "In memory" },
  "operations.status.value.configured": { en: "Configured" },
  "operations.status.value.missing": { en: "Not configured" },
  "operations.incidents.title": { en: "Runtime incidents" },
  "operations.incidents.description": {
    en: "Review repeated system failures, inspect the evidence that was captured, and record containment or release decisions.",
  },
  "operations.incidents.signatures.heading": { en: "Failure signatures" },
  "operations.incidents.summary.signatures": { en: "Signatures" },
  "operations.incidents.summary.signatures.detail": {
    en: "Distinct failure patterns requiring review",
  },
  "operations.incidents.summary.occurrences": { en: "Occurrences" },
  "operations.incidents.summary.occurrences.detail": {
    en: "Recorded events across those patterns",
  },
  "operations.incidents.summary.withCause": { en: "With a cause" },
  "operations.incidents.summary.withCause.detail": {
    en: "Patterns with a provider explanation available",
  },
  "operations.incidents.unreadable.title": {
    en: "Runtime incidents are temporarily unavailable.",
  },
  "operations.incidents.unreadable.detail": {
    en: "Refresh the page or try again shortly.",
  },
  "operations.incidents.unwired.title": {
    en: "Runtime incidents are not available in this workspace.",
  },
  "operations.incidents.unwired.detail": {
    en: "No incident data is connected to the current environment.",
  },
  "operations.incidents.unwired.provenance": {
    en: "Runtime incident data is not enabled for this workspace.",
  },
  "operations.incidents.signatures.subheading": {
    en: "Grouped by event, code and aggregate, most recent occurrence first.",
  },
  "operations.incidents.signatures.caption": {
    en: "Runtime failure signatures with their evidence and decisions",
  },
  "operations.incidents.signatures.empty": {
    en: "No runtime incidents need attention.",
  },
  "operations.incidents.signatures.count": {
    count: "count",
    en: { one: "{count} signature", other: "{count} signatures" },
  },
  "operations.incidents.column.failure": { en: "Failure" },
  "operations.incidents.column.boundary": { en: "Boundary and task" },
  "operations.incidents.column.record": { en: "Record and identifiers" },
  "operations.incidents.column.cause": { en: "Cause" },
  "operations.incidents.column.window": { en: "First and last" },
  "operations.incidents.row.noCode": { en: "No code recorded" },
  "operations.incidents.row.noBoundary": {
    en: "No boundary recorded by this writer",
  },
  "operations.incidents.row.task": { en: "Task {id}" },
  "operations.incidents.row.noTask": { en: "No task identifier recorded" },
  "operations.incidents.row.request": { en: "Request {id}" },
  "operations.incidents.row.auditEvent": { en: "Audit event {id}" },
  "operations.incidents.row.outbox": { en: "Outbox message {id}" },
  "operations.incidents.row.noOutbox": { en: "No outbox message" },
  "operations.incidents.row.firstSeen": { en: "First: {time}" },
  "operations.incidents.cause.codeOnly": { en: "Code only" },
  "operations.incidents.cause.commandAttempt": {
    en: "Provider-supplied, from this command's provisioning attempt",
  },
  "operations.incidents.cause.operationAttempt": {
    en: "Provider-supplied, the provisioning attempt's most recent error",
  },
  "operations.incidents.discard.coerced": {
    en: "{column}, coerced to {pattern} in {module}",
  },
  "operations.incidents.discard.coercedAttemptSurvives": {
    en: "{column}, coerced to {pattern} in {module}; the message survives on the provisioning attempt only while that row is present",
  },
  "operations.incidents.discard.attemptDocument": {
    en: "The provisioning attempt document, whose {field} is the cause when the attempt row is still present",
  },
  "operations.incidents.discard.codeColumn": {
    en: "{column}, which stores the failure code only",
  },
  "operations.incidents.discard.unknown": {
    en: "The writer of this event records a code and no message",
  },
  "operations.incidents.decision.contain": { en: "Record containment" },
  "operations.incidents.decision.contain.confirm": {
    en: "Record this containment",
  },
  "operations.incidents.decision.contain.title": {
    en: "Record containment for {failure}",
  },
  "operations.incidents.decision.contain.effect": {
    en: "Records that this failure is contained and names the containment you applied elsewhere. It applies no containment itself and changes no runtime state.",
  },
  "operations.incidents.decision.release": { en: "Record release" },
  "operations.incidents.decision.release.confirm": {
    en: "Record this release",
  },
  "operations.incidents.decision.release.title": {
    en: "Record release for {failure}",
  },
  "operations.incidents.decision.release.effect": {
    en: "Records that the containment for this failure has been lifted. It restores nothing itself and changes no runtime state.",
  },
  "operations.incidents.decided.contained": { en: "Contained." },
  "operations.incidents.decided.containedWithReason": {
    en: "Contained. {reason}",
  },
  "operations.incidents.decided.released": { en: "Released." },
  "operations.incidents.decided.releasedWithReason": {
    en: "Released. {reason}",
  },
  "operations.incidents.decision.anchor": { en: "Anchored on" },
  "operations.incidents.decision.anchor.detail": {
    en: "The immutable audit event that recorded the failure. Decisions are numbered against it in their own sequence, so no runtime writer's version can collide with one.",
  },
  "operations.incidents.decision.reference": { en: "Containment reference" },
  "operations.incidents.decision.referenceHelp": {
    en: "Optional. Gate key, deploy revision, ticket id or ticket URL, up to {limit} characters. One line of printable text; no quotes, angle brackets, backticks, semicolons or backslashes.",
  },
  "operations.incidents.decision.reasonHelp": {
    en: "Between {min} and {max} characters. Kept with your name on the audit record.",
  },
  "operations.incidents.failure.reasonTooLong": {
    en: "That reason is longer than {max} characters. Shorten it, or put the detail in the ticket you reference.",
  },
  "operations.incidents.failure.referenceInvalid": {
    en: "The containment reference must be one line of printable text, at most {limit} characters, with no quotes, angle brackets, backticks, semicolons or backslashes.",
  },
  "operations.incidents.failure.unavailable": {
    en: "The audit trail cannot be reached.",
  },
  "operations.incidents.failure.notFound": {
    en: "That failure is no longer on the audit trail. Reload the page.",
  },
  "operations.incidents.source.live": {
    en: "Audit trail, durable runtime failure events",
  },
  "operations.incidents.source.demo": {
    en: "Demonstration runtime failure ledger",
  },
  "operations.incidents.source.unavailable": { en: "No audit read completed" },
  "operations.incidents.source.unwired": {
    en: "No service connection is configured",
  },
  "operations.webhookReplay.title": { en: "Stopped provider callbacks" },
  "operations.webhookReplay.description": {
    en: "Provider callbacks that failed or have not been processed. Replay re-runs one from the bytes verified when the provider delivered it.",
  },
  "operations.webhookReplay.freshness.read": { en: "Read at page load" },
  "operations.webhookReplay.freshness.unread": {
    en: "No read completed for this request",
  },
  "operations.webhookReplay.source.live": { en: "Verified provider callbacks" },
  "operations.webhookReplay.source.demo": {
    en: "Demonstration verified callback ledger",
  },
  "operations.webhookReplay.source.unavailable": {
    en: "No callback read is available",
  },
  "operations.webhookReplay.unreadable.title": {
    en: "The callback store could not be read.",
  },
  "operations.webhookReplay.unreadable.detail": {
    en: "This page is showing nothing because no read completed, which is a different state from having no stopped callbacks. Check the service database connection before concluding every callback landed.",
  },
  "operations.webhookReplay.section.heading": { en: "Stopped callbacks" },
  "operations.webhookReplay.section.hint": {
    en: "Provider, event, failure, and how many times it was attempted.",
  },
  "operations.webhookReplay.empty": {
    en: "No callback is stopped. Every verified event either processed or is still within its delivery attempts.",
  },
  "operations.webhookReplay.count": {
    count: "count",
    en: { one: "{count} callback", other: "{count} callbacks" },
  },
  "operations.webhookReplay.column.provider": { en: "Provider" },
  "operations.webhookReplay.column.callback": { en: "Callback" },
  "operations.webhookReplay.column.state": { en: "State" },
  "operations.webhookReplay.column.received": { en: "Received" },
  "operations.webhookReplay.column.lastError": { en: "Last error" },
  "operations.webhookReplay.state.failed": { en: "Failed" },
  "operations.webhookReplay.state.unprocessed": { en: "Not processed" },
  "operations.webhookReplay.state.processed": { en: "Processed" },
  "operations.webhookReplay.action": { en: "Replay" },
  "operations.webhookReplay.confirm": { en: "Replay this callback" },
  "operations.webhookReplay.pending": { en: "Replaying…" },
  "operations.webhookReplay.dialog.title": { en: "Replay {callback}" },
  "operations.webhookReplay.effect": {
    en: "The stored event is processed again from the bytes verified at delivery. A corrected payload cannot be picked up here; ask the provider to redeliver the event for that.",
  },
  "operations.webhookReplay.detail.payloadHash": { en: "Payload hash" },
  "operations.webhookReplay.detail.repeatSubmission": {
    en: "Replays started by submitting twice",
  },
  "operations.webhookReplay.detail.repeatSubmission.answer": {
    en: "One. A second submission reports the run already in flight and starts nothing.",
  },
  "operations.webhookReplay.caption": {
    en: "Stopped provider callbacks with their failure and the replay available",
  },
  "operations.webhookReplay.reasonHelp": {
    en: "At least {min} characters. Give the incident or ticket reference and why replay is safe. Kept with your name on the audit record.",
  },
  "operations.webhookReplay.started": { en: "Replay started." },
  "operations.webhookReplay.failure.recentAuth": {
    en: "Sign in again to confirm it is you, then repeat the replay.",
  },
  "operations.webhookReplay.failure.forbidden": {
    en: "Your permission to replay provider callbacks has changed.",
  },
  "operations.webhookReplay.failure.notFound": {
    en: "No verified callback matches this provider and event id.",
  },
  "operations.webhookReplay.failure.unavailable": {
    en: "The callback store cannot be reached.",
  },
  "operations.webhookReplay.failure.alreadyRunning": {
    en: "A replay for this callback is already running. Nothing new was started.",
  },
  "operations.webhookReplay.failure.failed": {
    en: "The replay could not be started. Nothing changed.",
  },
  "operations.assisted.active": { en: "Assisted mode active" },
  "operations.assisted.effectiveAccount": { en: "Effective account" },
  "operations.assisted.staffActor": { en: "Staff member" },
  "operations.assisted.reasonAndExpiry": { en: "Reason and expiry" },
  "operations.assisted.reasonExpires": { en: "{reason} · expires {time}" },
  "operations.assisted.serverSession": {
    en: "Session {id} records you and the account you are acting for on every action.",
  },
  "operations.assisted.exit": { en: "Exit assisted mode" },
  "operations.gates.unavailable.title": {
    en: "External-gate registry unavailable",
  },
  "operations.gates.unavailable.owner": { en: "Platform operations" },
  "operations.gates.unavailable.capability": {
    en: "All externally gated capabilities",
  },
  "operations.gates.unavailable.activationTest": {
    en: "Not available; activation is denied",
  },
  "operations.gates.unavailable.freshness": {
    en: "No registry read is available for this request",
  },
  "operations.gates.unavailable.reason": {
    en: "The persistent gate registry could not be read. No gate is active.",
  },
  "operations.queue.filter.sla": sameInAllLanguages(
    "SLA",
    "Acronym kept as written in every language (glossary: acronyms kept as-is)",
  ),
  "operations.session.expired": {
    en: "Your session expired. Reload to continue.",
  },
  "operations.session.reload": { en: "Reload" },
});
