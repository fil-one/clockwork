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
): Promise<ExecutableAgreement | undefined> {
  if (!reference) return undefined;
  const { records } = await loadPortalRecords("customer", "agreements");
  const record = records.find((item) => item.recordKey === reference);
  if (!record) return undefined;
  const state = authoritative(record.data);
  return {
    reference,
    title: text(record.data, "title") ?? reference,
    jurisdiction: text(state, "jurisdiction") ?? "US",
    type: text(state, "type") ?? "csa",
  };
}

async function AgreementWorkspace({ params }: { params: RawSearchParams }) {
  const [identity, agreement] = await Promise.all([
    getRouteIdentity("customer"),
    resolveAgreement(firstSearchParam(params, "agreement")),
  ]);
  return (
    <AgreementAcceptance
      account={{ id: identity.accountId, name: identity.accountName }}
      {...(agreement ? { agreement } : {})}
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
