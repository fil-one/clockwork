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
      channel="quotes"
      recordKey={id}
      title="Partner quote"
      description="Transfer and resale truth from the scoped quote projection."
    />
  );
}
