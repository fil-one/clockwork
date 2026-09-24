import {
  PartnerCollectionRoute,
  partnerSurfaceMetadata,
} from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () => partnerSurfaceMetadata("quotes");
export default function Page() {
  return <PartnerCollectionRoute surface="quotes" />;
}
