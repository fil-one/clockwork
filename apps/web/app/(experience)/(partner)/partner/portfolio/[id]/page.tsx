import { PartnerPortfolioDetail } from "@/src/features/customer-partner/partner/partner-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartnerPortfolioDetail id={id} />;
}
