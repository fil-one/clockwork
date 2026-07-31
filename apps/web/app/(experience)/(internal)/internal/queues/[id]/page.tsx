import { RecordDetailPage } from "@/src/features/surfaces/record-detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RecordDetailPage id={id} backHref="/internal/queues" />;
}
