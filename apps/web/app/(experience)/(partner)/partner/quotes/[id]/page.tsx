import { PartnerQuoteDetail } from "@/src/features/customer-partner/partner/partner-detail";
import { partnerPageMetadata } from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () =>
  partnerPageMetadata("partner.detail.quote.eyebrow");
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartnerQuoteDetail id={id} />;
}
