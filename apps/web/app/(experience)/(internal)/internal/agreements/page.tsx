import { AgreementAdministration } from "@/src/features/internal-ops/administration-safety/agreements";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { getRouteRoles } from "@/src/features/shell/route-session";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";

export default async function Page() {
  return (
    <AgreementAdministration
      roles={await getRouteRoles("internal")}
      publishAction={
        <SurfaceActionGate
          audience="internal"
          requiredPermission="agreement:approve"
        >
          {/*
           * Publishing a template creates a record rather than acting on one:
           * the type, version, jurisdiction, canonical document and approved
           * text are all counsel's answers, and there is no record identity for
           * the route to resolve. The empty context is the statement of that.
           */}
          <WorkflowPanel
            context={{}}
            workflow="agreementAdmin"
            surface="agreementAdmin"
          />
        </SurfaceActionGate>
      }
    />
  );
}
