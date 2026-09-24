import {
  PartnerCollectionRoute,
  partnerSurfaceMetadata,
} from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () => partnerSurfaceMetadata("disputes");
export default function Page() {
  return <PartnerCollectionRoute surface="disputes" />;
}
