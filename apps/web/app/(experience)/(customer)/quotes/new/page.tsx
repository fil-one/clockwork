import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default function Page() {
  return (
    <ProjectionDetailPage
      audience="customer"
      channel="quotes"
      title="Quote workspace"
      description="Choose the authorized commercial record that should produce a new quote task."
    />
  );
}
