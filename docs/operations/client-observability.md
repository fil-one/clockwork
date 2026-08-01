# Client observability boundary

The web client emits a vendor-neutral OpenTelemetry record through the
`BrowserTelemetryExporter` interface. The default browser exporter dispatches
`clockwork:otel`; a collector integration can consume that boundary without
changing instrumentation.

## Correlation and signals

The root server layout accepts only a canonical W3C `traceparent` with non-zero
trace/span identifiers. It passes a reconstructed canonical value to the client.
Document load, browser error, unhandled rejection, and CLS/FCP/INP/LCP/TTFB
records inherit that trace ID and parent span ID; every emitted record receives
a new cryptographically random span ID and Unix nanosecond timestamp.

Resource attributes are fixed to service name, validated release version, and an
allowlisted deployment environment. Signal names and web-vital names/ratings are
allowlisted. Navigation type uses the browser performance entry rather than a
URL or user-controlled label.

## PII and secret containment

Only these attributes can leave instrumentation: route template, deployment
environment, error type, navigation type, service name/version, web-vital name,
and web-vital rating. Account/user/document IDs are replaced with `:id`; query
strings, fragments, URL credentials, emails, authorization values, arbitrary
errors, cookies, request bodies, and unapproved attributes are dropped. Unknown
signal, resource, error, navigation, and vital values become a fixed
redacted/unknown value.

The telemetry unit suite exercises malformed/all-zero trace context,
query/fragment/credential removal, UUID and opaque ID templating,
email/token/API-key/phone-like input, resource injection, exact nanosecond
conversion, signal-name redaction, and server-to-client trace correlation.
