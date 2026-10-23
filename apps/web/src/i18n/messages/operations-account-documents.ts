import { defineStaffMessages } from "../define";

export const accountDocumentMessages = defineStaffMessages({
  "operations.accountDocuments.title": { en: "Documents" },
  "operations.accountDocuments.description": {
    en: "Keep signed agreements and supporting PDFs with this record. Documents are visible to authorized Fil One staff.",
  },
  "operations.accountDocuments.emptyTitle": { en: "No documents attached" },
  "operations.accountDocuments.emptyBody": {
    en: "Attach an MNDA signed outside Commerce, an agreement, or a supporting document.",
  },
  "operations.accountDocuments.name": { en: "Document title" },
  "operations.accountDocuments.kind": { en: "Document type" },
  "operations.accountDocuments.signedOn": { en: "Signed on (optional)" },
  "operations.accountDocuments.kind.mnda": { en: "MNDA / NDA" },
  "operations.accountDocuments.kind.agreement": { en: "Agreement" },
  "operations.accountDocuments.kind.other": { en: "Other document" },
  "operations.accountDocuments.choose": { en: "Choose PDF" },
  "operations.accountDocuments.upload": { en: "Attach document" },
  "operations.accountDocuments.uploading": { en: "Attaching…" },
  "operations.accountDocuments.rules": {
    en: "PDF only, up to 25 MB. Attached documents are retained with their original details. Adding a file does not change signing or approval status.",
  },
  "operations.accountDocuments.uploaded": { en: "“{name}” is attached." },
  "operations.accountDocuments.external": { en: "Uploaded externally" },
  "operations.accountDocuments.signed": { en: "Signed {date}" },
  "operations.accountDocuments.view": { en: "View" },
  "operations.accountDocuments.download": { en: "Download" },
  "operations.accountDocuments.viewNamed": { en: "View {name}" },
  "operations.accountDocuments.downloadNamed": { en: "Download {name}" },
  "operations.accountDocuments.unavailable": {
    en: "Documents could not be loaded. Reload this page to try again.",
  },
  "operations.accountDocuments.demo": {
    en: "Document attachments are available on saved records in the live staff workspace.",
  },
  "operations.accountDocuments.duplicate": {
    en: "This PDF is already attached to this record. You can view or download it below; to replace it, remove that copy first.",
  },
  "operations.accountDocuments.retry": {
    en: "The previous upload used different details. Reload the page to check whether it was saved, then try again.",
  },
  "operations.accountDocuments.missing": {
    en: "This record or document is no longer available. Reload the page.",
  },
  "operations.accountDocuments.invalid": {
    en: "Enter a document title and check the signing date.",
  },
  "operations.accountDocuments.remove": { en: "Remove" },
  "operations.accountDocuments.removeNamed": { en: "Remove {name}" },
  "operations.accountDocuments.removeConfirm": {
    en: "Remove “{name}” from this record? It will no longer be listed or openable here. Commerce keeps the file and this change in the record’s history; you can restore it unless the same PDF has been attached again.",
  },
  "operations.accountDocuments.removeReason": { en: "Why remove it?" },
  "operations.accountDocuments.removeReasonHelp": {
    en: "For example: attached to the wrong record, or replaced by a corrected copy. Kept with the history.",
  },
  "operations.accountDocuments.removeAction": { en: "Remove document" },
  "operations.accountDocuments.removeCancel": { en: "Keep it" },
  "operations.accountDocuments.removing": { en: "Removing…" },
  "operations.accountDocuments.removed": {
    en: "“{name}” was removed from this record.",
  },
  "operations.accountDocuments.restored": {
    en: "“{name}” is back on this record.",
  },
  "operations.accountDocuments.undo": { en: "Undo" },
  "operations.accountDocuments.restore": { en: "Restore" },
  "operations.accountDocuments.restoreNamed": { en: "Restore {name}" },
  "operations.accountDocuments.removedTitle": {
    count: "count",
    en: {
      one: "{count} removed document",
      other: "{count} removed documents",
    },
  },
  "operations.accountDocuments.removedBody": {
    en: "Removed documents can’t be opened from this record. They stay in its history for audit, and the same PDF can be attached again.",
  },
  "operations.accountDocuments.removedBy": {
    en: "Removed by {name}: {reason}",
  },
  "operations.accountDocuments.changed": {
    en: "Someone else changed this document. Reload the page to see its current state.",
  },
  "operations.accountDocuments.forbidden": {
    en: "You do not have permission to change documents on this record.",
  },
});
