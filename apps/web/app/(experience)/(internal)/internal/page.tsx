import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="dashboard"
      title="Operator home"
      description="Choose the highest-priority authorized task from current system projections."
    />
  );
}
