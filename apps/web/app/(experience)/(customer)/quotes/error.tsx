"use client";

import { CommercialErrorState } from "@/src/features/customer-partner/commercial/collection-page";

export default function Error({ reset }: { reset: () => void }) {
  return <CommercialErrorState retry={reset} />;
}
