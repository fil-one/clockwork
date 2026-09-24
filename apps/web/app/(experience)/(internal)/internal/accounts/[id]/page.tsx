import type { Metadata } from "next";
import Link from "next/link";

import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import { AccountDerivationSection } from "@/src/features/experience-server/account-derivation-section";
import { ProjectionDetailPage } from "@/src/features/experience-server/projection-detail-page";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfaceActionGate } from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";
import { getTranslations } from "@/src/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("operations.account.title") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getTranslations();
  // A report run from an account's page is a report about that account. The
  // internal `dashboard` channel projects the `account` aggregate, so the
  // record opened here supplies the account the report is scoped to; the
  // report's account filter is otherwise a UUID an operator would have to
  // fetch from somewhere else and paste back in.
  const accounts = await loadPortalRecords("internal", "dashboard");
  const record = accounts.records.find(
    (candidate) => candidate.recordKey === id,
  );
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  return (
    <ProjectionDetailPage
      audience="internal"
      channel="dashboard"
      recordKey={id}
      title={t("operations.account.title")}
      description={t("operations.account.description")}
      actions={
        <SurfaceActionGate audience="internal" requiredPermission="report:read">
          {guidedDemo ? (
            <Link href="/internal/reports">
              {t("operations.account.openReports")}
            </Link>
          ) : (
            <WorkflowPanel
              context={
                record?.aggregateId ? { accountId: record.aggregateId } : {}
              }
              workflow="reports"
              surface="reports"
            />
          )}
        </SurfaceActionGate>
      }
      supporting={<AccountDerivationSection recordKey={id} />}
    />
  );
}
