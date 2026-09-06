# Provider operating references

Operators and finance approvers maintain provider ownership and rotation review
policy at **Administration → Provider references** (`/internal/providers`). This
is an operational record, not a credential store or provider activation control.

1. Rotate the credential in the secret manager and update its deployed consumer.
2. Record the secret-manager path, version, actual rotation timestamp, operating
   owner, rotation evidence reference, and reason for the update.
3. Choose a review interval between 1 and 730 days. The page computes and
   displays the review due date and marks overdue reviews. It does not send
   reminders or schedule credential rotation.
4. Qualify the deployed provider independently in **External gates**. Enable a
   capability only after its required evidence and approvals are satisfied.

The registry accepts `secret:`, `vault:`, and `arn:` paths. Never paste
credential values, private keys, connection strings, or signed URLs into these
records. Evidence references reject user information and remove query strings
and fragments. Rotation timestamps must describe an event that already occurred.

A bootstrap reference appears until an operator saves its registry entry. The
immutable bootstrap manifest is preserved. A bootstrap entry has no assigned
operating owner; its displayed 90-day review interval is a suggested default,
not an approved rotation requirement. The first save must assign an owner.

Writes require a directly authenticated internal operator or finance approver
with recent MFA. The database rechecks and share-locks the persisted user and
membership. Provider-scoped transaction locks and reviewed row versions prevent
concurrent first writes or updates from silently overwriting each other. Each
successful save creates an audit event and outbox record in the same
transaction. Tenant/runtime roles cannot read or write the registry. An
unavailable registry never appears as a successful provider connection; the demo
does not expose live provider reference data.

The twelve covered providers match the production bootstrap manifest: billing,
accounting, notifications, usage, WorkOS identity, evidence, provisioning,
screening, signature, tax, CRM, and document rendering. Saving a reference does
not alter runtime environment variables or enable a capability.
