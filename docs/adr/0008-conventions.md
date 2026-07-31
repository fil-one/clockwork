# ADR 0008: Money, time, versioning, and API conventions

Status: Accepted, 2026-07-31

Money is an ISO currency plus signed integer minor units. JSON serializes minor
units as decimal strings; calculations use `bigint` and basis points. Quantities
are non-negative decimal strings with at most 18 fractional digits. Database
numerics are `numeric(38,18)`. No binary floating point enters money or usage
calculations.

Instants are UTC RFC 3339 values with offsets; contractual calendar dates are
`date`; display uses the account locale later without changing storage. Tests
inject a clock. Mutable rows use optimistic `row_version`; commercial artifacts
use immutable versions and supersession pointers. Events and task IDs have
independent schema versions.

The API is `/v1`, JSON, OpenAPI 3.1, and extraction-ready English. Errors are
RFC 9457 `application/problem+json`. Mutations require Origin/CSRF validation
and an idempotency key. Cursor pagination is stable with a maximum of 100.
Request IDs cross every boundary. Backward-compatible fields may be added within
v1; semantic or invariant breaks require a new endpoint/event version.
