import { InternalProjectionPage } from "@/src/features/experience-server/internal-projection-page";

export default function Page() {
  return (
    <InternalProjectionPage
      channel="agreements"
      title="Agreement administration"
      description="Review canonical agreement versions and their authorized next task."
    />
  );
}
