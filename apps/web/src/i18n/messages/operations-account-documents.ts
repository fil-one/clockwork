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
    en: "This PDF is already attached to this record. You can view or download it below.",
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
  "operations.accountDocuments.forbidden": {
    en: "You do not have permission to attach documents to this record.",
  },
});
