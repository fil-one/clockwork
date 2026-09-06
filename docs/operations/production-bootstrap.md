# Safe production bootstrap

`pnpm bootstrap:production --manifest /secure/path/bootstrap.json` validates a
reviewable manifest and prints its digest and counts. It makes no database or
provider writes. Supply actual approved organization, identity, catalog, and
mapping inputs; this command supplies none. Never use the fictional demo seed
for a deployed commerce database.

The manifest schema is `ProductionBootstrapManifestSchema` in
`packages/db/src/production-bootstrap.ts`. Required top-level keys are
`schemaVersion: 1`, `id` (UUID), `environment` (`staging` or `production`),
`targetDatabaseHost`, `sourceEvidence`, `operatorUserId`,
`identityVerificationAttestation: "verified_with_identity_provider"`, `account`,
`organization`, `staff`, `providerReferences`, `catalog`, and
`organizationMappings`.

- `account` supplies the real internal legal entity, address, domain, currency,
  billing and AP contacts, and invoice-delivery email.
- `organization` supplies its commerce UUID, name, and actual WorkOS
  organization ID. The identity provider organization must already exist.
- Each `staff` entry supplies a commerce UUID, actual WorkOS user ID, email,
  name, one staff role, `mfaVerifiedAt`, and `mfaEvidence`. At least two
  distinct principals are required: the named internal operator and a finance
  approver. Legal and destructive-action approvers can also be included. The
  caller must have verified those identities and MFA with the identity provider
  within the last 24 hours and explicitly attest to that external verification.
  A correctly shaped provider ID is only syntax; the bootstrap does not prove
  identity or probe MFA. The immutable manifest retains the supplied external
  evidence.
- `providerReferences` contains provider names, secret-manager references,
  versions, rotation timestamps, and evidence references. Secret values are
  forbidden fields. These are initial configuration references, not claims of a
  successful connection or an activation test.
- `catalog` contains draft price-book versions and complete rate cards, each
  with evidence and a provisioning SKU/region/meter mapping. Rates are validated
  using the domain pricing guardrails. No book is published or made sellable.
  Empty catalog and reference arrays are allowed when those inputs remain
  externally blocked.
- `organizationMappings` records actual Fil One, WorkOS, or CRM organization
  references against the created staff organization. Initial rate mappings are
  recorded against their draft rate-card IDs. Mapping evidence does not replace
  the Fil One integration acceptance tests or make an unimplemented adapter
  live.

After reviewing the manifest digest, use the direct **database owner/migration**
connection and supply the authorization-context secret separately through the
secret manager:

```sh
pnpm bootstrap:production --manifest /secure/path/bootstrap.json --apply --expected-host approved-db-host
```

`DIRECT_DATABASE_URL` and `AUTHORIZATION_CONTEXT_SECRET` must already be set in
the process environment. The URL hostname must match both the reviewed manifest
and `--expected-host`; localhost is refused for production. The authorization
secret must be at least 32 characters and must not be the local development
secret. Neither this credential nor provider credentials belong in the manifest,
receipt, audit, or command-line arguments. Configure the deployed application to
use the same authorization secret and `AUTHORIZATION_CONTEXT_SECRET_ID` equal to
`bootstrap:<manifest UUID>`.

Apply requires the migrations, including 001427, an empty commerce account
register, no authorization secrets, and every capability disabled. It is a
single transaction: staff/roles, draft catalog, supplied mappings, authorization
secret, immutable manifest, audit, and outbox commit together. A rerun with the
same manifest ID and digest returns the existing receipt; changing an applied
manifest is refused. Existing commerce data, especially demo data, must never be
reset by this command.

After bootstrap, supply real provider secrets, verify external gates, and use
Capabilities Admin for distinct-person activation. The worker reads persisted
capabilities at boot and constructs only the providers needed by enabled new or
recovery work. Restart it after enabling a capability whose provider was
omitted; unconfigured provider calls are explicit denials, never simulated
successes.
