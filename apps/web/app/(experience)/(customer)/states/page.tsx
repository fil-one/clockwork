import { notFound } from "next/navigation";

import { StateGallery } from "@/src/features/states/state-gallery";

/**
 * The gallery is a design reference for every application state, not a customer
 * destination: its panels are specimens and its buttons record no decision. It
 * stays on the reviewed `/states` route that the visual qualification and the
 * state contract both name, and a production runtime has no route for it.
 */
function designReferenceAvailable(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_CLOCKWORK_RUNTIME_ENV?.trim().toLowerCase() !==
      "production"
  );
}

export default function Page() {
  if (!designReferenceAvailable()) notFound();
  return <StateGallery />;
}
