import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="approvals"
      title="Approval decisions"
      description="Review evidence and segregated authority before recording a decision."
    />
  );
}
