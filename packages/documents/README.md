# `@clockwork/documents`

Deterministic, branded commerce PDFs rendered with `@react-pdf/renderer`. The
engine supports the complete immutable artifact catalog:

- direct, partner-transfer, and partner resale or white-label quotes;
- order forms and amendments;
- POC summaries and final reports;
- invoice companions and receipts;
- commission statements;
- renewal and decline confirmations;
- deletion certificates with retention exclusions; and
- reconciliation and general report exports.

Use `renderCommerceDocument(input)` for the discriminated input union or one of
the named render helpers. Money is an ISO currency plus signed integer minor
units. Instants are UTC RFC 3339 values; contractual dates are ISO calendar
dates. The returned `contentHash` is the SHA-256 digest of the final PDF bytes.
The visible `recordHash` is the caller-supplied hash of the immutable source
record, avoiding the impossible requirement that a PDF contain its own byte
hash.

The neutral Fil One text wordmark and palette are defaults. A resale document
can supply `BrandConfig` to replace the text mark, accent, legal name, and
footer without changing document layout or exposing transfer-price fields.

Every page has a repeated header and footer, document ID, version, page count,
accessible metadata, and a verification block. Long tables wrap automatically;
report exports use landscape pages. English copy is centralized in
`messages.ts`, while currency, date, address, and tax presentation follows the
input locale. Adding Spanish copy later does not require changing input shapes.

Golden tests render every document kind and pin its byte hash, byte count, and
page count. Update goldens only after inspecting the corresponding rendered
pages.

Use the official Node distribution pinned in `.node-version` when rendering or
updating byte goldens. PDF stream compression depends on Node's bundled zlib;
Homebrew or another Node release can produce different byte hashes even when the
extracted text and rendered pixels are identical. The golden fixture records
both Node and zlib versions, and the test reports a toolchain mismatch
explicitly. Semantic Poppler tests separately verify document contents and keep
wrapped quote details clear of the fixed footer.
