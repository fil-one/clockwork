import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { RuntimeDatabase } from "../../client";
import { accounts } from "../../schema";
import { accountContacts } from "../../schema/core/finance";
import { lifecyclePartnerDomains } from "../../schema/lifecycle/platform";
import { withInternalTransaction } from "../../transaction";

/** Partner agreements under which the partner, not Fil One, owns the relationship. */
const partnerOwnedAgreements = new Set(["resale", "msp", "embedded"]);

export interface NotificationRecipientBranding {
  accountId: string;
  audience: "customer" | "partner" | "end_client" | "internal";
  communicationOwner: "fil_one" | "partner";
  brandingPolicy?: {
    policyId: string;
    displayName: string;
    logoUrl?: string;
    primaryColor?: string;
    customDomain?: string;
    customDomainVerified: boolean;
  };
}

/**
 * Resolves the tenant a notification recipient belongs to, so the delivery
 * boundary can pick the brand and the payload projection for that address.
 *
 * `lifecycle_partner_domains` is the persisted branding record: every row
 * carries a server-observed `verified_at`, the partner's brand name, colour and
 * logo, and which party owns communications. Nothing read it on the delivery
 * path, so a resold end client was emailed under the first-party sender.
 */
export class DatabaseNotificationTenantDirectory {
  public constructor(private readonly database: RuntimeDatabase) {}

  public async resolve(
    recipient: string,
  ): Promise<NotificationRecipientBranding | undefined> {
    const email = recipient.trim().toLowerCase();
    if (email.length === 0) return undefined;
    return withInternalTransaction(
      this.database,
      `notification-branding:${email}`,
      async (transaction) => {
        const contacts = await transaction.query.accountContacts.findMany({
          columns: { accountId: true },
          where: and(
            eq(accountContacts.active, true),
            sql`lower(${accountContacts.email}) = ${email}`,
          ),
        });
        if (contacts.length === 0) return undefined;
        const owners = await transaction.query.accounts.findMany({
          columns: {
            id: true,
            relationshipRoles: true,
            parentPartnerId: true,
            partnerAgreementType: true,
          },
          where: inArray(accounts.id, [
            ...new Set(contacts.map((contact) => contact.accountId)),
          ]),
        });
        // One address can be a commercial contact on more than one account.
        // Resolving to the partner-owned side is the only safe answer: treating
        // a partner-owned address as first-party is the exact defect here, and
        // the reverse only costs a neutral sender on an ambiguous address.
        const account =
          owners.find((candidate) => candidate.parentPartnerId !== null) ??
          owners.find((candidate) =>
            candidate.relationshipRoles.includes("partner"),
          ) ??
          owners[0];
        if (!account) return undefined;
        const governingPartnerId =
          account.parentPartnerId ??
          (account.relationshipRoles.includes("partner")
            ? account.id
            : undefined);
        const partner = governingPartnerId
          ? await transaction.query.accounts.findFirst({
              columns: { partnerAgreementType: true },
              where: eq(accounts.id, governingPartnerId),
            })
          : undefined;
        const branding = governingPartnerId
          ? await transaction.query.lifecyclePartnerDomains.findFirst({
              where: eq(lifecyclePartnerDomains.accountId, governingPartnerId),
              orderBy: desc(lifecyclePartnerDomains.verifiedAt),
            })
          : undefined;
        return {
          accountId: account.id,
          audience: audienceFor(account.relationshipRoles),
          communicationOwner:
            branding?.communicationOwner === "partner" ||
            branding?.communicationOwner === "fil_one"
              ? branding.communicationOwner
              : partnerOwnedAgreements.has(partner?.partnerAgreementType ?? "")
                ? "partner"
                : "fil_one",
          ...(branding
            ? {
                brandingPolicy: {
                  policyId: branding.id,
                  displayName: branding.brandName,
                  ...(branding.logoUrl ? { logoUrl: branding.logoUrl } : {}),
                  primaryColor: branding.primaryColor,
                  customDomain: branding.domain,
                  // The column is `not null`, so a row is a verified row.
                  customDomainVerified: true,
                },
              }
            : {}),
        };
      },
    );
  }
}

function audienceFor(
  roles: readonly string[],
): NotificationRecipientBranding["audience"] {
  if (roles.includes("end_client") && !roles.includes("direct_client"))
    return "end_client";
  if (roles.includes("partner")) return "partner";
  return "customer";
}
