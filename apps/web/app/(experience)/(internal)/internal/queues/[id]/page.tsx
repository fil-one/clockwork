import type { Metadata } from "next";

import { OwnerConsoleRepository } from "@clockwork/db";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { getRequestCommerceSession } from "@/src/auth/session";
import { getOptionalServiceDatabase } from "@/src/db/service";
import { queueLabels } from "@/src/features/internal-ops/queue-search/copy";
import { mayApproveOwnRequests } from "@/src/features/internal-ops/self-approval/model";
import { OwnExceptionApproval } from "@/src/features/internal-ops/self-approval/own-exception-approval";
import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";
import { getTranslations } from "@/src/i18n/server";
import { withStaffPermission } from "@/src/features/shell/staff-access";

/**
 * The case and how to word it, when the reader raised it, may approve their
 * own requests, and it is still open. Null otherwise, or when it cannot be
 * read: the ordinary decision form is there either way.
 */
async function ownOpenCase(
  caseId: string | undefined,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Promise<{ caseId: string; subject: string } | null> {
  if (!caseId) return null;
  const session = await getRequestCommerceSession();
  const database = getOptionalServiceDatabase();
  if (!session.providerBacked || !database || !mayApproveOwnRequests(session))
    return null;
  try {
    const facts = await new OwnerConsoleRepository(database).exceptionRequest({
      caseId,
      requestId: `queue-self-approval:${crypto.randomUUID()}`,
    });
    if (!facts || facts.status !== "open") return null;
    if (facts.requesterUserId !== session.userId) return null;
    const queue = queueLabels[facts.queue];
    return {
      caseId,
      subject: t("operations.owner.approvals.subject.exception", {
        queue: queue ? t(queue) : facts.queue,
        name: facts.accountName ?? t("operations.owner.event.unknownSubject"),
      }),
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.queueRecord.title") };
}

async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  // The queues channel projects the `exception_case` aggregate, so the record
  // this page opened *is* the case `POST /v1/lifecycle/exceptions/{caseId}/
  // decisions` decides. The reference in the URL is the projection's record
  // key, not the case identifier, and the case identifier appears nowhere an
  // operator can read it.
  const queues = await loadPortalRecords("internal", "queues");
  const record = queues.records.find((candidate) => candidate.recordKey === id);
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  const own = guidedDemo ? null : await ownOpenCase(record?.aggregateId, t);
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="queues"
      recordKey={id}
      title={t("operations.queueRecord.title")}
      description={t("operations.queueRecord.description")}
      {...(!guidedDemo && record
        ? {
            actions: (
              <SurfaceActionGate
                audience="internal"
                requiredPermission="system:operate"
              >
                {own ? (
                  <OwnExceptionApproval
                    caseId={own.caseId}
                    subject={own.subject}
                  />
                ) : null}
                <WorkflowPanel
                  context={
                    record?.aggregateId ? { caseId: record.aggregateId } : {}
                  }
                  workflow="approval"
                  surface="queues"
                />
              </SurfaceActionGate>
            ),
          }
        : {})}
    />
  );
}

export default withStaffPermission("operations:read", Page);
