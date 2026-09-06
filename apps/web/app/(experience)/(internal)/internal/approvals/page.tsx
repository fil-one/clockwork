import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="approvals"
      title="Approval decisions"
      description="Record an authorized approval or rejection against the latest persisted case evidence."
    />
  );
}
