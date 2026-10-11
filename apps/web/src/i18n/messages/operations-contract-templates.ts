import { defineStaffMessages } from "../define";

/** The template store and prepare-from-template additions (staff only). */
export const contractTemplateMessages = defineStaffMessages({
  "operations.contractTemplates.title": { en: "Contract templates" },
  "operations.contractTemplates.description": {
    en: "The wording sellers prepare agreements from. Import or draft a version, check its specimen PDF, then activate it for use. A version used for a contract never changes.",
  },
  "operations.contractTemplates.manage": { en: "Manage templates" },
  "operations.contractTemplates.new": { en: "New template version" },
  "operations.contractTemplates.newDescription": {
    en: "Import a template file or start a blank one. Either becomes a draft that nobody can prepare from until you activate it.",
  },
  "operations.contractTemplates.versionDescription": {
    en: "Drafts can be edited. Activated versions are fixed: to change one, duplicate it as a new version.",
  },
  "operations.contractTemplates.demoTitle": {
    en: "Demo: sample templates only",
  },
  "operations.contractTemplates.demoBody": {
    en: "You can open the sample templates, check a file and preview a specimen. Saving, activating and retiring are off in the demo.",
  },
  "operations.contractTemplates.emptyTitle": { en: "No templates yet" },
  "operations.contractTemplates.emptyBody": {
    en: "Import a template file or start a blank one. Sellers see a template once a version of it is activated.",
  },
  "operations.contractTemplates.inUse": {
    en: "{version} in use, activated by {name} on {date}.",
  },
  "operations.contractTemplates.notInUse": {
    en: "No version in use. Sellers cannot prepare this template.",
  },
  "operations.contractTemplates.versions": { en: "Versions of {name}" },
  "operations.contractTemplates.column.version": { en: "Version" },
  "operations.contractTemplates.column.status": { en: "Status" },
  "operations.contractTemplates.column.type": { en: "Contract type" },
  "operations.contractTemplates.column.source": { en: "Source" },
  "operations.contractTemplates.column.updated": { en: "Last change" },
  "operations.contractTemplates.openVersion": { en: "Open {version}" },
  "operations.contractTemplates.updatedBy": { en: "{date}, {name}" },
  "operations.contractTemplates.status.draft": { en: "Draft" },
  "operations.contractTemplates.status.active": { en: "In use" },
  "operations.contractTemplates.status.retired": { en: "Retired" },
  "operations.contractTemplates.versionHeading": { en: "{name}, {version}" },
  "operations.contractTemplates.fact.name": { en: "Name" },
  "operations.contractTemplates.fact.key": { en: "Template key" },
  "operations.contractTemplates.fact.type": { en: "Contract type" },
  "operations.contractTemplates.fact.source": { en: "Source note" },
  "operations.contractTemplates.fact.activated": { en: "Activated" },
  "operations.contractTemplates.fact.retired": { en: "Retired" },
  "operations.contractTemplates.fact.used": { en: "Prepared contracts" },
  "operations.contractTemplates.fact.hash": { en: "Content SHA-256" },
  "operations.contractTemplates.fact.becomes": { en: "Saves as" },
  "operations.contractTemplates.fact.contents": { en: "Contents" },
  "operations.contractTemplates.activatedBy": { en: "{name}, {date}" },
  "operations.contractTemplates.notActivated": { en: "Not yet" },
  "operations.contractTemplates.usedBy": {
    count: "count",
    en: {
      one: "{count} contract prepared from this version",
      other: "{count} contracts prepared from this version",
    },
  },
  "operations.contractTemplates.replaces": {
    en: "Activating this draft retires {version}, the version in use.",
  },
  "operations.contractTemplates.keyHelp": {
    en: "Lowercase letters, digits and hyphens. Every version of a template shares its key, and sellers' links use it.",
  },
  "operations.contractTemplates.optionalCount": {
    count: "count",
    en: {
      one: "{count} optional section",
      other: "{count} optional sections",
    },
  },
  "operations.contractTemplates.activate.action": { en: "Activate for use" },
  "operations.contractTemplates.activate.title": { en: "Activate {version}?" },
  "operations.contractTemplates.activate.body": {
    en: "Sellers can prepare contracts from this version straight away.",
  },
  "operations.contractTemplates.activate.replaces": {
    en: "Sellers prepare from this version straight away, and {version} is retired. Contracts already prepared keep their version.",
  },
  "operations.contractTemplates.activate.record": {
    en: "Your name and the time are recorded as the activation, in the template history and the audit log. The wording is fixed from now on.",
  },
  "operations.contractTemplates.activate.confirm": { en: "Activate" },
  "operations.contractTemplates.retire.action": { en: "Retire" },
  "operations.contractTemplates.retire.title": { en: "Retire {version}?" },
  "operations.contractTemplates.retire.body": {
    en: "Sellers can no longer prepare from this template until a version is activated again.",
  },
  "operations.contractTemplates.retire.note": {
    en: "Contracts already prepared keep this version and its PDF. You can activate it again later.",
  },
  "operations.contractTemplates.retire.confirm": { en: "Retire" },
  "operations.contractTemplates.discard.action": { en: "Discard draft" },
  "operations.contractTemplates.discard.title": {
    en: "Discard this draft?",
  },
  "operations.contractTemplates.discard.body": {
    en: "The draft is deleted. The audit log keeps a record that it existed.",
  },
  "operations.contractTemplates.discard.note": {
    en: "Download the JSON first if you may want it again.",
  },
  "operations.contractTemplates.discard.confirm": { en: "Discard" },
  "operations.contractTemplates.duplicate": {
    en: "Duplicate as new version",
  },
  "operations.contractTemplates.download": { en: "Download JSON" },
  "operations.contractTemplates.saveDraft": { en: "Save draft" },
  "operations.contractTemplates.saving": { en: "Saving…" },
  "operations.contractTemplates.saved": { en: "Draft saved" },
  "operations.contractTemplates.savedBody": {
    en: "Check the specimen PDF, then activate the draft when it is ready.",
  },
  "operations.contractTemplates.unsaved": {
    en: "Unsaved changes. Save the draft before activating it.",
  },
  "operations.contractTemplates.specimen.action": {
    en: "Preview specimen PDF",
  },
  "operations.contractTemplates.specimen.rendering": { en: "Rendering…" },
  "operations.contractTemplates.specimen.ready": { en: "Specimen ready" },
  "operations.contractTemplates.specimen.readyBody": {
    en: "Every optional section is in and every field shows its default or a sample value.",
  },
  "operations.contractTemplates.specimen.open": { en: "Open specimen" },
  "operations.contractTemplates.import.title": { en: "Import a file" },
  "operations.contractTemplates.import.description": {
    en: "A template JSON file: the wording as blocks with [[field]] tokens, the fields, optional sections and figures. The file is checked before anything is saved.",
  },
  "operations.contractTemplates.import.file": { en: "Template file" },
  "operations.contractTemplates.import.fileHelp": {
    en: "JSON, as downloaded from a template version or prepared for import.",
  },
  "operations.contractTemplates.import.firstVersion": {
    en: "{version}, a new template",
  },
  "operations.contractTemplates.import.nextVersion": {
    en: "{version}, a draft beside {active} in use",
  },
  "operations.contractTemplates.import.contents": {
    en: "{fields} fields, {sections} optional sections, {blocks} blocks",
  },
  "operations.contractTemplates.import.save": { en: "Save as draft" },
  "operations.contractTemplates.blank.title": { en: "Start blank" },
  "operations.contractTemplates.blank.legend": { en: "New template" },
  "operations.contractTemplates.blank.description": {
    en: "Creates a draft with one heading and one paragraph to edit. Use an existing key to start a new version of that template.",
  },
  "operations.contractTemplates.blank.create": { en: "Create draft" },
  "operations.contractTemplates.issues.title": {
    count: "count",
    en: {
      one: "{count} problem to fix",
      other: "{count} problems to fix",
    },
  },
  "operations.contractTemplates.issue.block": { en: "Block {number} ({type})" },
  "operations.contractTemplates.issue.title": { en: "Document title" },
  "operations.contractTemplates.issue.fields": { en: "Field {id} {detail}" },
  "operations.contractTemplates.issue.sections": {
    en: "Section {id} {detail}",
  },
  "operations.contractTemplates.issue.derived": {
    en: "Figure {id} {detail}",
  },
  "operations.contractTemplates.issue.other": { en: "{path}" },
  "operations.contractTemplates.error.title": {
    en: "The template was not saved",
  },
  "operations.contractTemplates.error.json": {
    en: "This file is not valid JSON.",
  },
  "operations.contractTemplates.error.tooLarge": {
    en: "This file is over 900 KB. A template file is usually under 100 KB; check it is the right file.",
  },
  "operations.contractTemplates.broken.title": {
    en: "This version cannot be used",
  },
  "operations.contractTemplates.broken.invalid": {
    en: "Its stored content no longer passes the template checks. Sellers cannot prepare from it. Retire it, then import a corrected file as a new version.",
  },
  "operations.contractTemplates.error.revision": {
    en: "Someone changed this version since you opened it. Reload and make your change again.",
  },
  "operations.contractTemplates.error.notDraft": {
    en: "Only drafts can be edited or discarded. Duplicate this version to change it.",
  },
  "operations.contractTemplates.error.notActive": {
    en: "Only the version in use can be retired.",
  },
  "operations.contractTemplates.error.keyChanged": {
    en: "A version keeps its template key. Import the file to start a different template.",
  },
  "operations.contractTemplates.error.integrity": {
    en: "This version's stored content no longer matches its hash, so sellers cannot prepare from it. Retire it and ask engineering to look at it.",
  },
  "operations.contractTemplates.kind.text": { en: "Text" },
  "operations.contractTemplates.kind.email": { en: "Email" },
  "operations.contractTemplates.kind.date": { en: "Date" },
  "operations.contractTemplates.kind.choice": { en: "Choice" },
  "operations.contractTemplates.kind.number": { en: "Whole number" },
  "operations.contractTemplates.kind.decimal": { en: "Decimal" },
  "operations.contractTemplates.kind.percent": { en: "Percent" },
  "operations.contractTemplates.kind.lineItems": { en: "Line items" },
  "operations.contractTemplates.block.heading": { en: "Heading" },
  "operations.contractTemplates.block.paragraph": { en: "Paragraph" },
  "operations.contractTemplates.block.table": { en: "Table" },
  "operations.contractTemplates.block.pageBreak": { en: "Page break" },
  "operations.contractTemplates.op.percentOf": { en: "Percent of an amount" },
  "operations.contractTemplates.op.product": { en: "Multiply" },
  "operations.contractTemplates.op.sum": { en: "Add" },
  "operations.contractTemplates.tableRows": {
    count: "count",
    en: { one: "Table, {count} row", other: "Table, {count} rows" },
  },
  "operations.contractTemplates.inSection": { en: "(section {section})" },
  "operations.contractTemplates.sectionOn": { en: "ticked by default" },
  "operations.contractTemplates.sectionOff": { en: "off by default" },
  "operations.contractTemplates.sectionWhen": {
    en: "in when {field} is {values}",
  },
  "operations.contractTemplates.editor.basics": { en: "Basics" },
  "operations.contractTemplates.editor.nameHelp": {
    en: "Shown to sellers, printed in the PDF and used in the signing email subject.",
  },
  "operations.contractTemplates.editor.sourceHelp": {
    en: "Where the wording came from, for example Counsel draft 8 Sept 2026, clean. Never printed.",
  },
  "operations.contractTemplates.editor.approval": {
    en: "Needs approval before sending",
  },
  "operations.contractTemplates.editor.approvalHelp": {
    en: "Someone with contract approval rights, other than the preparer, approves each contract before it goes out.",
  },
  "operations.contractTemplates.editor.title": { en: "Document title" },
  "operations.contractTemplates.editor.fields": { en: "Fields" },
  "operations.contractTemplates.editor.fieldsHelp": {
    en: "What a seller fills in, in form order. Put [[field id]] in the wording where each value prints.",
  },
  "operations.contractTemplates.editor.sections": {
    en: "Optional sections",
  },
  "operations.contractTemplates.editor.sectionsHelp": {
    en: "Parts a contract can include or leave out: an option, a schedule, an annex. Sellers tick them, or a choice field turns them on.",
  },
  "operations.contractTemplates.editor.derived": { en: "Worked-out figures" },
  "operations.contractTemplates.editor.derivedHelp": {
    en: "Figures calculated from numeric fields, such as an illustrative commission. Use [[figure id]] in the wording.",
  },
  "operations.contractTemplates.editor.blocks": { en: "Wording" },
  "operations.contractTemplates.editor.blocksHelp": {
    en: "The agreement in order: headings, paragraphs, tables and page breaks. The signature page is added automatically.",
  },
  "operations.contractTemplates.editor.fieldId": { en: "Id" },
  "operations.contractTemplates.editor.fieldIdHelp": {
    en: "Lowercase letters, digits and underscores, starting with a letter.",
  },
  "operations.contractTemplates.editor.sectionId": { en: "Id" },
  "operations.contractTemplates.editor.label": { en: "Label" },
  "operations.contractTemplates.editor.kind": { en: "Kind" },
  "operations.contractTemplates.editor.section": { en: "Section" },
  "operations.contractTemplates.editor.always": { en: "Always included" },
  "operations.contractTemplates.editor.default": { en: "Starting value" },
  "operations.contractTemplates.editor.maxLength": { en: "Longest value" },
  "operations.contractTemplates.editor.required": { en: "Required" },
  "operations.contractTemplates.editor.help": { en: "Help for sellers" },
  "operations.contractTemplates.editor.options": { en: "Options" },
  "operations.contractTemplates.editor.optionsHelp": {
    en: "One per line. The value prints in the agreement; add | and a label to show sellers something else.",
  },
  "operations.contractTemplates.editor.when": { en: "Included when" },
  "operations.contractTemplates.editor.ticked": { en: "The seller ticks it" },
  "operations.contractTemplates.editor.whenValues": {
    en: "Choice values",
  },
  "operations.contractTemplates.editor.whenValuesHelp": {
    en: "Comma-separated option values that turn the section on.",
  },
  "operations.contractTemplates.editor.sectionDefault": {
    en: "Ticked to start with",
  },
  "operations.contractTemplates.editor.op": { en: "Calculation" },
  "operations.contractTemplates.editor.operands": { en: "Of" },
  "operations.contractTemplates.editor.operandsHelp": {
    en: "Comma-separated field ids, earlier figures or numbers. Percent of an amount takes the percent first.",
  },
  "operations.contractTemplates.editor.decimals": { en: "Decimal places" },
  "operations.contractTemplates.editor.blockType": { en: "Type" },
  "operations.contractTemplates.editor.text": { en: "Text" },
  "operations.contractTemplates.editor.textHelp": {
    en: "[[id]] prints a value; **text** prints bold.",
  },
  "operations.contractTemplates.editor.tableHeader": {
    en: "First row is a heading",
  },
  "operations.contractTemplates.editor.tableRows": { en: "Rows" },
  "operations.contractTemplates.editor.tableWidths": { en: "Column widths" },
  "operations.contractTemplates.editor.tableWidthsHelp": {
    en: "Optional relative widths, such as 1, 3. Equal columns when blank.",
  },
  "operations.contractTemplates.editor.tableRowsHelp": {
    en: "One row per line, cells separated by |. Write \\| for a | inside a cell.",
  },
  "operations.contractTemplates.editor.addField": { en: "Add field" },
  "operations.contractTemplates.editor.addSection": { en: "Add section" },
  "operations.contractTemplates.editor.addDerived": { en: "Add figure" },
  "operations.contractTemplates.editor.addBlock": { en: "Add block at end" },
  "operations.contractTemplates.editor.insertBelow": { en: "Insert below" },
  "operations.contractTemplates.editor.up": { en: "Up" },
  "operations.contractTemplates.editor.down": { en: "Down" },
  "operations.contractTemplates.editor.remove": { en: "Remove" },
  "operations.contractTemplates.editor.upNamed": { en: "Move {name} up" },
  "operations.contractTemplates.editor.downNamed": { en: "Move {name} down" },
  "operations.contractTemplates.editor.removeNamed": { en: "Remove {name}" },
  "operations.contractTemplates.prepare.sections": {
    en: "Optional sections",
  },
  "operations.contractTemplates.prepare.sectionsHelp": {
    en: "Tick the parts this contract includes. Fields of a section left out are not asked for.",
  },
  "operations.contractTemplates.prepare.followsOn": {
    en: "{section}: included, set by {field}.",
  },
  "operations.contractTemplates.prepare.followsOff": {
    en: "{section}: left out, set by {field}.",
  },
  "operations.contractTemplates.prepare.preview": { en: "Preview PDF" },
  "operations.contractTemplates.prepare.previewing": { en: "Rendering…" },
  "operations.contractTemplates.prepare.previewReady": {
    en: "Preview ready",
  },
  "operations.contractTemplates.prepare.previewBody": {
    en: "Nothing is saved. Details not filled in yet print as blanks.",
  },
  "operations.contractTemplates.prepare.openPreview": { en: "Open preview" },
  "operations.contractTemplates.prepare.demoTitle": {
    en: "Demo: preview only",
  },
  "operations.contractTemplates.prepare.demoBody": {
    en: "Fill in the sample template, tick sections and preview the PDF. Preparing and sending are off in the demo.",
  },
});
