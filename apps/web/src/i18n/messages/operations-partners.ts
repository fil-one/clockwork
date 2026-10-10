import { defineStaffMessages } from "../define";

/**
 * The staff partner records at /internal/partners: the list, a partner's
 * terms and registered deals, the forms and the home-page rows. Part of the
 * operations module.
 */
export const staffPartnerMessages = defineStaffMessages({
  "operations.partners.title": { en: "Partners" },
  "operations.partners.description": {
    en: "What we agreed, or are negotiating, with each channel, referral and technology partner, and the deals they registered.",
  },
  "operations.partners.new": { en: "New partner" },
  "operations.partners.export": { en: "Export CSV" },
  "operations.partners.backToList": { en: "All partners" },
  "operations.partners.truncated": {
    en: "Showing the {count} most recently changed partners. Narrow the filters to see the rest.",
  },
  "operations.partners.empty.title": { en: "No partners yet" },
  "operations.partners.empty.description": {
    en: "Record a partner as soon as the first conversation starts. Terms can be filled in as they are agreed.",
  },
  "operations.partners.emptyFiltered.title": { en: "No partners match" },
  "operations.partners.emptyFiltered.description": {
    en: "Change or clear the filters to see more partners.",
  },
  "operations.partners.demo": {
    en: "These partners are fictional. The demo shows partner records but cannot change them.",
  },

  "operations.partners.model.referral": { en: "Referral" },
  "operations.partners.model.resale": { en: "Resale" },
  "operations.partners.model.affiliate": { en: "Affiliate" },
  "operations.partners.model.distributor": { en: "Distributor" },
  "operations.partners.model.msp": { en: "MSP" },
  "operations.partners.model.teaming": { en: "Teaming" },
  "operations.partners.model.technology": { en: "Technology" },
  "operations.partners.model.other": { en: "Other" },

  "operations.partners.status.prospect": { en: "Prospect" },
  "operations.partners.status.talking": { en: "Talking" },
  "operations.partners.status.negotiating": { en: "Negotiating" },
  "operations.partners.status.terms_agreed": { en: "Terms agreed" },
  "operations.partners.status.signed": { en: "Signed" },
  "operations.partners.status.active": { en: "Active" },
  "operations.partners.status.paused": { en: "Paused" },
  "operations.partners.status.ended": { en: "Ended" },

  "operations.partners.exclusivity.none": { en: "Non-exclusive" },
  "operations.partners.exclusivity.limited": { en: "Limited exclusivity" },
  "operations.partners.exclusivity.exclusive": { en: "Exclusive" },

  "operations.partners.deal.status.registered": { en: "Registered" },
  "operations.partners.deal.status.accepted": { en: "Accepted" },
  "operations.partners.deal.status.won": { en: "Won" },
  "operations.partners.deal.status.lost": { en: "Lost" },
  "operations.partners.deal.status.expired": { en: "Expired" },
  "operations.partners.deal.status.withdrawn": { en: "Withdrawn" },
  "operations.partners.deal.status.disputed": { en: "Disputed" },
  "operations.partners.deal.model.referral": { en: "Referral" },
  "operations.partners.deal.model.resale": { en: "Resale" },
  "operations.partners.deal.model.other": { en: "Other" },

  "operations.partners.filters.label": { en: "Filter partners" },
  "operations.partners.filters.search": { en: "Search" },
  "operations.partners.filters.searchPlaceholder": {
    en: "Name, region, contact or end client",
  },
  "operations.partners.filters.allStatuses": { en: "All statuses" },
  "operations.partners.filters.allModels": { en: "All models" },
  "operations.partners.filters.anyOwner": { en: "Anyone" },
  "operations.partners.filters.anyDue": { en: "Any time" },
  "operations.partners.filters.overdue": { en: "Overdue" },
  "operations.partners.filters.week": { en: "Due within 7 days" },
  "operations.partners.filters.mine": { en: "Only mine" },
  "operations.partners.filters.clear": { en: "Clear filters" },
  "operations.partners.filters.apply": { en: "Apply filters" },

  "operations.partners.column.partner": { en: "Partner" },
  "operations.partners.column.status": { en: "Status" },
  "operations.partners.column.models": { en: "Models" },
  "operations.partners.column.owner": { en: "Owner" },
  "operations.partners.column.terms": { en: "Headline terms" },
  "operations.partners.column.nextStep": { en: "Next step" },
  "operations.partners.column.openDeals": { en: "Open deals" },
  "operations.partners.unowned": { en: "No owner" },
  "operations.partners.none": { en: "None" },
  "operations.partners.notSet": { en: "Not set" },
  "operations.partners.commissionShort": { en: "{rate}% commission" },
  "operations.partners.marginShort": { en: "{rate}% margin" },
  "operations.partners.dueOn": { en: "due {date}" },
  "operations.partners.overdueOn": { en: "overdue since {date}" },

  "operations.partners.field.name": { en: "Partner name" },
  "operations.partners.field.website": { en: "Website" },
  "operations.partners.field.region": { en: "Region or territory" },
  "operations.partners.field.regionHelp": {
    en: "Where they sell or operate, in your words.",
  },
  "operations.partners.field.models": { en: "Partnership models" },
  "operations.partners.field.status": { en: "Status" },
  "operations.partners.field.owner": { en: "Owner" },
  "operations.partners.field.organization": {
    en: "Commerce organization",
  },
  "operations.partners.field.organizationHelp": {
    en: "Link the partner once operations has set up their organization.",
  },
  "operations.partners.field.organizationNone": { en: "Not linked" },
  "operations.partners.field.nextStep": { en: "Next step" },
  "operations.partners.field.nextStepDue": { en: "Next step due" },
  "operations.partners.field.notes": { en: "Notes" },
  "operations.partners.field.optional": { en: "Optional" },
  "operations.partners.field.createdBy": { en: "Recorded by" },
  "operations.partners.field.updated": { en: "Last changed" },

  "operations.partners.contacts.title": { en: "Key contacts" },
  "operations.partners.contacts.name": { en: "Name" },
  "operations.partners.contacts.email": { en: "Email" },
  "operations.partners.contacts.role": { en: "Role" },
  "operations.partners.contacts.add": { en: "Add a contact" },
  "operations.partners.contacts.remove": { en: "Remove contact {number}" },
  "operations.partners.contacts.empty": { en: "No contacts recorded." },

  "operations.partners.terms.title": { en: "Terms" },
  "operations.partners.terms.description": {
    en: "Fill in what applies. Anything else goes in the rows below. Terms here are a record of the deal; they do not change billing or commission payments.",
  },
  "operations.partners.terms.commissionPct": {
    en: "Commission or revenue share (%)",
  },
  "operations.partners.terms.commissionPctHelp": {
    en: "Any rate from 0 to 100, decimals allowed.",
  },
  "operations.partners.terms.commissionSchedule": {
    en: "Commission duration or step-down",
  },
  "operations.partners.terms.commissionScheduleHelp": {
    en: "For example: 36 months, perpetual, or 12 months from first invoice.",
  },
  "operations.partners.terms.steps": { en: "Step-down schedule" },
  "operations.partners.terms.stepsHelp": {
    en: "The rate that applies from each month of the partnership.",
  },
  "operations.partners.terms.stepFrom": { en: "From month" },
  "operations.partners.terms.stepRate": { en: "Rate (%)" },
  "operations.partners.terms.stepAdd": { en: "Add a step" },
  "operations.partners.terms.stepRemove": { en: "Remove step {number}" },
  "operations.partners.terms.stepLine": { en: "From month {month}: {rate}%" },
  "operations.partners.terms.marginPct": {
    en: "Partner margin or discount (%)",
  },
  "operations.partners.terms.territory": { en: "Territory" },
  "operations.partners.terms.exclusivity": { en: "Exclusivity" },
  "operations.partners.terms.exclusivityNote": { en: "Exclusivity note" },
  "operations.partners.terms.currency": { en: "Contracting currency" },
  "operations.partners.terms.nfrAllowance": { en: "NFR allowance" },
  "operations.partners.terms.nfrAllowanceHelp": {
    en: "Not-for-resale accounts or capacity the partner may use themselves.",
  },
  "operations.partners.terms.trialPeriod": { en: "Trial period" },
  "operations.partners.terms.trialTargets": { en: "Trial targets" },
  "operations.partners.terms.trialTargetsHelp": {
    en: "Named target accounts or what the trial has to show.",
  },
  "operations.partners.terms.rows": { en: "Other terms" },
  "operations.partners.terms.rowLabel": { en: "Term" },
  "operations.partners.terms.rowValue": { en: "Agreed" },
  "operations.partners.terms.rowNotes": { en: "Notes" },
  "operations.partners.terms.rowAdd": { en: "Add a term" },
  "operations.partners.terms.rowRemove": { en: "Remove term {number}" },
  "operations.partners.terms.empty": { en: "No terms recorded yet." },

  "operations.partners.form.newTitle": { en: "New partner" },
  "operations.partners.form.newDescription": {
    en: "Only the name is required. Record the rest as it is agreed.",
  },
  "operations.partners.form.editTitle": { en: "Edit {name}" },
  "operations.partners.form.basics": { en: "Partner" },
  "operations.partners.form.save": { en: "Save partner" },
  "operations.partners.form.saving": { en: "Saving" },
  "operations.partners.form.cancel": { en: "Cancel" },
  "operations.partners.form.error": {
    en: "Some fields need attention. Check the highlighted fields.",
  },
  "operations.partners.form.fieldError": { en: "Check this value." },
  "operations.partners.form.percentError": {
    en: "Enter a percentage from 0 to 100, with up to four decimals.",
  },
  "operations.partners.form.sizeError": {
    en: "Enter a size above zero, with up to three decimals, and pick a unit.",
  },

  "operations.partners.detail.title": { en: "Partner" },
  "operations.partners.detail.edit": { en: "Edit partner" },
  "operations.partners.detail.summary": { en: "Overview" },
  "operations.partners.detail.saved": { en: "Partner saved." },

  "operations.partners.deals.title": { en: "Registered deals" },
  "operations.partners.deals.description": {
    en: "Deals this partner brought us. Another partner's open registration for the same end client is flagged here and never blocked.",
  },
  "operations.partners.deals.empty": { en: "No deals registered yet." },
  "operations.partners.deals.register": { en: "Register a deal" },
  "operations.partners.deals.edit": { en: "Edit deal" },
  "operations.partners.deals.save": { en: "Save deal" },
  "operations.partners.deals.saving": { en: "Saving" },
  "operations.partners.deals.cancel": { en: "Cancel" },
  "operations.partners.deals.saved": { en: "Deal saved." },
  "operations.partners.deals.endClient": { en: "End client" },
  "operations.partners.deals.organization": {
    en: "End client's Commerce organization",
  },
  "operations.partners.deals.registeredOn": { en: "Registered on" },
  "operations.partners.deals.protectedUntil": { en: "Protected until" },
  "operations.partners.deals.protectedUntilHelp": {
    en: "Leave empty for {days} days from registration, the channel policy's protection.",
  },
  "operations.partners.deals.estimatedSize": { en: "Estimated size" },
  "operations.partners.deals.sizeUnit": { en: "Unit" },
  "operations.partners.deals.model": { en: "Model for this deal" },
  "operations.partners.deals.status": { en: "Status" },
  "operations.partners.deals.notes": { en: "Notes" },
  "operations.partners.deals.size": { en: "{size} {unit}" },
  "operations.partners.deals.protection": {
    en: "Registered {registered}, protected until {until}",
  },
  "operations.partners.deals.conflictTitle": {
    en: "Another partner has registered this end client",
  },
  "operations.partners.deals.conflictLine": {
    en: "{partner}: {status}, registered {registered}, protected until {until}",
  },
  "operations.partners.deals.conflictSaved": {
    en: "Saved. Another partner has an open registration for this end client.",
  },

  "operations.partners.links.title": { en: "MNDAs and contracts" },
  "operations.partners.links.description": {
    en: "Matched by company name, as the MNDA and contract registers match duplicates.",
  },
  "operations.partners.links.empty": {
    en: "No MNDAs or contracts with this company yet.",
  },
  "operations.partners.links.mnda": { en: "MNDA: {status}, sent by {owner}" },
  "operations.partners.links.contract": {
    en: "{type}: {status}, owner {owner}",
  },

  "operations.partners.history.title": { en: "History" },
  "operations.partners.history.empty": { en: "No changes recorded yet." },
  "operations.partners.history.created": { en: "{actor} recorded the partner" },
  "operations.partners.history.updated": {
    en: "{actor} changed {fields}",
  },
  "operations.partners.history.dealRegistered": {
    en: "{actor} registered a deal for {client}",
  },
  "operations.partners.history.dealUpdated": {
    en: "{actor} changed the deal for {client}: {fields}",
  },
  "operations.partners.history.dealExpired": {
    en: "Protection ended for {client}; the registration expired",
  },
  "operations.partners.history.other": { en: "{actor}: {event}" },
  "operations.partners.history.nothing": { en: "nothing" },

  "operations.partners.error.PARTNER_NOT_FOUND": {
    en: "This partner no longer exists. Reload the list.",
  },
  "operations.partners.error.PARTNER_VERSION_CONFLICT": {
    en: "Someone else changed this partner while you were editing. Reload to see their changes, then make yours again.",
  },
  "operations.partners.error.PARTNER_IDEMPOTENCY_CONFLICT": {
    en: "This was already saved by someone else. Reload the page.",
  },
  "operations.partners.error.PARTNER_OWNER_NOT_STAFF": {
    en: "The owner must be a Fil One staff member with the sales workspace.",
  },
  "operations.partners.error.PARTNER_ORGANIZATION_NOT_FOUND": {
    en: "That organization could not be found. Pick another or leave it unlinked.",
  },
  "operations.partners.error.PARTNER_DEAL_NOT_FOUND": {
    en: "This deal no longer exists. Reload the page.",
  },
  "operations.partners.error.PARTNER_DEAL_VERSION_CONFLICT": {
    en: "Someone else changed this deal while you were editing. Reload to see their changes.",
  },
  "operations.partners.error.PARTNER_DEAL_PARTNER_MISMATCH": {
    en: "This deal belongs to another partner.",
  },
  "operations.partners.error.PARTNER_UNAVAILABLE": {
    en: "Partners are not available on this deployment.",
  },
  "operations.partners.error.INVALID_INPUT": {
    en: "Some fields need attention. Check the highlighted fields.",
  },
  "operations.partners.error.CONTRACT_FORBIDDEN": {
    en: "Your role cannot change partners. Ask a seller or a commerce administrator.",
  },
  "operations.partners.error.CONTRACT_MFA_REQUIRED": {
    en: "Verify your second factor, then try again.",
  },
  "operations.partners.error.CONTRACT_DEMO_UNAVAILABLE": {
    en: "The demo cannot change partners.",
  },
  "operations.partners.error.SESSION_EXPIRED": {
    en: "Your session ended. Reload to sign in again; your changes are still in the form.",
  },
  "operations.partners.error.UNEXPECTED": {
    en: "That did not save. Try again in a minute.",
  },

  "operations.partners.access.mfaTitle": { en: "Verify your second factor" },
  "operations.partners.access.mfaBody": {
    en: "Partner terms open once you have verified your second factor for this session.",
  },
  "operations.partners.access.forbiddenTitle": {
    en: "Partners are not part of your role",
  },
  "operations.partners.access.forbiddenBody": {
    en: "Ask a commerce administrator if you need partner records.",
  },
  "operations.partners.access.demoTitle": { en: "Not in the demo" },
  "operations.partners.access.demoBody": {
    en: "The demo shows partner records but cannot record or change them.",
  },
  "operations.partners.access.missingTitle": { en: "Partner not found" },
  "operations.partners.access.missingBody": {
    en: "It may have been mistyped in the address. Open it from the list.",
  },
  "operations.partners.access.errorTitle": {
    en: "Partners could not be loaded",
  },
  "operations.partners.access.errorBody": {
    en: "Reload the page in a minute. If it keeps failing, tell the commerce administrator.",
  },

  "operations.partners.export.website": { en: "Website" },
  "operations.partners.export.region": { en: "Region" },
  "operations.partners.export.commission": { en: "Commission %" },
  "operations.partners.export.schedule": { en: "Commission duration" },
  "operations.partners.export.margin": { en: "Margin %" },
  "operations.partners.export.currency": { en: "Currency" },
  "operations.partners.export.territory": { en: "Territory" },
  "operations.partners.export.exclusivity": { en: "Exclusivity" },
  "operations.partners.export.nfr": { en: "NFR allowance" },
  "operations.partners.export.trial": { en: "Trial period" },
  "operations.partners.export.nextStepDue": { en: "Next step due" },
  "operations.partners.export.updated": { en: "Last changed" },

  "operations.sales.home.partners.heading": { en: "Partners" },
  "operations.sales.home.partners.overdue.title": {
    en: "Partner next steps overdue",
  },
  "operations.sales.home.partners.overdue.hint": {
    en: "The due date has passed. Do the step or move the date.",
  },
  "operations.sales.home.partners.week.title": {
    en: "Partner next steps due this week",
  },
  "operations.sales.home.partners.week.hint": {
    en: "Due within seven days, overdue ones included.",
  },
  "operations.sales.home.partners.unavailable": {
    en: "Partner next steps could not be loaded right now.",
  },
  "operations.sales.home.partners.open": { en: "Open partners" },
});
