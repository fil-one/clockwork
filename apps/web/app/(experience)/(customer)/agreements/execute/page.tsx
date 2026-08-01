import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default function Page() {
  return (
    <ProjectionDetailPage
      audience="customer"
      channel="agreements"
      title="Choose an agreement"
      description="Execution starts only from a persisted, authorized agreement version."
    />
  );
}
