# Runtime telemetry

Clockwork emits vendor-neutral OpenTelemetry spans at the server, API, database,
workflow, provider, webhook, queue, and outbox boundaries. Every available span
carries the same non-PII correlation join: request ID, workflow run ID, durable
task ID, audit event ID, and outbox message ID. Request or provider bodies,
URLs, query strings, headers, cookies, email addresses, credentials, tokens, and
exception messages are not accepted as telemetry attributes.

## OTLP configuration

The runtime accepts standard `OTEL_*` configuration. Set `OTEL_SERVICE_NAME`,
`OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, optional
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_RESOURCE_ATTRIBUTES`, and the standard
`http/protobuf` protocol. Production collectors require HTTPS. Header values are
delivered to the collector but are not exposed in readiness output or emitted
telemetry. `OTEL_SDK_DISABLED=true` is suitable only for local tests and an
explicitly approved maintenance interval.

No hosted vendor is selected in this repository. Live collector/backend
selection, collector credentials, retention/residency, paging delivery, and a
staging alert-and-dashboard evidence bundle are external inputs under
`EXT-ACC-01`. Until they are supplied, repository tests prove payload shape,
correlation, redaction, synthetic failures, and backend-neutral alert queries;
they do not claim that a production page was delivered.

## Data artifacts

- [runtime-dashboards.json](./runtime-dashboards.json) declares panels against
  OpenTelemetry span fields and attributes.
- [runtime-alerts.json](./runtime-alerts.json) declares thresholds, synthetic
  failure IDs, severity, and a linked runbook for every page.
- Synthetic failures use `clockwork.synthetic=true` and one of the enumerated
  scenario codes. Run them in staging after the collector and paging route are
  installed. Production synthetic failures require the incident commander and
  must never invoke a real provider effect.

## Correlation and triage

Start from `clockwork.request.id`; join to `clockwork.workflow.id`,
`clockwork.task.id`, `clockwork.audit.id`, and `clockwork.outbox.id`. A missing
ID is expected only before that object exists. Never reconstruct an absent join
from an email address, provider payload, or query string. Use the source
database and durable stores for authoritative state; telemetry is operational
evidence, not commercial authority.

For auth anomalies follow [auth-anomalies.md](./auth-anomalies.md). For database
or PITR signals use [disaster-recovery.md](./disaster-recovery.md). For queue,
dead-letter, or outbox signals use
[queue-outbox-health.md](./queue-outbox-health.md). Provisioning and
reconciliation link to their existing specialist runbooks. Uncaught exceptions
use [unhandled-errors.md](./unhandled-errors.md).
