import { randomUUID } from "node:crypto";
import { asc, desc, eq, ne, sql } from "drizzle-orm";

import {
  OrganizationOnboardingInputSchema,
  type Actor,
  type OnboardedOrganization,
  type OnboardingSide,
  type OrganizationSide,
} from "@clockwork/contracts";
import { normalizeLegalName } from "@clockwork/domain/core";

import type { RuntimeDatabase, RuntimeTransaction } from "../../client";
import {
  accounts,
  commerceUsers,
  memberships,
  organizations,
  procurementProfiles,
} from "../../schema";
import { handoffRequests } from "../../schema/handoff-requests";
import { withInternalTransaction } from "../../transaction";
import { appendAuditAndOutbox } from "../audit-outbox";
import {
  auditHandoffRequest,
  lockHandoffRequest,
} from "../system/handoff-requests";

type AccountInsert = typeof accounts.$inferInsert;

/**
 * The account, its organization and its procurement profile, written
 * together. Self-registration and staff set-up both create customers and
 * partners through this one function; each adds its own people and events.
 */
export async function insertAccountWithOrganization(
  tx: RuntimeTransaction,
  input: {
    organizationId?: string;
    side: OrganizationSide;
    account: Pick<
      AccountInsert,
      | "legalName"
      | "relationshipRoles"
      | "registeredAddress"
      | "taxIds"
      | "billingContact"
      | "apContact"
      | "invoiceDeliveryEmail"
      | "domain"
      | "country"
      | "currency"
      | "screeningStatus"
      | "partnerAgreementType"
    >;
  },
) {
  const [account] = await tx.insert(accounts).values(input.account).returning();
  if (!account) throw new Error("ACCOUNT_INSERT_FAILED");
  const [organization] = await tx
    .insert(organizations)
    .values({
      ...(input.organizationId ? { id: input.organizationId } : {}),
      accountId: account.id,
      name: account.legalName,
      isolated: false,
      side: input.side,
    })
    .returning();
  if (!organization) throw new Error("ORGANIZATION_INSERT_FAILED");
  await tx.insert(procurementProfiles).values({
    accountId: account.id,
    poRequired: false,
    exemptions: [],
    supplierDocuments: [],
  });
  return { account, organization };
}

/**
 * The organization side a self-registration's relationship gives: a partner
 * that is not also a direct client is a channel partner, as
 * `organization_side_from_account` (001446) decides for an account with no
 * recorded agreement type; everyone else is a customer.
 */
export function registrationSide(
  relationshipRoles: readonly string[],
): "customer" | "channel_partner" {
  return relationshipRoles.includes("partner") &&
    !relationshipRoles.includes("direct_client")
    ? "channel_partner"
    : "customer";
}

export interface OnboardingOrganizationSummary {
  organizationId: string;
  accountId: string;
  legalName: string;
  side: OrganizationSide;
  country: string;
  currency: string;
  domain: string;
  screeningStatus: string;
  identityProviderLinked: boolean;
  createdAt: string;
}

export interface OnboardingOrganizationMember {
  userId: string;
  name: string;
  email: string;
  role: string;
  addedAt: string;
}

export interface OnboardingOrganizationDetail extends OnboardingOrganizationSummary {
  billingContact: { name: string; email: string };
  partnerAgreementType: string | null;
  members: OnboardingOrganizationMember[];
  handoffRequestIds: string[];
}

const sideRelationship = (side: OnboardingSide, channel: string) =>
  side === "customer"
    ? { relationshipRoles: ["direct_client"], partnerAgreementType: null }
    : {
        relationshipRoles: ["partner"],
        partnerAgreementType:
          side === "referral_partner" ? "referral" : channel,
      };

const sideFits = (side: OnboardingSide, requested: "customer" | "partner") =>
  requested === "customer" ? side === "customer" : side !== "customer";

type UserActor = Actor & { kind: "user" };

/**
 * Customer and partner organizations created by operations staff. The web
 * layer checks `operations:write` for creation and `operations:read` for
 * reading; the service role does not narrow rows.
 */
export class OrganizationOnboardingRepository {
  constructor(private readonly db: RuntimeDatabase) {}

  private tx<T>(fn: (tx: RuntimeTransaction) => Promise<T>) {
    return withInternalTransaction(this.db, randomUUID(), fn);
  }

  /**
   * Creates the account and organization, and records the organization on
   * the handoff it came from. The `organization.created` event starts the
   * identity provider's organization, as it does for a self-registration. A
   * retry with the same organization id returns what the first one created.
   */
  create(raw: unknown, actor: UserActor): Promise<OnboardedOrganization> {
    const input = OrganizationOnboardingInputSchema.parse(raw);
    return this.tx(async (tx) => {
      const handoff = input.handoffRequestId
        ? await lockHandoffRequest(tx, input.handoffRequestId)
        : null;
      const [existing] = await tx
        .select({
          organizationId: organizations.id,
          accountId: organizations.accountId,
          legalName: accounts.legalName,
          side: organizations.side,
        })
        .from(organizations)
        .innerJoin(accounts, eq(accounts.id, organizations.accountId))
        .where(eq(organizations.id, input.id));
      if (existing) {
        if (handoff && handoff.organizationId !== existing.organizationId)
          throw new Error("ONBOARDING_ORGANIZATION_EXISTS");
        return { ...existing, side: existing.side as OnboardingSide };
      }
      if (handoff) {
        if (handoff.organizationId)
          throw new Error("ONBOARDING_HANDOFF_ALREADY_HAS_ORGANIZATION");
        if (handoff.status !== "in_progress")
          throw new Error("ONBOARDING_HANDOFF_NOT_IN_PROGRESS");
        if (!sideFits(input.side, handoff.requestedSide))
          throw new Error("ONBOARDING_HANDOFF_SIDE_MISMATCH");
      }
      // Commerce keeps one account per legal entity in a country and one per
      // business domain. Names compare as registration compares them
      // (NFKC, case, punctuation and company suffixes), so "ACME Inc" and
      // "Acme, Inc." are the same entity; say which rule refused.
      const [domainTaken] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.domain, input.domain))
        .limit(1);
      if (domainTaken) throw new Error("ONBOARDING_DOMAIN_TAKEN");
      const name = normalizeLegalName(input.legalName);
      const sameCountry = await tx
        .select({ legalName: accounts.legalName })
        .from(accounts)
        .where(eq(accounts.country, input.country));
      if (sameCountry.some((row) => normalizeLegalName(row.legalName) === name))
        throw new Error("ONBOARDING_ACCOUNT_EXISTS");
      const { account, organization } = await insertAccountWithOrganization(
        tx,
        {
          organizationId: input.id,
          side: input.side,
          account: {
            legalName: input.legalName,
            ...sideRelationship(input.side, input.channelAgreementType),
            registeredAddress: {
              ...input.registeredAddress,
              country: input.country,
            },
            taxIds: [],
            billingContact: input.billingContact,
            apContact: {},
            invoiceDeliveryEmail: input.invoiceDeliveryEmail,
            domain: input.domain,
            country: input.country,
            currency: input.currency,
            // Restricted until screening records evidence, as registration is.
            screeningStatus: "review",
          },
        },
      );
      const requestId = randomUUID();
      await appendAuditAndOutbox(tx, {
        accountId: account.id,
        aggregateType: "organization",
        aggregateId: organization.id,
        aggregateVersion: organization.rowVersion,
        eventType: "organization.created",
        actor,
        requestId,
        after: {
          organizationId: organization.id,
          accountId: account.id,
          legalName: account.legalName,
          side: organization.side,
          partnerAgreementType: account.partnerAgreementType,
          handoffRequestId: input.handoffRequestId,
          createdBy: "staff",
        },
      });
      if (handoff) {
        const [recorded] = await tx
          .update(handoffRequests)
          .set({
            organizationId: organization.id,
            updatedAt: sql`now()`,
            version: handoff.version + 1,
          })
          .where(eq(handoffRequests.id, handoff.id))
          .returning();
        if (!recorded) throw new Error("HANDOFF_UPDATE_FAILED");
        await auditHandoffRequest(
          tx,
          recorded,
          actor,
          "handoff.organization_recorded",
        );
      }
      return {
        organizationId: organization.id,
        accountId: account.id,
        legalName: account.legalName,
        side: input.side,
      };
    });
  }

  /** Customer and partner organizations, newest first. */
  list(limit = 200): Promise<OnboardingOrganizationSummary[]> {
    return this.tx(async (tx) =>
      (
        await tx
          .select({ organization: organizations, account: accounts })
          .from(organizations)
          .innerJoin(accounts, eq(accounts.id, organizations.accountId))
          .where(ne(organizations.side, "fil_one"))
          .orderBy(desc(organizations.createdAt), desc(organizations.id))
          .limit(limit)
      ).map(({ organization, account }) => summary(organization, account)),
    );
  }

  /** One customer or partner organization with its people. */
  get(organizationId: string): Promise<OnboardingOrganizationDetail> {
    return this.tx(async (tx) => {
      const [row] = await tx
        .select({ organization: organizations, account: accounts })
        .from(organizations)
        .innerJoin(accounts, eq(accounts.id, organizations.accountId))
        .where(eq(organizations.id, organizationId));
      if (!row || row.organization.side === "fil_one")
        throw new Error("ONBOARDING_ORGANIZATION_NOT_FOUND");
      const people = await tx
        .select({
          userId: commerceUsers.id,
          name: commerceUsers.name,
          email: commerceUsers.email,
          role: memberships.role,
          addedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(commerceUsers, eq(commerceUsers.id, memberships.userId))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(asc(memberships.createdAt));
      const handoffs = await tx
        .select({ id: handoffRequests.id })
        .from(handoffRequests)
        .where(eq(handoffRequests.organizationId, organizationId));
      const contact = row.account.billingContact as {
        name?: unknown;
        email?: unknown;
      };
      return {
        ...summary(row.organization, row.account),
        billingContact: {
          name: typeof contact.name === "string" ? contact.name : "",
          email: typeof contact.email === "string" ? contact.email : "",
        },
        partnerAgreementType: row.account.partnerAgreementType,
        members: people.map((person) => ({
          ...person,
          addedAt: person.addedAt.toISOString(),
        })),
        handoffRequestIds: handoffs.map(({ id }) => id),
      };
    });
  }
}

function summary(
  organization: typeof organizations.$inferSelect,
  account: typeof accounts.$inferSelect,
): OnboardingOrganizationSummary {
  return {
    organizationId: organization.id,
    accountId: account.id,
    legalName: account.legalName,
    side: organization.side as OrganizationSide,
    country: account.country,
    currency: account.currency,
    domain: account.domain,
    screeningStatus: account.screeningStatus,
    identityProviderLinked: organization.workosOrganizationId !== null,
    createdAt: organization.createdAt.toISOString(),
  };
}
