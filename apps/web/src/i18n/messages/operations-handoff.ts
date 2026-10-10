import { defineStaffMessages } from "../define";

/**
 * Handoffs from sales to operations: the request on a signed contract, the
 * queue at /internal/handoffs and the seller's view on the home page. Part of
 * the operations module.
 */
export const handoffMessages = defineStaffMessages({
  "operations.handoff.status.open": { en: "Not started" },
  "operations.handoff.status.in_progress": { en: "In progress" },
  "operations.handoff.status.done": { en: "Done" },
  "operations.handoff.status.declined": { en: "Declined" },
  "operations.handoff.side.customer": { en: "Customer" },
  "operations.handoff.side.partner": { en: "Channel or referral partner" },

  "operations.handoff.panel.title": { en: "Hand to operations" },
  "operations.handoff.panel.description": {
    en: "Operations sets the counterparty up in Commerce: the organization, then the first administrator's invitation.",
  },
  "operations.handoff.panel.notSigned": {
    en: "A contract can be handed to operations once it is signed.",
  },
  "operations.handoff.panel.unavailable": {
    en: "Handoffs could not be loaded right now. Reload the page in a minute.",
  },
  "operations.handoff.panel.requests": { en: "Handoffs for this contract" },
  "operations.handoff.form.open": { en: "Hand to operations" },
  "operations.handoff.form.legalName": { en: "Counterparty legal name" },
  "operations.handoff.form.signerName": { en: "Signer name" },
  "operations.handoff.form.signerEmail": { en: "Signer email" },
  "operations.handoff.form.signerEmailHelp": {
    en: "Operations invites this person as the first administrator.",
  },
  "operations.handoff.form.signerTitle": { en: "Signer title" },
  "operations.handoff.form.side": { en: "They become a" },
  "operations.handoff.form.mnda": { en: "Signed MNDA" },
  "operations.handoff.form.mndaNone": { en: "None" },
  "operations.handoff.form.scenario": { en: "Pricing scenario" },
  "operations.handoff.form.scenarioNone": { en: "None" },
  "operations.handoff.form.notes": { en: "Notes for operations" },
  "operations.handoff.form.notesHelp": {
    en: "Start date, billing contact, anything agreed outside the contract.",
  },
  "operations.handoff.form.optional": { en: "Optional" },
  "operations.handoff.form.submit": { en: "Hand to operations" },
  "operations.handoff.form.pending": { en: "Handing over…" },
  "operations.handoff.form.done": { en: "Handed to operations." },

  "operations.handoff.queue.title": { en: "Handoffs" },
  "operations.handoff.queue.description": {
    en: "Signed contracts sales has handed over. Take one, set up the organization and invite its first administrator, then mark it done.",
  },
  "operations.handoff.queue.filter.all": { en: "All" },
  "operations.handoff.queue.filter.withCount": { en: "{label} ({count})" },
  "operations.handoff.queue.filter.label": { en: "Show" },
  "operations.handoff.queue.empty.title": { en: "Nothing waiting" },
  "operations.handoff.queue.empty.description": {
    en: "Requests appear here when a seller hands a signed contract to operations.",
  },
  "operations.handoff.queue.unavailable": {
    en: "The queue could not be loaded right now. Reload the page in a minute. If it keeps failing, tell engineering.",
  },
  "operations.handoff.queue.demoTitle": {
    en: "Handoffs are turned off in the demo.",
  },
  "operations.handoff.queue.demoBody": {
    en: "In a live workspace, signed contracts that sales hands over appear here for operations to set up.",
  },
  "operations.handoff.column.counterparty": { en: "Counterparty" },
  "operations.handoff.column.side": { en: "Side" },
  "operations.handoff.column.requestedBy": { en: "Requested by" },
  "operations.handoff.column.requested": { en: "Requested" },
  "operations.handoff.column.status": { en: "Status" },
  "operations.handoff.column.assignee": { en: "Assigned to" },
  "operations.handoff.unassigned": { en: "Nobody yet" },

  "operations.handoff.detail.title": { en: "Handoff" },
  "operations.handoff.detail.documentTitle": { en: "{name}, handoff" },
  "operations.handoff.detail.requested": {
    en: "Requested by {name}, {date}",
  },
  "operations.handoff.detail.unavailable": {
    en: "This handoff could not be loaded right now. Reload the page in a minute. If it keeps failing, tell engineering.",
  },
  "operations.handoff.detail.contracts": { en: "Contracts" },
  "operations.handoff.detail.signer": { en: "Signer" },
  "operations.handoff.detail.mnda": { en: "MNDA" },
  "operations.handoff.detail.mndaCompleted": {
    en: "{company}, signed by {signer}",
  },
  "operations.handoff.detail.scenario": { en: "Pricing scenario" },
  "operations.handoff.detail.scenarioMissing": {
    en: "The scenario has since been deleted.",
  },
  "operations.handoff.detail.notes": { en: "Notes from sales" },
  "operations.handoff.detail.decision": { en: "Decision note" },
  "operations.handoff.detail.none": { en: "None" },
  "operations.handoff.detail.organization": { en: "Organization" },
  "operations.handoff.action.take": { en: "Take" },
  "operations.handoff.action.takeOver": { en: "Take over" },
  "operations.handoff.action.complete": { en: "Mark done" },
  "operations.handoff.action.decline": { en: "Decline" },
  "operations.handoff.action.note": { en: "Note for the seller" },
  "operations.handoff.action.noteHelp": {
    en: "Required to decline. The seller sees it on the contract.",
  },
  "operations.handoff.action.pending": { en: "Saving…" },
  "operations.handoff.action.taken": { en: "You are working on this handoff." },
  "operations.handoff.action.completed": { en: "Marked done." },
  "operations.handoff.action.declined": {
    en: "Declined. The seller sees your note.",
  },

  "operations.handoff.home.title": { en: "Handoffs" },
  "operations.handoff.home.description": {
    en: "Signed contracts you handed to operations, newest first.",
  },
  "operations.handoff.home.empty": {
    en: "None yet. Open a signed contract and choose Hand to operations.",
  },
  "operations.handoff.home.more": { en: "Showing the newest {count}." },

  "operations.handoff.error.HANDOFF_NOT_FOUND": {
    en: "This handoff no longer exists, or you cannot open it.",
  },
  "operations.handoff.error.HANDOFF_VERSION_CONFLICT": {
    en: "Someone changed this handoff a moment ago. Reload to see it.",
  },
  "operations.handoff.error.HANDOFF_CONTRACT_NOT_SIGNED": {
    en: "The contract is not signed yet.",
  },
  "operations.handoff.error.HANDOFF_ALREADY_REQUESTED": {
    en: "This contract is already with operations.",
  },
  "operations.handoff.error.HANDOFF_MNDA_NOT_COMPLETED": {
    en: "Only a signed MNDA can be attached.",
  },
  "operations.handoff.error.HANDOFF_PRICING_SCENARIO_NOT_FOUND": {
    en: "The pricing scenario no longer exists.",
  },
  "operations.handoff.error.HANDOFF_PRICING_SCENARIO_NOT_OWNED": {
    en: "Attach one of your own pricing scenarios.",
  },
  "operations.handoff.error.HANDOFF_MNDA_COMPANY_MISMATCH": {
    en: "That MNDA is with a different company than this contract.",
  },
  "operations.handoff.detail.signedInCommerce": {
    en: "signed in Commerce",
  },
  "operations.handoff.detail.recordedExecuted": {
    en: "recorded as signed by staff",
  },
  "operations.handoff.detail.signedInCommerceOnly": {
    en: "Signed in Commerce",
  },
  "operations.handoff.detail.recordedExecutedOnly": {
    en: "Recorded as signed by staff",
  },
  "operations.handoff.error.HANDOFF_TRANSITION_INVALID": {
    en: "That step is not available for this handoff now. Reload to see where it stands.",
  },
  "operations.handoff.error.HANDOFF_NOT_ASSIGNEE": {
    en: "Someone else is working on this handoff. Take it over first.",
  },
  "operations.handoff.error.HANDOFF_REQUEST_CLOSED": {
    en: "This handoff is already closed.",
  },
  "operations.handoff.error.HANDOFF_DECLINE_NOTE_REQUIRED": {
    en: "Add a note for the seller before declining.",
  },
  "operations.handoff.error.HANDOFF_IDEMPOTENCY_CONFLICT": {
    en: "This request could not be saved. Reload and try again.",
  },
  "operations.handoff.error.INVALID_INPUT": {
    en: "Check the highlighted fields.",
  },
  "operations.handoff.error.CONTRACT_FORBIDDEN": {
    en: "Your role cannot do this.",
  },
  "operations.handoff.error.CONTRACT_MFA_REQUIRED": {
    en: "Verify your sign-in with your authenticator, then try again.",
  },
  "operations.handoff.error.CONTRACT_DEMO_UNAVAILABLE": {
    en: "Handoffs are turned off in the demo.",
  },
  "operations.handoff.error.SESSION_EXPIRED": {
    en: "Your session expired. Reload to continue.",
  },
  "operations.handoff.error.UNEXPECTED": {
    en: "That did not work. Try again in a minute. If it keeps failing, tell engineering.",
  },
});
