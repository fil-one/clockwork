import { sql } from "drizzle-orm";

import { ids, roles as commerceRoles, type Role } from "@clockwork/contracts";
import {
  withAuthorizedTransaction,
  withInternalTransaction,
} from "@clockwork/db";

import {
  getOptionalRuntimeDatabase,
  getOptionalServiceDatabase,
} from "@/src/db/service";
import {
  NothingToQuote,
  ResaleQuoteBuilder,
} from "@/src/features/customer-partner/partner/resale-quote-builder";
import {
  partnerPricedRoute,
  type EndClientOption,
  type OfferOption,
  type QuoteRoute,
} from "@/src/features/customer-partner/partner/resale-quote-model";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";

// The session, the partner agreement, the registrations and the price book are
// all request-scoped reads.
export const dynamic = "force-dynamic";

type Row = Readonly<Record<string, unknown>>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Expected text column ${key}`);
  return value.trim();
}

function optionalText(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isCommerceRole(value: string): value is Role {
  return (commerceRoles as readonly string[]).includes(value);
}

function authorizationSecret(): string {
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!secret || secret.length < 32)
    throw new Error(
      "AUTHORIZATION_CONTEXT_SECRET is required to read the partner portfolio",
    );
  return secret;
}

/**
 * The route this partner may write a quote under, from the persisted agreement
 * alone.
 *
 * `assertQuoteCommercialContext` refuses a `referral` route unless the
 * agreement type is `referral` and refuses every other route when it is, and
 * refuses `distributor` unless the transfer tier is `distributor`. Deriving the
 * route here is the only way a seller cannot pick one the server will reject.
 */
function routeFor(
  agreementType: string | undefined,
  transferTier: string | undefined,
): QuoteRoute | undefined {
  if (!agreementType) return undefined;
  if (agreementType === "referral") return "referral";
  return transferTier === "distributor" ? "distributor" : "resale";
}

interface PartnerCommercialTruth {
  route: QuoteRoute;
  /** The persisted transfer tier; the offer list is filtered by it. */
  transferTier?: string;
  /** The partner's own billing currency, which prices its resale quotes. */
  partnerCurrency: string;
  endClients: readonly EndClientOption[];
}

/**
 * Reads the acting partner's own agreement and registered end clients through
 * the tenant pool with the session's authorization context, so row-level
 * security is what bounds the answer rather than this query alone.
 *
 * `deal_registrations_scope` restricts the registration rows to those whose
 * `partner_account_id` is in the session's account scope, and
 * `accounts_partner_portfolio_read` admits exactly the accounts a currently
 * approved registration (or an existing partner quote) reaches. The explicit
 * `partner.id` predicate is the second lock, not the first. The same approved,
 * currently protected registration is what the command and
 * `quotes_partner_registration_insert_guard` both require, so a client offered
 * here is a client the write can name.
 */
async function loadPartnerTruth(
  partnerAccountId: string,
  session: { userId: string; roles: readonly string[] },
): Promise<PartnerCommercialTruth | undefined> {
  const runtime = getOptionalRuntimeDatabase();
  if (!runtime) return undefined;
  const rows = await withAuthorizedTransaction(
    runtime,
    {
      userId: ids.user.parse(session.userId),
      accountIds: [partnerAccountId],
      roles: session.roles.filter(isCommerceRole),
      isInternalStaff: false,
      requestId: `partner-quote-options:${crypto.randomUUID()}`,
    },
    { secret: authorizationSecret() },
    async (transaction) => {
      const result = await transaction.execute(sql<Row>`
        select
          partner.currency as partner_currency,
          partner.partner_agreement_type as agreement_type,
          partner.partner_discount_tier as transfer_tier,
          partner.screening_status as partner_screening,
          client.id as end_client_id,
          client.legal_name as end_client_name,
          client.currency as end_client_currency
        from accounts partner
        left join deal_registrations registration
          on registration.partner_account_id = partner.id
         and registration.status = 'approved'
         and registration.protection_starts_at <= now()
         and registration.protection_ends_at > now()
        left join accounts client
          on client.id = registration.end_client_account_id
         and client.screening_status = 'clear'
        where partner.id = ${partnerAccountId}::uuid
          and partner.screening_status = 'clear'
        order by client.legal_name nulls last
      `);
      return [...result] as readonly Row[];
    },
  );
  const first = rows[0];
  if (!first) return undefined;
  const route = routeFor(
    optionalText(first, "agreement_type"),
    optionalText(first, "transfer_tier"),
  );
  if (!route) return undefined;
  const partnerCurrency = text(first, "partner_currency");
  const transferTier = optionalText(first, "transfer_tier");
  const byId = new Map<string, EndClientOption>();
  for (const row of rows) {
    const id = optionalText(row, "end_client_id");
    const name = optionalText(row, "end_client_name");
    const clientCurrency = optionalText(row, "end_client_currency");
    if (!id || !name || !clientCurrency) continue;
    byId.set(id, {
      id,
      name,
      // Fil One invoices a referral end client in its own currency and a
      // resale end client through the partner, in the partner's.
      quoteCurrency: partnerPricedRoute(route)
        ? partnerCurrency
        : clientCurrency,
    });
  }
  return {
    route,
    ...(transferTier ? { transferTier } : {}),
    partnerCurrency,
    endClients: [...byId.values()].toSorted((left, right) =>
      left.name.localeCompare(right.name),
    ),
  };
}

/**
 * The rate cards on activated, in-window price books that this partner can be
 * priced against.
 *
 * `sku` and `region` are what `priceQuote` resolves a rate against, so the
 * offer is the rate card rather than the book. On a partner-priced route the
 * card also has to carry a transfer price for the persisted tier -- the
 * repository rejects the quote otherwise -- which is tested with `?` so the
 * confidential amount is never read, let alone rendered. No money column is
 * selected here at all.
 */
async function loadOffers(input: {
  currency: string;
  transferTier: string;
  now: Date;
}): Promise<readonly OfferOption[]> {
  const service = getOptionalServiceDatabase();
  if (!service) return [];
  const today = input.now.toISOString().slice(0, 10);
  const rows = await withInternalTransaction(
    service,
    `partner-quote-offers:${crypto.randomUUID()}`,
    async (transaction) => {
      const result = await transaction.execute(sql<Row>`
        select
          book.id as price_book_id,
          book.name as price_book_name,
          book.currency as currency,
          book.version as version,
          card.sku as sku,
          card.region as region
        from price_books book
        join rate_cards card on card.price_book_id = book.id
        where book.status = 'active'
          and book.effective_from <= ${today}::date
          and (book.effective_to is null or book.effective_to > ${today}::date)
          and book.currency = ${input.currency}
          and card.partner_transfer_prices ? ${input.transferTier}
        order by book.currency, book.name, card.sku, card.region
      `);
      return [...result] as readonly Row[];
    },
  );
  return rows.map((row) => {
    const priceBookId = text(row, "price_book_id");
    const sku = text(row, "sku");
    const region = text(row, "region");
    const currency = text(row, "currency");
    return {
      id: `${priceBookId}:${sku}:${region}`,
      name: `${sku} · ${region} · ${text(row, "price_book_name")} (${currency})`,
      priceBookId,
      sku,
      region,
      currency,
    };
  });
}

async function ResaleQuoteWorkspace() {
  const now = new Date();
  const [identity, session] = await Promise.all([
    getRouteIdentity("partner"),
    getRouteSession("partner"),
  ]);
  const truth = await loadPartnerTruth(identity.accountId, {
    userId: identity.userId,
    roles: session.roles,
  });
  if (!truth) return <NothingToQuote missing="agreement" />;
  const partnerPriced = partnerPricedRoute(truth.route);
  // A referral quote is billed by Fil One, and the audit-append policy
  // `core_partner_can_append_commercial_audit` admits a partner-written quote
  // audit only where `merchant_of_record = 'partner'`. Composing the form for a
  // referral partner would compose a submission the database refuses, so the
  // boundary is named instead of posted into.
  if (!partnerPriced) return <NothingToQuote missing="referralRoute" />;
  // Transfer pricing on a partner-priced route is the persisted tier; the
  // repository refuses the quote when the partner has none.
  if (!truth.transferTier) return <NothingToQuote missing="agreement" />;
  const offers = await loadOffers({
    // A partner-priced quote is billed in the partner's own currency, and the
    // repository refuses a book that disagrees with it.
    currency: truth.partnerCurrency,
    transferTier: truth.transferTier,
    now,
  });
  return (
    <ResaleQuoteBuilder
      context={{
        partnerAccountId: identity.accountId,
        partnerAccountName: identity.accountName,
        route: truth.route,
        offers,
        endClients: truth.endClients,
      }}
    />
  );
}

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="partner"
      requiredPermission="partner:quote:write"
    >
      <ResaleQuoteWorkspace />
    </SurfacePermissionGate>
  );
}
