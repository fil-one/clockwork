import { EmptyState } from "@clockwork/ui";

export default function ChooseOrganizationPage() {
  return (
    <main className="app-shell">
      <EmptyState
        title="Choose an organization"
        description="Select an organization in WorkOS AuthKit. Local development uses the deterministic Northstar organization."
      />
    </main>
  );
}
