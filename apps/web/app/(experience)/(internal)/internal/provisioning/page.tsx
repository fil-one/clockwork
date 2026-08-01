import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="provisioning"
      title="Provisioning recovery"
      description="Review provider state and idempotency evidence before recovery."
    />
  );
}
