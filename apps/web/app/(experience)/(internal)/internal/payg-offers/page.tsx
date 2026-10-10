import { contextHasPermission } from "@clockwork/contracts";
import type { Metadata } from "next";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import {
  DemoCommercialPolicyRepository,
  localizeDemoPaygPolicy,
} from "@/src/features/internal-ops/commercial-policies/demo-policies";
import { DatabasePaygOfferRepository } from "@clockwork/db";
import type { PaygOfferRecord } from "@clockwork/domain/core";
import { getLocale, getTranslations } from "@/src/i18n/server";

import { getOptionalServiceDatabase } from "@/src/db/service";
import { getRequestCommerceSession } from "@/src/auth/session";
import { PaygOfferAdministration } from "@/src/features/internal-ops/administration-safety/payg-offers";
import { withStaffPermission } from "@/src/features/shell/staff-access";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("adminPricing.payg.title") };
}

async function Page() {
  const session = await getRequestCommerceSession();
  if (!session.isInternalStaff)
    throw new Error("Internal staff authority is required"); // i18n-exempt: server-side guard; Next.js masks thrown server errors and the shell shows its own translated error page
  const database = getOptionalServiceDatabase();
  let offers: PaygOfferRecord[] = [];
  let available = false;
  const demo = demoDeployIdentityEnabled(process.env);
  const financeAuthority = contextHasPermission(session, "quote:approve");
  if (demo && financeAuthority) {
    // Demo-authored policy text is shown in the reader's language.
    const locale = await getLocale();
    offers = (await new DemoCommercialPolicyRepository().listPayg()).map(
      (offer) => localizeDemoPaygPolicy(offer, locale),
    );
    available = true;
  }
  if (!demo && database && session.providerBacked && financeAuthority) {
    try {
      offers = await new DatabasePaygOfferRepository(database).list();
      available = true;
    } catch {
      /* An unavailable authoritative service never becomes a fixture. */
    }
  }
  return (
    <PaygOfferAdministration
      demo={demo}
      permissions={session.permissions}
      userId={session.userId}
      offers={offers}
      available={available}
    />
  );
}

export default withStaffPermission("operations:read", Page);
