import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <ProjectionDetailPage
      audience="partner"
      channel="portfolio"
      recordKey={id}
      title="End-client portfolio record"
      description="Private partner and end-client data remain bound to this authorized projection."
    />
  );
}
