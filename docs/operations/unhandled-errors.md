# Unhandled runtime errors

1. Record the alert, deploy revision, environment, boundary, safe error type and
   code, request/workflow/task/audit/outbox IDs, and first/last occurrence. Do
   not add the exception message, stack arguments, request body, or user data to
   telemetry or tickets.
2. Contain only the affected route, task, topic, or provider capability. Keep
   unrelated recovery paths available. If the error followed provider success,
   preserve and replay the original idempotency key rather than invoking a new
   effect.
3. Reproduce with a sanitized deterministic scenario. Validate authorization,
   aggregate version, transaction ordering, idempotency, and persisted gate
   state before changing retry policy.
4. Add an exact regression test, deploy through staging, execute the linked
   synthetic failure, and verify the alert resolves through the configured
   paging route. Live staging evidence and paging delivery remain required
   external evidence; a local test cannot substitute for them.
