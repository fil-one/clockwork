# ADR 0004: WorkOS identity and commerce authorization

Status: Accepted, 2026-07-31

WorkOS AuthKit owns authentication, sessions, organizations, MFA policy,
invitations, and identity lifecycle. Commerce owns account scope, memberships,
roles, permissions, approval limits, internal-staff classification, and
two-person rules. WorkOS role webhooks synchronize identifiers into commerce;
they do not grant access without a matching commerce membership.

Privileged roles require the selected organization to be registered as covered
by an activated WorkOS MFA/access policy; SSO organizations enforce MFA at the
IdP. Destructive and high-value actions also require recent AuthKit
authentication. Internal roles require both an allow-listed staff identity and
internal membership and cannot be assigned to customer organizations. Every
query receives transaction-local user, role, account, and staff context for RLS.
Impersonation is time-limited, requires a reason, preserves both effective and
actual actors, and emits audit events. Missing credentials select deterministic
local identities only outside production. WorkOS role slugs never grant commerce
roles: membership webhooks link or revoke identity records, while commerce
approval remains authoritative.
