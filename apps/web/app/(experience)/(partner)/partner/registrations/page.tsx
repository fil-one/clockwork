import { sql } from "drizzle-orm";

import { ids, roles as commerceRoles, type Role } from "@clockwork/contracts";
import { withAuthorizedTransaction } from "@clockwork/db";

import { getOptionalRuntimeDatabase } from "@/src/db/service";
import {
  DealRegistration,
  RegistrationDirectoryUnavailable,
} from "@/src/features/customer-partner/partner/deal-registration";
import type { RegistrableEndClient } from "@/src/features/customer-partner/partner/deal-registration-model";
import { PartnerCollectionRoute } from "@/src/features/customer-partner/partner/partner-route";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import {
  getRouteIdentity,
  getRouteSession,
} from "@/src/features/shell/route-session";

// The session and the partner's own account scope are request-scoped reads.
export const dynamic = "force-dynamic";

type Row = Readonly<Record<string, unknown>>;

function isCommerceRole(value: string): value is Role {
  return (commerceRoles as readonly string[]).includes(value);
}

/**
 * The end clients this partner may name on a registration, read through the
 * tenant pool under the session's own authorization context.
 *
 * Row-level security is what bounds the answer, not this query.
 * `core_partner_can_access_account` (supabase/migrations/000934) admits an
 * account only where an approved deal registration or an existing partner quote
 * already reaches it, so the list is the partner's own relationship scope and
 * nothing wider. The `not in` clause drops the partner's own account rows,
 * which `accounts_scope` also admits and which `registerDeal` refuses as an end
 * client.
 *
 * No screening filter. Screening is enforced on the quote, not on the
 * registration -- `assertQuoteCommercialContext` refuses an unscreened buyer,
 * and nothing in the registration path does -- so excluding an unscreened
 * account here would refuse a registration the server accepts, which is the
 * point of registering early.
 *
 * `undefined` means the directory could not be read at all, which is a
 * different statement from "you have no end clients" and is reported as one.
 */
async function loadRegistrableEndClients(
  partnerAccountId: string,
  session: { userId: string; roles: readonly string[] },
): Promise<readonly RegistrableEndClient[] | undefined> {
  const runtime = getOptionalRuntimeDatabase();
  const secret = process.env.AUTHORIZATION_CONTEXT_SECRET?.trim();
  if (!runtime || !secret || secret.length < 32) return undefined;
  const rows = await withAuthorizedTransaction(
    runtime,
    {
      userId: ids.user.parse(session.userId),
      accountIds: [partnerAccountId],
      roles: session.roles.filter(isCommerceRole),
      isInternalStaff: false,
      requestId: `partner-registration-clients:${crypto.randomUUID()}`,
    },
    { secret },
    async (transaction) => {
      const result = await transaction.execute(sql<Row>`
        select account.id as id, account.legal_name as name
        from accounts account
        where account.id <> ${partnerAccountId}::uuid
        order by account.legal_name
      `);
      return [...result] as readonly Row[];
    },
  );
  const clients: RegistrableEndClient[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id : undefined;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id && name) clients.push({ id, name });
  }
  return clients;
}

/**
 * Spec §6 and §14 put deal registration on the partner desk, the surface
 * describes itself as the place to "register named opportunities", and the
 * command palette links "Register a deal" here. Until this mount there was no
 * code path at all that could send `deal_registrations create`: the only caller
 * was a workflow-panel branch no route ever rendered.
 */
async function RegistrationAction() {
  const identity = await getRouteIdentity("partner").catch(() => undefined);
  if (!identity) return null;
  const session = await getRouteSession("partner");
  const endClients = await loadRegistrableEndClients(identity.accountId, {
    userId: identity.userId,
    roles: session.roles,
  });
  if (!endClients) return <RegistrationDirectoryUnavailable />;
  return (
    <DealRegistration
      context={{
        partnerAccountId: identity.accountId,
        partnerAccountName: identity.accountName,
        endClients,
      }}
    />
  );
}

export default function Page() {
  return (
    <PartnerCollectionRoute
      surface="registrations"
      actions={
        <SurfaceActionGate
          audience="partner"
          requiredPermission="partner:quote:write"
        >
          <RegistrationAction />
        </SurfaceActionGate>
      }
    />
  );
}
