import type { Role } from "@clockwork/contracts";

import { getFormattingLocale, getTranslations } from "@/src/i18n/server";
import {
  AccountOverview,
  type AccountOverviewProjection,
} from "@/src/features/customer-partner/customer/account-overview";
import { loadAccountOverviewAccount } from "@/src/features/customer-partner/customer/account-overview-loader";
import {
  collectionMemberCounts,
  collectionMemberRole,
} from "@/src/features/customer-partner/customer/collection-record";
import { demoDeployIdentityEnabled } from "@/src/auth/demo-deploy";
import type { ProjectionRecord } from "@/src/features/experience-server/model";
import { loadPortalRecords } from "@/src/features/experience-server/portal-view-loader";
import type { MessageId, Translator } from "@/src/i18n";
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
  role: "owner" | "billing",
  t: Translator,
): string {
  const match = records.find(
    (record) => collectionMemberRole(record.data) === role,
  );
  return match
    ? (text(match.data, "title") ?? t("common.notRecorded"))
    : t("common.notRecorded");
}

const roleLabels: Readonly<Record<Role, MessageId>> = {
  owner: "role.owner",
  admin: "role.admin",
  billing: "role.billing",
  member: "role.member",
  partner_admin: "role.partnerAdmin",
  partner_seller: "role.partnerSeller",
  internal_operator: "role.internalOperator",
  finance_approver: "role.financeApprover",
  legal_approver: "role.legalApprover",
  destructive_action_approver: "role.destructiveActionApprover",
};

/** The acting role as a label; an unknown role is shown as its code. */
function roleLabel(role: string, t: Translator): string {
  const id = (roleLabels as Readonly<Record<string, MessageId>>)[role];
  return id ? t(id) : role;
}

async function AccountWorkspace() {
  const t = await getTranslations();
  const count = new Intl.NumberFormat(await getFormattingLocale());
  const [identity, roles, users, procurement] = await Promise.all([
    getRouteIdentity("customer"),
    getRouteRoles("customer"),
    loadPortalRecords("customer", "users"),
    loadPortalRecords("customer", "procurement"),
  ]);
  const { withAccess, invitations } = collectionMemberCounts(users.records);
  const account = await loadAccountOverviewAccount({
    accountId: identity.accountId,
    identityAccountName: identity.accountName,
    guidedDemo: demoDeployIdentityEnabled(process.env),
  });
  const projection: AccountOverviewProjection = {
    accountName: account.accountName,
    organizationName: identity.organizationName,
    roleLabel: roleLabel(identity.role, t),
    facts: [
      {
        label: t("role.owner"),
        value: personNamed(users.records, "owner", t),
      },
      {
        label: t("customer.account.fact.billingContact"),
        value:
          account.billingContact ?? personNamed(users.records, "billing", t),
      },
      ...(account.invoiceDeliveryEmail
        ? [
            {
              label: t("customer.collection.field.invoiceDelivery"),
              value: account.invoiceDeliveryEmail,
            },
          ]
        : []),
      {
        label: t("customer.account.fact.people"),
        value: count.format(withAccess),
      },
      {
        label: t("customer.account.fact.invitations"),
        value: count.format(invitations),
      },
    ],
    areaMeta: {
      users: t("customer.account.areas.users.meta", {
        count: withAccess,
      }),
      procurement: t("customer.account.areas.procurement.meta", {
        count: procurement.records.length,
      }),
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
