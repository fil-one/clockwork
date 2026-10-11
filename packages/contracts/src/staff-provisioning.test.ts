import { describe, expect, it } from "vitest";

import {
  assertStaffAdministratorRemains,
  assertStaffProvisioningTarget,
  planStaffProvisioning,
  staffEmailDomainAllowed,
  staffProvisioningFailureCode,
  StaffProvisioningSchema,
  type ExistingStaffIdentityRow,
} from "./staff-provisioning";

const organizationId = "30000000-0000-4000-8000-000000000008";
const person = (input: Record<string, unknown> = {}) =>
  StaffProvisioningSchema.parse({
    email: "Seller@Fil.One",
    name: "New Seller",
    title: "Account executive",
    ...input,
  });
const staffRow = (
  input: Partial<ExistingStaffIdentityRow> = {},
): ExistingStaffIdentityRow => ({
  id: "20000000-0000-4000-8000-000000000010",
  workos_user_id: "user_seller",
  is_internal_staff: true,
  role: "revenue",
  organization_id: organizationId,
  ...input,
});

describe("staff provisioning diagnostics", () => {
  it.each([
    "STAFF_PROVISIONING_SCOPE_MISMATCH",
    "STAFF_PROVISIONING_BINDING_CONFLICT",
    "STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT",
    "STAFF_WORKOS_HTTP_401",
    "STAFF_WORKOS_HTTP_429",
  ])("retains the safe refusal %s", (code) => {
    expect(staffProvisioningFailureCode(new Error(code))).toBe(code);
  });

  it("reports SQLSTATE without database detail, SQL or credentials", () => {
    const error = Object.assign(new Error("secret database connection"), {
      code: "42703",
      detail: "private identity",
      query: "secret SQL",
    });
    expect(staffProvisioningFailureCode(error)).toBe("STAFF_DATABASE_42703");
  });

  it.each([
    new Error("STAFF_PROVISIONING_API_KEY_SECRET"),
    new Error("STAFF_WORKOS_HTTP_401 secret-token"),
    Object.assign(new Error("private provider body"), { code: "secret-value" }),
    { message: "STAFF_PROVISIONING_SCOPE_MISMATCH", secret: "private" },
    "secret response",
  ])("redacts unexpected failures %#", (error) => {
    expect(staffProvisioningFailureCode(error)).toBe(
      "STAFF_PROVISIONING_UNEXPECTED",
    );
  });

  it("redacts malformed provisioning values", () => {
    const parsed = StaffProvisioningSchema.safeParse({
      email: "private-invalid",
    });
    if (parsed.success) throw new Error("Expected invalid provisioning input");
    expect(staffProvisioningFailureCode(parsed.error)).toBe(
      "STAFF_PROVISIONING_INVALID_INPUT",
    );
    expect(staffProvisioningFailureCode(new SyntaxError("private JSON"))).toBe(
      "STAFF_PROVISIONING_INVALID_JSON",
    );
  });
});

describe("staff provisioning input", () => {
  it("defaults new staff to the seller role and lowercases the email", () => {
    expect(person()).toMatchObject({
      email: "seller@fil.one",
      role: "revenue",
    });
  });

  it.each(["revenue", "commerce_admin", "internal_operator"])(
    "accepts the %s role",
    (role) => {
      expect(person({ role }).role).toBe(role);
    },
  );

  it.each(["finance_approver", "owner", "partner_admin"])(
    "refuses the %s role",
    (role) => {
      expect(() => person({ role })).toThrow();
    },
  );

  it("accepts only an explicit true for a role update and no other fields", () => {
    expect(person({ updateRole: true }).updateRole).toBe(true);
    expect(() => person({ updateRole: false })).toThrow();
    expect(() => person({ approvalLimit: 1 })).toThrow();
  });
});

describe("staff email domains", () => {
  it("matches the configured domains exactly, ignoring case and spaces", () => {
    expect(staffEmailDomainAllowed("a@fil.one", "fil.org, Fil.One")).toBe(true);
    expect(staffEmailDomainAllowed("a@evil-fil.one", "fil.one")).toBe(false);
    expect(staffEmailDomainAllowed("a@fil.one.example", "fil.one")).toBe(false);
    expect(staffEmailDomainAllowed("a@fil.one", undefined)).toBe(false);
    expect(staffEmailDomainAllowed("fil.one", "fil.one")).toBe(false);
  });
});

describe("staff provisioning target", () => {
  const manifest = {
    environment: "production",
    targetDatabaseHost: "db.example",
    operatorUserId: "20000000-0000-4000-8000-000000000001",
    organization: { id: organizationId, workosOrganizationId: "org_staff" },
  };

  it("runs only against the manifest's database and stage", () => {
    expect(() =>
      assertStaffProvisioningTarget({
        manifest,
        databaseHost: "db.example",
        deployStage: "prod",
      }),
    ).not.toThrow();
    expect(() =>
      assertStaffProvisioningTarget({
        manifest,
        databaseHost: "other.example",
        deployStage: "prod",
      }),
    ).toThrow("STAFF_PROVISIONING_TARGET_MISMATCH");
    expect(() =>
      assertStaffProvisioningTarget({
        manifest,
        databaseHost: "db.example",
        deployStage: "staging",
      }),
    ).toThrow("STAFF_PROVISIONING_TARGET_MISMATCH");
  });
});

describe("staff provisioning plan", () => {
  it("creates a person the database does not know", () => {
    expect(
      planStaffProvisioning({ existing: [], person: person(), organizationId }),
    ).toEqual({ kind: "create" });
  });

  it("verifies an existing staff member whose role already matches", () => {
    expect(
      planStaffProvisioning({
        existing: [staffRow()],
        person: person(),
        organizationId,
      }),
    ).toMatchObject({ kind: "verify", workosUserId: "user_seller" });
  });

  it("changes a role only when the secret asks for it", () => {
    expect(() =>
      planStaffProvisioning({
        existing: [staffRow()],
        person: person({ role: "commerce_admin" }),
        organizationId,
      }),
    ).toThrow("STAFF_PROVISIONING_ROLE_CHANGE_NOT_REQUESTED");
    expect(
      planStaffProvisioning({
        existing: [staffRow()],
        person: person({ role: "commerce_admin", updateRole: true }),
        organizationId,
      }),
    ).toMatchObject({ kind: "update_role", from: "revenue" });
  });

  it("restores a deactivated staff member who holds no membership", () => {
    expect(
      planStaffProvisioning({
        existing: [staffRow({ role: null, organization_id: null })],
        person: person(),
        organizationId,
      }),
    ).toMatchObject({ kind: "restore" });
  });

  it.each([
    ["a customer identity", [staffRow({ is_internal_staff: false })]],
    [
      "a member of another organization",
      [staffRow({ organization_id: "30000000-0000-4000-8000-000000000001" })],
    ],
    ["an identity with several memberships", [staffRow(), staffRow()]],
  ])("refuses %s", (_label, existing) => {
    expect(() =>
      planStaffProvisioning({
        existing,
        person: person({ updateRole: true }),
        organizationId,
      }),
    ).toThrow("STAFF_PROVISIONING_EXISTING_IDENTITY_CONFLICT");
  });
});

describe("last commerce administrator", () => {
  it("refuses to demote the only administrator", () => {
    expect(() =>
      assertStaffAdministratorRemains({
        from: "commerce_admin",
        to: "revenue",
        otherAdministrators: 0,
      }),
    ).toThrow("STAFF_PROVISIONING_LAST_ADMIN");
  });

  it("allows the change while another administrator remains", () => {
    expect(() =>
      assertStaffAdministratorRemains({
        from: "commerce_admin",
        to: "internal_operator",
        otherAdministrators: 1,
      }),
    ).not.toThrow();
  });

  it("ignores changes that do not remove an administrator", () => {
    expect(() =>
      assertStaffAdministratorRemains({
        from: "revenue",
        to: "commerce_admin",
        otherAdministrators: 0,
      }),
    ).not.toThrow();
  });
});
