import { defineStaffMessages } from "../define";

/**
 * The sales workspace: the staff home page, indicative pricing and the staff
 * error state. Part of the operations module.
 */
export const salesMessages = defineStaffMessages({
  "operations.sales.home.title": { en: "My work" },
  "operations.sales.home.description": {
    en: "Agreements waiting on you or a counterparty, and what finished recently.",
  },
  "operations.sales.home.sendMnda": { en: "New MNDA" },
  "operations.sales.home.openPricing": { en: "Pricing" },
  "operations.sales.home.cards": { en: "Your MNDAs" },
  "operations.sales.home.card.attention.title": { en: "Needs attention" },
  "operations.sales.home.card.attention.hint": {
    en: "An email bounced, SignWell stopped or deleted the request, or SignWell's copy does not match. Open the MNDA to see what to do.",
  },
  "operations.sales.home.card.waitingPartner.title": {
    en: "Waiting on the counterparty",
  },
  "operations.sales.home.card.waitingPartner.hint": {
    en: "Sent or opened, not yet signed by the counterparty.",
  },
  "operations.sales.home.card.waitingFilOne.title": {
    en: "Waiting on Fil One",
  },
  "operations.sales.home.card.waitingFilOne.hint": {
    en: "The counterparty signed. A Fil One signer countersigns next.",
  },
  "operations.sales.home.card.completed.title": {
    en: "Signed in the last 30 days",
  },
  "operations.sales.home.card.completed.hint": {
    en: "Signed by both sides. Download the signed PDF from the register.",
  },
  "operations.sales.home.card.drafts.title": { en: "Drafts you started" },
  "operations.sales.home.card.drafts.hint": {
    en: "Not sent yet. Open one to finish and send it, or discard it.",
  },
  "operations.sales.home.card.mine": { en: "Yours: {count}" },
  "operations.sales.home.card.team": { en: "Team: {count}" },
  "operations.sales.home.card.none": { en: "none" },
  "operations.sales.home.unavailable": {
    en: "MNDA counts are not available right now. Open the MNDA register to check where each one stands.",
  },
  "operations.sales.home.openRegister": { en: "Open the MNDA register" },
  "operations.sales.home.contracts.heading": { en: "Your contracts" },
  "operations.sales.home.contracts.awaitingApproval.title": {
    en: "Waiting for your approval",
  },
  "operations.sales.home.contracts.awaitingApproval.hint": {
    en: "Prepared by someone else. Approve it, or send it back with a reason.",
  },
  "operations.sales.home.contracts.needsAttention.title": {
    en: "Needs attention",
  },
  "operations.sales.home.contracts.needsAttention.hint": {
    en: "SignWell reported a problem, a send did not finish, or an approver sent it back. Open the contract to see what to do.",
  },
  "operations.sales.home.contracts.outForSignature.title": {
    en: "Out for signature",
  },
  "operations.sales.home.contracts.outForSignature.hint": {
    en: "Contracts you recorded or prepared that are not yet signed by both sides.",
  },
  "operations.sales.home.contracts.unavailable": {
    en: "Contract counts are not available right now. Open the contract register to check where each one stands.",
  },
  "operations.sales.home.contracts.openRegister": {
    en: "Open the contract register",
  },
  "operations.sales.home.start.title": { en: "Send your first MNDA" },
  "operations.sales.home.start.intro": {
    en: "Four steps from draft to signed PDF.",
  },
  "operations.sales.home.start.step1": {
    en: "Choose New MNDA at the top of this page, or in the MNDA register.",
  },
  "operations.sales.home.start.step2": {
    en: "Enter the counterparty's legal name and the signer's name and email. Leave anything you do not know blank. The counterparty fills it in when signing.",
  },
  "operations.sales.home.start.step3": {
    en: "Preview the PDF, check the names, then send. The counterparty gets an email from SignWell, our signing service.",
  },
  "operations.sales.home.start.step4": {
    en: "Track it here and in the MNDA register. When the counterparty signs, a Fil One signer countersigns and the signed PDF appears in the register.",
  },
  "operations.sales.home.start.help": {
    en: "Questions about access or signing go to a commerce administrator.",
  },
  "operations.sales.home.start.dismiss": { en: "Hide this guide" },
  "operations.sales.home.start.show": {
    en: "New to MNDAs? Show the four steps",
  },
  "operations.sales.pricing.title": { en: "Indicative pricing" },
  "operations.sales.pricing.description": {
    en: "Work out a total for a conversation with a prospect. These figures are indicative. They are not a quote or an offer.",
  },
  "operations.sales.pricing.book": { en: "Price book" },
  "operations.sales.pricing.bookOption": {
    en: "{name}, version {version}, {currency}",
  },
  "operations.sales.pricing.source.active": {
    en: "Prices from the active price book, effective {date}. Signed contract prices can differ.",
  },
  "operations.sales.pricing.empty.title": {
    en: "No approved price book is active yet",
  },
  "operations.sales.pricing.empty.description": {
    en: "Pricing appears here once finance approves and activates a price book. Until then, ask a commerce administrator for the current rate card.",
  },
  "operations.sales.pricing.rate": { en: "Storage option" },
  "operations.sales.pricing.rateOption": {
    en: "{sku}, {region}: {price} per {unit}",
  },
  "operations.sales.pricing.quantity": { en: "Quantity ({unit})" },
  "operations.sales.pricing.minimum": { en: "Minimum {minimum} {unit}." },
  "operations.sales.pricing.term": { en: "Term (months)" },
  "operations.sales.pricing.discount": { en: "Discount (%)" },
  "operations.sales.pricing.discountHelp": {
    en: "Any discount needs finance approval before it can go in a quote.",
  },
  "operations.sales.pricing.run": { en: "Work out the price" },
  "operations.sales.pricing.invalid": {
    en: "Check the numbers: the quantity must be above zero, the term a whole number of months, and the discount between 0 and 100%.",
  },
  "operations.sales.pricing.result.monthly": { en: "Per month" },
  "operations.sales.pricing.result.total": { en: "Total for {months} months" },
  "operations.sales.pricing.result.unit": { en: "Price per unit" },
  "operations.sales.pricing.result.overage": {
    en: "Usage above the commitment",
  },
  "operations.sales.pricing.perUnit": { en: "{price} per {unit}" },
  "operations.sales.pricing.belowMinimum": {
    en: "This is below the minimum of {minimum} {unit}. A quote starts at the minimum.",
  },
  "operations.sales.pricing.caveat": {
    en: "Indicative only. Taxes are not included, and the final price is set in the quote.",
  },
  "operations.sales.pricing.unavailable": {
    en: "Price books could not be loaded right now. Reload the page in a minute. If it keeps failing, tell a commerce administrator.",
  },
  "operations.sales.pricing.scenario.title": { en: "Pricing scenarios" },
  "operations.sales.pricing.scenario.description": {
    en: "Price several lines for one prospect, save them to come back to, and download an indicative summary to send. Saving prices every line at today's list prices.",
  },
  "operations.sales.pricing.scenario.editing": { en: "Editing {name}" },
  "operations.sales.pricing.scenario.asOf": {
    en: "Saved with list prices as of {date}. Saving again prices every line at today's list prices.",
  },
  "operations.sales.pricing.scenario.lineStale": {
    en: "The saved rate {sku}, {region} is no longer in force. Choose a current rate before you save.",
  },
  "operations.sales.pricing.scenario.chooseRate": {
    en: "Choose a current rate",
  },
  "operations.sales.pricing.scenario.savedTotal": { en: "Total when saved" },
  "operations.sales.pricing.scenario.name": { en: "Scenario name" },
  "operations.sales.pricing.scenario.company": { en: "Prospect or company" },
  "operations.sales.pricing.scenario.notes": { en: "Notes" },
  "operations.sales.pricing.scenario.notesHelp": {
    en: "For you and your team. Notes are not printed on the summary.",
  },
  "operations.sales.pricing.scenario.line": { en: "Line {number}" },
  "operations.sales.pricing.scenario.addLine": { en: "Add line" },
  "operations.sales.pricing.scenario.removeLine": {
    en: "Remove line {number}",
  },
  "operations.sales.pricing.scenario.subtotal": {
    en: "Subtotal at list price",
  },
  "operations.sales.pricing.scenario.discounts": { en: "Discounts" },
  "operations.sales.pricing.scenario.total": { en: "Total" },
  "operations.sales.pricing.scenario.save": { en: "Save as scenario" },
  "operations.sales.pricing.scenario.saveChanges": { en: "Save changes" },
  "operations.sales.pricing.scenario.startNew": { en: "Start a new scenario" },
  "operations.sales.pricing.scenario.saved": { en: "Saved {name}." },
  "operations.sales.pricing.scenario.deleted": { en: "Deleted {name}." },
  "operations.sales.pricing.scenario.deleteConfirm": {
    en: "Delete {name}? This cannot be undone.",
  },
  "operations.sales.pricing.scenario.listMine": { en: "My scenarios" },
  "operations.sales.pricing.scenario.listAll": { en: "All scenarios" },
  "operations.sales.pricing.scenario.empty": { en: "No saved scenarios yet." },
  "operations.sales.pricing.scenario.summary": {
    en: "{company} · priced {date} · {total}",
  },
  "operations.sales.pricing.scenario.owner": { en: "Saved by {name}" },
  "operations.sales.pricing.scenario.open": { en: "Open" },
  "operations.sales.pricing.scenario.openNamed": { en: "Open {name}" },
  "operations.sales.pricing.scenario.downloadNamed": {
    en: "Download the indicative summary for {name}",
  },
  "operations.sales.pricing.scenario.delete": { en: "Delete" },
  "operations.sales.pricing.scenario.deleteNamed": { en: "Delete {name}" },
  "operations.sales.pricing.scenario.unavailable": {
    en: "Saved scenarios are not available here. The calculator above still works.",
  },
  "operations.sales.pricing.scenario.mfa": {
    en: "Verify your sign-in to save and open scenarios.",
  },
  "operations.sales.pricing.scenario.loadError": {
    en: "Saved scenarios could not be loaded. Reload the page in a minute.",
  },
  "operations.sales.pricing.scenario.error.rateUnavailable": {
    en: "A rate in this scenario is no longer in force. Choose a current rate and save again.",
  },
  "operations.sales.pricing.scenario.error.currency": {
    en: "Every line in a scenario must use the same currency.",
  },
  "operations.sales.pricing.scenario.error.conflict": {
    en: "This scenario changed after you opened it. Open it again and make your change.",
  },
  "operations.sales.pricing.scenario.error.belowMinimum": {
    en: "A line is below its rate's minimum quantity. Raise it to the minimum before you save.",
  },
  "operations.sales.pricing.scenario.error.unprintableCompany": {
    en: "The summary can print Latin letters only. Enter the company name in Latin letters.",
  },
  "operations.sales.pricing.scenario.error.unprintable": {
    en: "This summary cannot be printed because the scenario uses characters outside the Latin alphabet. Open the scenario, correct the company name and save it again.",
  },
  "operations.sales.pricing.scenario.error.notFound": {
    en: "This scenario no longer exists.",
  },
  "operations.staff.error.mfaHint": {
    en: "If you signed in a while ago, your sign-in check may have expired. Verify your sign-in, then try again.",
  },
  "operations.staff.error.verify": { en: "Verify sign-in" },
});
