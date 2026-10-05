import { randomUUID } from "node:crypto";
import {
  assertStaffAdministratorRemains,
  assertStaffProvisioningTarget,
  planStaffProvisioning,
  staffEmailDomainAllowed,
  StaffProvisioningSchema,
  type ExistingStaffIdentityRow,
  type StaffProvisioningManifest,
} from "../packages/contracts/src/staff-provisioning";
import postgres from "postgres";
import { provisionWorkosStaff } from "../packages/integrations/src/workos/provision-staff";

async function main() {
  const raw = process.env.STAFF_PROVISIONING;
  if (!raw) return;
  const person = StaffProvisioningSchema.parse(JSON.parse(raw));
  const manifest = JSON.parse(
    process.env.BOOTSTRAP_MANIFEST ?? "null",
  ) as StaffProvisioningManifest | null;
  const url = process.env.DIRECT_DATABASE_URL,
    key = process.env.WORKOS_API_KEY;
  if (!manifest || !url || !key)
    throw new Error("STAFF_PROVISIONING_CONFIGURATION_REQUIRED");
  assertStaffProvisioningTarget({
    manifest,
    databaseHost: new URL(url).hostname,
    deployStage: process.env.DEPLOY_STAGE,
  });
  if (
    !staffEmailDomainAllowed(person.email, process.env.INTERNAL_EMAIL_DOMAINS)
  )
    throw new Error("STAFF_PROVISIONING_DOMAIN_DENIED");
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: new URL(url).hostname === "127.0.0.1" ? false : "require",
  });
  try {
    // Fail before provider changes unless the bootstrapped staff organization
    // and authorizing operator both exist in this exact deployed database. A
    // commerce administrator authorizes as an operator does.
    const scope =
      await client`select o.id from organizations o join memberships m on m.organization_id=o.id join commerce_users u on u.id=m.user_id where o.id=${manifest.organization.id} and o.workos_organization_id=${manifest.organization.workosOrganizationId} and u.id=${manifest.operatorUserId} and u.is_internal_staff and m.role in ('internal_operator','commerce_admin')`;
    if (scope.length !== 1)
      throw new Error("STAFF_PROVISIONING_SCOPE_MISMATCH");
    const existing = await client<
      ExistingStaffIdentityRow[]
    >`select u.id,u.workos_user_id,u.is_internal_staff,m.role,m.organization_id from commerce_users u left join memberships m on m.user_id=u.id where lower(u.email)=${person.email}`;
    const plan = planStaffProvisioning({
      existing,
      person,
      organizationId: manifest.organization.id,
    });
    const binding = await provisionWorkosStaff(
      key,
      manifest.organization.workosOrganizationId,
      person,
    );
    if (plan.kind !== "create" && plan.workosUserId !== binding.workosUserId)
      throw new Error("STAFF_PROVISIONING_BINDING_CONFLICT");
    if (plan.kind === "verify") {
      console.log("staff provisioning: existing identity and role verified");
      return;
    }
    const actor = { kind: "user", id: manifest.operatorUserId };
    const appendEvent = async (
      tx: postgres.TransactionSql,
      eventType: string,
      after: Record<string, string | boolean>,
      before?: Record<string, string | boolean>,
    ) => {
      const eventId = randomUUID();
      await tx`insert into audit_events(id,aggregate_type,aggregate_id,aggregate_version,event_type,event_version,actor,occurred_at,request_id,before,after) values(${eventId},'organization',${manifest.organization.id},1,${eventType},1,${tx.json(actor)},now(),${randomUUID()},${before ? tx.json(before) : null},${tx.json(after)})`;
      await tx`insert into outbox_messages(id,event_id,topic,payload) values(${randomUUID()},${eventId},${eventType},${tx.json(after)})`;
    };
    if (plan.kind === "update_role") {
      await client.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtext(${person.email}))`;
        // The same lock the Team page takes, so the administrator count below
        // cannot change underneath this update.
        await tx`select id from memberships where organization_id=${manifest.organization.id} for update`;
        const [administrators] = await tx<
          { total: number }[]
        >`select count(*)::int as total from memberships m join commerce_users u on u.id=m.user_id where m.organization_id=${manifest.organization.id} and m.role='commerce_admin' and u.is_internal_staff and m.user_id<>${plan.userId}`;
        assertStaffAdministratorRemains({
          from: plan.from,
          to: person.role,
          otherAdministrators: administrators?.total ?? 0,
        });
        const updated =
          await tx`update memberships set role=${person.role} where user_id=${plan.userId} and organization_id=${manifest.organization.id} and role=${plan.from} returning id`;
        if (updated.length !== 1)
          throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
        await appendEvent(
          tx,
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
        await tx`insert into memberships(id,organization_id,user_id,workos_membership_id,role) values(${randomUUID()},${manifest.organization.id},${plan.userId},${binding.workosMembershipId},${person.role})`;
        await appendEvent(tx, "staff.reactivated", after);
        return;
      }
      const duplicate =
        await tx`select id from commerce_users where lower(email)=${person.email}`;
      if (duplicate.length)
        throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
      const id = randomUUID();
      await tx`insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled) values(${id},${binding.workosUserId},${person.email},${person.name},true,false)`;
      await tx`insert into memberships(id,organization_id,user_id,workos_membership_id,role) values(${randomUUID()},${manifest.organization.id},${id},${binding.workosMembershipId},${person.role})`;
      await appendEvent(tx, "staff.provisioned", after);
    });
    console.log(
      `staff provisioning: identity and ${person.role} membership ${plan.kind === "restore" ? "restored" : "created"}; email verification and MFA remain required at login`,
    );
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error(
    "staff provisioning failed; no credentials or identity-provider response bodies logged",
  );
  process.exitCode = 1;
});
