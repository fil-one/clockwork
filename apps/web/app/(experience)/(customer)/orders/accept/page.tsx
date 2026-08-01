import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
export default function Page() {
  return (
    <ProjectionDetailPage
      audience="customer"
      channel="orders"
      title="Order acceptance"
      description="Review the persisted order and optimistic version before acceptance."
    />
  );
}
