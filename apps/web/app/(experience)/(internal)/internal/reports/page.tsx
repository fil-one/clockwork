import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="reports"
      title="Reports"
      description="Inspect generated report requests and immutable output status."
    />
  );
}
