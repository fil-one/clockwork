import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="queues"
      recordKey={id}
      title="Queue record"
      description="Review source freshness, evidence, and the version-bound next task."
    />
  );
}
