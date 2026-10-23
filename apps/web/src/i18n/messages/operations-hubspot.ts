import { defineStaffMessages } from "../define";

/**
 * Bringing HubSpot companies and deals into Commerce: the picker, the
 * handoff review, the receipt, a partner's HubSpot section, the pipeline and
 * the administrator's connection page. Part of the operations module.
 */
export const hubspotMessages = defineStaffMessages({
  "operations.hubspot.demo": {
    en: "This is a fictional HubSpot portal. The demo shows the handoff but cannot import anything.",
  },
  "operations.hubspot.readOnly": {
    en: "You can review HubSpot records. Importing needs permission to change partners.",
  },
  "operations.hubspot.notSet": { en: "Not set" },
  "operations.hubspot.noOwner": { en: "No HubSpot owner" },
  "operations.hubspot.ownerIs": { en: "Owner: {name}" },
  "operations.hubspot.openInHubSpot": { en: "Open in HubSpot" },
  "operations.hubspot.openPartner": { en: "Open partner" },
  "operations.hubspot.reviewUpdates": { en: "Review updates" },
  "operations.hubspot.bring": { en: "Bring into Commerce" },
  "operations.hubspot.inHubSpot": { en: "In HubSpot: {value}" },
  "operations.hubspot.stale": { en: "Stale" },
  "operations.hubspot.models": { en: "Partner models (optional)" },
  "operations.hubspot.audience": {
    en: "Included information stays in Commerce after HubSpot is disconnected and is visible to staff with Sales access.",
  },
  "operations.hubspot.noSecondConfirmation": {
    en: "HubSpot is only read. Nothing changes there.",
  },

  "operations.hubspot.picker.title": { en: "Bring in from HubSpot" },
  "operations.hubspot.picker.description": {
    en: "Search for a company or deal you already work on in HubSpot, or paste its HubSpot link.",
  },
  "operations.hubspot.picker.dealDescription": {
    en: "This deal has no company yet. Choose the company that becomes the Commerce partner; the deal stays as context.",
  },
  "operations.hubspot.picker.linkDescription": {
    en: "Find the HubSpot company for this partner. Linking copies nothing until you choose what to import.",
  },
  "operations.hubspot.picker.searchLabel": {
    en: "Company, deal or HubSpot link",
  },
  "operations.hubspot.picker.searchHelp": {
    en: "Names and domains match as you would search in HubSpot.",
  },
  "operations.hubspot.picker.search": { en: "Search" },
  "operations.hubspot.picker.start": {
    en: "Nothing is listed until you search, so the whole CRM is never loaded here.",
  },
  "operations.hubspot.picker.clear": { en: "Start a new search" },
  "operations.hubspot.picker.announce": {
    count: "count",
    en: {
      one: "{count} HubSpot record matches {query}",
      other: "{count} HubSpot records match {query}",
    },
  },
  "operations.hubspot.picker.companies": { en: "Companies" },
  "operations.hubspot.picker.deals": { en: "Deals" },
  "operations.hubspot.picker.noCompanies": { en: "No companies match." },
  "operations.hubspot.picker.noDeals": { en: "No deals match." },
  "operations.hubspot.picker.linked": { en: "Linked in Commerce" },
  "operations.hubspot.picker.linkedTo": { en: "Partner: {name}" },
  "operations.hubspot.picker.review": { en: "Review handoff" },
  "operations.hubspot.picker.noneTitle": { en: "No HubSpot records match" },
  "operations.hubspot.picker.noneBody": {
    en: "Nothing matched “{query}”. Try another name, paste the record’s HubSpot link, or create the partner by hand.",
  },
  "operations.hubspot.picker.manual": { en: "Create a partner by hand" },
  "operations.hubspot.picker.foreignTitle": {
    en: "That link is for another HubSpot portal",
  },
  "operations.hubspot.picker.foreignBody": {
    en: "The link is for portal {linked}. Commerce is connected to portal {connected}, so it cannot open that record.",
  },

  "operations.hubspot.choose.title": {
    en: "Which company is becoming the partner for {deal}?",
  },
  "operations.hubspot.choose.stage": { en: "HubSpot stage: {stage}" },
  "operations.hubspot.choose.legend": {
    en: "Choose the company that becomes the Commerce partner",
  },
  "operations.hubspot.choose.body": {
    en: "HubSpot labels such as Primary describe the deal; they are not a choice. The other companies stay on the deal reference.",
  },
  "operations.hubspot.choose.continue": { en: "Continue" },
  "operations.hubspot.choose.noneTitle": { en: "This deal has no company" },
  "operations.hubspot.choose.noneBody": {
    en: "Choose a company in HubSpot search. The deal is kept as context on the partner.",
  },
  "operations.hubspot.choose.pick": { en: "Choose a company" },

  "operations.hubspot.review.title": { en: "Review HubSpot handoff" },
  "operations.hubspot.review.newTitle": {
    en: "Bring {name} into Commerce",
  },
  "operations.hubspot.review.newDescription": {
    en: "Partner: a company we work with to refer, resell, distribute or deliver business. Choose what comes across; nothing optional is selected for you.",
  },
  "operations.hubspot.review.updateTitle": {
    en: "Review HubSpot updates for {name}",
  },
  "operations.hubspot.review.linkTitle": {
    en: "Link {name} to its HubSpot company",
  },
  "operations.hubspot.review.updateDescription": {
    en: "Commerce values stay unless you choose a change. HubSpot blanks never clear them.",
  },
  "operations.hubspot.review.from": { en: "HubSpot company" },
  "operations.hubspot.review.fromCompany": { en: "Started from the company" },
  "operations.hubspot.review.fromDeal": { en: "From deal: {deal}" },
  "operations.hubspot.review.toNew": { en: "New Commerce partner" },
  "operations.hubspot.review.toExisting": { en: "Existing Commerce partner" },
  "operations.hubspot.review.storedOn": {
    en: "Contacts and documents will be stored on this partner.",
  },
  "operations.hubspot.review.read": { en: "Read from HubSpot" },
  "operations.hubspot.review.changedTitle": {
    en: "HubSpot changed since you opened this review",
  },
  "operations.hubspot.review.changedBody": {
    en: "Check {items} again; the page now shows the current values and your choices are kept. Then submit again.",
  },
  "operations.hubspot.review.alreadyLinkedTitle": {
    en: "This company was just linked to {name}",
  },
  "operations.hubspot.review.alreadyLinkedBody": {
    en: "Someone else finished a handoff for this company first, so this one was not applied. Open that partner, or review what differs.",
  },
  "operations.hubspot.review.exactLinkTitle": {
    en: "This company is already linked",
  },
  "operations.hubspot.review.exactLinkBody": {
    en: "It belongs to {name}, so this review updates that partner instead.",
  },
  "operations.hubspot.review.linkedElsewhereTitle": {
    en: "This partner is linked to another HubSpot company",
  },
  "operations.hubspot.review.linkedElsewhereBody": {
    en: "It is linked to {company}. A partner links to one company per portal; relinking needs support.",
  },

  "operations.hubspot.group.company": { en: "Company details" },
  "operations.hubspot.group.people": { en: "People" },
  "operations.hubspot.group.context": { en: "Sales context" },
  "operations.hubspot.group.notes": { en: "Notes" },
  "operations.hubspot.group.documents": { en: "Documents" },

  "operations.hubspot.status.label": { en: "Commerce relationship status" },
  "operations.hubspot.status.help": {
    en: "This is the relationship’s status in Commerce.",
  },
  "operations.hubspot.status.helpStage": {
    en: "This is the relationship’s status in Commerce, independent of the deal’s sales stage ({stage}).",
  },
  "operations.hubspot.owner.mapped": {
    en: "Mapped from the HubSpot owner, {name}.",
  },
  "operations.hubspot.owner.viewerUnmapped": {
    en: "You: the HubSpot owner, {name}, has no Commerce mapping.",
  },
  "operations.hubspot.owner.viewerNoOwner": {
    en: "You: this company has no HubSpot owner.",
  },
  "operations.hubspot.owner.noneUnmapped": {
    en: "Unassigned: the HubSpot owner, {name}, has no Commerce mapping.",
  },
  "operations.hubspot.owner.none": {
    en: "Unassigned: this company has no HubSpot owner.",
  },
  "operations.hubspot.owner.chosen": { en: "Chosen by you." },

  "operations.hubspot.suggestion.title": {
    en: "Commerce may already have this partner",
  },
  "operations.hubspot.suggestion.body": {
    en: "These look similar. Inspect each one; use it instead, or say why it is a different company.",
  },
  "operations.hubspot.suggestion.sameName": { en: "Same name" },
  "operations.hubspot.suggestion.sameWebsite": { en: "Same website" },
  "operations.hubspot.suggestion.inspect": { en: "Inspect" },
  "operations.hubspot.suggestion.useThis": { en: "Use this partner" },
  "operations.hubspot.suggestion.notSame": { en: "Not the same company" },
  "operations.hubspot.suggestion.reason": { en: "Why is it different?" },
  "operations.hubspot.suggestion.reasonHelp": {
    en: "Recorded with the import, for whoever looks at it next.",
  },
  "operations.hubspot.suggestion.confirm": { en: "Set aside" },
  "operations.hubspot.suggestion.dismissed": { en: "Set aside" },
  "operations.hubspot.suggestion.undo": { en: "Reconsider" },
  "operations.hubspot.suggestion.linkedOther": {
    en: "Linked to another HubSpot company.",
  },

  "operations.hubspot.compare.title": { en: "Company details" },
  "operations.hubspot.compare.body": {
    en: "Each field shows Commerce now, HubSpot now and your choice. A field changed on both sides needs a choice.",
  },
  "operations.hubspot.compare.field": { en: "Field" },
  "operations.hubspot.compare.commerce": { en: "Commerce" },
  "operations.hubspot.compare.hubspot": { en: "HubSpot" },
  "operations.hubspot.compare.decision": { en: "Result" },
  "operations.hubspot.compare.decisionFor": { en: "What to do with {field}" },
  "operations.hubspot.compare.unchanged": {
    en: "Owner, status, models and terms never change in an update import.",
  },
  "operations.hubspot.decision.keep": { en: "Keep Commerce" },
  "operations.hubspot.decision.use": { en: "Use HubSpot" },
  "operations.hubspot.decision.clear": { en: "Clear value" },
  "operations.hubspot.drift.never_imported": { en: "Not imported before" },
  "operations.hubspot.drift.unchanged": { en: "No change" },
  "operations.hubspot.drift.hubspot_changed": { en: "Changed in HubSpot" },
  "operations.hubspot.drift.commerce_changed": { en: "Changed in Commerce" },
  "operations.hubspot.drift.both_changed": { en: "Changed on both sides" },

  "operations.hubspot.people.body": {
    en: "Nobody is selected for you. Choose the people to keep on the partner; each keeps their HubSpot identity and role labels.",
  },
  "operations.hubspot.people.labels": { en: "HubSpot: {labels}" },
  "operations.hubspot.people.none": {
    en: "HubSpot has no contacts associated with this company or deal.",
  },
  "operations.hubspot.people.alreadyLinked": {
    en: "Already on this partner as {name}. Selecting it refreshes its HubSpot labels; the Commerce values stay.",
  },
  "operations.hubspot.people.matchLabel": {
    en: "{name} in Commerce has the same email",
  },
  "operations.hubspot.people.matchChoose": { en: "Choose…" },
  "operations.hubspot.people.matchSame": {
    en: "Same person: link {name}, keep Commerce values",
  },
  "operations.hubspot.people.matchNew": { en: "Different person: add new" },
  "operations.hubspot.people.primary": { en: "Primary Commerce contact" },
  "operations.hubspot.people.primaryHelp": {
    en: "Never taken from list order or a HubSpot label.",
  },
  "operations.hubspot.people.primaryUnchanged": {
    en: "Leave as it is",
  },
  "operations.hubspot.people.existing": { en: "{name} (already in Commerce)" },

  "operations.hubspot.context.body": {
    en: "The deal is kept as reference with its companies, stage, amount and dates. It is an opportunity, not a Commerce registration.",
  },
  "operations.hubspot.context.keepDeal": {
    en: "Keep {name} as context",
  },
  "operations.hubspot.context.keepDealHelp": {
    en: "Its pipeline, stage, amount, currency, close date, owner and companies are recorded as they are in HubSpot.",
  },
  "operations.hubspot.context.noDeal": {
    en: "This handoff started from the company, so no deal is attached.",
  },
  "operations.hubspot.context.endCustomer": {
    en: "End customer for a later registration",
  },
  "operations.hubspot.context.endCustomerHelp": {
    en: "Suggested when you register this opportunity. Nothing is registered now.",
  },
  "operations.hubspot.context.endCustomerNone": { en: "None" },
  "operations.hubspot.context.notRegistration": {
    en: "A Closed Won deal does not approve terms, sign anything or create protection.",
  },
  "operations.hubspot.deal.stage": { en: "Stage" },
  "operations.hubspot.deal.amount": { en: "Amount" },
  "operations.hubspot.deal.amountNoCurrency": {
    en: "{amount} (no currency in HubSpot)",
  },
  "operations.hubspot.deal.close": { en: "Expected close" },
  "operations.hubspot.deal.owner": { en: "HubSpot owner" },
  "operations.hubspot.deal.companies": { en: "Companies on the deal" },
  "operations.hubspot.deal.becomesPartner": { en: "becomes this partner" },

  "operations.hubspot.notes.outOfScope": {
    en: "Notes are not part of the HubSpot data your administrator approved.",
  },
  "operations.hubspot.notes.none": { en: "No notes in HubSpot." },
  "operations.hubspot.notes.label": { en: "Note by {author}, {date}" },
  "operations.hubspot.notes.unknownAuthor": { en: "an unknown author" },
  "operations.hubspot.notes.preview": { en: "Preview" },
  "operations.hubspot.notes.empty": { en: "This note has no text." },

  "operations.hubspot.documents.body": {
    en: "Selected PDFs are kept, byte for byte, as private attachments on the partner. Nothing is selected for you.",
  },
  "operations.hubspot.documents.outOfScope": {
    en: "Files are not part of the HubSpot data your administrator approved.",
  },
  "operations.hubspot.documents.none": {
    en: "No files are attached to this company’s or deal’s notes.",
  },
  "operations.hubspot.documents.unsupported": {
    en: "Not a PDF, so it cannot be attached",
  },
  "operations.hubspot.documents.tooLarge": { en: "Larger than 25 MB" },
  "operations.hubspot.documents.unreadable": {
    en: "Unavailable: HubSpot would not share this file",
  },
  "operations.hubspot.documents.claim": {
    en: "HubSpot describes this as signed. Commerce keeps it as a supplied document and does not mark anything executed.",
  },
  "operations.hubspot.documents.title": { en: "Document title" },
  "operations.hubspot.documents.kind": { en: "Category" },

  "operations.hubspot.more.title": { en: "More control" },
  "operations.hubspot.more.hint": {
    en: "Keep approved HubSpot properties for reference.",
  },
  "operations.hubspot.more.inEffect": { en: "In effect: {items}" },
  "operations.hubspot.more.references": {
    count: "count",
    en: {
      one: "{count} reference value",
      other: "{count} reference values",
    },
  },
  "operations.hubspot.more.clears": { en: "a value cleared" },
  "operations.hubspot.more.referencesTitle": {
    en: "Keep HubSpot properties for reference",
  },
  "operations.hubspot.more.referencesBody": {
    en: "Kept with the import under its HubSpot label and original value. They are never copied into unrelated fields or notes.",
  },
  "operations.hubspot.more.companyProperty": { en: "Company: {label}" },
  "operations.hubspot.more.dealProperty": { en: "Deal: {label}" },
  "operations.hubspot.more.noProperties": {
    en: "Your administrator has approved no additional properties.",
  },
  "operations.hubspot.more.neverImported": {
    en: "Commission, margin, exclusivity, contract and approval state are set in Commerce only and never come from HubSpot.",
  },
  "operations.hubspot.more.clearHelp": {
    en: "Clear value, in the comparison above, removes the Commerce website or region. Nothing is cleared unless you choose it.",
  },

  "operations.hubspot.issue.title": {
    count: "count",
    en: {
      one: "{count} choice is needed before this can be committed",
      other: "{count} choices are needed before this can be committed",
    },
  },
  "operations.hubspot.issue.name": { en: "Enter the partner’s name." },
  "operations.hubspot.issue.decision": {
    en: "Choose what happens to {field}: it changed in Commerce and in HubSpot.",
  },
  "operations.hubspot.issue.suggestion": {
    en: "Decide whether {name} is the same company.",
  },
  "operations.hubspot.issue.contactMatch": {
    en: "Say whether {name} is the person already in Commerce.",
  },
  "operations.hubspot.issue.documentTitle": {
    en: "Give each selected document a title.",
  },

  "operations.hubspot.summary.create": {
    en: "Create {name} as a partner with {parts}.",
  },
  "operations.hubspot.summary.createOnly": {
    en: "Create {name} as a partner.",
  },
  "operations.hubspot.summary.update": { en: "{changes}; {kept}." },
  "operations.hubspot.summary.updateOnly": { en: "{changes}." },
  "operations.hubspot.summary.kept": {
    count: "count",
    en: {
      one: "keep {count} existing value",
      other: "keep {count} existing values",
    },
  },
  "operations.hubspot.summary.addContacts": {
    count: "count",
    en: { one: "add {count} contact", other: "add {count} contacts" },
  },
  "operations.hubspot.summary.linkContacts": {
    count: "count",
    en: { one: "link {count} contact", other: "link {count} contacts" },
  },
  "operations.hubspot.summary.keepDeals": {
    count: "count",
    en: {
      one: "keep {count} deal reference",
      other: "keep {count} deal references",
    },
  },
  "operations.hubspot.summary.keepNotes": {
    count: "count",
    en: { one: "keep {count} note", other: "keep {count} notes" },
  },
  "operations.hubspot.summary.keepReferences": {
    count: "count",
    en: {
      one: "keep {count} reference value",
      other: "keep {count} reference values",
    },
  },
  "operations.hubspot.summary.attachDocuments": {
    count: "count",
    en: {
      one: "attach {count} document",
      other: "attach {count} documents",
    },
  },
  "operations.hubspot.summary.linkOnly": {
    en: "Link {company} to {partner}. Nothing is copied.",
  },
  "operations.hubspot.summary.noChanges": { en: "change no values" },
  "operations.hubspot.summary.nothingSelected": {
    en: "Already linked. Choose a change, a person, context or a document to import.",
  },
  "operations.hubspot.summary.incomplete": {
    en: "Make the choices above to see what this handoff will do.",
  },
  "operations.hubspot.summary.added": {
    count: "count",
    en: { one: "add {count} value", other: "add {count} values" },
  },
  "operations.hubspot.summary.replaced": {
    count: "count",
    en: { one: "replace {count} value", other: "replace {count} values" },
  },
  "operations.hubspot.summary.cleared": {
    count: "count",
    en: { one: "clear {count} value", other: "clear {count} values" },
  },
  "operations.hubspot.summary.contacts": {
    count: "count",
    en: { one: "{count} contact", other: "{count} contacts" },
  },
  "operations.hubspot.summary.contactsLinked": {
    count: "count",
    en: { one: "{count} linked contact", other: "{count} linked contacts" },
  },
  "operations.hubspot.summary.deals": {
    count: "count",
    en: { one: "{count} deal reference", other: "{count} deal references" },
  },
  "operations.hubspot.summary.notes": {
    count: "count",
    en: { one: "{count} note", other: "{count} notes" },
  },
  "operations.hubspot.summary.references": {
    count: "count",
    en: {
      one: "{count} reference value",
      other: "{count} reference values",
    },
  },
  "operations.hubspot.summary.documents": {
    count: "count",
    en: { one: "{count} document", other: "{count} documents" },
  },

  "operations.hubspot.action.create": { en: "Create partner" },
  "operations.hubspot.action.import": { en: "Import selected changes" },
  "operations.hubspot.action.link": { en: "Link record" },
  "operations.hubspot.action.working": { en: "Saving…" },
  "operations.hubspot.cancel.label": { en: "Cancel" },
  "operations.hubspot.cancel.confirm": {
    en: "Leave without importing? Your choices here will be lost.",
  },
  "operations.hubspot.cancel.keep": { en: "Keep reviewing" },
  "operations.hubspot.cancel.discard": { en: "Leave" },

  "operations.hubspot.receipt.title": { en: "HubSpot import receipt" },
  "operations.hubspot.receipt.partnerCreated": { en: "Partner created" },
  "operations.hubspot.receipt.recordSaved": { en: "Record saved" },
  "operations.hubspot.receipt.complete": { en: "Handoff complete" },
  "operations.hubspot.receipt.needsAttention": {
    count: "count",
    en: {
      one: "{count} document still needs attention",
      other: "{count} documents still need attention",
    },
  },
  "operations.hubspot.receipt.withExclusions": {
    count: "count",
    en: {
      one: "Completed with {count} item excluded",
      other: "Completed with {count} items excluded",
    },
  },
  "operations.hubspot.receipt.usable": {
    en: "The partner can be used now. The handoff is not complete until every selected document is attached or excluded, and that does not waive any agreement requirement.",
  },
  "operations.hubspot.receipt.source": { en: "From HubSpot" },
  "operations.hubspot.receipt.by": { en: "Imported by" },
  "operations.hubspot.receipt.copied": { en: "Copied into Commerce" },
  "operations.hubspot.receipt.reference": { en: "Kept for reference" },
  "operations.hubspot.receipt.leftOut": { en: "Left out on purpose" },
  "operations.hubspot.receipt.added": { en: "Added {field}: {value}" },
  "operations.hubspot.receipt.replaced": { en: "Replaced {field}: {value}" },
  "operations.hubspot.receipt.cleared": { en: "Cleared {field}" },
  "operations.hubspot.receipt.kept": { en: "Kept {field}" },
  "operations.hubspot.receipt.contactAdded": { en: "Added contact {name}" },
  "operations.hubspot.receipt.contactLinked": {
    en: "Linked {name} to HubSpot",
  },
  "operations.hubspot.receipt.primary": { en: "primary contact" },
  "operations.hubspot.receipt.nothingCopied": {
    en: "No field values or people",
  },
  "operations.hubspot.receipt.nothingKept": { en: "Nothing" },
  "operations.hubspot.receipt.nothingLeftOut": { en: "Nothing" },
  "operations.hubspot.receipt.deal": { en: "{name}, {stage}" },
  "operations.hubspot.receipt.amountNotSet": { en: "Amount not set" },
  "operations.hubspot.receipt.closes": { en: "expected close {date}" },
  "operations.hubspot.receipt.endCustomer": { en: "end customer {name}" },
  "operations.hubspot.receipt.duplicate": {
    en: "An identical PDF is already attached as “{title}”.",
  },
  "operations.hubspot.receipt.excludedBecause": {
    en: "Excluded: {reason}",
  },
  "operations.hubspot.receipt.attach": { en: "Attach document" },
  "operations.hubspot.receipt.retry": { en: "Retry document" },
  "operations.hubspot.receipt.attaching": { en: "Attaching…" },
  "operations.hubspot.receipt.useExisting": {
    en: "Use existing attachment “{title}”",
  },
  "operations.hubspot.receipt.exclude": {
    en: "Exclude this item and finish",
  },
  "operations.hubspot.receipt.excludeReason": {
    en: "Why leave it out?",
  },
  "operations.hubspot.receipt.excludeConfirm": { en: "Exclude" },
  "operations.hubspot.receipt.itemAnnounce": { en: "{title}: {status}" },
  "operations.hubspot.receipt.duplicateRemoved": {
    en: "The identical copy was removed from the partner since. Attach this one, or exclude it.",
  },
  "operations.hubspot.receipt.attachmentRemoved": {
    en: "Removed from the partner’s documents afterwards.",
  },
  "operations.hubspot.receipt.appendOnly": {
    en: "To take an attached document off the partner, remove it under Documents; the receipt and the history keep the record of it.",
  },

  "operations.hubspot.continue.title": { en: "Continue in Commerce" },
  "operations.hubspot.continue.body": {
    en: "Each opens an existing form with what you brought across as editable suggestions. Nothing is submitted for you.",
  },
  "operations.hubspot.continue.relationship": {
    en: "Review partner relationship",
  },
  "operations.hubspot.continue.register": {
    en: "Register this opportunity",
  },
  "operations.hubspot.continue.mnda": { en: "Prepare MNDA" },
  "operations.hubspot.continue.documents": { en: "View documents" },
  "operations.hubspot.continue.source": { en: "Open source in HubSpot" },
  "operations.hubspot.continue.registrationNotCreated": {
    en: "Commerce registration: not created by this import. Registering is its own step.",
  },

  "operations.hubspot.register.title": {
    en: "Suggested from a HubSpot deal",
  },
  "operations.hubspot.register.body": {
    en: "The end client and source link are suggestions. The registration date, protection, size, model and status are yours to set; the deal’s amount and close date are not used.",
  },
  "operations.hubspot.register.choose": {
    en: "End client from the HubSpot deal",
  },
  "operations.hubspot.register.chooseHelp": {
    en: "The deal’s other companies. Pick one, or type the end client below.",
  },
  "operations.hubspot.register.chooseNone": { en: "Choose…" },
  "operations.hubspot.mnda.title": {
    en: "Suggested from a HubSpot import",
  },
  "operations.hubspot.mnda.body": {
    en: "Confirm the legal entity and that the signer may sign for it. Nothing is saved or sent until you do.",
  },

  "operations.hubspot.section.title": { en: "HubSpot" },
  "operations.hubspot.section.link": { en: "Link HubSpot record" },
  "operations.hubspot.section.notLinked": {
    en: "Not linked to a HubSpot company. Linking copies nothing until you choose what to import.",
  },
  "operations.hubspot.section.company": { en: "Linked company" },
  "operations.hubspot.section.linkedBy": { en: "Linked by" },
  "operations.hubspot.section.checked": { en: "Last checked" },
  "operations.hubspot.section.updated": { en: "Updated in HubSpot" },
  "operations.hubspot.section.changed": {
    count: "count",
    en: {
      one: "{count} HubSpot value changed since your last import",
      other: "{count} HubSpot values changed since your last import",
    },
  },
  "operations.hubspot.section.changedBody": {
    en: "Commerce fields stay as they are until you review the changes.",
  },
  "operations.hubspot.section.archivedBody": {
    en: "This partner keeps its history and imported values. A relink needs an authorized review.",
  },
  "operations.hubspot.section.liveUnavailable": {
    en: "Current HubSpot details are not available",
  },
  "operations.hubspot.section.current": { en: "Current HubSpot details" },
  "operations.hubspot.section.dealsTitle": {
    en: "HubSpot deals associated with this company",
  },
  "operations.hubspot.section.dealsDisclaimer": {
    en: "Association does not establish sourcing, ownership or revenue credit. Registered deals are listed separately.",
  },
  "operations.hubspot.section.noDeals": {
    en: "No deals are associated with this company in HubSpot.",
  },
  "operations.hubspot.section.history": { en: "Import history" },
  "operations.hubspot.section.noImports": {
    en: "Linked without an import.",
  },
  "operations.hubspot.section.importCreated": {
    en: "Created from {name}",
  },
  "operations.hubspot.section.importUpdated": {
    en: "Imported from {name}",
  },

  "operations.hubspot.pipeline.title": { en: "Pipeline" },
  "operations.hubspot.pipeline.description": {
    en: "HubSpot deals in their HubSpot stages, read-only. Commerce registrations are separate.",
  },
  "operations.hubspot.pipeline.refresh": { en: "Refresh HubSpot data" },
  "operations.hubspot.pipeline.refreshing": { en: "Refreshing…" },
  "operations.hubspot.pipeline.copy": { en: "Copy link to this view" },
  "operations.hubspot.pipeline.copied": { en: "Link copied" },
  "operations.hubspot.pipeline.checked": { en: "Last checked" },
  "operations.hubspot.pipeline.staleTitle": {
    en: "HubSpot is not answering right now",
  },
  "operations.hubspot.pipeline.staleBody": {
    en: "This is the last data Commerce read, as of the time above. Importing waits until HubSpot answers again.",
  },
  "operations.hubspot.pipeline.partialTitle": {
    en: "Totals cover part of this pipeline",
  },
  "operations.hubspot.pipeline.partialBody": {
    en: "Commerce read {read} of {total} deals. Counts and totals below are for those deals only; narrow the pipeline or stage to see all of them.",
  },
  "operations.hubspot.pipeline.pipeline": { en: "Pipeline" },
  "operations.hubspot.pipeline.state": { en: "Deals" },
  "operations.hubspot.pipeline.state.open": { en: "Open" },
  "operations.hubspot.pipeline.state.closed": { en: "Closed" },
  "operations.hubspot.pipeline.state.all": { en: "All" },
  "operations.hubspot.pipeline.anyStage": { en: "Any stage" },
  "operations.hubspot.pipeline.anyOwner": { en: "Any owner" },
  "operations.hubspot.pipeline.closeFrom": { en: "Closes on or after" },
  "operations.hubspot.pipeline.closeTo": { en: "Closes on or before" },
  "operations.hubspot.pipeline.currency": { en: "Currency" },
  "operations.hubspot.pipeline.anyCurrency": { en: "Any currency" },
  "operations.hubspot.pipeline.linkedLabel": { en: "In Commerce" },
  "operations.hubspot.pipeline.linked.any": { en: "Any" },
  "operations.hubspot.pipeline.linked.linked": {
    en: "All companies linked",
  },
  "operations.hubspot.pipeline.linked.partly": {
    en: "Some companies linked",
  },
  "operations.hubspot.pipeline.linked.none": { en: "No company linked" },
  "operations.hubspot.pipeline.search": { en: "Deal or company" },
  "operations.hubspot.pipeline.apply": { en: "Apply" },
  "operations.hubspot.pipeline.clear": { en: "Clear" },
  "operations.hubspot.pipeline.summary": {
    count: "count",
    en: { one: "{count} deal", other: "{count} deals" },
  },
  "operations.hubspot.pipeline.viewLabel": { en: "Pipeline view" },
  "operations.hubspot.pipeline.table": { en: "Table" },
  "operations.hubspot.pipeline.board": { en: "Board" },
  "operations.hubspot.pipeline.missing": {
    count: "count",
    en: {
      one: "Amount missing for {count} deal",
      other: "Amounts missing for {count} deals",
    },
  },
  "operations.hubspot.pipeline.noCombined": {
    en: "Currencies are not combined",
  },
  "operations.hubspot.pipeline.noAmounts": { en: "No amounts" },
  "operations.hubspot.pipeline.emptyTitle": { en: "No deals match" },
  "operations.hubspot.pipeline.emptyBody": {
    en: "Change or clear the filters to see more deals.",
  },
  "operations.hubspot.pipeline.tableCaption": { en: "HubSpot deals" },
  "operations.hubspot.pipeline.deal": { en: "Deal" },
  "operations.hubspot.pipeline.companies": { en: "Companies" },
  "operations.hubspot.pipeline.commerce": { en: "Commerce" },
  "operations.hubspot.pipeline.noCompanies": { en: "No company" },
  "operations.hubspot.pipeline.linkedCount": {
    en: "Linked companies: {linked} of {total}",
  },
  "operations.hubspot.pipeline.closePanel": { en: "Close" },
  "operations.hubspot.pipeline.partnerLink": { en: "Partner: {name}" },
  "operations.hubspot.pipeline.registrationSeparate": {
    en: "A HubSpot deal is an opportunity. Registering it with a partner is a separate step in Commerce.",
  },

  "operations.hubspot.state.notConfiguredTitle": {
    en: "HubSpot is not set up for this environment",
  },
  "operations.hubspot.state.notConfiguredBody": {
    en: "An administrator adds the HubSpot access token to the deployment, then approves the connection. Partners can still be created by hand.",
  },
  "operations.hubspot.state.notConnectedTitle": {
    en: "HubSpot is not connected",
  },
  "operations.hubspot.state.notConnectedBody": {
    en: "An administrator has to approve who may read HubSpot data, and which data, before anyone can. Partners can still be created by hand.",
  },
  "operations.hubspot.state.portalTitle": {
    en: "The HubSpot token reaches another portal",
  },
  "operations.hubspot.state.portalBody": {
    en: "The approved portal and the configured token disagree, so nothing is read. An administrator needs to disconnect and approve the new portal.",
  },
  "operations.hubspot.state.busyTitle": { en: "HubSpot is busy" },
  "operations.hubspot.state.busyBody": {
    en: "HubSpot asked Commerce to slow down. Try again in a minute.",
  },
  "operations.hubspot.state.scopeTitle": {
    en: "HubSpot refused this read",
  },
  "operations.hubspot.state.scopeBody": {
    en: "The HubSpot token is missing a read permission. An administrator can check the connection.",
  },
  "operations.hubspot.state.archivedTitle": {
    en: "This HubSpot company is archived or merged",
  },
  "operations.hubspot.state.archivedBody": {
    en: "Commerce does not bring in archived companies. Find the company it was merged into.",
  },
  "operations.hubspot.state.notAssociatedTitle": {
    en: "That company is not on this deal",
  },
  "operations.hubspot.state.notAssociatedBody": {
    en: "Choose one of the deal’s companies, or start from the company instead.",
  },
  "operations.hubspot.state.missingTitle": {
    en: "That HubSpot record was not found",
  },
  "operations.hubspot.state.missingBody": {
    en: "It may have been deleted, or it is outside the data Commerce may read.",
  },
  "operations.hubspot.state.demoTitle": {
    en: "Not available in the demo",
  },
  "operations.hubspot.state.demoBody": {
    en: "The demo shows the handoff and pipeline with fictional HubSpot data only.",
  },
  "operations.hubspot.state.unavailableTitle": {
    en: "HubSpot data is not available",
  },
  "operations.hubspot.state.unavailableBody": {
    en: "Commerce could not read HubSpot just now. Try again shortly; nothing was imported.",
  },
  "operations.hubspot.state.settings": { en: "HubSpot connection" },
  "operations.hubspot.state.noPipelinesTitle": {
    en: "No HubSpot pipelines are approved",
  },
  "operations.hubspot.state.noPipelinesBody": {
    en: "An administrator chooses which deal pipelines staff may see on the HubSpot connection page.",
  },
  "operations.hubspot.error.HUBSPOT_SIMILAR_PARTNER": {
    en: "A partner that looks like this company was added meanwhile. It is now listed above; inspect it, then create the partner.",
  },
  "operations.hubspot.error.HUBSPOT_NO_PIPELINES": {
    en: "No HubSpot pipeline is approved for staff to see.",
  },

  "operations.hubspot.ownerPanel.title": { en: "Integrations" },
  "operations.hubspot.ownerPanel.description": {
    en: "Connections that bring outside data into Commerce.",
  },
  "operations.hubspot.ownerPanel.open": { en: "HubSpot connection" },
  "operations.hubspot.ownerPanel.body": {
    en: "Connect HubSpot so sellers can bring companies and deals in as partners and see the pipeline. The connection page walks through the token, the deploy and your approval.",
  },

  "operations.hubspot.setup.title": { en: "Connect HubSpot in four steps" },
  "operations.hubspot.setup.body": {
    en: "Two of these happen outside Commerce, in HubSpot and in GitHub. The token is never typed into Commerce or shown here.",
  },
  "operations.hubspot.setup.done": { en: "Done" },
  "operations.hubspot.setup.current": { en: "Next" },
  "operations.hubspot.setup.upcoming": { en: "Later" },
  "operations.hubspot.setup.tokenTitle": {
    en: "Create a read-only HubSpot service key",
  },
  "operations.hubspot.setup.tokenBody": {
    en: "A HubSpot super admin, or a user with Developer tools access, opens Development → Keys → Service keys → Create service key, names it Fil One Commerce, adds only the read scopes below and copies the key. A legacy private app token with the same scopes works the same way.",
  },
  "operations.hubspot.setup.scopes": { en: "Read scopes to grant:" },
  "operations.hubspot.setup.filesScope": {
    en: "To bring PDFs across from HubSpot notes, also grant files and files.ui_hidden.read: note attachments are kept in HubSpot’s hidden file folder. Without them, documents show as unavailable and everything else works. Grant no write scopes, and rotate the key in HubSpot about every six months.",
  },
  "operations.hubspot.setup.deployTitle": {
    en: "Add the token to the deployment",
  },
  "operations.hubspot.setup.deployBody": {
    en: "In GitHub, fil-one/clockwork → Settings → Environments, add a secret named HUBSPOT_ACCESS_TOKEN to production (and staging, to try it there first). Then open Actions → Deploy → Run workflow on main. The next deploy gives the app the token.",
  },
  "operations.hubspot.setup.deployCheck": {
    en: "This deployment has a key, but HubSpot did not accept it. Check that it was copied whole and has not been rotated or revoked, then deploy again.",
  },
  "operations.hubspot.setup.approveTitle": {
    en: "Approve the connection here",
  },
  "operations.hubspot.setup.approveBody": {
    en: "Below, confirm the portal the token reaches, choose the pipelines and extra properties staff may read, decide on notes and files, pick the pipeline shown first, map HubSpot owners to Commerce staff, accept the audience and choose Activate connection.",
  },
  "operations.hubspot.setup.useTitle": { en: "Start using it" },
  "operations.hubspot.setup.useBody": {
    en: "Sellers choose Partners → From HubSpot, or Bring into Commerce on a deal in Sales → Pipeline. An existing partner links to its company from Link HubSpot record on the partner page.",
  },
  "operations.hubspot.setup.openPicker": { en: "Bring in from HubSpot" },
  "operations.hubspot.setup.openPipeline": { en: "Open the pipeline" },
  "operations.hubspot.setup.openPartners": { en: "Open partners" },
  "operations.hubspot.setup.notice": {
    en: "HubSpot is not connected yet",
  },
  "operations.hubspot.setup.noticeBody": {
    en: "Connect it to bring HubSpot companies and deals in as partners and to see the pipeline here. It takes a HubSpot token, one deploy and an approval.",
  },
  "operations.hubspot.setup.noticeAction": { en: "Set up HubSpot" },

  "operations.hubspot.settings.title": { en: "HubSpot connection" },
  "operations.hubspot.settings.owner": { en: "Owner console" },
  "operations.hubspot.settings.description": {
    en: "One HubSpot portal, read-only, for staff with Sales access. Commerce never writes to HubSpot.",
  },
  "operations.hubspot.settings.connection": { en: "Connection" },
  "operations.hubspot.settings.statusActive": { en: "Active" },
  "operations.hubspot.settings.statusOff": { en: "Not connected" },
  "operations.hubspot.settings.statusMismatch": { en: "Portal mismatch" },
  "operations.hubspot.settings.token": { en: "Access token" },
  "operations.hubspot.settings.tokenReaches": {
    en: "Configured; it reaches portal {portal} ({domain})",
  },
  "operations.hubspot.settings.tokenMissing": {
    en: "Not configured for this deployment",
  },
  "operations.hubspot.settings.tokenHelp": {
    en: "The token is a deployment secret with read scopes only. It is never shown here or stored in Commerce.",
  },
  "operations.hubspot.settings.approvedBy": { en: "Approved by" },
  "operations.hubspot.settings.portal": { en: "Approved portal" },
  "operations.hubspot.settings.previous": { en: "Previous connection" },
  "operations.hubspot.settings.previousBody": {
    en: "Portal {portal}, disconnected. Its imports and links are kept.",
  },
  "operations.hubspot.settings.check": { en: "Read-only check" },
  "operations.hubspot.settings.checkPassed": {
    en: "Passed: {properties} optional properties and {pipelines} pipelines readable",
  },
  "operations.hubspot.settings.mismatchBody": {
    en: "Disconnect, then approve the portal the token reaches. Links to the old portal are kept and never mix with the new one.",
  },
  "operations.hubspot.settings.scope": { en: "Data staff may read" },
  "operations.hubspot.settings.scopeBody": {
    en: "Anything not approved here stays unreadable, including properties HubSpot adds later. Properties HubSpot marks sensitive cannot be approved here.",
  },
  "operations.hubspot.settings.companies": { en: "Companies" },
  "operations.hubspot.settings.deals": { en: "Deals" },
  "operations.hubspot.settings.contacts": { en: "Contacts" },
  "operations.hubspot.settings.always": {
    en: "Always read: {names}",
  },
  "operations.hubspot.settings.sensitive": {
    en: "Sensitive in HubSpot: excluded",
  },
  "operations.hubspot.settings.pipelines": { en: "Pipelines" },
  "operations.hubspot.settings.pipelinesHelp": {
    en: "Staff see deals only in the pipelines chosen here, in the pipeline view, search and handoffs alike.",
  },
  "operations.hubspot.settings.stages": {
    count: "count",
    en: { one: "{count} stage", other: "{count} stages" },
  },
  "operations.hubspot.settings.activity": { en: "Notes and files" },
  "operations.hubspot.settings.notes": { en: "Notes" },
  "operations.hubspot.settings.notesHelp": {
    en: "Plain text of notes on companies and deals, to keep as context when someone selects them.",
  },
  "operations.hubspot.settings.files": { en: "Files attached to notes" },
  "operations.hubspot.settings.filesHelp": {
    en: "PDFs someone selects are copied as private attachments on the partner.",
  },
  "operations.hubspot.settings.neverImported": {
    en: "Commission, margin, exclusivity, contract and approval state are never imported, whatever is approved here.",
  },
  "operations.hubspot.settings.defaults": { en: "Defaults" },
  "operations.hubspot.settings.pipeline": { en: "Pipeline shown first" },
  "operations.hubspot.settings.pipelineFirst": {
    en: "HubSpot’s first pipeline",
  },
  "operations.hubspot.settings.owners": { en: "Owner mapping" },
  "operations.hubspot.settings.ownersBody": {
    en: "A mapped HubSpot owner is proposed as the Commerce owner of a new partner, with the reason shown. Unmapped owners stay readable as HubSpot context; Commerce never creates a user.",
  },
  "operations.hubspot.settings.notMapped": { en: "Not mapped" },
  "operations.hubspot.settings.audience": { en: "Audience" },
  "operations.hubspot.settings.audienceBody": {
    en: "Staff with Sales access will read the approved HubSpot data through this one connection. That can differ from what each person may see in HubSpot itself; the connection does not reproduce HubSpot permissions.",
  },
  "operations.hubspot.settings.accept": {
    en: "I approve this audience and data scope",
  },
  "operations.hubspot.settings.acceptHelp": {
    en: "Required each time the connection is activated or its scope changes. Recorded with your name.",
  },
  "operations.hubspot.settings.activate": { en: "Activate connection" },
  "operations.hubspot.settings.save": { en: "Save changes" },
  "operations.hubspot.settings.activated": { en: "HubSpot is connected." },
  "operations.hubspot.settings.saved": { en: "Connection updated." },
  "operations.hubspot.settings.disconnect": { en: "Disconnect HubSpot" },
  "operations.hubspot.settings.disconnectConfirm": {
    en: "Stop all HubSpot reads now?",
  },
  "operations.hubspot.settings.disconnected": {
    en: "HubSpot is disconnected.",
  },
  "operations.hubspot.settings.disconnectHelp": {
    en: "Disconnecting stops live reads and pending reviews at once. Imported partners, documents, source identifiers and history stay.",
  },

  "operations.hubspot.import.status.complete": { en: "Complete" },
  "operations.hubspot.import.status.needs_attention": {
    en: "Needs attention",
  },
  "operations.hubspot.import.status.completed_with_exclusions": {
    en: "Completed with exclusions",
  },
  "operations.hubspot.item.status.pending": { en: "Waiting" },
  "operations.hubspot.item.status.attached": { en: "Attached" },
  "operations.hubspot.item.status.failed": { en: "Needs attention" },
  "operations.hubspot.item.status.duplicate": { en: "Already attached" },
  "operations.hubspot.item.status.reused": { en: "Existing attachment used" },
  "operations.hubspot.item.status.excluded": { en: "Excluded" },

  "operations.hubspot.error.HUBSPOT_NOT_CONFIGURED": {
    en: "HubSpot is not set up for this environment.",
  },
  "operations.hubspot.error.HUBSPOT_NOT_CONNECTED": {
    en: "HubSpot is not connected. An administrator needs to approve the connection.",
  },
  "operations.hubspot.error.HUBSPOT_PORTAL_MISMATCH": {
    en: "The HubSpot token now reaches a different portal, so nothing was read.",
  },
  "operations.hubspot.error.HUBSPOT_CONNECTION_CHANGED": {
    en: "The HubSpot connection changed since this review opened. Reload and review again.",
  },
  "operations.hubspot.error.HUBSPOT_UNAVAILABLE": {
    en: "HubSpot did not answer. Nothing was imported; try again shortly.",
  },
  "operations.hubspot.error.HUBSPOT_RATE_LIMITED": {
    en: "HubSpot asked Commerce to slow down. Try again in a minute.",
  },
  "operations.hubspot.error.HUBSPOT_RECORD_NOT_FOUND": {
    en: "That HubSpot record no longer exists or cannot be read.",
  },
  "operations.hubspot.error.HUBSPOT_RECORD_ARCHIVED": {
    en: "That HubSpot company is archived or merged.",
  },
  "operations.hubspot.error.HUBSPOT_SOURCE_CHANGED": {
    en: "HubSpot changed since you opened this review. Check it again.",
  },
  "operations.hubspot.error.HUBSPOT_NOT_ASSOCIATED": {
    en: "That company is not on this deal in HubSpot.",
  },
  "operations.hubspot.error.HUBSPOT_SCOPE_DENIED": {
    en: "That is outside the HubSpot data Commerce may read.",
  },
  "operations.hubspot.error.HUBSPOT_ALREADY_LINKED": {
    en: "This HubSpot company is already linked to another partner.",
  },
  "operations.hubspot.error.HUBSPOT_PARTNER_LINKED_ELSEWHERE": {
    en: "This partner is already linked to another HubSpot company.",
  },
  "operations.hubspot.error.HUBSPOT_OPERATION_CONFLICT": {
    en: "This handoff was already submitted differently. Reload the page to see what was saved.",
  },
  "operations.hubspot.error.HUBSPOT_CONTACT_LIMIT": {
    en: "A partner can hold 20 contacts. Select fewer people.",
  },
  "operations.hubspot.error.HUBSPOT_CONTACT_NOT_FOUND": {
    en: "A selected person is no longer available. Reload and choose again.",
  },
  "operations.hubspot.error.HUBSPOT_DOCUMENT_UNAVAILABLE": {
    en: "HubSpot would not provide this file. Retry, or exclude it.",
  },
  "operations.hubspot.error.HUBSPOT_DOCUMENT_CHANGED": {
    en: "The file changed in HubSpot after it was reviewed. Exclude it and bring the new version in with a fresh review.",
  },
  "operations.hubspot.error.HUBSPOT_DOCUMENT_INVALID": {
    en: "The file is not a valid PDF of 25 MB or less.",
  },
  "operations.hubspot.error.HUBSPOT_ITEM_NOT_FOUND": {
    en: "That document is not part of this import.",
  },
  "operations.hubspot.error.HUBSPOT_ITEM_RESOLVED": {
    en: "That document was already resolved. Reload to see its result.",
  },
  "operations.hubspot.error.HUBSPOT_IMPORT_NOT_FOUND": {
    en: "That import was not found on this partner.",
  },
  "operations.hubspot.error.HUBSPOT_DECISION_REQUIRED": {
    en: "Make the remaining choice before saving.",
  },
  "operations.hubspot.error.HUBSPOT_CONNECTION_VERSION_CONFLICT": {
    en: "Someone else changed the connection. Reload and review it again.",
  },
  "operations.hubspot.error.HUBSPOT_OWNER_NOT_STAFF": {
    en: "A mapped owner is no longer staff with Sales access.",
  },
  "operations.hubspot.error.INVALID_INPUT": {
    en: "Something in the review is not valid. Check the highlighted choices.",
  },
  "operations.hubspot.error.CONTRACT_FORBIDDEN": {
    en: "You do not have permission to do that.",
  },
  "operations.hubspot.error.CONTRACT_MFA_REQUIRED": {
    en: "Verify with your second factor, then try again.",
  },
  "operations.hubspot.error.CONTRACT_DEMO_UNAVAILABLE": {
    en: "The demo cannot import anything.",
  },
  "operations.hubspot.error.SESSION_EXPIRED": {
    en: "Your session expired. Sign in again; your choices stay on this page.",
  },
  "operations.hubspot.error.PARTNER_VERSION_CONFLICT": {
    en: "Someone changed this partner while you were reviewing. The comparison now shows their change and your choices are kept; check it and submit again.",
  },
  "operations.hubspot.error.PARTNER_NOT_FOUND": {
    en: "That partner no longer exists.",
  },
  "operations.hubspot.error.PARTNER_OWNER_NOT_STAFF": {
    en: "The chosen owner is not staff with Sales access.",
  },
  "operations.hubspot.error.UNEXPECTED": {
    en: "Something went wrong. Nothing was imported; try again.",
  },
});
