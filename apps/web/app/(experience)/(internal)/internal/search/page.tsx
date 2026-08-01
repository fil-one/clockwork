import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default function Page() {
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="queues"
      title="Scoped operational search"
      description="Only session-authorized projections are searchable in this experience."
    />
  );
}
