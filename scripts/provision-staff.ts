import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  assertStaffAdministratorRemains,
  assertStaffProvisioningTarget,
  planStaffProvisioning,
  staffEmailDomainAllowed,
  staffProvisioningFailureCode,
  StaffProvisioningSchema,
  type ExistingStaffIdentityRow,
  type StaffProvisioningManifest,
} from "../packages/contracts/src/staff-provisioning";
import postgres from "postgres";
import { provisionWorkosStaff } from "../packages/integrations/src/workos/provision-staff";

let phase = "configuration";
export async function provisionStaff(
  environment: NodeJS.ProcessEnv = process.env,
  provisionIdentity: typeof provisionWorkosStaff = provisionWorkosStaff,
) {
  const raw = environment.STAFF_PROVISIONING;
  if (!raw) return;
  const person = StaffProvisioningSchema.parse(JSON.parse(raw));
  const manifest = JSON.parse(
    environment.BOOTSTRAP_MANIFEST ?? "null",
  ) as StaffProvisioningManifest | null;
  const url = environment.DIRECT_DATABASE_URL,
    key = environment.WORKOS_API_KEY;
  if (!manifest || !url || !key)
    throw new Error("STAFF_PROVISIONING_CONFIGURATION_REQUIRED");
  assertStaffProvisioningTarget({
    manifest,
    databaseHost: new URL(url).hostname,
    deployStage: environment.DEPLOY_STAGE,
  });
  if (
    !staffEmailDomainAllowed(person.email, environment.INTERNAL_EMAIL_DOMAINS)
  )
    throw new Error("STAFF_PROVISIONING_DOMAIN_DENIED");
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: new URL(url).hostname === "127.0.0.1" ? false : "require",
  });
  try {
    phase = "scope";
    // Fail before provider changes unless the bootstrapped staff organization
    // and authorizing operator both exist in this exact deployed database. The
    // operator holds operations:write: an operator or a commerce administrator.
    const scope =
      await client`select o.id from organizations o join memberships m on m.organization_id=o.id join commerce_users u on u.id=m.user_id where o.id=${manifest.organization.id} and o.workos_organization_id=${manifest.organization.workosOrganizationId} and u.id=${manifest.operatorUserId} and u.is_internal_staff and public.member_has_permission(u.id, 'operations:write', o.id)`;
    if (scope.length !== 1)
      throw new Error("STAFF_PROVISIONING_SCOPE_MISMATCH");
    console.log("staff provisioning: environment and operator scope verified");
    phase = "identity";
    const existing = await client<
      ExistingStaffIdentityRow[]
    >`select u.id,u.workos_user_id,u.is_internal_staff,m.role,m.organization_id from commerce_users u left join memberships m on m.user_id=u.id where lower(u.email)=${person.email}`;
    const plan = planStaffProvisioning({
      existing,
      person,
      organizationId: manifest.organization.id,
    });
    console.log("staff provisioning: identity plan", { plan: plan.kind });
    phase = "workos";
    const binding = await provisionIdentity(
      key,
      manifest.organization.workosOrganizationId,
      person,
    );
    phase = "binding";
    if (plan.kind !== "create" && plan.workosUserId !== binding.workosUserId)
      throw new Error("STAFF_PROVISIONING_BINDING_CONFLICT");
    if (plan.kind === "verify") {
      console.log("staff provisioning: existing identity and role verified");
      return;
    }
    const actor = { kind: "user", id: manifest.operatorUserId };
    const appendEvent = async (
      tx: postgres.TransactionSql,
      membership: { id: string; row_version: number },
      eventType: string,
      after: Record<string, string | boolean>,
      before?: Record<string, string | boolean>,
    ) => {
      const eventId = randomUUID();
      const associatedAfter = {
        ...after,
        organizationId: manifest.organization.id,
      };
      // Staff changes share Team's membership stream and its persisted version.
      // Organization version 1 may already belong to an unrelated earlier event.
      await tx`insert into audit_events(id,aggregate_type,aggregate_id,aggregate_version,event_type,event_version,actor,occurred_at,request_id,before,after) values(${eventId},'membership',${membership.id},${membership.row_version},${eventType},1,${tx.json(actor)},now(),${randomUUID()},${before ? tx.json(before) : null},${tx.json(associatedAfter)})`;
      await tx`insert into outbox_messages(id,event_id,topic,payload) values(${randomUUID()},${eventId},${eventType},${tx.json(associatedAfter)})`;
    };
    if (plan.kind === "update_role") {
      phase = "update_role";
      await client.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${person.email}))`;
        // The same lock the Team page takes, so the administrator count below
        // cannot change underneath this update.
        await tx`select id from memberships where organization_id=${manifest.organization.id} for update`;
        phase = "role_authority";
        const [administrators] = await tx<
          { total: number }[]
        >`select count(*)::int as total from memberships m join commerce_users u on u.id=m.user_id where m.organization_id=${manifest.organization.id} and public.member_has_permission(m.user_id, 'staff:manage', m.organization_id) and u.is_internal_staff and m.user_id<>${plan.userId}`;
        assertStaffAdministratorRemains({
          from: plan.from,
          to: person.role,
          otherAdministrators: administrators?.total ?? 0,
        });
        phase = "role_update";
        const updated = await tx<
          { id: string; row_version: number }[]
        >`update memberships set role=${person.role} where user_id=${plan.userId} and organization_id=${manifest.organization.id} and role=${plan.from} returning id,row_version`;
        const membership = updated[0];
        if (updated.length !== 1 || !membership)
          throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
        phase = "role_audit";
        await appendEvent(
          tx,
          membership,
          "staff.role_changed",
          { email: person.email, role: person.role },
          { email: person.email, role: plan.from },
        );
      });
      console.log(
        "staff provisioning: existing staff role updated; the new role applies at the next request",
      );
      return;
    }
    phase = plan.kind;
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${person.email}))`;
      const after = {
        email: person.email,
        name: person.name,
        title: person.title,
        role: person.role,
        workosUserId: binding.workosUserId,
        mfaRequiredAtLogin: true,
      };
      if (plan.kind === "restore") {
        const current =
          await tx`select id from memberships where user_id=${plan.userId}`;
        if (current.length)
          throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
        const membershipId = randomUUID();
        await tx`insert into memberships(id,organization_id,user_id,workos_membership_id,role) values(${membershipId},${manifest.organization.id},${plan.userId},${binding.workosMembershipId},${person.role})`;
        await appendEvent(
          tx,
          { id: membershipId, row_version: 1 },
          "staff.reactivated",
          after,
        );
        return;
      }
      const duplicate =
        await tx`select id from commerce_users where lower(email)=${person.email}`;
      if (duplicate.length)
        throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
      const id = randomUUID();
      const membershipId = randomUUID();
      await tx`insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled) values(${id},${binding.workosUserId},${person.email},${person.name},true,false)`;
      await tx`insert into memberships(id,organization_id,user_id,workos_membership_id,role) values(${membershipId},${manifest.organization.id},${id},${binding.workosMembershipId},${person.role})`;
      await appendEvent(
        tx,
        { id: membershipId, row_version: 1 },
        "staff.provisioned",
        after,
      );
    });
    console.log(
      `staff provisioning: identity and ${person.role} membership ${plan.kind === "restore" ? "restored" : "created"}; email verification and MFA remain required at login`,
    );
  } finally {
    await client.end();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  provisionStaff().catch((error: unknown) => {
    console.error("staff provisioning failed", {
      phase,
      code: staffProvisioningFailureCode(error),
    });
    process.exitCode = 1;
  });
