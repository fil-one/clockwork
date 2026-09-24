import {
  OffboardingWorkflow,
  type OffboardableService,
} from "@/src/features/customer-partner/commercial/offboarding";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import {
  firstSearchParam,
  type RawSearchParams,
} from "@/src/features/customer-partner/commercial/url-state";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import type { Translator } from "@/src/i18n";
import { getTranslations } from "@/src/i18n/server";
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

function offboardableService(
  record: ProjectionRecord,
  t: Translator,
): OffboardableService {
  const name = text(record.data, "title") ?? record.recordKey;
  const term = text(record.data, "term");
  return {
    id: record.aggregateId,
    reference: record.recordKey,
    name,
    label: term ? t("common.join.labels", { first: name, second: term }) : name,
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
  const [t, identity, orders, services] = await Promise.all([
    getTranslations(),
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
  const selectedOrderId = selected ?? open[0]?.aggregateId;
  const selectedRecord = open.find(
    (record) => record.aggregateId === selectedOrderId,
  );
  return (
    <OffboardingWorkflow
      account={{ id: identity.accountId, name: identity.accountName }}
      services={open.map((record) => offboardableService(record, t))}
      {...(selectedOrderId ? { selectedServiceId: selectedOrderId } : {})}
      {...(demoDeployIdentityEnabled(process.env) && selectedRecord
        ? {
            demoProjection: {
              projectionId: selectedRecord.id,
              recordKey: selectedRecord.recordKey,
              version: selectedRecord.version,
            },
          }
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
      requiredPermission="account:write"
    >
      <OffboardingSurface params={params} />
    </SurfacePermissionGate>
  );
}
