"use server";

import { hasPermission } from "@clockwork/contracts";

import { getCommerceSession } from "@/src/auth/session";
import type {
  BuyQuoteProjectionLookup,
  PreparedQuoteArtifactLookup,
} from "@/src/features/customer-partner/commercial/prepared-quote-artifact";
import {
  loadBuyQuoteProjection,
  loadPreparedQuoteArtifact,
} from "@/src/features/experience-server/portal-view-loader";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function mayWriteQuotes(): Promise<boolean> {
  const session = await getCommerceSession();
  return session.roles.some((role) => hasPermission(role, "quote:write"));
}

export async function lookupPreparedQuoteArtifact(
  quoteId: string,
): Promise<PreparedQuoteArtifactLookup> {
  if (typeof quoteId !== "string" || !uuidPattern.test(quoteId))
    return { status: "unavailable" };
  if (!(await mayWriteQuotes())) return { status: "forbidden" };
  return loadPreparedQuoteArtifact(quoteId);
}

export async function lookupBuyQuoteProjection(
  quoteId: string,
): Promise<BuyQuoteProjectionLookup> {
  if (typeof quoteId !== "string" || !uuidPattern.test(quoteId))
    return { status: "unavailable" };
  if (!(await mayWriteQuotes())) return { status: "forbidden" };
  return loadBuyQuoteProjection(quoteId);
}
