# Catalog and provider mappings

`/internal/catalog` reads the persisted price-book rates and Fil One SKU/region
bindings created by production bootstrap. It displays catalog versions, units,
approved claims and the supplied provider SKU, region, meter and evidence URI.
It never displays provider credentials or simulates a successful connection.

Operators and finance approvers with direct staff authentication and recent MFA
can fill or revise mappings on an unproposed draft. Changes lock and advance the
parent price-book version and append audit/outbox evidence with the reason.
Pending approval and published books freeze mapping inserts, updates and deletes
at the database boundary. Mapping identity cannot be moved to another rate.
Refresh after another editor changes a rate or mapping in the same book.

Create or revise commercial SKU/region and rate content through the linked
price-book editor. Reject a pending proposal before editing; prepare a new book
version for a published mapping. The mapping page has no activation command.
Price-book approval, production capabilities and external provider gates retain
their independent authority.

A supplied mapping and evidence URI are configuration, not proof of an operating
Fil One transport. The signed integration API, machine credentials, provider
activation tests, immutable organization links and account cutover must still be
qualified before direct sales are enabled. No provider reference here grants
permission to create an external tenant or assume billing ownership.
