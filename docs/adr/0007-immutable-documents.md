# ADR 0007: Immutable legal document storage

Status: Accepted, 2026-07-31

Executed agreements, click evidence, issued quotes, order forms, amendments,
notices, completion certificates, and deletion certificates are rendered or
accepted as bytes, SHA-256 hashed, and written to a versioned S3 bucket with
Object Lock. Production uses Compliance mode unless counsel approves a narrower
class. Keys are content-addressed; the database stores hash, immutable object
version, retention deadline, and legal-hold state.

The adapter refuses overwrite semantics. A correction is a new document and
business-object version. Upload succeeds before a transaction commits its
document reference; orphan reconciliation is safe because hashes deduplicate.
Downloads verify the stored hash. Local fakes preserve the same immutability and
content-addressing contract.
