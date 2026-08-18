import {
  AgreementAcceptance,
  type ExecutableAgreement,
} from "@/src/features/customer-partner/commercial/agreement-acceptance";
import {
  firstSearchParam,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

type Data = Readonly<Record<string, unknown>>;

function text(data: Data, key: string): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function authoritative(data: Data): Data {
  const value = data.authoritative;
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}

async function resolveAgreement(
  reference: string | undefined,
  guidedDemo: boolean,
): Promise<ExecutableAgreement | undefined> {
  if (!reference && !guidedDemo) return undefined;
  const { records } = await loadPortalRecords("customer", "agreements");
  const record = reference
    ? records.find((item) => item.recordKey === reference)
    : records.find(
        (item) =>
          Array.isArray(item.data.allowedActions) &&
          item.data.allowedActions.includes("execute_agreement"),
      );
  if (!record) return undefined;
  const state = authoritative(record.data);
  return {
    reference: record.recordKey,
    title: text(record.data, "title") ?? record.recordKey,
    jurisdiction: text(state, "jurisdiction") ?? "US",
    type: text(state, "type") ?? "csa",
    ...(guidedDemo
      ? {
          demoProjection: {
            projectionId: record.id,
            recordKey: record.recordKey,
            version: record.version,
          },
        }
      : {}),
  };
}

function demoTemplate(agreement: ExecutableAgreement): ActiveAgreementTemplate {
  const exactText = `${agreement.title}. The customer accepts the approved Fil One service terms, incorporated policies, order-specific commitments, and documented renewal and offboarding controls.`;
  return {
    id: "71000000-0000-4000-8000-000000000001",
    type: agreement.type,
    semanticVersion: "3.2.0",
    jurisdiction: agreement.jurisdiction,
    effectiveOn: "2026-07-01",
    canonicalDocumentId: "71000000-0000-4000-8000-000000000002",
    exactText,
    exactTextHash: createHash("sha256").update(exactText).digest("hex"),
    executionMode: "click_through",
  };
}

async function AgreementWorkspace({ params }: { params: RawSearchParams }) {
  const guidedDemo = demoDeployIdentityEnabled(process.env);
  const [identity, agreement] = await Promise.all([
    getRouteIdentity("customer"),
    resolveAgreement(firstSearchParam(params, "agreement"), guidedDemo),
  ]);
  return (
    <AgreementAcceptance
      account={{ id: identity.accountId, name: identity.accountName }}
      {...(agreement ? { agreement } : {})}
      {...(guidedDemo && agreement
        ? { demoTemplate: demoTemplate(agreement) }
        : {})}
    />
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="agreement:execute"
    >
      <AgreementWorkspace params={params} />
    </SurfacePermissionGate>
  );
}
import { createHash } from "node:crypto";

import type { ActiveAgreementTemplate } from "@/src/features/contracts/commerce-client";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
