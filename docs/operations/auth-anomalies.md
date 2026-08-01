# Authentication anomaly response

Treat repeated authorization denials, invalid session or webhook signatures,
cross-account access attempts, privileged operations without recent
authentication, and unexpected identity-role changes as security signals.

1. Capture the alert ID, UTC window, environment, route template, response
   status, error code, request ID, and any workflow/task/audit/outbox joins. Do
   not copy request bodies, cookies, tokens, email addresses, IP addresses, or
   provider headers into the incident record.
2. Preserve WorkOS and application audit evidence. Determine whether the event
   is a valid fail-closed denial, credential abuse, role-sync drift, signature
   failure, or an instrumentation fault. Never grant a commerce role from an
   identity-provider role alone.
3. Contain the narrow identity, session, webhook subscription, or credential.
   Rotate suspected credentials through the secret manager; do not paste them
   into a ticket or command line.
4. Verify account and partner scope, separation of duties, recent
   authentication, raw-body webhook verification, replay protection, and the
   durable audit record. Escalate cross-account access or signature bypass to
   the security incident commander immediately.
5. Close only after the source authorization state and audit history explain the
   signal, staging synthetic detection has passed, and no PII or secret was
   emitted to telemetry.
