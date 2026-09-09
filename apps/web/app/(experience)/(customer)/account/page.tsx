import { getTranslations } from "@/src/i18n/server";
import {
  AccountOverview,
  type AccountOverviewProjection,
} from "@/src/features/customer-partner/customer/account-overview";
import { loadAccountOverviewAccount } from "@/src/features/customer-partner/customer/account-overview-loader";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import { plural, t as englishTranslator } from "@/src/i18n/en";
import {
  SurfaceActionGate,
  SurfacePermissionGate,
} from "@/src/features/shell/permission-gate";
import { WorkflowPanel } from "@/src/features/surfaces/workflow-panel";
import {
  getRouteIdentity,
  getRouteRoles,
} from "@/src/features/shell/route-session";

function text(
  data: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function personNamed(
  records: readonly ProjectionRecord[],
  pattern: RegExp,
  t = englishTranslator,
): string {
  const match = records.find((record) =>
    pattern.test(text(record.data, "value") ?? ""),
  );
  return match
    ? (text(match.data, "title") ?? t("account.unassigned"))
    : t("account.unassigned");
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

async function AccountWorkspace() {
  const t = await getTranslations();
  const [identity, roles, users, procurement] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteRoles("customer"),
    loadPortalRecords("customer", "users"),
    loadPortalRecords("customer", "procurement"),
  ]);
  const invitations = users.records.filter(
    (record) => text(record.data, "status") === "pending",
  ).length;
  const account = await loadAccountOverviewAccount({
    accountId: identity.accountId,
    identityAccountName: identity.accountName,
    guidedDemo: demoDeployIdentityEnabled(process.env),
  });
  const projection: AccountOverviewProjection = {
    accountName: account.accountName,
    organizationName: identity.organizationName,
    roleLabel: titleCase(identity.role),
    facts: [
      {
        label: t("account.owner"),
        value: personNamed(users.records, /owner/iu, t),
      },
      {
        label: t("account.billingContact"),
        value:
          account.billingContact ?? personNamed(users.records, /billing/iu, t),
      },
      ...(account.invoiceDeliveryEmail
        ? [
            {
              label: "Invoice delivery",
              value: account.invoiceDeliveryEmail,
            },
          ]
        : []),
      {
        label: t("account.people"),
        value: String(users.records.length),
      },
      { label: t("account.invitations"), value: String(invitations) },
    ],
    areaMeta: {
      users: plural(
        users.records.length,
        t("account.areas.users.meta.one"),
        t("account.areas.users.meta.other"),
      ),
      procurement: plural(
        procurement.records.length,
        t("account.areas.procurement.meta.one"),
        t("account.areas.procurement.meta.other"),
      ),
    },
  };
  return (
    <AccountOverview
      actions={
        <SurfaceActionGate
          audience="customer"
          requiredPermission="account:write"
        >
          <WorkflowPanel
            context={{ accountId: identity.accountId }}
            workflow="account"
            surface="account"
          />
        </SurfaceActionGate>
      }
      canManageAccount={roles.some(
        (role) => role === "owner" || role === "admin",
      )}
      projection={projection}
    />
  );
}

export default function Page() {
  return (
    <SurfacePermissionGate
      audience="customer"
      requiredPermission="account:read"
    >
      <AccountWorkspace />
    </SurfacePermissionGate>
  );
}
