import { z } from "zod";

/**
 * The roles a staff member can be given through provisioning or the team
 * page. Sellers start as `revenue`; the approver roles stay with the bootstrap
 * manifest, where each grant is reviewed on its own.
 */
export const staffProvisioningRoles = [
  "revenue",
  "commerce_admin",
  "internal_operator",
] as const;
export const StaffProvisioningRoleSchema = z.enum(staffProvisioningRoles);
export type StaffProvisioningRole = z.infer<typeof StaffProvisioningRoleSchema>;

/** Explicit deployment-owner input; never accepted from a customer request. */
export const StaffProvisioningSchema = z
  .object({
    email: z.email().transform((v) => v.toLowerCase()),
    name: z.string().trim().min(1).max(180),
    title: z.string().trim().min(1).max(180),
    role: StaffProvisioningRoleSchema.default("revenue"),
    // Changing an existing staff member's role is never implied by a
    // different role in the secret; it has to be asked for.
    updateRole: z.literal(true).optional(),
  })
  .strict();
export type StaffProvisioning = z.infer<typeof StaffProvisioningSchema>;

/** Splits a comma-separated domain list the way the deployment writes it. */
export function staffEmailDomains(configured: string | undefined): string[] {
  return (configured ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/** Whether an address is on one of the staff email domains. */
export function staffEmailDomainAllowed(
  email: string,
  configured: string | undefined,
): boolean {
  const at = email.lastIndexOf("@");
  const domain = at > 0 ? email.slice(at + 1).toLowerCase() : "";
  return domain.length > 0 && staffEmailDomains(configured).includes(domain);
}

export interface StaffProvisioningManifest {
  environment: string;
  targetDatabaseHost: string;
  operatorUserId: string;
  organization: { id: string; workosOrganizationId: string };
}

/**
 * The provisioning secret only runs against the database and deployment stage
 * its manifest names; anything else fails before the identity provider is
 * touched.
 */
export function assertStaffProvisioningTarget(input: {
  manifest: StaffProvisioningManifest;
  databaseHost: string;
  deployStage: string | undefined;
}): void {
  const stage = input.deployStage === "prod" ? "production" : input.deployStage;
  if (
    input.databaseHost !== input.manifest.targetDatabaseHost ||
    input.manifest.environment !== stage
  )
    throw new Error("STAFF_PROVISIONING_TARGET_MISMATCH");
}

/** One row per membership the existing commerce identity holds (or one row with no membership). */
export interface ExistingStaffIdentityRow {
  id: string;
  workos_user_id: string;
  is_internal_staff: boolean;
  role: string | null;
  organization_id: string | null;
}

export type StaffProvisioningPlan =
  | { kind: "create" }
  | { kind: "verify"; userId: string; workosUserId: string }
  | {
      kind: "update_role";
      userId: string;
      workosUserId: string;
      from: string;
    }
  | { kind: "restore"; userId: string; workosUserId: string };

/**
 * What provisioning should do for this person, decided before any provider or
 * database change. A person the staff organization does not already hold as
 * internal staff is never adopted: customer identities, people in another
 * organization and ambiguous matches all stop here with a specific code.
 */
export function planStaffProvisioning(input: {
  existing: readonly ExistingStaffIdentityRow[];
  person: StaffProvisioning;
  organizationId: string;
}): StaffProvisioningPlan {
  const { existing, person, organizationId } = input;
  if (existing.length > 1)
    throw new Error("STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT");
  const row = existing[0];
  if (!row) return { kind: "create" };
  if (!row.is_internal_staff)
    throw new Error("STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT");
  const identity = { userId: row.id, workosUserId: row.workos_user_id };
  // A staff member who was deactivated keeps their identity and history but
  // holds no membership; provisioning them again restores one.
  if (row.role === null || row.organization_id === null)
    return { kind: "restore", ...identity };
  if (row.organization_id !== organizationId)
    throw new Error("STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT");
  if (row.role === person.role) return { kind: "verify", ...identity };
  if (!person.updateRole)
    throw new Error("STAFF_PROVISIONING_ROLE_CHANGE_NOT_REQUESTED");
  return { kind: "update_role", ...identity, from: row.role };
}

/**
 * A role change may not leave the staff organization without a commerce
 * administrator. `otherAdministrators` counts the organization's other
 * commerce administrators, read under a lock on its memberships.
 */
export function assertStaffAdministratorRemains(input: {
  from: string;
  to: string;
  otherAdministrators: number;
}): void {
  if (
    input.from === "commerce_admin" &&
    input.to !== "commerce_admin" &&
    input.otherAdministrators < 1
  )
    throw new Error("STAFF_PROVISIONING_LAST_ADMIN");
}
