# Customer PAYG and trial requests

Customers use `/buy/payg` to review no-term PAYG or trial offers and retain a
request for their organization. Finance reviews the handoff queue at
`/internal/payg-requests`. This workflow records customer assent and links
verified service records; it does not provision a provider tenant, issue
credentials, or activate billing.

## Configure an offer

In `/internal/payg-offers`, create a policy draft and enable **Include customer
acquisition policy**. Configure the service/billing, cancellation/service-end,
and trial eligibility/expiry notices. Supply the terms and retention document
identifiers, versions, HTTPS references and exact SHA-256 hashes. These
documents and their contents need the appropriate commercial/legal approval;
Clockwork does not invent or independently verify that policy.

The PAYG and trial request flags permit collecting requests. They do not replace
provider readiness, capability controls, or billing cutover evidence. A
different finance approver must approve the immutable version. Only the latest
approved, effective version for each SKU and region is offered. A newer version
with requests disabled does not fall back to an older sales offer. Existing
policies without customer notices remain usable by established internal
workflows but are not silently exposed for new customer acceptance.

## Customer acceptance

An owner or administrator of the selected organization reviews the price,
monthly minimum, partial-month treatment, trial limits and document references.
Each request binds the authenticated customer, account, organization, exact
offer version and fingerprint, and the full retained policy. Changing the
selected offer or receiving a newer fingerprint clears consent. A stale offer
requires refreshing and accepting the new terms.

Submission remains **Pending verified handoff**. The request identifier and
command hash make identical retries safe. The database rechecks persisted
membership, protects the acceptance snapshot, and prevents overlapping pending
acquisition requests for an organization. Request and resolution changes append
an audit event and its outbox delivery evidence in the same transaction;
identical request retries do not add another event. It does not claim that a
pending request has provider access or billing authority.

## Link a verified handoff

Use the existing finance controls in `/internal/payg-offers` to record the
independently verified trial claim or PAYG enrollment. Then return to the
service request and link its source identifier with a resolution reason. The
database verifies the same account, organization, tenant and offer policy. A new
trial or paid enrollment must start at or after customer acceptance; historical
service cannot be relabeled as newly authorized. PAYG source workflows retain
canonical UTC timestamps and require an exact UTC-hour start, so the first
eligible service hour may follow the acceptance time.

A trial conversion request records separate paid assent. Finance must first
confirm conversion of that trial to the matching paid enrollment. A request
cannot itself override lifetime trial eligibility, reset egress budgets, or
manufacture a provider mapping. Linking a source dispatches no new provider or
payment effect.

Customer records distinguish a linked trial or enrollment from provider access.
Provider credentials, trial enforcement and billing ownership still require the
actual provider integration and its approved handoff/cutover contract. In
particular, the existing Fil One billing owner must not be double-billed by
treating a Clockwork request as cutover authorization.

## Cancellation

A customer can request cancellation of a linked current PAYG enrollment,
including when the account is blocked from new sales. Cancellation is not an
immediate service stop: the retained policy controls final billing, and finance
must record a confirmed provider service end before resolving the request.
New-request flags do not disable cancellation against the enrollment's retained
customer notices. The service end is shown only once that evidence is linked.

## Demo and validation

The explicit demo deployment uses the shared resettable state store and a stable
fictional approved offer. Its finance queue labels the action **Simulate
verified handoff**. These records and document references are fictional and
never reach the production repositories, a provider, or a payment service. Reset
removes requests and simulated service results.

Regression coverage exercises cross-account and impersonation denial, exact
assent, stale offers, idempotency, immutable displayed economics, pre-assent
start rejection, confirmed trial conversion, blocked-account cancellation, and
the customer/finance handoff browser journey. Real production qualification
still requires provider contract and billing-cutover evidence; passing the demo
does not supply either.
