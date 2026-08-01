import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="queues"
      title="Operational queues"
      description="Work the next authorized task from freshness-labeled projections."
    />
  );
}
