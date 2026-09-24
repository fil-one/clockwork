import {
  PartnerCollectionRoute,
  partnerSurfaceMetadata,
} from "@/src/features/customer-partner/partner/partner-route";

export const generateMetadata = () => partnerSurfaceMetadata("billing");
export default function Page() {
  return <PartnerCollectionRoute surface="billing" />;
}
