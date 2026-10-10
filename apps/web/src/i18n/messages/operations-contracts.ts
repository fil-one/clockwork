import { defineStaffMessages, sameInAllLanguages } from "../define";
export const contractMessages = defineStaffMessages({
  "operations.contracts.title": { en: "Contracts" },
  "operations.contracts.description": {
    en: "Every agreement with prospects, customers and partners, signed or in progress. Signed MNDAs from the MNDA register appear here automatically.",
  },
  "operations.contracts.results": { en: "Contracts found" },
  "operations.contracts.count": {
    count: "count",
    en: { one: "{count} contract", other: "{count} contracts" },
  },
  "operations.contracts.backToRegister": { en: "Back to contracts" },
  "operations.contracts.notSet": { en: "Not set" },
  "operations.contracts.none": { en: "None" },
  "operations.contracts.yes": { en: "Yes" },
  "operations.contracts.no": { en: "No" },
  "operations.contracts.months": {
    count: "count",
    en: { one: "{count} month", other: "{count} months" },
  },
  "operations.contracts.days": {
    count: "count",
    en: { one: "{count} day", other: "{count} days" },
  },
  "operations.contracts.noSignedCopy": { en: "No signed copy" },
  "operations.contracts.action.record": { en: "Record a contract" },
  "operations.contracts.action.fromTemplate": {
    en: "Prepare from template",
  },
  "operations.contracts.action.renewals": { en: "Contract renewal notices" },
  "operations.contracts.action.export": { en: "Export CSV" },
  "operations.contracts.action.edit": { en: "Edit" },
  "operations.contracts.access.mfaTitle": {
    en: "Verify your sign-in to open contracts",
  },
  "operations.contracts.access.mfaBody": {
    en: "Contracts hold signed legal documents, so this page needs a sign-in verified with your authenticator app. Sign out, then sign in again and complete the verification step.",
  },
  "operations.contracts.access.demoTitle": {
    en: "Contracts are read-only in the demo",
  },
  "operations.contracts.access.demoBody": {
    en: "The demo shows a fictional contract register. Recording, editing and sending contracts need a Fil One staff account.",
  },
  "operations.contracts.access.forbiddenTitle": {
    en: "Contracts are not part of your role",
  },
  "operations.contracts.access.forbiddenBody": {
    en: "Ask a Commerce administrator to give your account access.",
  },
  "operations.contracts.access.missingTitle": {
    en: "This contract could not be found",
  },
  "operations.contracts.access.missingBody": {
    en: "The link may be wrong, or the page may be for a template that does not exist. Open the register to find the contract.",
  },
  "operations.contracts.access.errorTitle": {
    en: "This page could not be loaded",
  },
  "operations.contracts.access.errorBody": {
    en: "Reload the page. If it keeps happening, tell a Commerce administrator.",
  },
  "operations.contracts.type.mnda": sameInAllLanguages(
    "MNDA",
    "agreement abbreviation, kept as-is like the MNDA register it links to",
  ),
  "operations.contracts.type.ndaOneWay": { en: "One-way NDA" },
  "operations.contracts.type.customerMsa": { en: "Customer MSA" },
  "operations.contracts.type.orderForm": { en: "Order form" },
  "operations.contracts.type.dpa": { en: "Data processing addendum" },
  "operations.contracts.type.securityAnnex": { en: "Security annex" },
  "operations.contracts.type.channelPartnership": {
    en: "Channel partnership agreement",
  },
  "operations.contracts.type.technologyPartner": {
    en: "Technology partner agreement",
  },
  "operations.contracts.type.sow": { en: "Statement of work" },
  "operations.contracts.type.other": { en: "Other" },
  "operations.contracts.paper.ours": { en: "Our paper" },
  "operations.contracts.paper.theirs": { en: "Their paper" },
  "operations.contracts.paper.oursHelp": {
    en: "Fil One's own template or wording.",
  },
  "operations.contracts.paper.theirsHelp": {
    en: "The counterparty's document.",
  },
  "operations.contracts.status.draft": { en: "Draft" },
  "operations.contracts.status.inNegotiation": { en: "In negotiation" },
  "operations.contracts.status.outForSignature": { en: "Out for signature" },
  "operations.contracts.status.executed": { en: "Signed" },
  "operations.contracts.status.expired": { en: "Expired" },
  "operations.contracts.status.terminated": { en: "Terminated" },
  "operations.contracts.file.main": { en: "Main document" },
  "operations.contracts.file.attachment": { en: "Attachment" },
  "operations.contracts.file.counterpartyDraft": { en: "Their draft" },
  "operations.contracts.file.redline": { en: "Markup" },
  "operations.contracts.file.generated": { en: "Prepared document" },
  "operations.contracts.file.executed": {
    en: "Signed copy with signing record",
  },
  "operations.contracts.field.counterparty": { en: "Counterparty legal name" },
  "operations.contracts.field.counterpartyHelp": {
    en: "As written in the agreement, for example Bluefin Data Inc.",
  },
  "operations.contracts.field.title": { en: "Short title" },
  "operations.contracts.field.titleHelp": {
    en: "Helps tell agreements with the same counterparty apart, for example 2026 storage order.",
  },
  "operations.contracts.field.type": { en: "Type" },
  "operations.contracts.field.paper": { en: "Whose paper" },
  "operations.contracts.field.status": { en: "Status" },
  "operations.contracts.field.statusExecutedHelp": {
    en: "Once signed, a contract can only expire or be terminated.",
  },
  "operations.contracts.field.effectiveDate": { en: "Effective date" },
  "operations.contracts.field.initialTerm": { en: "Initial term" },
  "operations.contracts.field.monthsHelp": {
    en: "In months. Leave blank if the agreement runs until either side ends it.",
  },
  "operations.contracts.field.autoRenew": { en: "Renews automatically" },
  "operations.contracts.field.autoRenewHelp": {
    en: "The term renews unless one side gives notice of non-renewal in time.",
  },
  "operations.contracts.field.renewalTerm": { en: "Renewal term" },
  "operations.contracts.field.renewalTermHelp": {
    en: "In months. Leave blank to use the initial term.",
  },
  "operations.contracts.field.noticePeriod": { en: "Notice period" },
  "operations.contracts.field.noticeHelp": {
    en: "In days: how long before the term ends notice of non-renewal must be given.",
  },
  "operations.contracts.field.termEnds": { en: "Current term ends" },
  "operations.contracts.field.renewsOn": { en: "Renews on" },
  "operations.contracts.field.noticeDeadline": { en: "Notice deadline" },
  "operations.contracts.field.value": { en: "Contract value" },
  "operations.contracts.field.valueHelp": {
    en: "Total committed value, for example 12000 or 12,000.50.",
  },
  "operations.contracts.field.currency": { en: "Currency" },
  "operations.contracts.field.pricingNotes": { en: "Pricing notes" },
  "operations.contracts.field.pricingNotesHelp": {
    en: "Rates, discounts, minimums or anything else about price.",
  },
  "operations.contracts.field.owner": { en: "Fil One owner" },
  "operations.contracts.field.ownerHelp": {
    en: "The person who looks after this relationship.",
  },
  "operations.contracts.field.tags": { en: "Tags" },
  "operations.contracts.field.tagsHelp": {
    en: "Separate tags with commas, for example enterprise, EU.",
  },
  "operations.contracts.field.internalNotes": { en: "Internal notes" },
  "operations.contracts.field.internalNotesHelp": {
    en: "Seen by Fil One staff only.",
  },
  "operations.contracts.field.error.required": { en: "Required." },
  "operations.contracts.field.error.tooLong": { en: "This is too long." },
  "operations.contracts.field.error.format": { en: "Check the format." },
  "operations.contracts.field.error.number": { en: "Enter a whole number." },
  "operations.contracts.field.error.email": {
    en: "Enter a valid email address.",
  },
  "operations.contracts.field.error.amount": {
    en: "Enter an amount such as 12000 or 12,000.50.",
  },
  "operations.contracts.field.error.amountAndCurrency": {
    en: "Enter both an amount and a currency.",
  },
  "operations.contracts.field.error.autoRenew": {
    en: "Needed when the contract renews automatically.",
  },
  "operations.contracts.field.error.termNeedsDate": {
    en: "Add the effective date so the term can be worked out.",
  },
  "operations.contracts.field.error.tag": {
    en: "Tags can use letters, numbers, spaces and - _ . / & +.",
  },
  "operations.contracts.field.error.characters": {
    en: "Remove line breaks and special control characters.",
  },
  "operations.contracts.field.error.check": { en: "Check this value." },
  "operations.contracts.field.error.months": {
    en: "Enter the term in whole months, for example 12.",
  },
  "operations.contracts.field.error.days": {
    en: "Enter the notice period in whole days, for example 30.",
  },
  "operations.contracts.field.error.date": {
    en: "Enter a full date, for example 1 October 2026.",
  },
  "operations.contracts.column.renewsOrEnds": { en: "Renews or ends" },
  "operations.contracts.boundary.renews": { en: "Renews" },
  "operations.contracts.boundary.ends": { en: "Ends" },
  "operations.contracts.deadline.passed": { en: "Passed" },
  "operations.contracts.deadline.today": { en: "Today" },
  "operations.contracts.deadline.inDays": {
    count: "count",
    en: { one: "In {count} day", other: "In {count} days" },
  },
  "operations.contracts.filters.label": { en: "Filter contracts" },
  "operations.contracts.filters.search": { en: "Search" },
  "operations.contracts.filters.searchPlaceholder": {
    en: "Counterparty, owner or tag",
  },
  "operations.contracts.filters.allTypes": { en: "All types" },
  "operations.contracts.filters.allStatuses": { en: "All statuses" },
  "operations.contracts.filters.signingGroup": { en: "Signing" },
  "operations.contracts.filters.signingDeclined": { en: "Signer declined" },
  "operations.contracts.filters.signingExpired": { en: "Signing expired" },
  "operations.contracts.filters.signingCanceled": {
    en: "Signing voided or discarded",
  },
  "operations.contracts.filters.signingApproval": {
    en: "Waiting for approval",
  },
  "operations.contracts.filters.signingAttention": {
    en: "Signing needs attention",
  },
  "operations.contracts.filters.anyDate": { en: "Any date" },
  "operations.contracts.filters.within": {
    count: "count",
    en: { one: "Within {count} day", other: "Within {count} days" },
  },
  "operations.contracts.filters.recordedByMe": { en: "Recorded by me" },
  "operations.contracts.filters.toggle": {
    count: "count",
    en: { one: "Filters ({count})", other: "Filters ({count})" },
  },
  "operations.contracts.filters.toggleNone": { en: "Filters" },
  "operations.contracts.filters.clear": { en: "Clear filters" },
  "operations.contracts.sort.ascending": { en: "{column}, sort ascending" },
  "operations.contracts.sort.descending": { en: "{column}, sort descending" },
  "operations.contracts.source.mnda": { en: "MNDA register" },
  "operations.contracts.source.mndaRow": { en: "From the MNDA register" },
  "operations.contracts.source.register": { en: "Contract register" },
  "operations.contracts.export.documents": { en: "Documents" },
  "operations.contracts.export.source": { en: "Source" },
  "operations.contracts.export.signing": { en: "Signing" },
  "operations.contracts.export.truncated": {
    en: "The CSV export includes the first {limit} matching contracts. Narrow the filters to export the rest.",
  },
  "operations.contracts.empty.title": { en: "No contracts recorded yet" },
  "operations.contracts.empty.body": {
    en: "Record a signed agreement, or upload a counterparty's draft while you negotiate. Signed MNDAs will appear here as well.",
  },
  "operations.contracts.empty.filteredTitle": {
    en: "No contracts match these filters",
  },
  "operations.contracts.empty.filteredBody": {
    en: "Try a shorter search or clear the filters.",
  },
  "operations.contracts.pagination.label": { en: "Pages" },
  "operations.contracts.pagination.position": { en: "Page {page} of {pages}" },
  "operations.contracts.pagination.previous": { en: "Previous" },
  "operations.contracts.pagination.next": { en: "Next" },
  "operations.contracts.new.title": { en: "Record a contract" },
  "operations.contracts.new.fromMnda": {
    en: "From the MNDA signed on {date}. Counterparty signer: {signer}.",
  },
  "operations.contracts.new.description": {
    en: "Add an agreement signed outside Commerce, or one you are still negotiating on the counterparty's paper.",
  },
  "operations.contracts.edit.title": { en: "Edit contract" },
  "operations.contracts.form.parties": { en: "Agreement" },
  "operations.contracts.form.term": { en: "Term and renewal" },
  "operations.contracts.form.termHelp": {
    en: "These dates drive the renewal notices list. Check them against the agreement.",
  },
  "operations.contracts.form.commercial": { en: "Commercial terms" },
  "operations.contracts.form.ownership": { en: "Ownership and notes" },
  "operations.contracts.form.documents": { en: "Documents" },
  "operations.contracts.form.documentsHelp": {
    en: "Add the signed PDF and any attachments, such as a DPA or an order form. You can add more later.",
  },
  "operations.contracts.form.chooseFiles": { en: "Choose PDFs" },
  "operations.contracts.form.fileRules": { en: "PDF only, up to 25 MB each." },
  "operations.contracts.form.documentKind": { en: "Document type" },
  "operations.contracts.form.removeFile": { en: "Remove {name}" },
  "operations.contracts.form.optional": { en: "Optional" },
  "operations.contracts.form.save": { en: "Save contract" },
  "operations.contracts.form.saveChanges": { en: "Save changes" },
  "operations.contracts.form.cancel": { en: "Cancel" },
  "operations.contracts.form.saving": { en: "Saving…" },
  "operations.contracts.form.uploading": {
    en: "Uploading {name} ({index} of {total})…",
  },
  "operations.contracts.form.checkFields": { en: "Check these fields" },
  "operations.contracts.form.check": { en: "Field" },
  "operations.contracts.form.notSaved": { en: "The contract was not saved" },
  "operations.contracts.form.partialTitle": {
    en: "The contract was saved, but some files did not upload",
  },
  "operations.contracts.form.openContract": {
    en: "Open the contract to add them",
  },
  "operations.contracts.detail.title": { en: "Contract" },
  "operations.contracts.detail.documentTitle": { en: "{name}, {type}" },
  "operations.contracts.detail.terms": { en: "Key terms" },
  "operations.contracts.detail.renewsEvery": {
    count: "count",
    en: { one: "Yes, every {count} month", other: "Yes, every {count} months" },
  },
  "operations.contracts.detail.recordedBy": { en: "Recorded by" },
  "operations.contracts.detail.documents": { en: "Documents on file" },
  "operations.contracts.detail.noNotes": { en: "No notes yet." },
  "operations.contracts.detail.noSignedCopyTitle": {
    en: "No signed copy is attached",
  },
  "operations.contracts.detail.noSignedCopyBody": {
    en: "This contract is marked signed. Upload the signed PDF so the team can find it.",
  },
  "operations.contracts.detail.termEndedTitle": { en: "The term has ended" },
  "operations.contracts.detail.termEndedBody": {
    en: "This contract does not renew and its term is over. Change the status to expired or terminated if it is no longer in force.",
  },
  "operations.contracts.documents.title": { en: "Documents" },
  "operations.contracts.documents.description": {
    en: "Signed agreements, attachments and drafts. Each file is checked against its fingerprint when opened.",
  },
  "operations.contracts.documents.emptyTitle": { en: "No documents yet" },
  "operations.contracts.documents.emptyBody": {
    en: "Upload the signed PDF, or the counterparty's latest draft while you negotiate.",
  },
  "operations.contracts.documents.meta": { en: "{size} · {name} · {time}" },
  "operations.contracts.documents.view": { en: "View" },
  "operations.contracts.documents.viewNamed": { en: "View {name}" },
  "operations.contracts.documents.download": { en: "Download" },
  "operations.contracts.documents.downloadNamed": { en: "Download {name}" },
  "operations.contracts.documents.remove": { en: "Remove" },
  "operations.contracts.documents.removeNamed": { en: "Remove {name}" },
  "operations.contracts.documents.choose": { en: "PDF to upload" },
  "operations.contracts.documents.upload": { en: "Upload" },
  "operations.contracts.documents.uploading": { en: "Uploading…" },
  "operations.contracts.documents.uploaded": { en: "{name} was added." },
  "operations.contracts.documents.removed": { en: "{name} was removed." },
  "operations.contracts.documents.locked": {
    en: "Documents on a signed contract are kept permanently. To correct one, upload the right file and explain it in the notes.",
  },
  "operations.contracts.documents.confirmTitle": {
    en: "Remove this document?",
  },
  "operations.contracts.documents.confirmBody": {
    en: "{name} will be removed from this contract. The activity history keeps a record that it was there.",
  },
  "operations.contracts.activity.title": { en: "Activity" },
  "operations.contracts.activity.created": { en: "Recorded the contract" },
  "operations.contracts.activity.updated": { en: "Edited the contract" },
  "operations.contracts.activity.documentAdded": { en: "Added {name}" },
  "operations.contracts.activity.documentRemoved": { en: "Removed {name}" },
  "operations.contracts.activity.prepared": { en: "Prepared from a template" },
  "operations.contracts.activity.approved": { en: "Approved for sending" },
  "operations.contracts.activity.selfApproved": {
    en: "Approved for sending by the preparer, with a reason",
  },
  "operations.contracts.activity.voided": { en: "Voided" },
  "operations.contracts.activity.remindedCounterparty": {
    en: "Reminder sent to the counterparty signer",
  },
  "operations.contracts.activity.remindedCountersigner": {
    en: "Reminder sent to the Fil One countersigner",
  },
  "operations.contracts.activity.deletedInSignWell": {
    en: "Found deleted in SignWell",
  },
  "operations.contracts.activity.signwellMismatch": {
    en: "SignWell's copy stopped matching this contract",
  },
  "operations.contracts.activity.signerChange": {
    en: "Voided: someone else will sign",
  },
  "operations.contracts.activity.signerCorrectionRequested": {
    en: "Counterparty email change sent to SignWell: {email}",
  },
  "operations.contracts.activity.signerCorrected": {
    en: "Counterparty email changed to {email}",
  },
  "operations.contracts.activity.signerCorrectedFrom": {
    en: "Counterparty email changed from {from} to {email}",
  },
  "operations.contracts.activity.signerCorrectionRequestedFrom": {
    en: "Counterparty email change from {from} to {email} sent to SignWell",
  },
  "operations.contracts.activity.signerCorrectionDropped": {
    en: "Counterparty email change not applied by SignWell",
  },
  "operations.contracts.activity.signerCorrectionRefused": {
    en: "SignWell refused the counterparty email change to {email}",
  },
  "operations.contracts.activity.reason": { en: "Reason: {reason}" },
  "operations.contracts.signing.signersMismatch": {
    en: "The signers in SignWell no longer match this contract, so its status is not updated until they match again.",
  },
  "operations.contracts.signing.bindingMismatch": {
    en: "SignWell's copy does not belong to this contract, so its status is not updated until it matches again.",
  },
  "operations.contracts.signing.signedMismatch": {
    en: "Someone signed this contract in SignWell, but SignWell's copy does not match it.",
  },
  "operations.contracts.signing.signedMismatchNext": {
    en: "Ask a commerce administrator to resolve it in SignWell.",
  },
  "operations.contracts.signing.fieldsMismatch": {
    en: "SignWell found signature fields Commerce did not place, such as form fields in the uploaded PDF, so nothing was sent.",
  },
  "operations.contracts.signing.mismatchNextPaper": {
    en: "Void it here to close the request, then record the contract again.",
  },
  "operations.contracts.signing.mismatchNext": {
    en: "Void it here to close the request, then prepare a new one.",
  },
  "operations.contracts.error.stillPreparing": {
    en: "SignWell is still preparing this contract, so it was not sent. Send it again in a minute.",
  },
  "operations.contracts.error.needsAttention": {
    en: "This contract was not sent. The signing section says why and what to do next.",
  },
  "operations.contracts.activity.rejected": {
    en: "Sent back with changes requested",
  },
  "operations.contracts.activity.signing": { en: "Signing: {state}" },
  "operations.contracts.activity.change": {
    en: "{field} changed from {from} to {to}",
  },
  "operations.contracts.renewals.title": { en: "Contract renewal notices" },
  "operations.contracts.renewals.description": {
    en: "Signed contracts that renew automatically unless someone gives notice. The deadline is the last day to give notice before the current term ends.",
  },
  "operations.contracts.renewals.windowLabel": { en: "Time window" },
  "operations.contracts.renewals.window": {
    count: "count",
    en: { one: "Next {count} day", other: "Next {count} days" },
  },
  "operations.contracts.renewals.count": {
    count: "count",
    en: { one: "{count} notice due", other: "{count} notices due" },
  },
  "operations.contracts.renewals.passedTitle": { en: "Notice deadline passed" },
  "operations.contracts.renewals.passedBody": {
    en: "These contracts will renew automatically: the last day to give notice of non-renewal has passed.",
  },
  "operations.contracts.renewals.passedRow": {
    en: "Notice deadline {deadline}, renews on {renewal}",
  },
  "operations.contracts.renewals.emptyTitle": {
    count: "count",
    en: {
      one: "No notices due in the next {count} day",
      other: "No notices due in the next {count} days",
    },
  },
  "operations.contracts.renewals.emptyBody": {
    en: "A contract appears here when it renews automatically and its notice deadline is close. Record the effective date, term, renewal and notice period on each contract to include it.",
  },
  "operations.contracts.renewals.footnote": {
    en: "Deadlines are worked out from the dates on each record. Check the agreement's own notice wording before relying on them.",
  },
  "operations.contracts.templates.title": { en: "Prepare from template" },
  "operations.contracts.templates.description": {
    en: "Prepare a Fil One agreement from wording approved by legal, then send it for signature.",
  },
  "operations.contracts.templates.ready": { en: "Ready" },
  "operations.contracts.templates.pending": {
    en: "Template pending from legal",
  },
  "operations.contracts.templates.readyBody": {
    en: "Version {version}. Fill in the details, check the PDF and send it for signature.",
  },
  "operations.contracts.templates.readyWithApproval": {
    en: "Version {version}. Someone other than the person who prepares it must approve it before it is sent.",
  },
  "operations.contracts.templates.pendingBody": {
    en: "Legal has not supplied this template yet. Until then, record the agreement manually once it is signed.",
  },
  "operations.contracts.templates.noneReadyTitle": {
    en: "Legal has not supplied contract templates yet",
  },
  "operations.contracts.templates.noneReadyBody": {
    en: "Record a signed agreement instead. Coming from legal: {names}.",
  },
  "operations.contracts.templates.pendingList": {
    en: "Not yet supplied by legal: {names}. Record these manually once signed.",
  },
  "operations.contracts.templates.prepare": { en: "Prepare" },
  "operations.contracts.templates.prepareNamed": { en: "Prepare {name}" },
  "operations.contracts.templates.recordInstead": { en: "Record manually" },
  "operations.contracts.prepare.title": { en: "Prepare from template" },
  "operations.contracts.prepare.description": {
    en: "Template version {version}. You will see the PDF before anything is sent.",
  },
  "operations.contracts.prepare.counterparty": {
    en: "Counterparty and signer",
  },
  "operations.contracts.prepare.terms": { en: "Agreement details" },
  "operations.contracts.prepare.filOne": sameInAllLanguages(
    "Fil One",
    "product name",
  ),
  "operations.contracts.prepare.signerName": { en: "Signer's full name" },
  "operations.contracts.prepare.signerEmail": { en: "Signer's email" },
  "operations.contracts.prepare.signerTitle": { en: "Signer's job title" },
  "operations.contracts.prepare.countersigner": { en: "Fil One countersigner" },
  "operations.contracts.prepare.order": {
    en: "The counterparty signs first, then the Fil One countersigner.",
  },
  "operations.contracts.prepare.latinHelp": {
    en: "Use Latin letters, as the name should appear in the agreement.",
  },
  "operations.contracts.prepare.choose": { en: "Choose…" },
  "operations.contracts.prepare.submit": { en: "Prepare document" },
  "operations.contracts.prepare.preparing": { en: "Preparing…" },
  "operations.contracts.prepare.notPrepared": {
    en: "The document was not prepared",
  },
  "operations.contracts.prepare.approvalTitle": {
    en: "Approval needed before sending",
  },
  "operations.contracts.prepare.approvalBody": {
    en: "After you prepare it, someone else with approval rights must approve it before it can go out.",
  },
  "operations.contracts.prepare.notReadyBody": {
    en: "You can prepare and approve the document now. Sending will work once SignWell is set up for contracts.",
  },
  "operations.contracts.prepare.noCountersignerTitle": {
    en: "No Fil One countersigner is set up",
  },
  "operations.contracts.paperSend.title": { en: "Prepare for signature" },
  "operations.contracts.paperSend.description": {
    en: "Send their PDF through SignWell with a Fil One signature page added at the end.",
  },
  "operations.contracts.paperSend.file": { en: "Their PDF" },
  "operations.contracts.paperSend.signers": { en: "Who signs in SignWell" },
  "operations.contracts.paperSend.filOneOnly": { en: "Fil One only" },
  "operations.contracts.paperSend.filOneOnlyHelp": {
    en: "The counterparty already signed this PDF.",
  },
  "operations.contracts.paperSend.both": {
    en: "The counterparty, then Fil One",
  },
  "operations.contracts.paperSend.bothHelp": {
    en: "The counterparty signs the added page first.",
  },
  "operations.contracts.paperSend.approvalNote": {
    en: "Someone with approval rights approves it before it can be sent.",
  },
  "operations.contracts.paperSend.submit": { en: "Prepare for signature" },
  "operations.contracts.paperSend.notPrepared": {
    en: "Not prepared for signature",
  },
  "operations.contracts.signing.paperSource": {
    en: "Their PDF with the Fil One signature page ({version}).",
  },
  "operations.contracts.signing.signedOnPaper": {
    en: "Signed on their paper",
  },
  "operations.contracts.signing.confirmSendFilOneBody": {
    en: "SignWell will email {countersigner} to sign for Fil One.",
  },
  "operations.contracts.error.paperNotSendable": {
    en: "Only an unsigned contract on the counterparty's paper can be sent for Fil One signature.",
  },
  "operations.contracts.error.signingExists": {
    en: "This contract already has a signing request. Reload to see it.",
  },
  "operations.contracts.error.fileSentForSignature": {
    en: "This PDF was sent for signature, so it stays with the contract as a record of what was signed.",
  },
  "operations.contracts.signing.paperClosedTitle": {
    en: "This request can no longer be sent",
  },
  "operations.contracts.signing.paperClosedBody": {
    en: "A contract on their paper is sent for signature once. To send it again, record it again with its PDF; the new record starts from this one. Then set this record to Terminated so the contract is not counted twice.",
  },
  "operations.contracts.signing.recordAgain": {
    en: "Record the contract again",
  },
  "operations.contracts.signing.closeThisOne": {
    en: "Edit this record",
  },
  "operations.contracts.error.paperUnreadable": {
    en: "This PDF could not be read because it is encrypted or damaged, even if it opens in a viewer. Print it to a new PDF, upload that, and try again.",
  },
  "operations.contracts.error.paperFormUnreadable": {
    en: "This PDF has form fields that cannot be copied exactly as they appear. Print it to a flat PDF (for example, Print to PDF), upload that, and send it again.",
  },
  "operations.contracts.error.paperChanged": {
    en: "This PDF no longer matches the file that was uploaded. Reload the contract and choose the PDF again.",
  },
  "operations.contracts.prepare.fromTitle": {
    en: "Values from the voided contract",
  },
  "operations.contracts.prepare.fromBody": {
    en: "Enter the person who will sign for the counterparty, check the rest, and prepare the contract again.",
  },
  "operations.contracts.prepare.noCountersignerBody": {
    en: "Ask a Commerce administrator to add an active countersigner in the MNDA register.",
  },
  "operations.contracts.lineItems.currency": { en: "Currency" },
  "operations.contracts.lineItems.currencyImported": {
    en: "Set by the imported pricing scenario.",
  },
  "operations.contracts.lineItems.line": { en: "Line {number}" },
  "operations.contracts.lineItems.sku": { en: "Item" },
  "operations.contracts.lineItems.description": { en: "Description" },
  "operations.contracts.lineItems.region": { en: "Region" },
  "operations.contracts.lineItems.unit": { en: "Unit" },
  "operations.contracts.lineItems.unitPrice": {
    en: "Unit price ({currency})",
  },
  "operations.contracts.lineItems.quantity": { en: "Quantity" },
  "operations.contracts.lineItems.term": { en: "Term (months)" },
  "operations.contracts.lineItems.discount": { en: "Discount (%)" },
  "operations.contracts.lineItems.extended": {
    en: "Extended price {amount}",
  },
  "operations.contracts.lineItems.incomplete": {
    en: "Enter the unit price, quantity, term and discount to price this line.",
  },
  "operations.contracts.lineItems.belowMinimum": {
    en: "This is below the rate's minimum of {minimum} {unit}.",
  },
  "operations.contracts.lineItems.add": { en: "Add line" },
  "operations.contracts.lineItems.remove": { en: "Remove line {number}" },
  "operations.contracts.lineItems.subtotal": {
    en: "Subtotal before discounts",
  },
  "operations.contracts.lineItems.discounts": { en: "Discounts" },
  "operations.contracts.lineItems.total": { en: "Total" },
  "operations.contracts.lineItems.noTotal": {
    en: "The total appears when every line is complete.",
  },
  "operations.contracts.lineItems.replace": {
    en: "Replace the lines already entered with this scenario's lines?",
  },
  "operations.contracts.lineItems.import.open": {
    en: "Import from pricing scenario",
  },
  "operations.contracts.lineItems.import.loading": {
    en: "Loading scenarios…",
  },
  "operations.contracts.lineItems.import.choose": { en: "Saved scenario" },
  "operations.contracts.lineItems.import.option": {
    en: "{name}, {company} ({total})",
  },
  "operations.contracts.lineItems.import.submit": { en: "Import lines" },
  "operations.contracts.lineItems.import.none": {
    en: "No saved pricing scenarios yet. Save one on the pricing page to import it here.",
  },
  "operations.contracts.lineItems.import.done": {
    en: "Lines from the scenario {name}, list prices as of {date}. You can still edit them; the contract's pricing notes name any line that no longer matches the scenario.",
  },
  "operations.contracts.lineItems.import.detach": { en: "Detach scenario" },
  "operations.contracts.lineItems.import.lineRefused": {
    en: "Line {number} of this scenario cannot be used in the agreement. {reason}",
  },
  "operations.contracts.lineItems.import.failed": {
    en: "The scenario was not imported",
  },
  "operations.contracts.lineItems.import.unavailable": {
    en: "Saved pricing scenarios are not available here.",
  },
  "operations.contracts.lineItems.error.invalid": {
    en: "The line items could not be printed. Check every line and prepare the document again.",
  },
  "operations.contracts.lineItems.error.characters": {
    en: "Use Latin letters, digits and common punctuation, without angle brackets, square brackets or braces.",
  },
  "operations.contracts.lineItems.error.belowMinimum": {
    en: "A line is below its rate's minimum quantity. Raise it to the minimum.",
  },
  "operations.contracts.lineItems.error.lineTotal": {
    en: "A line's extended price does not match its entries. Check the line and try again.",
  },
  "operations.contracts.lineItems.error.lines": {
    en: "Complete every line: item, unit, unit price, quantity, term and discount.",
  },
  "operations.contracts.signing.title": { en: "Signature" },
  "operations.contracts.signing.template": {
    en: "Prepared from template version {version}.",
  },
  "operations.contracts.signing.progress": { en: "Signing progress" },
  "operations.contracts.signing.step.prepared": { en: "Prepared" },
  "operations.contracts.signing.step.approved": { en: "Approved" },
  "operations.contracts.signing.step.sent": { en: "Sent" },
  "operations.contracts.signing.step.counterparty": {
    en: "Counterparty signed",
  },
  "operations.contracts.signing.step.countersigned": { en: "Fil One signed" },
  "operations.contracts.signing.state.draft": { en: "Prepared" },
  "operations.contracts.signing.state.preparing": {
    en: "Preparing in SignWell",
  },
  "operations.contracts.signing.state.ready": { en: "Ready to send" },
  "operations.contracts.signing.state.sending": { en: "Sending" },
  "operations.contracts.signing.state.sent": { en: "Sent" },
  "operations.contracts.signing.state.viewed": { en: "Opened" },
  "operations.contracts.signing.state.awaitingCountersignature": {
    en: "Waiting on Fil One",
  },
  "operations.contracts.signing.state.completed": { en: "Signed" },
  "operations.contracts.signing.state.declined": { en: "Declined" },
  "operations.contracts.signing.state.expired": { en: "Expired unsigned" },
  "operations.contracts.signing.state.canceled": {
    en: "Voided or discarded",
  },
  "operations.contracts.signing.state.voided": { en: "Voided" },
  "operations.contracts.signing.state.discarded": { en: "Discarded" },
  "operations.contracts.signing.state.attention": { en: "Needs attention" },
  "operations.contracts.signing.testMode": {
    en: "Test mode: SignWell sends practice requests, and signatures are not legally binding.",
  },
  "operations.contracts.signing.notReadyBody": {
    en: "Ask a Commerce administrator to turn on contract signing.",
  },
  "operations.contracts.signing.attentionTitle": {
    en: "SignWell reports a problem",
  },
  "operations.contracts.signing.attentionBody": {
    en: "SignWell stopped this request. Check status, or void it and prepare it again.",
  },
  "operations.contracts.signing.bouncedTitle": {
    en: "A signer's email bounced",
  },
  "operations.contracts.signing.bouncedBody": {
    en: "Fix the counterparty's email, or choose Someone else will sign. If the Fil One countersigner's email bounced, ask a Commerce administrator.",
  },
  "operations.contracts.signing.signerChangeTitle": {
    en: "Voided: someone else will sign",
  },
  "operations.contracts.signing.signerChangeBody": {
    en: "Prepare the contract again for the new signer. The earlier values are filled in.",
  },
  "operations.contracts.signing.prepareAgain": { en: "Prepare again" },
  "operations.contracts.signing.correct.action": { en: "Fix email" },
  "operations.contracts.signing.correct.title": {
    en: "Fix the counterparty's email",
  },
  "operations.contracts.signing.correct.description": {
    en: "SignWell sends the request to the new address. The signer stays {name}.",
  },
  "operations.contracts.signing.correct.help": {
    en: "Works until the counterparty starts signing.",
  },
  "operations.contracts.signing.correct.confirm": { en: "Send to new email" },
  "operations.contracts.signing.correct.working": { en: "Updating" },
  "operations.contracts.signing.correct.someoneElse": {
    en: "Someone else will sign",
  },
  "operations.contracts.signing.counterpartySigner": {
    en: "Counterparty signer",
  },
  "operations.contracts.signing.countersigner": { en: "Fil One countersigner" },
  "operations.contracts.signing.preparedBy": { en: "Prepared by" },
  "operations.contracts.signing.approval": { en: "Approval" },
  "operations.contracts.signing.approvedBy": {
    en: "Approved by {name}, {time}",
  },
  "operations.contracts.signing.rejectedBy": {
    en: "Sent back by {name}, {time}",
  },
  "operations.contracts.signing.rejectionReason": { en: "Changes requested" },
  "operations.contracts.signing.awaitingOthers": {
    en: "You prepared this contract, so someone else must approve it.",
  },
  "operations.contracts.signing.awaitingYou": {
    en: "Check the prepared PDF, then approve it or send it back with the changes you need.",
  },
  "operations.contracts.signing.awaitingApprover": {
    en: "Waiting for someone with approval rights.",
  },
  "operations.contracts.signing.preview": { en: "Open prepared PDF" },
  "operations.contracts.signing.approve": { en: "Approve" },
  "operations.contracts.signing.reject": { en: "Send back" },
  "operations.contracts.signing.reasonLabel": { en: "What needs to change" },
  "operations.contracts.signing.reasonHelp": {
    en: "The preparer sees this note.",
  },
  "operations.contracts.signing.confirmReject": { en: "Send back" },
  "operations.contracts.signing.send": { en: "Send for signature" },
  "operations.contracts.signing.confirmSendTitle": {
    en: "Send for signature?",
  },
  "operations.contracts.signing.confirmSendBody": {
    en: "SignWell will email {signer} at {email}. After they sign, {countersigner} signs for Fil One.",
  },
  "operations.contracts.signing.refresh": { en: "Check status" },
  "operations.contracts.signing.remindCounterparty": { en: "Remind {name}" },
  "operations.contracts.signing.remindCountersigner": { en: "Remind {name}" },
  "operations.contracts.signing.discard": { en: "Discard draft" },
  "operations.contracts.signing.discardConfirm": {
    en: "Discard this prepared contract? Nothing has been sent, and the record stays in the register as a draft.",
  },
  "operations.contracts.signing.void.action": { en: "Void" },
  "operations.contracts.signing.void.title": { en: "Void this contract?" },
  "operations.contracts.signing.void.description": {
    en: "{signer} can no longer sign it.",
  },
  "operations.contracts.signing.void.evidence": {
    en: "SignWell stops the request and deletes its copy. The register keeps the prepared PDF and the history. Once the counterparty has signed, the contract can no longer be voided.",
  },
  "operations.contracts.signing.void.reason": { en: "Reason" },
  "operations.contracts.signing.void.reasonHelp": {
    en: "For example: wrong legal entity. Saved in the contract’s history.",
  },
  "operations.contracts.signing.void.reasonRequired": {
    en: "Enter a reason of at least 3 characters.",
  },
  "operations.contracts.signing.void.confirm": { en: "Void contract" },
  "operations.contracts.signing.void.keep": { en: "Keep it" },
  "operations.contracts.signing.void.working": { en: "Voiding" },
  "operations.contracts.signing.void.signerChangeNote": {
    en: "After voiding, the template opens with the same values so you can enter the new signer. If the template needs approval, it is approved again.",
  },
  "operations.contracts.signing.deletedTitle": {
    en: "SignWell no longer has this document",
  },
  "operations.contracts.signing.deletedBody": {
    en: "It was deleted in SignWell, so no one can sign it. Void it here to close the request. The prepared PDF and the history stay in the register.",
  },
  "operations.contracts.approval.notRequired": { en: "Not needed" },
  "operations.contracts.approval.pending": { en: "Waiting for approval" },
  "operations.contracts.approval.approved": { en: "Approved" },
  "operations.contracts.approval.rejected": { en: "Sent back" },
  "operations.contracts.error.forbidden": {
    en: "Your role does not allow this.",
  },
  "operations.contracts.error.mfa": {
    en: "Verify your sign-in with your authenticator app, then try again.",
  },
  "operations.contracts.error.demo": {
    en: "Contracts are read-only in the demo.",
  },
  "operations.contracts.error.notFound": {
    en: "This record no longer exists, or the link is wrong.",
  },
  "operations.contracts.error.fileNotFound": {
    en: "This file is no longer attached.",
  },
  "operations.contracts.error.versionConflict": {
    en: "Someone else changed this while you were editing. Reload to see their changes, then make yours again.",
  },
  "operations.contracts.error.duplicate": {
    en: "This form was already submitted with different details. Reload the page and start again.",
  },
  "operations.contracts.error.tooLarge": {
    en: "This file is larger than 25 MB. Compress it or split it into separate PDFs.",
  },
  "operations.contracts.error.notPdf": {
    en: "Only PDF files can be uploaded. Save the document as a PDF and try again.",
  },
  "operations.contracts.error.empty": { en: "This file is empty." },
  "operations.contracts.error.integrity": {
    en: "This document did not match its fingerprint and was not opened. Tell a Commerce administrator.",
  },
  "operations.contracts.error.filePermanent": {
    en: "Documents on a signed contract cannot be removed. Upload the right file and explain it in the notes.",
  },
  "operations.contracts.error.statusFollowsSigning": {
    en: "While a contract is out for signature, its status follows SignWell.",
  },
  "operations.contracts.error.executedFinal": {
    en: "A signed contract can only be marked expired or terminated.",
  },
  "operations.contracts.error.selfApproval": {
    en: "You prepared this contract, so someone else must approve it.",
  },
  "operations.contracts.error.alreadyDecided": {
    en: "Someone has already approved or sent back this contract. Reload to see the decision.",
  },
  "operations.contracts.error.approvalRequired": {
    en: "This contract needs approval before it can be sent.",
  },
  "operations.contracts.error.reasonRequired": {
    en: "Say what needs to change so the preparer can fix it.",
  },
  "operations.contracts.error.busy": {
    en: "Another update to this contract is in progress. Try again in a minute.",
  },
  "operations.contracts.error.documentBusy": {
    en: "Several documents are being uploaded or opened right now. Try again in a moment.",
  },
  "operations.contracts.error.reminderTooSoon": {
    en: "A reminder went out less than a minute ago.",
  },
  "operations.contracts.error.notPending": {
    en: "This contract is no longer waiting for a signature.",
  },
  "operations.contracts.error.voidRequired": {
    en: "This contract was already sent to SignWell. Void it instead, with a reason.",
  },
  "operations.contracts.error.alreadyCompleted": {
    en: "Both sides have signed this contract, so it can no longer be voided.",
  },
  "operations.contracts.error.notVoidable": {
    en: "The counterparty has already signed, so this contract can no longer be voided.",
  },
  "operations.contracts.error.notPreparer": {
    en: "Only the person who prepared this contract, or an approver, can void it.",
  },
  "operations.contracts.error.distinctSigners": {
    en: "The counterparty signer and the Fil One countersigner must be different people.",
  },
  "operations.contracts.error.signerStarted": {
    en: "The counterparty has started signing, so their email can no longer be changed. If someone else must sign, choose Someone else will sign.",
  },
  "operations.contracts.error.notCorrectable": {
    en: "This contract is not waiting for the counterparty, so their email cannot be changed. Check its status and try again.",
  },
  "operations.contracts.error.countersignerUnavailable": {
    en: "That countersigner is no longer available. Choose another.",
  },
  "operations.contracts.error.pendingLegal": {
    en: "This template is pending from legal and cannot be prepared yet.",
  },
  "operations.contracts.error.templateNotFound": {
    en: "This template does not exist.",
  },
  "operations.contracts.error.valueCharacters": {
    en: "Use Latin letters only, and leave out < > [ ] { }.",
  },
  "operations.contracts.error.signingNotConfigured": {
    en: "Sending for signature is not set up here",
  },
  "operations.contracts.error.uploadInterrupted": {
    en: "The upload was interrupted. Check your connection and try again.",
  },
  "operations.contracts.error.provider": {
    en: "SignWell did not respond as expected. Nothing was sent twice. Try again in a few minutes.",
  },
  "operations.contracts.error.generic": {
    en: "Something went wrong. Try again, and if it keeps happening, tell a Commerce administrator.",
  },
  "operations.contracts.home.title": { en: "Contract renewal notices" },
  "operations.contracts.home.within": {
    count: "count",
    en: {
      one: "{count} notice due in the next {days} days",
      other: "{count} notices due in the next {days} days",
    },
  },
  "operations.contracts.home.passed": {
    count: "count",
    en: {
      one: "{count} contract renews automatically: its notice deadline has passed",
      other:
        "{count} contracts renew automatically: their notice deadlines have passed",
    },
  },
  "operations.contracts.home.next": { en: "Next deadline: {date}" },
  "operations.contracts.home.none": {
    en: "No renewal notices are due in the next 90 days.",
  },
  "operations.contracts.home.open": { en: "Open renewal notices" },
  "operations.salesLibrary.title": { en: "Sales library" },
  "operations.salesLibrary.description": {
    en: "Current pitch decks, one-pagers, pricing sheets and case studies to share with customers and partners.",
  },
  "operations.contracts.demo": {
    en: "Demo register: the counterparties are fictional and no documents are stored, so signed contracts show No signed copy. Recording and editing are turned off.",
  },
  "operations.salesLibrary.demo": {
    en: "Demo library: these items are fictional and their files are not stored, so downloads are turned off.",
  },
  "operations.salesLibrary.add": { en: "Add material" },
  "operations.salesLibrary.added": { en: "{title} was added." },
  "operations.salesLibrary.saved": { en: "{title} was saved." },
  "operations.salesLibrary.count": {
    count: "count",
    en: { one: "{count} item", other: "{count} items" },
  },
  "operations.salesLibrary.noMatches": { en: "Nothing matches these filters." },
  "operations.salesLibrary.updatedOn": { en: "Updated {date}" },
  "operations.salesLibrary.open": { en: "Open link" },
  "operations.salesLibrary.openNamed": { en: "Open {title}" },
  "operations.salesLibrary.downloadNamed": { en: "Download {title}" },
  "operations.salesLibrary.editNamed": { en: "Edit {title}" },
  "operations.salesLibrary.empty.title": {
    en: "Nothing in the sales library yet",
  },
  "operations.salesLibrary.empty.manageBody": {
    en: "Add the decks, one-pagers, pricing sheets and case studies the team shares, so everyone sends the current version.",
  },
  "operations.salesLibrary.empty.readBody": {
    en: "This is where the team's current decks, one-pagers, pricing sheets and case studies will be. Ask a Commerce administrator to add them.",
  },
  "operations.salesLibrary.access.mfaTitle": {
    en: "Verify your sign-in to open the sales library",
  },
  "operations.salesLibrary.access.demoTitle": {
    en: "The sales library is not available in the demo",
  },
  "operations.salesLibrary.access.demoBody": {
    en: "The demo signs in with sample people. Sign in with your Fil One account to use the sales library.",
  },
  "operations.salesLibrary.access.forbiddenTitle": {
    en: "The sales library is not part of your role",
  },
  "operations.salesLibrary.access.missingTitle": {
    en: "This item could not be found",
  },
  "operations.salesLibrary.access.missingBody": {
    en: "It may have been removed. Open the sales library to find the current version.",
  },
  "operations.salesLibrary.access.errorTitle": {
    en: "The sales library could not be loaded",
  },
  "operations.salesLibrary.kind.pitchDeck": { en: "Pitch deck" },
  "operations.salesLibrary.kind.onePager": { en: "One-pager" },
  "operations.salesLibrary.kind.pricingSheet": { en: "Pricing sheet" },
  "operations.salesLibrary.kind.caseStudy": { en: "Case study" },
  "operations.salesLibrary.kind.other": { en: "Other" },
  "operations.salesLibrary.audience.customer": { en: "Customers" },
  "operations.salesLibrary.audience.partner": { en: "Partners" },
  "operations.salesLibrary.status.current": { en: "Current" },
  "operations.salesLibrary.status.archived": { en: "Archived" },
  "operations.salesLibrary.filters.search": { en: "Search" },
  "operations.salesLibrary.filters.placeholder": { en: "Title or description" },
  "operations.salesLibrary.filters.allAudiences": { en: "All audiences" },
  "operations.salesLibrary.filters.allKinds": { en: "All types" },
  "operations.salesLibrary.filters.showArchived": {
    count: "count",
    en: { one: "Show archived ({count})", other: "Show archived ({count})" },
  },
  "operations.salesLibrary.form.addTitle": { en: "Add material" },
  "operations.salesLibrary.form.editTitle": { en: "Edit material" },
  "operations.salesLibrary.form.title": { en: "Title" },
  "operations.salesLibrary.form.kind": { en: "Type" },
  "operations.salesLibrary.form.audience": { en: "Audience" },
  "operations.salesLibrary.form.status": { en: "Status" },
  "operations.salesLibrary.form.updatedOn": { en: "Content updated on" },
  "operations.salesLibrary.form.updatedOnHelp": {
    en: "When the material itself last changed.",
  },
  "operations.salesLibrary.form.description": { en: "Description" },
  "operations.salesLibrary.form.descriptionHelp": {
    en: "When to use it and who it is for.",
  },
  "operations.salesLibrary.form.source": { en: "File or link" },
  "operations.salesLibrary.form.sourceKind": { en: "Where the material lives" },
  "operations.salesLibrary.form.sourceFile": { en: "Upload a PDF" },
  "operations.salesLibrary.form.sourceLink": { en: "Link to it" },
  "operations.salesLibrary.form.file": { en: "PDF" },
  "operations.salesLibrary.form.replaceFile": { en: "Replace the PDF" },
  "operations.salesLibrary.form.currentFile": {
    en: "Current file: {name}. Choose a PDF only to replace it.",
  },
  "operations.salesLibrary.form.link": { en: "Link" },
  "operations.salesLibrary.form.linkHelp": {
    en: "A shared link that starts with https://, for example to Google Drive or Docsend.",
  },
  "operations.salesLibrary.form.add": { en: "Add to library" },
  "operations.salesLibrary.error.https": {
    en: "Use a link that starts with https://.",
  },
  "operations.salesLibrary.error.linkOrFile": {
    en: "Add either a PDF or a link, not both.",
  },
});
