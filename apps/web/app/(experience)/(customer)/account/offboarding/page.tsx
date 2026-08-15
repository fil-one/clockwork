import {
  OffboardingWorkflow,
  type OffboardableService,
} from "@/src/features/customer-partner/commercial/offboarding";
import {
  firstSearchParam,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { SurfacePermissionGate } from "@/src/features/shell/permission-gate";
import { getRouteIdentity } from "@/src/features/shell/route-session";

import { requestedOrderAggregateId } from "./select-service";

const closedStatuses = ["completed", "cancelled", "canceled", "terminated"];

function text(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function offboardableService(record: ProjectionRecord): OffboardableService {
  const name = text(record.data, "title") ?? record.recordKey;
  const term = text(record.data, "term");
  return {
    id: record.aggregateId,
    reference: record.recordKey,
    name,
    label: term ? `${name} · ${term}` : name,
  };
}

/**
 * The list is the customer's open orders, which is what the offboarding
 * command is scoped to. The second read is the `services` channel and happens
 * only when a `?service=` reference has to be resolved against it; with no
 * parameter this surface still makes exactly one projection read.
 */
async function OffboardingSurface({ params }: { params: RawSearchParams }) {
  const requested = firstSearchParam(params, "service");
  const [identity, orders, services] = await Promise.all([
    getRouteIdentity("customer"),
    loadPortalRecords("customer", "orders"),
    requested
      ? loadPortalRecords("customer", "services")
      : Promise.resolve(null),
  ]);
  const open = orders.records.filter(
    (record) => !closedStatuses.includes(text(record.data, "status") ?? ""),
  );
  const selected = requestedOrderAggregateId(
    requested,
    open,
    services?.records ?? [],
  );
  return (
    <OffboardingWorkflow
      account={{ id: identity.accountId, name: identity.accountName }}
      services={open.map(offboardableService)}
      {...(selected ? { selectedServiceId: selected } : {})}
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
      requiredPermission="account:write"
    >
      <OffboardingSurface params={params} />
    </SurfacePermissionGate>
  );
}
