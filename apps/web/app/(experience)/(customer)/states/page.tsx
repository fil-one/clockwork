import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default function Page() {
  return (
    <ProjectionDetailPage
      audience="customer"
      channel="dashboard"
      title="Experience states"
      description="Current authorized source state, including empty and stale conditions."
    />
  );
}
