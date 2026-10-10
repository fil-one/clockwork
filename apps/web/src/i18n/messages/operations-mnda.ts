import { defineStaffMessages } from "../define";
export const mndaMessages = defineStaffMessages({
  "operations.mnda.mixedDetails": {
    en: "Our team starts; the counterparty completes missing details",
  },
  "operations.mnda.mixedHint": {
    en: "Enter what you know. Leave the rest blank and the counterparty fills it in before signing.",
  },
  "operations.mnda.shortNameHint": {
    en: "Optional to customize. Defaults to the legal name and can be edited.",
  },
  "operations.mnda.detailsMode": {
    en: "Who completes the counterparty's details?",
  },
  "operations.mnda.teamDetails": { en: "Our team enters the details" },
  "operations.mnda.partnerReference": {
    en: "Counterparty or internal reference",
  },

  "operations.mnda.latin": {
    en: "Use Latin-script names and addresses. Enter the entity type without a leading article, for example Delaware corporation.",
  },
  "operations.mnda.title": { en: "MNDAs" },
  "operations.mnda.description": {
    en: "Send the approved agreement and track both signatures.",
  },
  "operations.mnda.new": { en: "New MNDA" },
  "operations.mnda.company": { en: "Counterparty legal name" },
  "operations.mnda.shortName": { en: "Counterparty short name" },
  "operations.mnda.entityDescription": { en: "Jurisdiction and entity type" },
  "operations.mnda.streetAddress": { en: "Street address" },
  "operations.mnda.locality": { en: "City, region, postal code, country" },
  "operations.mnda.noticesContact": { en: "Notices contact" },
  "operations.mnda.noticesEmail": { en: "Notices email" },
  "operations.mnda.signerName": { en: "Counterparty signer name" },
  "operations.mnda.signerEmail": { en: "Counterparty signer email" },
  "operations.mnda.signerTitle": { en: "Signer's job title" },
  "operations.mnda.effectiveDate": { en: "Effective date" },
  "operations.mnda.countersigner": { en: "Fil One countersigner" },
  "operations.mnda.preview": { en: "Prepare preview" },
  "operations.mnda.openPdf": { en: "Open PDF" },
  "operations.mnda.send": { en: "Confirm and send" },
  "operations.mnda.notReady": {
    en: "Sending is off until signing is connected. You can prepare drafts.",
  },
  "operations.mnda.testMode": {
    en: "Test mode: these documents are for testing only.",
  },
  "operations.mnda.demo": {
    en: "Demo register: the companies and people are fictional. Preparing, sending, reminders and voids are turned off, and nothing goes out for signature.",
  },
  "operations.mnda.none": { en: "No MNDAs yet." },
  "operations.mnda.preparedBy": { en: "Prepared by {name}" },
  "operations.mnda.executed": { en: "Signed PDF" },
  "operations.mnda.signers": { en: "Authorized countersigners" },
  "operations.mnda.newSigner": { en: "Add countersigner" },
  "operations.mnda.titleField": { en: "Signer's job title" },
  "operations.mnda.active": { en: "Available for new requests" },
  "operations.mnda.default": { en: "Default countersigner" },
  "operations.mnda.review": {
    en: "Open the PDF and check the details before you send. Nothing goes to the counterparty until you confirm.",
  },
  "operations.mnda.order": {
    en: "The counterparty signs first, then the selected Fil One countersigner.",
  },

  "operations.mnda.teamHint": {
    en: "Enter every detail. The counterparty only signs.",
  },
  "operations.mnda.ifKnown": { en: "If known" },

  "operations.mnda.section.signer": { en: "Counterparty signer" },
  "operations.mnda.section.company": { en: "Company" },
  "operations.mnda.section.knownDetails": {
    en: "Known details (the counterparty fills any blanks)",
  },
  "operations.mnda.section.details": { en: "Company and notice details" },
  "operations.mnda.section.agreement": { en: "Agreement" },
  "operations.mnda.noticeLine": {
    en: "Legal notices to Fil One go to {email}.",
  },

  "operations.mnda.editTitle": { en: "Edit MNDA details" },
  "operations.mnda.preparing": { en: "Preparing preview" },
  "operations.mnda.sending": { en: "Sending" },
  "operations.mnda.retrySend": { en: "Try sending again" },
  "operations.mnda.downloadPdf": { en: "Download PDF" },
  "operations.mnda.editDetails": { en: "Edit details" },
  "operations.mnda.discardDraft": { en: "Discard draft" },

  "operations.mnda.preview.title": { en: "Review before sending" },
  "operations.mnda.preview.partner": { en: "Counterparty signer" },
  "operations.mnda.preview.notices": { en: "Notices to Fil One" },
  "operations.mnda.preview.partnerCompletes": {
    en: "Counterparty fills in",
  },
  "operations.mnda.preview.nothingToComplete": {
    en: "Nothing. Every detail is in the agreement.",
  },
  "operations.mnda.preview.order": {
    en: "{countersigner} countersigns after the counterparty signs. When both have signed, you get the signed copy by email.",
  },
  "operations.mnda.duplicate.title": {
    en: "Fil One already has an MNDA with this company",
  },
  "operations.mnda.duplicate.detail": {
    en: "{status}, {date}, prepared by {owner}",
  },
  "operations.mnda.duplicate.contractsTitle": {
    en: "The contract register already lists this company",
  },
  "operations.mnda.duplicate.contractDetail": {
    en: "{type}, {status}, effective {date}, owner {owner}",
  },
  "operations.mnda.duplicate.contractDetailUndated": {
    en: "{type}, {status}, owner {owner}",
  },

  "operations.mnda.register": { en: "All MNDAs" },
  "operations.mnda.loading": { en: "Loading" },
  "operations.mnda.loadFailed": {
    en: "The list could not be refreshed. Check your connection and try again.",
  },
  "operations.mnda.searchLabel": { en: "Search MNDAs" },
  "operations.mnda.searchPlaceholder": {
    en: "Search company, signer or email",
  },
  "operations.mnda.mine": { en: "Only mine" },
  "operations.mnda.statusFilter": { en: "Filter by status" },
  "operations.mnda.group.all": { en: "All" },
  "operations.mnda.group.drafts": { en: "Drafts" },
  "operations.mnda.group.waitingPartner": {
    en: "Waiting on counterparty",
  },
  "operations.mnda.group.waitingFilOne": { en: "Waiting on Fil One" },
  "operations.mnda.group.attention": { en: "Needs attention" },
  "operations.mnda.group.completed": { en: "Signed" },
  "operations.mnda.group.closed": { en: "Closed" },

  "operations.mnda.state.draft": { en: "Draft" },
  "operations.mnda.state.preparing": { en: "Preparing" },
  "operations.mnda.state.ready": { en: "Ready to send" },
  "operations.mnda.state.sending": { en: "Sending" },
  "operations.mnda.state.sent": { en: "Sent" },
  "operations.mnda.state.viewed": { en: "Opened" },
  "operations.mnda.state.awaiting": { en: "Waiting on Fil One" },
  "operations.mnda.state.completed": { en: "Signed" },
  "operations.mnda.state.declined": { en: "Declined" },
  "operations.mnda.state.expired": { en: "Expired" },
  "operations.mnda.state.canceled": { en: "Voided" },
  "operations.mnda.state.discarded": { en: "Discarded" },
  "operations.mnda.state.attention": { en: "Needs attention" },

  "operations.mnda.column.company": { en: "Company" },
  "operations.mnda.signedAs": { en: "Signed as {name}" },
  "operations.mnda.column.sent": { en: "Sent" },
  "operations.mnda.column.waiting": { en: "Waiting" },
  "operations.mnda.notSent": { en: "Not sent" },
  "operations.mnda.completedOn": { en: "Signed {date}" },
  "operations.mnda.testBadge": { en: "Test" },
  "operations.mnda.continue": { en: "Continue" },
  "operations.mnda.remindName": { en: "Remind {name}" },
  "operations.mnda.reminded": { en: "Reminder sent to {name}." },
  "operations.mnda.fixEmail": { en: "Fix email" },
  "operations.mnda.copy": { en: "New MNDA from this one" },
  "operations.mnda.checkStatus": { en: "Check status" },
  "operations.mnda.more": { en: "More" },
  "operations.mnda.moreFor": { en: "More actions for {company}" },
  "operations.mnda.blocked.notReady": {
    en: "Sending is off until signing is connected.",
  },
  "operations.mnda.blocked.demo": { en: "Turned off in the demo." },
  "operations.mnda.export": { en: "Export CSV" },
  "operations.mnda.noneHint": {
    en: "Choose New MNDA to send your first agreement.",
  },
  "operations.mnda.noMatches": { en: "No MNDAs match these filters" },
  "operations.mnda.noMatchesHint": { en: "Try another search or status." },
  "operations.mnda.clearFilters": { en: "Clear filters" },
  "operations.mnda.pagination": { en: "Pages" },
  "operations.mnda.pageOf": { en: "Page {page} of {pages}" },
  "operations.mnda.previous": { en: "Previous" },
  "operations.mnda.next": { en: "Next" },
  "operations.mnda.dismiss": { en: "Dismiss" },

  "operations.mnda.sentMessage": {
    en: "Sent to {email}. You get the signed copy by email when both sides have signed.",
  },
  "operations.mnda.correctedMessage": {
    en: "SignWell is sending the request to {email}.",
  },
  "operations.mnda.voidedMessage": {
    en: "MNDA voided. The counterparty can no longer sign it.",
  },

  "operations.mnda.note.bounced": {
    en: "The counterparty's email bounced.",
  },
  "operations.mnda.note.bouncedNext": {
    en: "Fix the email and SignWell sends it again.",
  },
  "operations.mnda.note.stopped": { en: "SignWell stopped this request." },
  "operations.mnda.note.stoppedNext": { en: "Void it, then send it again." },
  "operations.mnda.note.sendUnfinished": { en: "Sending did not finish." },
  "operations.mnda.note.sendUnfinishedNext": {
    en: "Choose Continue and send again. The counterparty never gets two copies.",
  },
  "operations.mnda.note.unreachable": {
    en: "SignWell did not answer the last check.",
  },
  "operations.mnda.note.unreachableNext": {
    en: "Choose Check status in a minute.",
  },
  "operations.mnda.note.expired": {
    en: "The counterparty did not sign within 30 days.",
  },
  "operations.mnda.note.declined": {
    en: "The counterparty declined to sign.",
  },
  "operations.mnda.note.sendAgainNext": {
    en: "Choose New MNDA from this one to start again.",
  },
  "operations.mnda.note.deletedInSignWell": { en: "Deleted in SignWell." },
  "operations.mnda.note.signersMismatch": {
    en: "The signers in SignWell no longer match this MNDA, so its status is not updated.",
  },
  "operations.mnda.note.fieldsMismatch": {
    en: "SignWell's copy of this MNDA has fields that do not match the template.",
  },
  "operations.mnda.note.fieldsMismatchNext": {
    en: "Void it and send again. If it happens again, tell engineering.",
  },
  "operations.mnda.note.bindingMismatch": {
    en: "SignWell's copy does not belong to this MNDA, so its status is not updated.",
  },
  "operations.mnda.note.signersMismatchNext": {
    en: "If you just fixed the counterparty's email, fix it again with the same address. Otherwise void it, then send it again.",
  },
  "operations.mnda.note.signedMismatch": {
    en: "Someone signed this MNDA in SignWell, but SignWell's copy does not match it.",
  },
  "operations.mnda.note.signedMismatchNext": {
    en: "Ask a commerce administrator to resolve it in SignWell.",
  },
  "operations.mnda.note.superseded": { en: "Replaced by an edited draft." },
  "operations.mnda.note.discarded": { en: "Draft discarded." },
  "operations.mnda.note.voided": { en: "Voided: {reason}" },

  "operations.mnda.void.action": { en: "Void" },
  "operations.mnda.void.title": { en: "Void this MNDA?" },
  "operations.mnda.void.description": {
    en: "The signer at {company} can no longer sign it.",
  },
  "operations.mnda.void.evidence": {
    en: "SignWell stops the request and deletes its copy. This register keeps the original PDF and the history. Once the counterparty has signed, the MNDA can no longer be voided.",
  },

  "operations.mnda.void.reason": { en: "Reason" },
  "operations.mnda.void.reasonHelp": {
    en: "For example: wrong legal entity. Saved with the record.",
  },
  "operations.mnda.void.confirm": { en: "Void MNDA" },
  "operations.mnda.void.keep": { en: "Keep it" },
  "operations.mnda.void.working": { en: "Voiding" },
  "operations.mnda.void.someoneElseReason": {
    en: "A different person will sign for the counterparty.",
  },

  "operations.mnda.discard.title": { en: "Discard this draft?" },
  "operations.mnda.discard.description": {
    en: "The draft for {company} was never sent.",
  },
  "operations.mnda.discard.evidence": {
    en: "It moves to Closed. You can still open its PDF there.",
  },
  "operations.mnda.discard.keep": { en: "Keep draft" },

  "operations.mnda.correct.title": { en: "Fix the counterparty's email" },
  "operations.mnda.correct.description": {
    en: "SignWell sends the request to the new address. The signer stays {name}.",
  },
  "operations.mnda.correct.help": {
    en: "Works until the counterparty starts signing.",
  },
  "operations.mnda.correct.confirm": { en: "Send to new email" },
  "operations.mnda.correct.working": { en: "Updating" },
  "operations.mnda.correct.someoneElse": { en: "Someone else will sign" },

  "operations.mnda.error.required": { en: "Enter this detail." },
  "operations.mnda.error.invalidCharacters": {
    en: "Use letters, numbers and common punctuation. Remove angle brackets, square brackets, curly brackets and characters from non-Latin scripts.",
  },
  "operations.mnda.error.invalidEmail": {
    en: "Enter a full email address, like name@company.com.",
  },
  "operations.mnda.error.tooLong": {
    en: "This is too long. Shorten it to 180 characters.",
  },
  "operations.mnda.error.invalidDate": { en: "Enter a date." },
  "operations.mnda.error.invalidValue": { en: "Check this value." },
  "operations.mnda.error.sameAsCountersigner": {
    en: "The counterparty signer can't use the Fil One countersigner's email.",
  },
  "operations.mnda.error.countersignerUnavailable": {
    en: "This countersigner is no longer available. Choose another.",
  },
  "operations.mnda.error.reminderCooldown": {
    en: "A reminder just went out. Wait a minute before sending another.",
  },
  "operations.mnda.error.busy": {
    en: "Someone else is updating this MNDA. Try again in a moment.",
  },
  "operations.mnda.error.providerFailed": {
    en: "SignWell did not respond. Try again in a minute. Nothing was sent twice.",
  },
  "operations.mnda.error.forbidden": {
    en: "Your account can't do this. Ask a commerce administrator for access.",
  },
  "operations.mnda.error.mfaRequired": {
    en: "Verify your sign-in with your authenticator app, then try again.",
  },
  "operations.mnda.error.notConfigured": {
    en: "Sending is not set up in this environment yet.",
  },
  "operations.mnda.error.notFound": {
    en: "This MNDA no longer exists. Refresh the page.",
  },
  "operations.mnda.error.conflict": {
    en: "Something changed while you were working. Review the details and try again.",
  },
  "operations.mnda.error.notPending": {
    en: "This MNDA is no longer waiting on anyone. Its row shows its current status.",
  },
  "operations.mnda.error.remindNeedsAttention": {
    en: "No reminder was sent. This MNDA needs attention first, and its row says why and what to do next.",
  },
  "operations.mnda.error.signerStarted": {
    en: "The counterparty has started signing, so the email can't change. Void this MNDA and send a new one.",
  },
  "operations.mnda.error.notCorrectable": {
    en: "The email can only change while the counterparty has not signed. Void this MNDA and send a new one.",
  },
  "operations.mnda.error.alreadyCompleted": {
    en: "Both sides already signed this MNDA, so it was kept.",
  },
  "operations.mnda.error.needsAttention": {
    en: "This MNDA was not sent. Its row in the list says why and what to do next.",
  },
  "operations.mnda.error.stillPreparing": {
    en: "SignWell is still preparing this MNDA, so it was not sent. Send it again in a minute. Until then it stays under Drafts.",
  },
  "operations.mnda.error.signedInSignWell": {
    en: "Someone signed SignWell's copy of this MNDA, so it can't be voided here. Ask a commerce administrator to resolve it in SignWell.",
  },
  "operations.mnda.error.reasonRequired": {
    en: "Enter a reason of at least 3 characters.",
  },
  "operations.mnda.error.demoUnavailable": {
    en: "The demo does not prepare, send or change MNDAs.",
  },
  "operations.mnda.error.unexpected": {
    en: "That did not work. Try again, and tell James if it keeps happening.",
  },

  "operations.mnda.access.forbiddenTitle": {
    en: "You don't have access to MNDAs",
  },
  "operations.mnda.access.forbiddenDescription": {
    en: "Ask a commerce administrator to give your account the revenue role.",
  },
  "operations.mnda.access.mfaTitle": {
    en: "Verify your sign-in to send MNDAs",
  },
  "operations.mnda.access.mfaDescription": {
    en: "MNDAs are legal documents, so this page needs a sign-in verified with your authenticator app.",
  },
  "operations.mnda.access.mfaAction": { en: "Verify sign-in" },
  "operations.mnda.access.unavailableTitle": {
    en: "MNDAs are unavailable right now",
  },
  "operations.mnda.access.unavailableDescription": {
    en: "The register could not be loaded. Reload the page in a minute.",
  },
  "operations.mnda.access.home": { en: "Back to home" },
  "operations.mnda.inactive": { en: "Not available" },

  "operations.mnda.settings.link": { en: "MNDA settings" },
  "operations.mnda.settings.title": { en: "MNDA settings" },
  "operations.mnda.settings.description": {
    en: "Who signs for Fil One and where legal notices go. Changes apply to new drafts; prepared drafts keep their values.",
  },
  "operations.mnda.settings.back": { en: "Back to MNDAs" },
  "operations.mnda.settings.noticeTitle": { en: "Notice email" },
  "operations.mnda.settings.noticeDescription": {
    en: "Printed in every new MNDA as Fil One's email for legal notices. It does not need to belong to the countersigner.",
  },
  "operations.mnda.settings.noticeEmail": { en: "Fil One notice email" },
  "operations.mnda.settings.lastChanged": { en: "Last changed {date}." },
  "operations.mnda.settings.saved": {
    en: "Notice email saved. New drafts use it.",
  },
  "operations.mnda.settings.signersDescription": {
    en: "People who may countersign MNDAs for Fil One. Sellers choose one when they prepare a draft.",
  },
  "operations.mnda.settings.signerForm": { en: "Countersigner details" },
  "operations.mnda.settings.signerSaved": { en: "{name} saved." },
  "operations.mnda.settings.editSigner": { en: "Edit {name}" },
  "operations.mnda.settings.activeHelp": {
    en: "Turn off when this person should no longer countersign. Existing MNDAs are not affected.",
  },
  "operations.mnda.settings.defaultHelp": { en: "Preselected for new MNDAs." },

  "operations.mnda.count": {
    count: "count",
    en: { one: "{count} MNDA", other: "{count} MNDAs" },
  },
  "operations.mnda.days": {
    count: "count",
    en: { one: "{count} day", other: "{count} days" },
  },
  "operations.mnda.error.summary": {
    count: "count",
    en: {
      one: "{count} detail needs attention. Check the highlighted field.",
      other: "{count} details need attention. Check the highlighted fields.",
    },
  },
  "operations.mnda.error.notOwner": {
    en: "Only the person who prepared this MNDA or a commerce administrator can do this.",
  },
  "operations.mnda.error.notVoidable": {
    en: "The counterparty has already signed, so this MNDA can't be voided. If it must not take effect, tell the Fil One countersigner not to sign it.",
  },

  "operations.mnda.error.settingsChanged": {
    en: "The MNDA settings changed while you were working. Prepare the preview again to use the current notice email.",
  },
  "operations.mnda.error.settingsConflict": {
    en: "Someone else changed these settings while you were editing. Review the current value and save again.",
  },
  "operations.mnda.settings.changedElsewhere": {
    en: "Someone else changed the notice email to {email} while you were editing. Your entry is still in the field: review it and save again if it should replace theirs.",
  },
  "operations.mnda.exportFailed": {
    en: "The MNDA export could not be prepared. Go back and try again in a minute.",
  },
  "operations.mnda.exportTruncated": {
    en: "Export CSV includes the newest {limit} MNDAs that match. Narrow the filters to export the rest.",
  },
  "operations.mnda.note.deletedNext": {
    en: "The counterparty can no longer sign it. Void it here to close it, then start a new one if needed.",
  },
  "operations.mnda.note.signerChange": {
    en: "Voided: a different person will sign for the counterparty.",
  },
  "operations.mnda.void.signerChangeNote": {
    en: "After voiding, a new draft opens with the same company details so you can enter the new signer.",
  },
});
