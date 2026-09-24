import { notFound, redirect } from "next/navigation";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { configuredDemoStateStore } from "@/src/features/experience-server/demo-state-store";
import { isStoredQuote } from "@/src/features/customer-partner/partner/demo-partner-quote";
import type { QuoteSnapshot } from "@clockwork/domain/core";
import { OrderAcceptance } from "@/src/features/customer-partner/commercial/order-acceptance";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";
import { formatMoney } from "@/src/features/shared/format";
import { partnerQuoteLinesText } from "@/src/features/customer-partner/partner/partner-presentation";
import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import { partnerPageMetadata } from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () =>
  partnerPageMetadata("partner.orders.supplyOrder");
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!demoDeployIdentityEnabled(process.env)) notFound();
  const { id } = await params;
  const identity = await getRouteIdentity("partner");
  const t = await getTranslations();
  const formattingLocale = await getFormattingLocale();
  const state = await configuredDemoStateStore().read();
  const stored =
    state.projectionOverrides[
      `demo-partner-quote:${id.replace(/^quote-/u, "")}`
    ]?.data;
  if (!isStoredQuote(stored) || stored.partnerAccountId !== identity.accountId)
    notFound();
  if (stored.orderId) redirect(`/partner/orders/${stored.orderId}`);
  if (stored.record.status !== "open") notFound();
  const quote = stored.snapshot as unknown as QuoteSnapshot;
  return (
    <SurfacePermissionGate audience="partner" requiredPermission="order:write">
      <OrderAcceptance
        audience="partner"
        account={{ id: identity.accountId, name: identity.accountName }}
        signerUserId={identity.userId}
        quote={{
          id: quote.id,
          lineCount: quote.lines.length,
          reference: `PQ-${quote.id.slice(-12).toUpperCase()}`,
          title: stored.record.name,
          version: String(quote.revision),
          scope: partnerQuoteLinesText(quote.lines, t, formattingLocale),
          spend: formatMoney(
            quote.total.minor,
            quote.total.currency,
            formattingLocale,
          ),
          acceptedLabel: t("partner.order.issuedTransferQuote"),
        }}
        agreement={{
          title: t("partner.order.demoAgreement", {
            partner: identity.accountName,
          }),
          version: "1",
        }}
      />
    </SurfacePermissionGate>
  );
}
