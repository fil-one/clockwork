import { randomUUID } from "node:crypto";
import { StaffProvisioningSchema } from "../packages/contracts/src/staff-provisioning";
import postgres from "postgres";
import { provisionWorkosStaff } from "../packages/integrations/src/workos/provision-staff";

async function main() {
  const raw = process.env.STAFF_PROVISIONING;
  if (!raw) return;
  const person = StaffProvisioningSchema.parse(JSON.parse(raw));
  const manifest = JSON.parse(process.env.BOOTSTRAP_MANIFEST ?? "null") as {
    environment: string;
    targetDatabaseHost: string;
    operatorUserId: string;
    organization: { id: string; workosOrganizationId: string };
  } | null;
  const url = process.env.DIRECT_DATABASE_URL,
    key = process.env.WORKOS_API_KEY;
  if (!manifest || !url || !key)
    throw new Error("STAFF_PROVISIONING_CONFIGURATION_REQUIRED");
  if (
    new URL(url).hostname !== manifest.targetDatabaseHost ||
    manifest.environment !==
      (process.env.DEPLOY_STAGE === "prod"
        ? "production"
        : process.env.DEPLOY_STAGE)
  )
    throw new Error("STAFF_PROVISIONING_TARGET_MISMATCH");
  const domain = person.email.split("@")[1];
  if (
    !domain ||
    !(process.env.INTERNAL_EMAIL_DOMAINS ?? "")
      .split(",")
      .map((v) => v.trim())
      .includes(domain)
  )
    throw new Error("STAFF_PROVISIONING_DOMAIN_DENIED");
  const client = postgres(url, {
    max: 1,
    prepare: false,
    ssl: new URL(url).hostname === "127.0.0.1" ? false : "require",
  });
  try {
    // Fail before provider changes unless the bootstrapped staff organization
    // and authorizing operator both exist in this exact deployed database.
    const scope =
      await client`select o.id from organizations o join memberships m on m.organization_id=o.id join commerce_users u on u.id=m.user_id where o.id=${manifest.organization.id} and o.workos_organization_id=${manifest.organization.workosOrganizationId} and u.id=${manifest.operatorUserId} and u.is_internal_staff and m.role='internal_operator'`;
    if (scope.length !== 1)
      throw new Error("STAFF_PROVISIONING_SCOPE_MISMATCH");
    const existing =
      await client`select u.id,u.workos_user_id,u.is_internal_staff,m.role,m.organization_id from commerce_users u left join memberships m on m.user_id=u.id where lower(u.email)=${person.email}`;
    if (
      existing.length > 1 ||
      (existing[0] &&
        (!existing[0].is_internal_staff ||
          existing[0].role !== person.role ||
          existing[0].organization_id !== manifest.organization.id))
    )
      throw new Error("STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT");
    const binding = await provisionWorkosStaff(
      key,
      manifest.organization.workosOrganizationId,
      person,
    );
    if (existing[0]) {
      if (existing[0].workos_user_id !== binding.workosUserId)
        throw new Error("STAFF_PROVISIONING_BINDING_CONFLICT");
      console.log("staff provisioning: existing identity and role verified");
      return;
    }
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${person.email}))`;
      const duplicate =
        await tx`select id from commerce_users where lower(email)=${person.email}`;
      if (duplicate.length)
        throw new Error("STAFF_PROVISIONING_RETRY_REQUIRED");
      const id = randomUUID(),
        eventId = randomUUID();
      await tx`insert into commerce_users(id,workos_user_id,email,name,is_internal_staff,mfa_enrolled) values(${id},${binding.workosUserId},${person.email},${person.name},true,false)`;
      await tx`insert into memberships(id,organization_id,user_id,workos_membership_id,role) values(${randomUUID()},${manifest.organization.id},${id},${binding.workosMembershipId},${person.role})`;
      const actor = { kind: "user", id: manifest.operatorUserId };
      const after = {
        email: person.email,
        name: person.name,
        title: person.title,
        role: person.role,
        workosUserId: binding.workosUserId,
        mfaRequiredAtLogin: true,
      };
      await tx`insert into audit_events(id,aggregate_type,aggregate_id,aggregate_version,event_type,event_version,actor,occurred_at,request_id,after) values(${eventId},'organization',${manifest.organization.id},1,'staff.provisioned',1,${tx.json(actor)},now(),${randomUUID()},${tx.json(after)})`;
      await tx`insert into outbox_messages(id,event_id,topic,payload) values(${randomUUID()},${eventId},'staff.provisioned',${tx.json(after)})`;
    });
    console.log(
      "staff provisioning: identity and internal operator membership created; email verification and MFA remain required at login",
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
