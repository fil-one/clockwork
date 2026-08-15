/**
 * Surface identifiers and workflow kinds shared by the server-backed workflow
 * panel and the routes that mount it.
 */
export type SurfaceKey =
  | "dashboard"
  | "agreements"
  | "agreementExecution"
  | "quotes"
  | "quoteBuilder"
  | "orders"
  | "services"
  | "amendments"
  | "pocs"
  | "billing"
  | "account"
  | "users"
  | "procurement"
  | "offboarding"
  | "marketplace"
  | "support"
  | "partner"
  | "portfolio"
  | "registrations"
  | "registrationDisputes"
  | "partnerQuotes"
  | "partnerBilling"
  | "commissions"
  | "partnerRenewals"
  | "sandboxes"
  | "brand"
  | "partnerMarketplace"
  | "partnerSupport"
  | "internal"
  | "search"
  | "assisted"
  | "queues"
  | "approvals"
  | "priceBooks"
  | "agreementAdmin"
  | "provisioning"
  | "collections"
  | "renewals"
  | "reports"
  | "migrations"
  | "gates";

/**
 * Workflows the generic panel still owns.
 *
 * A list rather than a bare union so a test can walk it: every member has a
 * `mutationFields` branch and a submit branch in `workflow-panel.tsx`, and a
 * member with neither is worse than absent. `admin` was exactly that -- a title
 * and nothing else, so the panel rendered an empty form whose Submit fell
 * through every branch and then announced "Request accepted. The server record
 * is now the source of truth." having sent no request at all.
 *
 * Ten members left when purpose-built, record-bound surfaces took the work
 * over. Each is named with what now performs the write, because the panel
 * branch was the only caller and a reader looking for it deserves the
 * forwarding address:
 *
 * - `quote` -> `/quotes/new` (`QuoteBuilder`) and `/partner/quotes/new`
 *   (`ResaleQuoteBuilder`), which derive the commercial route from the
 *   persisted partner agreement instead of offering it as a picker;
 * - `agreement` -> `/agreements/execute` (`AgreementAcceptance`);
 * - `order` -> `/orders/accept` (`OrderAcceptance`), which carries the
 *   signatory attestation `orders.authority_title` /`authority_attested`
 *   require;
 * - `offboarding` -> `/account/offboarding` (`OffboardingWorkflow`), which
 *   lists the account's live orders rather than asking for an order id;
 * - `payment` -> `PaymentHandoff` on `/billing/[id]`;
 * - `pricebook` -> `/internal/price-books` (`PriceBookAdministration`) for the
 *   activation lifecycle only, and with a caveat worth reading: that surface
 *   sends `request_activation`, `activate` and `retire`, not `create`. The
 *   deleted branch could send `create`, so this is the one supersession that is
 *   not a superset. It goes anyway because the branch was reachable from no
 *   route, asked an operator to type a price-book UUID, and could not send
 *   `add_rate` -- so the book it created carried no rate card and could price
 *   nothing. Creating a priced book has no surface today and did not have one
 *   before; books arrive through `supabase/seed.sql` and migrations. That gap
 *   is real and belongs to whoever builds price-book authoring;
 * - `assisted` -> `startAssistedSession`, after which the operator works
 *   through the customer surfaces on the identical records (spec principle 9),
 *   rather than through a parallel operator-only form;
 * - `registration` -> `/partner/registrations` (`DealRegistration`), which
 *   names the end client from the partner's own relationship scope instead of
 *   printing an account UUID the surface promises not to expose;
 * - `admin` -> nothing, because it was never an implementation;
 * - `collections` -> `/internal/collections`, and this one is worth reading in
 *   full because the branch was not merely unreachable. It offered four
 *   actions. Two of them could never have written anything: it sent
 *   `{invoiceId, stripeCreditNoteId, amount, reasonCode}` to
 *   `credit_notes:issue` and `{paymentId, stripeRefundId, amount, reasonCode}`
 *   to `refunds:submit`, against `.strict()` schemas that want
 *   `providerReason` and `internalReasonCode` and reject both spellings and
 *   both extra keys. `disputes:create` and `invoices:evaluate_dunning` were
 *   well formed, and both are also replaced. `CorrectionDialog` on
 *   `/internal/collections` builds the credit note, refund and dispute
 *   payloads through `collections-corrections/model.ts`, whose output all
 *   three schemas accept; `evaluate_dunning` is offered on the same rows by
 *   `ProjectionActionButtons`, version-bound, from the invoice aggregate's own
 *   `allowedActions`. So the supersession is a superset of what the branch
 *   could actually do, and a strict superset of what it could do correctly.
 *
 * Deleting the branches does not reintroduce the one-click `accept` and `pay`
 * that `projection-definitions.ts` documents as deliberately absent: neither
 * replacement offers them, and the two writes still run through the order
 * acceptance form and the provider payment session respectively.
 */
export const surfaceWorkflows = [
  "poc",
  "renewal",
  "reports",
  "account",
  "invite",
  "procurement",
  "agreementAdmin",
  "brand",
  "approval",
] as const;

export type SurfaceWorkflow = (typeof surfaceWorkflows)[number];
