import { defineStaffMessages, sameInAllLanguages } from "../define";

/**
 * Price books, PAYG offers, catalog and channel pricing administration. Owned by the adminPricing lane.
 * Staff-only, so English only.
 */
export const adminPricingMessages = defineStaffMessages({
  // ── Shared across the pricing surfaces ──────────────────────────────────
  "adminPricing.version": { en: "Version" },
  "adminPricing.bookName": { en: "{name} v{version}" },
  "adminPricing.priceBookId": { en: "Price book ID" },
  "adminPricing.bookStatus.draft": { en: "Draft" },
  "adminPricing.bookStatus.active": { en: "Active" },
  "adminPricing.bookStatus.retired": { en: "Retired" },
  "adminPricing.pill.financeAuthority": { en: "Finance authority" },
  "adminPricing.pill.readOnly": { en: "Read only" },
  "adminPricing.pill.unavailable": { en: "Unavailable" },
  "adminPricing.pill.noVersions": { en: "No versions" },
  "adminPricing.pill.upToDate": { en: "Up to date" },

  // Rate-card fields: the authoring form, the rate table, the import preview
  // and the economic diff all use these.
  "adminPricing.rate.sku": sameInAllLanguages(
    "SKU",
    "stock-keeping unit acronym, kept as SKU in every console",
  ),
  "adminPricing.rate.unit": { en: "Unit" },
  "adminPricing.rate.minimumQuantity": { en: "Minimum quantity" },
  "adminPricing.rate.listPrice": { en: "List price" },
  "adminPricing.rate.floorPrice": { en: "Floor price" },
  "adminPricing.rate.overageRate": { en: "Overage rate" },
  "adminPricing.rate.commitType": { en: "Commitment model" },
  "adminPricing.rate.approvedClaim": { en: "Approved commercial description" },
  "adminPricing.rate.egressTreatment": { en: "Egress treatment" },
  "adminPricing.rate.taxCode": { en: "Tax code" },
  "adminPricing.rate.stripeTaxCode": { en: "Stripe tax code" },
  "adminPricing.rate.incomeAccount": { en: "Income account" },
  "adminPricing.rate.qboIncomeAccount": { en: "QBO income account" },
  "adminPricing.rate.legacyTrialQuantity": { en: "Legacy trial quantity" },
  "adminPricing.rate.transferPrices": { en: "Transfer prices" },
  "adminPricing.rate.notConfigured": { en: "Not configured" },
  "adminPricing.rate.transferPrice": { en: "{tier}: {amount}" },
  "adminPricing.commitType.termDrawdown": { en: "Term drawdown" },
  "adminPricing.commitType.periodAllowance": { en: "Period allowance" },
  "adminPricing.unit.tbMonth": { en: "TB-month" },
  "adminPricing.unit.tbMonthQuantity": { en: "{quantity} TB-month" },
  "adminPricing.unit.quantity": { en: "{quantity} {unit}" },
  "adminPricing.egress.metered": { en: "Metered" },
  "adminPricing.egress.included": { en: "Included, no egress fee" },
  "adminPricing.error.forbidden": {
    en: "Your role or current session cannot make this change.",
  },
  "adminPricing.error.conflict": {
    en: "This price book changed while you were working. Refresh and review the latest version before trying again.",
  },
  "adminPricing.error.unavailable": {
    en: "The pricing service is unavailable. Nothing was changed.",
  },

  // ── Price books page ────────────────────────────────────────────────────
  "adminPricing.priceBooks.eyebrow": {
    en: "Administration · Commercial controls",
  },
  "adminPricing.priceBooks.title": { en: "Price books" },
  "adminPricing.priceBooks.description": {
    en: "Review rate-card versions, routes, floors and activation readiness. Activation decisions stay with finance approvers.",
  },
  "adminPricing.priceBooks.notice.title": {
    en: "Only activated versions set price.",
  },
  "adminPricing.priceBooks.link.payg": {
    en: "Configure PAYG billing and trial offer policies",
  },
  "adminPricing.priceBooks.link.channel": {
    en: "Configure channel and acquisition controls",
  },
  "adminPricing.priceBooks.activation.authorities": {
    en: "Activation takes two finance approvers: one proposes it, a second decides it.",
  },
  "adminPricing.priceBooks.author.title": { en: "Create a priced draft" },
  "adminPricing.priceBooks.author.description": {
    en: "Create the version metadata, then add its first validated rate card. An empty draft can never be proposed for activation.",
  },
  "adminPricing.priceBooks.author.name": { en: "Price-book name" },
  "adminPricing.priceBooks.author.effectiveFrom": { en: "Effective from" },
  "adminPricing.priceBooks.author.firstStep": {
    en: "This first step creates a draft only. It cannot price a quote until the next step adds a complete rate card and finance later completes the two-authority activation.",
  },
  "adminPricing.priceBooks.author.create": { en: "Create draft and continue" },
  "adminPricing.priceBooks.author.creating": { en: "Creating draft…" },
  "adminPricing.priceBooks.author.created": {
    en: "Draft metadata recorded. Add its first rate card next.",
  },
  "adminPricing.priceBooks.author.createFailed": {
    en: "The draft was not created. Nothing changed.",
  },
  "adminPricing.priceBooks.draftId": { en: "Draft ID" },
  "adminPricing.priceBooks.rateForm.decimalError": {
    en: "Enter each {currency} price with no more than two decimal places.",
  },
  "adminPricing.priceBooks.rateForm.tierError": {
    en: "Each transfer tier needs a unique name and a valid price with at most two decimal places.",
  },
  "adminPricing.priceBooks.rateForm.saved": {
    en: "Rate card saved. Reopen this draft to add or edit more rates, then review it before proposing activation.",
  },
  "adminPricing.priceBooks.rateForm.saveFailed": {
    en: "The rate card was not saved. The draft is unchanged.",
  },
  "adminPricing.priceBooks.rateForm.unitPrice": {
    en: "Unit price ({currency})",
  },
  "adminPricing.priceBooks.rateForm.floorPrice": {
    en: "Floor price ({currency})",
  },
  "adminPricing.priceBooks.rateForm.overageRate": {
    en: "Overage rate ({currency})",
  },
  "adminPricing.priceBooks.rateForm.taxCodeExample": { en: "e.g. {code}" },
  "adminPricing.priceBooks.transfer.legend": { en: "Partner transfer prices" },
  "adminPricing.priceBooks.transfer.help": {
    en: "Wholesale prices by tier, in {currency}. These apply only to resale and distributor routes and remain subject to the floor. Leave empty for a direct-only rate.",
  },
  "adminPricing.priceBooks.transfer.tier": { en: "Transfer tier {number}" },
  "adminPricing.priceBooks.transfer.price": {
    en: "Transfer price {number} ({currency})",
  },
  "adminPricing.priceBooks.transfer.remove": {
    en: "Remove transfer tier {number}",
  },
  "adminPricing.priceBooks.transfer.add": { en: "Add transfer tier" },
  "adminPricing.priceBooks.rateForm.validating": { en: "Validating rate…" },
  "adminPricing.priceBooks.rateForm.save": { en: "Save rate card" },
  "adminPricing.priceBooks.rateForm.add": { en: "Add rate card" },
  "adminPricing.priceBooks.rateForm.close": { en: "Close draft editor" },
  "adminPricing.priceBooks.versions.title": { en: "Price book versions" },
  "adminPricing.priceBooks.source.service": { en: "Pricing service" },
  "adminPricing.priceBooks.source.demo": { en: "Guided demo data" },
  "adminPricing.priceBooks.source.unavailable": {
    en: "Pricing service unavailable",
  },
  "adminPricing.priceBooks.filters.label": { en: "Price book filters" },
  "adminPricing.priceBooks.filters.search": { en: "Search price books" },
  "adminPricing.priceBooks.filters.placeholder": {
    en: "Name, version, currency or region",
  },
  "adminPricing.priceBooks.versions.count": {
    count: "count",
    en: {
      one: "{shown} of {count} version",
      other: "{shown} of {count} versions",
    },
  },
  "adminPricing.priceBooks.versions.sortNote": {
    en: "Sorted by currency, then newest version",
  },
  "adminPricing.priceBooks.versions.caption": {
    en: "Price book versions and activation readiness",
  },
  "adminPricing.priceBooks.col.regions": { en: "Regions" },
  "adminPricing.priceBooks.col.effective": { en: "Effective" },
  "adminPricing.priceBooks.col.rateCards": { en: "Rate cards" },
  "adminPricing.priceBooks.col.activation": { en: "Activation" },
  "adminPricing.priceBooks.effectiveRange": { en: "{from} to {to}" },
  "adminPricing.priceBooks.effectiveFrom": { en: "From {from}" },
  "adminPricing.priceBooks.activation.scheduled": {
    en: "Scheduled for {date}",
  },
  "adminPricing.priceBooks.activation.proposedBy": {
    en: "Proposed by {email}",
  },
  "adminPricing.priceBooks.activation.notProposed": { en: "Not proposed" },
  "adminPricing.priceBooks.activation.decided": { en: "Decided" },
  "adminPricing.priceBooks.activation.proposeLabel": {
    en: "Propose activation",
  },
  "adminPricing.priceBooks.activation.proposeHint": {
    en: "A second finance approver decides it. Floors, regions and version are checked again then.",
  },
  "adminPricing.priceBooks.activation.approveLabel": {
    en: "Approve and activate",
  },
  "adminPricing.priceBooks.activation.approveHint": {
    en: "This retires the current version for the currency and sets price for new quotes.",
  },
  "adminPricing.priceBooks.activation.retireLabel": {
    en: "Retire this version",
  },
  "adminPricing.priceBooks.activation.retireHint": {
    en: "Quotes, orders and invoices already priced from it stay as they are.",
  },
  "adminPricing.priceBooks.activation.proposed": {
    en: "Proposed. A second finance approver decides it.",
  },
  "adminPricing.priceBooks.activation.activated": {
    en: "Activated. This version sets price for new quotes.",
  },
  "adminPricing.priceBooks.activation.retired": {
    en: "Retired. Nothing already priced from it changed.",
  },
  "adminPricing.priceBooks.activation.stale": {
    en: "This version changed while the page was open. Reload it and review the current version.",
  },
  "adminPricing.priceBooks.activation.failed": {
    en: "The decision was not recorded. Nothing changed.",
  },
  "adminPricing.priceBooks.activation.awaitingSecondTitle": {
    en: "Awaiting a second approver",
  },
  "adminPricing.priceBooks.activation.awaitingSecondBody": {
    en: "You proposed this activation. Another finance approver decides it.",
  },
  "adminPricing.priceBooks.activation.financeOnlyTitle": {
    en: "Finance approval authority is required.",
  },
  "adminPricing.priceBooks.activation.financeOnlyBody": {
    en: "Other internal roles may scan versions. Only finance may decide activation.",
  },
  "adminPricing.priceBooks.activation.noDecision": {
    en: "This version has no decision open to you.",
  },
  "adminPricing.priceBooks.activation.empty": {
    en: "The pricing service is available, but no price books exist yet.",
  },
  "adminPricing.priceBooks.activation.unreadable": {
    en: "No price books are readable for this request.",
  },
  "adminPricing.priceBooks.activation.noMatches": {
    en: "No price-book versions match these filters.",
  },
  "adminPricing.priceBooks.review.cancelTitle": {
    en: "Schedule cancellation review",
  },
  "adminPricing.priceBooks.review.activationTitle": {
    en: "Finance activation review",
  },
  "adminPricing.priceBooks.review.summaryTitle": {
    en: "Price-book activation review",
  },
  "adminPricing.priceBooks.review.scope": {
    en: "A review creates no quote, order or invoice, and claims no amount as collected.",
  },
  "adminPricing.priceBooks.review.impact.cancel": {
    en: "Cancels the approved schedule and unlocks this draft for editing. Current active pricing stays in place.",
  },
  "adminPricing.priceBooks.review.impact.approve": {
    count: "count",
    en: {
      one: "Approves {count} rate card across {regions} from {date}.",
      other: "Approves {count} rate cards across {regions} from {date}.",
    },
  },
  "adminPricing.priceBooks.review.impact.approveEmpty": {
    en: "Approves a version with no rate cards from {date}.",
  },
  "adminPricing.priceBooks.review.evidence.saved": {
    count: "count",
    en: {
      one: "{count} rate card saved",
      other: "{count} rate cards saved",
    },
  },
  "adminPricing.priceBooks.review.evidence.scheduleEffective": {
    en: "Approved schedule effective {date}",
  },
  "adminPricing.priceBooks.review.evidence.notProposed": {
    en: "Not yet proposed",
  },
  "adminPricing.priceBooks.review.evidence.noPriorDecision": {
    en: "No earlier decision recorded",
  },
  "adminPricing.priceBooks.review.policyBasis": {
    en: "Commercial policy CP-2 requires versioned rate cards, explicit routes, regional floors and two finance approvers.",
  },
  "adminPricing.priceBooks.review.downstream.cancel": {
    en: "No price book is activated or retired. The cancellation and the earlier approval stay in the history; this draft needs a new proposal and approval by a different finance approver before any later activation.",
  },
  "adminPricing.priceBooks.review.downstream.approve": {
    en: "Activation makes this version eligible for new pricing. Retained quote, order, invoice and collection economics stay unchanged; retiring the current book stops draft issuance and revisions on it.",
  },
  "adminPricing.priceBooks.review.selector": { en: "Price book version" },
  "adminPricing.priceBooks.review.selectorHint": {
    en: "Search by name or version. The technical ID is submitted securely.",
  },
  "adminPricing.priceBooks.rateCardCount": {
    count: "count",
    en: { one: "{count} rate card", other: "{count} rate cards" },
  },
  "adminPricing.priceBooks.review.proposedBy": { en: "Proposed by" },
  "adminPricing.priceBooks.export.download": { en: "Download price book" },
  "adminPricing.priceBooks.export.unsupported": {
    en: "This price book cannot use the strict v2 exchange format. Check that all rates are complete and supported before exporting.",
  },
  "adminPricing.priceBooks.review.addRate": { en: "Add a rate to this draft" },
  "adminPricing.priceBooks.review.reopened": {
    en: "Draft reopened. Add another SKU or region, or edit a rate below.",
  },
  "adminPricing.priceBooks.rates.caption": { en: "Rate card economics" },
  "adminPricing.priceBooks.rates.skuRegion": { en: "SKU / region" },
  "adminPricing.priceBooks.rates.terms": { en: "Commercial terms" },
  "adminPricing.priceBooks.rates.details": {
    en: "Description, codes and transfer prices",
  },
  "adminPricing.priceBooks.rates.editLabel": {
    en: "Edit rate {sku} in {region}",
  },
  "adminPricing.priceBooks.rates.removeLabel": {
    en: "Remove rate {sku} in {region}",
  },
  "adminPricing.priceBooks.rates.removed": {
    en: "Rate removed from the draft. Review the remaining rates before proposing activation.",
  },
  "adminPricing.priceBooks.rates.removeFailed": {
    en: "The rate was not removed.",
  },
  "adminPricing.priceBooks.rates.empty": {
    en: "No rate cards yet. Add a rate before proposing activation.",
  },
  "adminPricing.priceBooks.review.replaces": {
    en: "Activation replaces {book} for {currency}. Only one price book can be active per currency, even when the new version has a different name. Review removed rates before approval.",
  },
  "adminPricing.priceBooks.diff.caption": {
    en: "Economic changes from {book}",
  },
  "adminPricing.priceBooks.diff.field": { en: "Changed field" },
  "adminPricing.priceBooks.diff.current": { en: "Current active value" },
  "adminPricing.priceBooks.diff.candidate": { en: "Candidate value" },
  "adminPricing.priceBooks.diff.empty": {
    en: "No rate or discount authority changes from the active version.",
  },
  "adminPricing.priceBooks.review.noActive": {
    en: "No active price book exists for this currency. Review the complete rate table above.",
  },
  "adminPricing.priceBooks.review.reason": { en: "Finance decision reason" },
  "adminPricing.priceBooks.review.reasonPlaceholder": {
    en: "Explain the commercial evidence and why activation is justified.",
  },
  "adminPricing.priceBooks.review.otherSchedule": {
    en: "{book} has an approved schedule for {currency}. Cancel that schedule before approving another scheduled or immediate activation.",
  },
  "adminPricing.priceBooks.schedule.heading": { en: "Activation schedule" },
  "adminPricing.priceBooks.schedule.status.approved": { en: "Approved" },
  "adminPricing.priceBooks.schedule.status.executed": { en: "Executed" },
  "adminPricing.priceBooks.schedule.status.cancelled": { en: "Cancelled" },
  "adminPricing.priceBooks.schedule.status.expired": { en: "Expired" },
  "adminPricing.priceBooks.schedule.window": {
    en: "Effective from {from} (UTC) through {to}.",
  },
  "adminPricing.priceBooks.schedule.windowOpen": {
    en: "Effective from {from} (UTC).",
  },
  "adminPricing.priceBooks.schedule.locked": {
    en: "This reviewed version is locked.",
  },
  "adminPricing.priceBooks.schedule.demoNote": {
    en: "This fictional schedule demonstrates advance approval and cancellation; it does not run the production worker.",
  },
  "adminPricing.priceBooks.schedule.workerNote": {
    en: "From the effective date, the worker checks every minute and rechecks finance authority and the new-business control before changing current pricing.",
  },
  "adminPricing.priceBooks.schedule.cancelToReopen": {
    en: "Cancel this schedule to reopen the draft.",
  },
  "adminPricing.priceBooks.review.futureEffective": {
    en: "Activation is available on or after {date} (UTC). A different finance approver can approve its schedule now, or return then for immediate activation. Current active pricing stays in place until execution.",
  },
  "adminPricing.priceBooks.review.expired": {
    en: "This draft’s effective period has expired. Return it for changes or create a new draft with current dates before approval.",
  },
  "adminPricing.priceBooks.review.loadingSaved": {
    en: "Loading saved price-book changes before review…",
  },
  "adminPricing.priceBooks.review.refreshSaved": {
    en: "Refresh saved changes",
  },
  "adminPricing.priceBooks.review.changed": {
    en: "The price book changed after your review. Review the current version before recording a decision.",
  },
  "adminPricing.priceBooks.review.submit": { en: "Review price-book approval" },
  "adminPricing.priceBooks.clone.summary": {
    en: "Clone this version into a draft",
  },
  "adminPricing.priceBooks.clone.copies": {
    count: "count",
    en: {
      one: "Copies the {count} saved rate into a new {currency} draft, with its floor, transfer prices, tax and accounting codes and the discount rules.",
      other:
        "Copies the {count} saved rates into a new {currency} draft, with their floors, transfer prices, tax and accounting codes and the discount rules.",
    },
  },
  "adminPricing.priceBooks.clone.notes": {
    en: "The source stays unchanged. Approval history and provider resource bindings are not copied; review catalog mappings before proposing the new version.",
  },
  "adminPricing.priceBooks.clone.formLabel": { en: "Clone price book" },
  "adminPricing.priceBooks.clone.invalid": {
    en: "Check the clone name, new version, effective date and reason.",
  },
  "adminPricing.priceBooks.versionExists": {
    en: "{currency} version {version} already exists. Choose a new version.",
  },
  "adminPricing.priceBooks.clone.done": {
    en: "Draft cloned. Review its copied economics and configure catalog mappings before requesting fresh approval.",
  },
  "adminPricing.priceBooks.clone.duplicate": {
    en: "This currency and version, or the new draft’s identity, already exist. Choose a new version.",
  },
  "adminPricing.priceBooks.clone.conflict": {
    en: "The source changed, or this currency and version already exist. Refresh and choose a new version.",
  },
  "adminPricing.priceBooks.clone.failed": {
    en: "The draft was not cloned. Refresh the source and check that the new currency and version are unused.",
  },
  "adminPricing.priceBooks.clone.legend": { en: "New {currency} draft" },
  "adminPricing.priceBooks.clone.name": { en: "Cloned price-book name" },
  "adminPricing.priceBooks.clone.version": { en: "Cloned price-book version" },
  "adminPricing.priceBooks.clone.effective": { en: "Cloned effective date" },
  "adminPricing.priceBooks.clone.reason": { en: "Clone reason" },
  "adminPricing.priceBooks.clone.submit": { en: "Create cloned draft" },
  "adminPricing.priceBooks.clone.busy": { en: "Cloning…" },
  "adminPricing.priceBooks.clone.needsRate": {
    en: "Add at least one rate before cloning this price book.",
  },
  "adminPricing.priceBooks.decision.label": { en: "Record the decision" },
  "adminPricing.priceBooks.decision.cancelSchedule": {
    en: "Cancel approved schedule",
  },
  "adminPricing.priceBooks.decision.cancelScheduleHint": {
    en: "Keeps the decision history and current active pricing. The draft becomes editable and needs a new proposal and approval.",
  },
  "adminPricing.priceBooks.decision.schedule": {
    en: "Approve scheduled activation",
  },
  "adminPricing.priceBooks.decision.scheduleHint": {
    en: "Locks this exact version for execution from its effective date. Current pricing remains active until execution. Only one approved schedule per currency is allowed.",
  },
  "adminPricing.priceBooks.decision.reject": { en: "Return draft for changes" },
  "adminPricing.priceBooks.decision.rejectHint": {
    en: "Records your reason and reopens the draft for editing. A new proposal is required before activation.",
  },
  "adminPricing.priceBooks.decision.recording": { en: "Recording…" },
  "adminPricing.priceBooks.outcome.scheduled": {
    en: "Scheduled activation approved. The exact reviewed version is locked until execution or cancellation.",
  },
  "adminPricing.priceBooks.outcome.cancelled": {
    en: "Schedule cancelled. Current pricing is unchanged; the draft needs a new approval.",
  },
  "adminPricing.priceBooks.outcome.rejected": {
    en: "Activation rejected. The draft can be edited and proposed again.",
  },
  // ── PAYG and trial policies (payg-offers.tsx, demo PAYG pages) ─────────
  "adminPricing.payg.eyebrow": { en: "Commercial administration" },
  "adminPricing.payg.title": { en: "PAYG and trial policies" },
  "adminPricing.payg.requestsPageTitle": {
    en: "Customer PAYG and trial requests",
  },
  "adminPricing.payg.description": {
    en: "Configure versioned usage pricing and trial rules. Drafts require a distinct finance approver. Approval records policy readiness; provider mappings, external gates, and account cutover still control activation.",
  },
  "adminPricing.payg.priceBooksLink": { en: "Committed price books" },
  "adminPricing.payg.requestsLink": {
    en: "Review customer activation, trial and cancellation requests",
  },
  "adminPricing.payg.demoNotice": {
    en: "Fictional policy workspace. Changes persist until demo reset. Review the proposal from a different demo author or create a draft. No enrollment, provider verification, billing execution, or live policy approval occurs here.",
  },
  "adminPricing.payg.unavailable": {
    en: "The policy database is unavailable. No policy versions are shown and changes cannot be saved.",
  },
  "adminPricing.payg.financeRequired": {
    en: "Finance approver access is required to manage these policies.",
  },
  "adminPricing.payg.status.draft": { en: "Draft" },
  "adminPricing.payg.status.proposed": { en: "Proposed" },
  "adminPricing.payg.status.approved": { en: "Approved" },
  "adminPricing.payg.status.retired": { en: "Retired" },
  "adminPricing.payg.saved.draft": {
    en: "Policy version {version} is a draft. Sales activation is unchanged.",
  },
  "adminPricing.payg.saved.proposed": {
    en: "Policy version {version} is proposed for finance approval. Sales activation is unchanged.",
  },
  "adminPricing.payg.saved.approved": {
    en: "Policy version {version} is approved. Sales activation is unchanged.",
  },
  "adminPricing.payg.saved.retired": {
    en: "Policy version {version} is retired for future enrollments. Sales activation is unchanged.",
  },
  "adminPricing.payg.versions.title": { en: "Policy versions" },
  "adminPricing.payg.versions.new": { en: "New policy draft" },
  "adminPricing.payg.versions.option": {
    en: "{name} · {region} · v{version} · {status}",
  },
  "adminPricing.payg.versions.none": {
    en: "No saved PAYG or trial policy versions.",
  },
  "adminPricing.payg.selected.label": { en: "Selected policy" },
  "adminPricing.payg.selected.pricing": {
    en: "{price} per TB-month; monthly minimum {minimum}. Partial-month minimum: {partial}.",
  },
  "adminPricing.payg.selected.trial": {
    en: "Trial: {duration}, then {grace} read-only. Storage cap: {storage}. Cumulative egress cap: {egress}.",
  },
  "adminPricing.payg.days": {
    count: "count",
    en: { one: "{count} day", other: "{count} days" },
  },
  "adminPricing.payg.notSpecified": { en: "Not specified" },
  "adminPricing.payg.selected.fullEvidence": {
    en: "Full policy and approval evidence",
  },
  "adminPricing.payg.decision.reason": { en: "Decision reason" },
  "adminPricing.payg.decision.evidence": { en: "Approval evidence reference" },
  "adminPricing.payg.decision.propose": { en: "Propose for finance approval" },
  "adminPricing.payg.decision.approve": { en: "Approve policy version" },
  "adminPricing.payg.decision.reject": { en: "Return to draft" },
  "adminPricing.payg.decision.retire": { en: "Retire for future enrollments" },
  "adminPricing.payg.decision.distinctRequired": {
    en: "A different finance approver must review this version.",
  },

  // PAYG monthly rating preview
  "adminPricing.payg.simulator.title": { en: "Monthly rating preview" },
  "adminPricing.payg.simulator.description": {
    en: "Uses the saved policy and a full UTC calendar month. This simulation creates no customer enrollment or invoice. Taxes are excluded.",
  },
  "adminPricing.payg.simulator.month": { en: "Service month" },
  "adminPricing.payg.simulator.storage": { en: "Average daily storage (TB)" },
  "adminPricing.payg.simulator.egress": { en: "Total monthly egress (TB)" },
  "adminPricing.payg.simulator.operations": { en: "Total API operations" },
  "adminPricing.payg.simulator.calculating": { en: "Calculating…" },
  "adminPricing.payg.simulator.calculate": { en: "Calculate monthly estimate" },
  "adminPricing.payg.simulator.total": {
    en: "Estimated monthly total: {amount}",
  },
  "adminPricing.payg.simulator.line.storage": { en: "Storage" },
  "adminPricing.payg.simulator.line.egress": { en: "Egress" },
  "adminPricing.payg.simulator.line.api": { en: "API operations" },
  "adminPricing.payg.simulator.line.minimum": {
    en: "Monthly minimum adjustment",
  },

  // PAYG policy form
  "adminPricing.payg.form.offerAndEvidence": { en: "Offer and evidence" },
  "adminPricing.payg.form.name": { en: "Policy name" },
  "adminPricing.payg.form.sku": { en: "Provisionable SKU" },
  "adminPricing.payg.form.region": { en: "Region code" },
  "adminPricing.payg.form.version": { en: "Offer version" },
  "adminPricing.payg.form.effectiveFrom": { en: "Effective from" },
  "adminPricing.payg.form.owner": { en: "Policy owner" },
  "adminPricing.payg.form.sourceUri": { en: "Evidence link" },
  "adminPricing.payg.form.sourceUriHint": {
    en: "HTTPS document URL without a query string or fragment.",
  },
  "adminPricing.payg.form.sourceCheckedAt": { en: "Evidence checked on (UTC)" },
  "adminPricing.payg.form.sourceDocumentId": {
    en: "Source document reference",
  },
  "adminPricing.payg.form.pricingHeading": { en: "Monthly PAYG pricing" },
  "adminPricing.payg.form.pricingDescription": {
    en: "Average daily storage uses hourly measurements in UTC. One TB is {bytes} bytes. Egress and API operations are recorded at zero charge.",
  },
  "adminPricing.payg.form.storagePrice": { en: "Price per TB-month" },
  "adminPricing.payg.form.storagePriceHint": {
    en: "Amount in the selected currency, with a decimal point, such as {example}.",
  },
  "adminPricing.payg.form.storagePriceAmountHint": {
    en: "Amount in the selected currency, with up to two decimal places, such as {example}.",
  },
  "adminPricing.payg.form.minimum": { en: "Monthly minimum charge" },
  "adminPricing.payg.form.partialMinimum": {
    en: "Minimum for the first and final partial months",
  },
  "adminPricing.payg.form.selectTreatment": { en: "Select approved treatment" },
  "adminPricing.payg.form.partial.full": { en: "Full monthly minimum" },
  "adminPricing.payg.form.partial.prorated": {
    en: "Prorated by service hours",
  },
  "adminPricing.payg.form.correctionWindow": {
    en: "Automatic correction window (days)",
  },
  "adminPricing.payg.form.correctionWindowHint": {
    en: "After the service period; later corrections require finance review.",
  },
  "adminPricing.payg.form.trialHeading": { en: "Trial limits and access" },
  "adminPricing.payg.form.trialDuration": { en: "Trial duration (days)" },
  "adminPricing.payg.form.gracePeriod": { en: "Read-only grace period (days)" },
  "adminPricing.payg.form.storageLimit": { en: "Storage limit (bytes)" },
  "adminPricing.payg.form.storageLimitHint": { en: "1 TB = {bytes} bytes." },
  "adminPricing.payg.form.egressLimit": {
    en: "Cumulative trial egress limit (bytes)",
  },
  "adminPricing.payg.form.egressLimitHint": {
    en: "This budget does not reset each month.",
  },
  "adminPricing.payg.form.counterAge": {
    en: "Maximum usage counter age (seconds)",
  },
  "adminPricing.payg.form.egressExhaustion": {
    en: "When the egress budget is exhausted",
  },
  "adminPricing.payg.form.selectBehavior": { en: "Select approved behavior" },
  "adminPricing.payg.form.exhaustion.disableAll": { en: "Disable all access" },
  "adminPricing.payg.form.exhaustion.blockEgress": { en: "Block egress only" },
  "adminPricing.payg.form.exhaustionNote": {
    en: "Storage exhaustion blocks writes. Trial expiry starts the read-only grace period; the account is disabled when grace ends. Automatic deletion is not configured here.",
  },
  "adminPricing.payg.form.customerHeading": {
    en: "Customer request notices and terms",
  },
  "adminPricing.payg.form.customerDescription": {
    en: "Configure approved documents before offering this version to customers. These flags permit collecting requests; they do not activate billing, provision a tenant, or authorize a provider cutover.",
  },
  "adminPricing.payg.form.includeCustomerPolicy": {
    en: "Include customer acquisition policy",
  },
  "adminPricing.payg.form.acceptPayg": {
    en: "Accept PAYG activation requests",
  },
  "adminPricing.payg.form.acceptTrial": { en: "Accept trial requests" },
  "adminPricing.payg.form.serviceNotice": { en: "Service and billing notice" },
  "adminPricing.payg.form.cancellationNotice": {
    en: "Cancellation and service-end notice",
  },
  "adminPricing.payg.form.trialNotice": {
    en: "Trial eligibility and expiry notice",
  },
  "adminPricing.payg.form.terms.heading": { en: "Terms" },
  "adminPricing.payg.form.terms.documentId": { en: "Terms document reference" },
  "adminPricing.payg.form.terms.version": { en: "Terms document version" },
  "adminPricing.payg.form.terms.uri": { en: "Terms document URL" },
  "adminPricing.payg.form.terms.hash": {
    en: "SHA-256 of the exact terms document",
  },
  "adminPricing.payg.form.retention.heading": { en: "Retention policy" },
  "adminPricing.payg.form.retention.documentId": {
    en: "Retention policy document reference",
  },
  "adminPricing.payg.form.retention.version": {
    en: "Retention policy document version",
  },
  "adminPricing.payg.form.retention.uri": {
    en: "Retention policy document URL",
  },
  "adminPricing.payg.form.retention.hash": {
    en: "SHA-256 of the exact retention policy document",
  },
  "adminPricing.payg.form.saveDraft": { en: "Save draft" },
  "adminPricing.payg.form.createDraft": { en: "Create policy draft" },

  // Verified trial lifecycle
  "adminPricing.payg.trials.title": { en: "Verified trial lifecycle" },
  "adminPricing.payg.trials.description": {
    en: "Record a trial only for a mapped provider tenant and an existing server-verified domain. One claim is retained for each organization and domain. This does not provision storage or enable a live trial adapter.",
  },
  "adminPricing.payg.trials.refresh": { en: "Refresh trial claims" },
  "adminPricing.payg.trials.none": { en: "No trial claims are recorded." },
  "adminPricing.payg.trials.claimed": {
    en: "Lifetime trial claim {id} retained. Provider enforcement requires the verified authorization adapter.",
  },
  "adminPricing.payg.trials.converted": {
    en: "Trial {id} converted to its confirmed paid binding. Tenant and stored data are preserved.",
  },
  "adminPricing.payg.trials.rowConverted": {
    en: "Trial {id} · {domain} · converted {time}",
  },
  "adminPricing.payg.trials.rowActive": {
    en: "Trial {id} · {domain} · write access expires {time}",
  },
  "adminPricing.payg.trials.recordClaim": { en: "Record verified trial claim" },
  "adminPricing.payg.trials.organizationId": { en: "Organization ID" },
  "adminPricing.payg.trials.approvedPolicy": { en: "Approved trial policy" },
  "adminPricing.payg.trials.evidence": {
    en: "Persisted domain verification reference",
  },
  "adminPricing.payg.trials.evidencePlaceholder": {
    en: "{registration} or {dns}",
  },
  "adminPricing.payg.trials.recordClaimButton": { en: "Record trial claim" },
  "adminPricing.payg.trials.confirmConversion": {
    en: "Confirm paid conversion",
  },
  "adminPricing.payg.trials.trialId": { en: "Trial ID" },
  "adminPricing.payg.trials.paidSource": { en: "Confirmed paid source" },
  "adminPricing.payg.trials.paidSource.payg": { en: "PAYG enrollment" },
  "adminPricing.payg.trials.paidSource.term": {
    en: "Active committed entitlement",
  },
  "adminPricing.payg.trials.paidSourceId": { en: "Paid source ID" },
  "adminPricing.payg.trials.confirmConversionButton": {
    en: "Confirm trial conversion",
  },

  // Verified PAYG enrollment
  "adminPricing.payg.enrollments.title": { en: "Verified PAYG enrollment" },
  "adminPricing.payg.enrollments.refresh": { en: "Refresh enrollments" },
  "adminPricing.payg.enrollments.none": {
    en: "No verified enrollments are recorded.",
  },
  "adminPricing.payg.enrollments.rowActive.clockwork": {
    en: "Enrollment {id} · account {account} · billed by Fil One Commerce · service from {time}",
  },
  "adminPricing.payg.enrollments.rowActive.filOne": {
    en: "Enrollment {id} · account {account} · billed by Fil One · service from {time}",
  },
  "adminPricing.payg.enrollments.rowEnded.clockwork": {
    en: "Enrollment {id} · account {account} · billed by Fil One Commerce · service ended {time}",
  },
  "adminPricing.payg.enrollments.rowEnded.filOne": {
    en: "Enrollment {id} · account {account} · billed by Fil One · service ended {time}",
  },
  "adminPricing.payg.enrollments.description": {
    en: "Record an existing verified provider entitlement and its approved commercial cutover. This records billing authority; it does not create a provider account or stop storage service.",
  },
  "adminPricing.payg.enrollments.record": { en: "Record verified enrollment" },
  "adminPricing.payg.enrollments.approvedPolicy": { en: "Approved policy" },
  "adminPricing.payg.enrollments.accountId": { en: "Customer account ID" },
  "adminPricing.payg.enrollments.organizationId": {
    en: "Verified provider organization ID",
  },
  "adminPricing.payg.enrollments.tenantId": {
    en: "Verified provider tenant ID",
  },
  "adminPricing.payg.enrollments.entitlementId": {
    en: "Verified provider entitlement ID",
  },
  "adminPricing.payg.enrollments.source": { en: "Metering source name" },
  "adminPricing.payg.enrollments.mappingVersionId": {
    en: "Verified mapping version",
  },
  "adminPricing.payg.enrollments.bindingEvidenceId": {
    en: "Identity verification evidence reference",
  },
  "adminPricing.payg.enrollments.startsAt": {
    en: "Confirmed service start (UTC, full hour)",
  },
  "adminPricing.payg.enrollments.billingAuthority": { en: "Billing authority" },
  "adminPricing.payg.enrollments.authority.filOne": {
    en: "Fil One retains billing",
  },
  "adminPricing.payg.enrollments.authority.clockwork": {
    en: "Fil One Commerce, with approved cutover evidence",
  },
  "adminPricing.payg.enrollments.cutoverEvidence": {
    en: "Approved cutover evidence reference",
  },
  "adminPricing.payg.enrollments.recordButton": { en: "Record enrollment" },
  "adminPricing.payg.enrollments.retained": {
    en: "Enrollment {id} retained. Its approved policy and provider identity are now frozen.",
  },
  "adminPricing.payg.enrollments.cancelSummary": {
    en: "Record confirmed service cancellation",
  },
  "adminPricing.payg.enrollments.enrollmentId": { en: "Enrollment ID" },
  "adminPricing.payg.enrollments.serviceEnd": {
    en: "Confirmed service end (UTC, full hour)",
  },
  "adminPricing.payg.enrollments.serviceEndEvidence": {
    en: "Provider service-end evidence reference",
  },
  "adminPricing.payg.enrollments.recordCancellation": {
    en: "Record confirmed cancellation",
  },
  "adminPricing.payg.enrollments.cancellationRetained": {
    en: "Confirmed service end retained. The next billing sweep will close the final service period.",
  },

  // Retained billing effects
  "adminPricing.payg.billing.title": { en: "Retained billing effects" },
  "adminPricing.payg.billing.description": {
    en: "Review rated periods and corrections, then create the corresponding financial documents. Each effect can be materialized once; provider delivery remains subject to capability gates. Corrections to paid invoices create customer balance credits; cash refunds require a separate approved refund.",
  },
  "adminPricing.payg.billing.refresh": { en: "Refresh billing queue" },
  "adminPricing.payg.billing.none": {
    en: "No billing effects are waiting for a document.",
  },
  "adminPricing.payg.billing.creditNotesSaved": {
    count: "count",
    en: {
      one: "Credit note {ids} saved and queued for provider delivery.",
      other: "Credit notes {ids} saved and queued for provider delivery.",
    },
  },
  "adminPricing.payg.billing.invoiceSaved": {
    en: "Invoice {id} saved and queued for provider delivery.",
  },
  "adminPricing.payg.billing.row": {
    en: "{month} · {kind} · {amount} · account {account}",
  },
  "adminPricing.payg.billing.kind.debitAdjustment": { en: "Debit adjustment" },
  "adminPricing.payg.billing.kind.creditAdjustment": {
    en: "Credit adjustment",
  },
  "adminPricing.payg.billing.create": { en: "Create financial document" },

  // PAYG API problems and local validation, as the reader sees them
  "adminPricing.payg.error.bindingMismatch": {
    en: "The approved policy must match this provider entitlement and be effective on the service start date.",
  },
  "adminPricing.payg.error.trialAccountNotCleared": {
    en: "The customer account must clear screening before a trial is claimed.",
  },
  "adminPricing.payg.error.trialAlreadyUsed": {
    en: "This organization or verified domain has already claimed a trial. Its lifetime eligibility cannot be reset.",
  },
  "adminPricing.payg.error.trialDomainEvidence": {
    en: "Use a retained successful registration verification event or verified DNS domain record for this organization’s account.",
  },
  "adminPricing.payg.error.trialTenantRequired": {
    en: "The organization needs a verified provider tenant mapping before a trial can be recorded.",
  },
  "adminPricing.payg.error.trialPaidNotConfirmed": {
    en: "The paid source must be active, verified, and bound to the same account and tenant.",
  },
  "adminPricing.payg.error.trialPolicyRequired": {
    en: "Choose an approved trial policy with retained approval evidence.",
  },
  "adminPricing.payg.error.enrollmentAlreadyBound": {
    en: "This provider entitlement already has an enrollment. Refresh the enrollment list to inspect its retained identity.",
  },
  "adminPricing.payg.error.stripeCustomerUnmapped": {
    en: "The customer account needs a verified Stripe customer mapping before enrollment.",
  },
  "adminPricing.payg.error.enrollmentEvidenceRequired": {
    en: "Identity verification and approved Fil One Commerce billing cutover evidence are required.",
  },
  "adminPricing.payg.error.creditOriginalNotIssued": {
    en: "The original invoices must finish provider delivery before this correction can create credits.",
  },
  "adminPricing.payg.error.enrollmentStartInvalid": {
    en: "Enter a confirmed past service start at an exact UTC hour.",
  },
  "adminPricing.payg.error.cancellationRequired": {
    en: "Enter a confirmed past service end at an exact UTC hour, with provider evidence.",
  },
  "adminPricing.payg.error.enrollmentReplayConflict": {
    en: "This enrollment is already recorded with different source or billing evidence.",
  },
  "adminPricing.payg.error.versionExists": {
    en: "This SKU, region, and offer version already exists. Open the existing draft or choose a new version.",
  },
  "adminPricing.payg.error.staleVersion": {
    en: "This version changed. Refresh the page before trying again.",
  },
  "adminPricing.payg.error.distinctApprover": {
    en: "A finance approver who did not create, edit, or propose this version must decide.",
  },
  "adminPricing.payg.error.financeAuthority": {
    en: "Your persisted finance membership and MFA enrollment are required to change policies.",
  },
  "adminPricing.payg.error.unavailable": {
    en: "The policy service is unavailable. Your changes were not saved.",
  },
  "adminPricing.payg.error.recentAuthentication": {
    en: "Sign in again before changing commercial policy.",
  },
  "adminPricing.payg.error.sourceCheckedInFuture": {
    en: "The evidence check date cannot be in the future.",
  },
  "adminPricing.payg.error.taxReview": {
    en: "The account tax evidence requires finance review before an invoice can be created.",
  },
  "adminPricing.payg.error.validation": {
    en: "Check every required field. Evidence links must use HTTPS and contain no query string, fragment, or credentials.",
  },
  "adminPricing.payg.error.notSaved": {
    en: "The policy change was not saved. Refresh the page and check your finance access.",
  },
  "adminPricing.payg.error.csrf": {
    en: "Refresh the page to restore the secure form token.",
  },
  "adminPricing.payg.error.moneyFormat": {
    en: "Enter monetary amounts with at most two decimal places.",
  },
  "adminPricing.payg.error.tbFormat": {
    en: "Enter TB as a non-negative number with at most twelve decimal places.",
  },
  "adminPricing.payg.error.simulationFailed": {
    en: "The simulation could not be completed.",
  },
  "adminPricing.payg.error.draftNotSaved": { en: "The draft was not saved." },
  "adminPricing.payg.error.trialListUnavailable": {
    en: "The trial claim list is unavailable.",
  },
  "adminPricing.payg.error.trialCommandFailed": {
    en: "The trial record was not saved.",
  },
  "adminPricing.payg.error.enrollmentListUnavailable": {
    en: "The enrollment list is unavailable.",
  },
  "adminPricing.payg.error.choosePolicy": {
    en: "Choose an approved policy version.",
  },
  "adminPricing.payg.error.enrollmentNotSaved": {
    en: "The enrollment was not saved.",
  },
  "adminPricing.payg.error.cancellationNotSaved": {
    en: "The cancellation was not saved.",
  },
  "adminPricing.payg.error.billingQueueUnavailable": {
    en: "The billing queue could not be loaded.",
  },
  "adminPricing.payg.error.billingNeedsReview": {
    en: "Billing requires review.",
  },
  "adminPricing.payg.error.changeFailed": { en: "The policy change failed." },
  // ── Price-book parts: discount authority, simulation, impact, import, diff ─
  "adminPricing.route.label": { en: "Route" },
  "adminPricing.route.any": { en: "Any route" },
  "adminPricing.route.direct": { en: "Direct" },
  "adminPricing.route.referral": { en: "Referral" },
  "adminPricing.route.resale": { en: "Resale" },
  "adminPricing.route.distributor": { en: "Distributor" },
  "adminPricing.route.marketplace": { en: "Marketplace" },
  "adminPricing.discounts.title": { en: "Discount authority" },
  "adminPricing.discounts.intro": {
    en: "Ceilings are in basis points: 100 = 1%. A matching rule can raise the default ceiling; the highest matching ceiling applies. Regional floor prices still apply. Changes require a new two-person activation.",
  },
  "adminPricing.discounts.bps": {
    count: "count",
    en: { one: "{count} bp ({percent})", other: "{count} bps ({percent})" },
  },
  "adminPricing.discounts.summary": {
    count: "count",
    en: {
      one: "Default ceiling {ceiling}; {count} scoped rule",
      other: "Default ceiling {ceiling}; {count} scoped rules",
    },
  },
  "adminPricing.discounts.saved": {
    en: "Discount authority saved to the draft.",
  },
  "adminPricing.discounts.failed": {
    en: "Discount authority was not saved. The draft is unchanged.",
  },
  "adminPricing.discounts.matrixLegend": { en: "Versioned discount matrix" },
  "adminPricing.discounts.policyId": { en: "Policy identifier" },
  "adminPricing.discounts.policyVersion": { en: "Policy version" },
  "adminPricing.discounts.defaultCeiling": {
    en: "Default discount ceiling (bps)",
  },
  "adminPricing.discounts.rule": { en: "Rule {number}" },
  "adminPricing.discounts.skuAny": { en: "SKU (blank = any)" },
  "adminPricing.discounts.regionAny": { en: "Region (blank = any)" },
  "adminPricing.discounts.partnerTierAny": { en: "Partner tier (blank = any)" },
  "adminPricing.discounts.minTerm": { en: "Minimum term (months)" },
  "adminPricing.discounts.ruleCeiling": { en: "Discount ceiling (bps)" },
  "adminPricing.discounts.removeRule": { en: "Remove rule {number}" },
  "adminPricing.discounts.addRule": { en: "Add discount rule" },
  "adminPricing.discounts.save": { en: "Save discount authority" },
  "adminPricing.discounts.readOnly": {
    en: "Published and proposed policy is read only. A rejected draft can be edited and proposed again.",
  },
  "adminPricing.simulation.title": { en: "Term quote simulation" },
  "adminPricing.simulation.intro": {
    en: "Preview saved rates and discount authority at the effective date. This does not activate a book or create a quote. PAYG usage rating and monthly minimums are a separate billing policy.",
  },
  "adminPricing.simulation.rate": { en: "Simulation rate" },
  "adminPricing.simulation.quantity": { en: "Simulation quantity" },
  "adminPricing.simulation.term": { en: "Simulation term (months)" },
  "adminPricing.simulation.discount": { en: "Simulation discount (bps)" },
  "adminPricing.simulation.route": { en: "Simulation route" },
  "adminPricing.simulation.partnerTier": { en: "Simulation partner tier" },
  "adminPricing.simulation.run": { en: "Simulate saved pricing" },
  "adminPricing.simulation.selectRate": { en: "Select a saved rate card." },
  "adminPricing.simulation.total": { en: "Term total, excluding tax: {total}" },
  "adminPricing.simulation.guardrail.pass": {
    en: "Price guardrails: within the floor price and discount authority.",
  },
  "adminPricing.simulation.guardrail.notConfigured": {
    en: "Price guardrails: no floor price is configured for this rate.",
  },
  "adminPricing.simulation.guardrail.exceptionRequired": {
    en: "Price guardrails: this price needs a pricing exception.",
  },
  "adminPricing.simulation.breach.floor": {
    en: "{rate}: unit price {quoted} is below the floor price of {floor}.",
  },
  "adminPricing.simulation.breach.discount": {
    en: "{rate}: a {discount} discount is above the {ceiling} ceiling. The lowest unit price within authority is {price}.",
  },
  "adminPricing.simulation.failed": {
    en: "The simulation could not run: {detail}",
  },
  "adminPricing.simulation.failedGeneric": {
    en: "The simulation could not run.",
  },
  "adminPricing.diff.rateAbsent": { en: "Not in the active version" },
  "adminPricing.diff.rateRemoved": { en: "Rate removed" },
  "adminPricing.diff.rulesChanged": { en: "{summary} (scoped rules changed)" },
  "adminPricing.import.summary": {
    en: "Import price-book JSON into a new draft",
  },
  "adminPricing.import.intro": {
    en: "Paste a price book exported from this page (v2 economics-only format; maximum 1 MiB and 250 rates). Validate and review the preview first. Prices, floors, transfer prices, tax and accounting codes and discount rules are kept. The draft gets new identities and needs fresh approval. Provider bindings and approval history cannot be imported. Source details in the file are provenance only, not verified authority.",
  },
  "adminPricing.import.jsonLabel": { en: "Price-book JSON" },
  "adminPricing.import.validate": { en: "Validate import preview" },
  "adminPricing.import.validated": {
    en: "Economics validated. Review the rates and the new draft's details before importing.",
  },
  "adminPricing.import.invalidJson": {
    en: "This is not valid JSON. Paste the complete exported file.",
  },
  "adminPricing.import.invalidDocument": {
    en: "This is not a valid price-book export: {detail}",
  },
  "adminPricing.import.tooLarge": {
    en: "Price-book JSON must be no larger than 1 MiB.",
  },
  "adminPricing.import.bytes": {
    count: "count",
    en: { one: "{used} of {count} byte", other: "{used} of {count} bytes" },
  },
  "adminPricing.import.checkDraft": {
    en: "Check the new draft's name, version, effective date and reason.",
  },
  "adminPricing.import.versionExists": {
    en: "{currency} version {version} already exists. Choose a new version.",
  },
  "adminPricing.import.imported": {
    en: "Draft imported. Review its economics and catalog mappings before requesting fresh approval.",
  },
  "adminPricing.import.duplicate": {
    en: "A price book with this identity, or with this currency and version, already exists. Choose a new version.",
  },
  "adminPricing.import.failed": {
    en: "The draft was not imported. Refresh the page, then check the document and the new version number.",
  },
  "adminPricing.import.previewTitle": {
    count: "count",
    en: {
      one: "Import preview · {currency} · {count} rate",
      other: "Import preview · {currency} · {count} rates",
    },
  },
  "adminPricing.import.source": { en: "Uploaded source: {book}." },
  "adminPricing.import.discount": { en: "Discount authority: {summary}." },
  "adminPricing.import.tableCaption": { en: "Imported rate preview" },
  "adminPricing.import.header.skuRegion": { en: "SKU / region" },
  "adminPricing.import.header.unit": { en: "Unit · commitment model" },
  "adminPricing.import.header.prices": { en: "List / floor / overage" },
  "adminPricing.import.header.minimum": { en: "Minimum / trial limit" },
  "adminPricing.import.header.tax": { en: "Tax code / income account" },
  "adminPricing.import.completeEconomics": {
    en: "Complete validated economics",
  },
  "adminPricing.import.legend": { en: "New draft (approval not requested)" },
  "adminPricing.import.name": { en: "Imported price-book name" },
  "adminPricing.import.version": { en: "Imported price-book version" },
  "adminPricing.import.effectiveFrom": { en: "Imported effective date" },
  "adminPricing.import.reason": { en: "Import reason" },
  "adminPricing.import.submit": { en: "Create imported draft" },
  "adminPricing.import.importing": { en: "Importing…" },
  "adminPricing.import.formLabel": { en: "Import price book" },
  "adminPricing.impact.title": { en: "Existing business impact" },
  "adminPricing.impact.scope": {
    en: "Activation changes the eligible price book for new quotes in this currency. It does not reprice retained quote, order, invoice or commitment snapshots. Issued quotes keep their quoted economics, and acceptance still checks their expiry, agreement and other existing controls.",
  },
  "adminPricing.impact.retireNotice": {
    en: "Retiring the current book stops draft issuance and revisions on that book. Review open quote work before activation; using the new rates requires a new quote, not a repriced historical revision.",
  },
  "adminPricing.impact.unavailable": {
    en: "Reference counts are unavailable or the price-book version changed. Refresh before relying on the impact review. Unavailable counts do not mean zero business.",
  },
  "adminPricing.impact.checked.demo": {
    en: "Illustrative demo scenario, checked {time}. These examples demonstrate the review; they are not live customer or demo-action totals.",
  },
  "adminPricing.impact.checked.retained": {
    en: "Retained commerce records, checked {time}. These are complete reference counts for these books at the read snapshot, not a forecast or approval attestation.",
  },
  "adminPricing.impact.tableCaption": {
    en: "References retained on each price book",
  },
  "adminPricing.impact.header.records": { en: "Retained records" },
  "adminPricing.impact.header.current": { en: "Current active: {book}" },
  "adminPricing.impact.header.selected": { en: "Selected: {book}" },
  "adminPricing.impact.footnote": {
    en: "Revisions and orders are separate counts and must not be added together. Agreements count distinct governing records, not new contracts created by activation. Entitlements describe retained state, not a live provider check. Revenue, margin and renewal forecasts require additional approved inputs.",
  },
  "adminPricing.impact.metric.quoteRevisions": {
    en: "Quote revisions (all statuses)",
  },
  "adminPricing.impact.metric.quoteSeries": { en: "Distinct quote series" },
  "adminPricing.impact.metric.quotedAccounts": {
    en: "Distinct quoted accounts",
  },
  "adminPricing.impact.metric.draftQuotes": { en: "Draft quotes" },
  "adminPricing.impact.metric.unexpiredIssuedQuotes": {
    en: "Issued quotes before expiry",
  },
  "adminPricing.impact.metric.expiredIssuedQuotes": {
    en: "Issued quotes past expiry",
  },
  "adminPricing.impact.metric.acceptedQuotes": {
    en: "Accepted quote revisions",
  },
  "adminPricing.impact.metric.orders": { en: "Orders (all statuses)" },
  "adminPricing.impact.metric.immutableOrders": {
    en: "Orders with immutable snapshots",
  },
  "adminPricing.impact.metric.openOrders": {
    en: "Accepted / provisioning / active / amended orders",
  },
  "adminPricing.impact.metric.governingAgreements": {
    en: "Distinct governing agreements",
  },
  "adminPricing.impact.metric.orderLines": { en: "Retained order lines" },
  "adminPricing.impact.metric.activeEntitlements": {
    en: "Retained active entitlements",
  },
  "adminPricing.impact.metric.suspendedEntitlements": {
    en: "Retained write-suspended entitlements",
  },
  // ── Catalog and provider mappings (/internal/catalog) ───────────────────
  "adminPricing.catalog.title": { en: "Catalog and provider mappings" },
  "adminPricing.catalog.eyebrow": { en: "Commercial administration" },
  "adminPricing.catalog.description": {
    en: "Inspect catalog versions and prepare the provisionable SKU, region and source meter for each draft rate.",
  },
  "adminPricing.catalog.priceBooksSentence": {
    en: "Manage SKUs, regions, rates and price-book approval on the {link} page.",
  },
  "adminPricing.catalog.priceBooksLink": { en: "Price books" },
  "adminPricing.catalog.evidenceNote": {
    en: "Mapping evidence records the references supplied; it does not certify a live provider or enable sales.",
  },
  "adminPricing.catalog.gatesSentence": {
    en: "Review provider qualification on the {link} page.",
  },
  "adminPricing.catalog.gatesLink": { en: "External gates" },
  "adminPricing.catalog.registryUnavailable": {
    en: "The catalog registry is unavailable. Check the control database connection and try again.",
  },
  "adminPricing.catalog.demoUnavailable": {
    en: "Live provider mappings are not connected in this demo. Use Price books to explore fictional SKUs, regions and pricing. Mapping administration requires a verified staff session and the control database.",
  },
  "adminPricing.catalog.empty": {
    en: "No catalog rates exist. Create an initial draft with the safe production bootstrap or the price-book editor.",
  },
  "adminPricing.catalog.providerSkuRegion": { en: "Provider SKU and region" },
  "adminPricing.catalog.sourceMeter": { en: "Source meter" },
  "adminPricing.catalog.sourceEvidence": { en: "Source evidence" },
  "adminPricing.catalog.notQualified": {
    en: "No valid provisionable mapping is retained. This entry is not provider-qualified.",
  },
  "adminPricing.catalog.frozen": {
    en: "This mapping is frozen by publication or a pending approval. Prepare changes in a new draft version.",
  },
  "adminPricing.catalog.form.legend": { en: "Draft provider mapping" },
  "adminPricing.catalog.form.providerSku": { en: "Provider SKU" },
  "adminPricing.catalog.form.providerRegion": { en: "Provider region" },
  "adminPricing.catalog.form.meterId": { en: "Source meter identifier" },
  "adminPricing.catalog.form.sourceEvidence": {
    en: "Source evidence reference",
  },
  "adminPricing.catalog.form.reason": { en: "Reason for change" },
  "adminPricing.catalog.form.submit": { en: "Save draft mapping" },
  "adminPricing.catalog.result.forbidden": {
    en: "Mapping changes require a directly authenticated operator or finance approver with recent MFA.",
  },
  "adminPricing.catalog.result.invalid": {
    en: "Check the provider SKU, region, meter, evidence reference and reason.",
  },
  "adminPricing.catalog.result.saved": {
    en: "Draft mapping saved. Provider qualification and price-book approval remain required.",
  },
  "adminPricing.catalog.result.conflict": {
    en: "The price book changed. Refresh and review the latest draft before saving again.",
  },
  "adminPricing.catalog.result.frozen": {
    en: "This mapping is frozen. Reject the pending proposal or create a new draft version.",
  },
  "adminPricing.catalog.result.failed": {
    en: "The mapping could not be saved. Refresh and check your current authority and the source evidence.",
  },

  // ── Demo price-book command: problem details the finance user reads ─────
  "adminPricing.command.notFound": { en: "The price book was not found." },
  "adminPricing.command.versionConflict": {
    en: "The price book changed after it was read.",
  },
  "adminPricing.command.importInvalid": {
    en: "The price-book import is invalid: {detail}",
  },
  "adminPricing.command.duplicate": {
    en: "A price book with this currency and version already exists.",
  },
  "adminPricing.command.importIdentity": {
    en: "An import requires a new price-book ID.",
  },
  "adminPricing.command.cloneEmpty": {
    en: "Add at least one rate before cloning this price book.",
  },
  "adminPricing.command.endBeforeStart": {
    en: "The price book’s end date is before its start date.",
  },
  "adminPricing.command.noSchedule": {
    en: "No approved schedule exists for this draft.",
  },
  "adminPricing.command.scheduleFrozen": {
    en: "This approved schedule is frozen; cancel it before changing the draft.",
  },
  "adminPricing.command.scheduleDistinct": {
    en: "A different finance approver must approve the proposed schedule.",
  },
  "adminPricing.command.scheduleFuture": {
    en: "Advance approval requires a future effective date.",
  },
  "adminPricing.command.scheduleExists": {
    en: "This currency already has an approved schedule.",
  },
  "adminPricing.command.editLocked": {
    en: "Only an unproposed draft can be edited; a different finance approver must reject activation before editing.",
  },
  "adminPricing.command.rateNotFound": {
    en: "The rate card was not found in this draft.",
  },
  "adminPricing.command.discountInvalid": {
    en: "The discount matrix is invalid: {detail}",
  },
  "adminPricing.command.rateDraftOnly": {
    en: "Rate cards can be added only to a draft price book.",
  },
  "adminPricing.command.rateInvalid": {
    en: "The rate card is invalid: {detail}",
  },
  "adminPricing.command.rejectDistinct": {
    en: "A different finance approver must reject a pending activation.",
  },
  "adminPricing.command.proposeUnproposed": {
    en: "Only an unproposed draft can be proposed for activation.",
  },
  "adminPricing.command.bookInvalid": {
    en: "The price book is invalid: {detail}",
  },
  "adminPricing.command.activateScheduled": {
    en: "Cancel the approved schedule for this currency before activating a different version.",
  },
  "adminPricing.command.activateDistinct": {
    en: "A different finance approver must activate the proposed draft.",
  },
  "adminPricing.command.activateEarly": {
    en: "A price book cannot be activated before its effective date.",
  },
  "adminPricing.command.activateLate": {
    en: "A price book cannot be activated after its effective end date.",
  },
  "adminPricing.command.retireActiveOnly": {
    en: "Only an active price book can be retired.",
  },
  "adminPricing.command.forbidden": {
    en: "Finance approval authority with recent MFA is required.",
  },
  "adminPricing.command.idempotencyRequired": {
    en: "A valid idempotency-key header is required.",
  },
  "adminPricing.command.idempotencyConflict": {
    en: "This idempotency key is already bound to a different command.",
  },
  "adminPricing.command.validation": {
    en: "Some values in this change are missing or in the wrong format. Check them and try again.",
  },
  "adminPricing.command.failed": {
    en: "The demo could not record this price-book change.",
  },
  "adminPricing.payg.selfApprovalSubject": { en: "{name}, version {version}" },
});
