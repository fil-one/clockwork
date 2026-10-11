import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionsForRoles, type Role } from "@clockwork/contracts";

const mocks = vi.hoisted(() => ({
  routeSession: vi.fn(),
  commerceSession: vi.fn(),
}));
vi.mock("./route-session", () => ({ getRouteSession: mocks.routeSession }));
vi.mock("@/src/auth/session", () => ({
  getCommerceSession: mocks.commerceSession,
}));

import {
  requireStaffPermission,
  StaffPermissionError,
  staffMayUse,
  withStaffPermission,
} from "./staff-access";

function signedInAs(...roles: Role[]) {
  const permissions = permissionsForRoles(roles, { side: "fil_one" });
  mocks.routeSession.mockResolvedValue({ roles, permissions });
  mocks.commerceSession.mockResolvedValue({
    roles,
    permissions,
    isInternalStaff: true,
  });
}

beforeEach(() => vi.clearAllMocks());

describe("staff page guard", () => {
  it("refuses a seller on an operations page without starting the page", async () => {
    signedInAs("revenue");
    const page = vi.fn(() => <p>Webhook replay</p>);
    render(await withStaffPermission("operations:read", page)());
    expect(page).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "This page is not part of your workspace",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your role, Revenue, does not/u)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to your home page" }),
    ).toHaveAttribute("href", "/internal");
  });

  it("lets a seller use a sales page", async () => {
    signedInAs("revenue");
    render(
      await withStaffPermission("sales:read", () => (
        <p>Indicative pricing</p>
      ))(),
    );
    expect(screen.getByText("Indicative pricing")).toBeInTheDocument();
  });

  it("lets a commerce administrator use operations and team pages", async () => {
    signedInAs("commerce_admin");
    render(await withStaffPermission("operations:read", () => <p>Queues</p>)());
    expect(screen.getByText("Queues")).toBeInTheDocument();
    render(await withStaffPermission("staff:manage", () => <p>Team</p>)());
    expect(screen.getByText("Team")).toBeInTheDocument();
  });

  it("refuses an internal operator the team page, naming their role", async () => {
    signedInAs("internal_operator");
    render(await withStaffPermission("staff:manage", () => <p>Team</p>)());
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    expect(screen.getByText(/Internal operator/u)).toBeInTheDocument();
  });

  it("names the primary role and admits every permission of a multi-role seller", async () => {
    signedInAs("revenue", "legal_approver");
    render(
      await withStaffPermission("contract:approve", () => <p>Approve</p>)(),
    );
    expect(screen.getByText("Approve")).toBeInTheDocument();
    render(await withStaffPermission("staff:manage", () => <p>Team</p>)());
    expect(screen.getByText(/Your role, Revenue, does not/u)).toBeVisible();
  });

  it("passes the route props through to the page", async () => {
    signedInAs("commerce_admin");
    const page = vi.fn(({ id }: { id: string }) => <p>{id}</p>);
    render(await withStaffPermission("operations:read", page)({ id: "q-1" }));
    expect(screen.getByText("q-1")).toBeInTheDocument();
  });
});

describe("staff action guard", () => {
  it("refuses a seller an operations action", async () => {
    signedInAs("revenue");
    await expect(requireStaffPermission("operations:read")).rejects.toThrow(
      StaffPermissionError,
    );
  });

  it("refuses a customer even with a matching permission", async () => {
    mocks.commerceSession.mockResolvedValue({
      roles: ["owner"],
      permissions: permissionsForRoles(["owner"]),
      isInternalStaff: false,
    });
    await expect(requireStaffPermission("account:read")).rejects.toThrow(
      StaffPermissionError,
    );
    expect(
      staffMayUse(
        { roles: ["owner"], permissions: permissionsForRoles(["owner"]) },
        "account:read",
      ),
    ).toBe(false);
  });

  it("reads the session's permissions, so an assisted session stays without approvals", () => {
    const assisted = {
      roles: ["commerce_admin"],
      permissions: permissionsForRoles(["commerce_admin"], { assisted: true }),
    };
    expect(staffMayUse(assisted, "operations:read")).toBe(true);
    expect(staffMayUse(assisted, "staff:manage")).toBe(false);
    expect(staffMayUse(assisted, "quote:approve")).toBe(false);
  });

  it("returns the session to an administrator", async () => {
    signedInAs("commerce_admin");
    await expect(requireStaffPermission("staff:manage")).resolves.toMatchObject(
      { isInternalStaff: true },
    );
  });
});

/**
 * Every staff page outside the sales workspace is an operations page and must
 * refuse a seller on the server. A page added under /internal without the
 * guard fails here instead of quietly opening to the seller role.
 */
describe("every staff route is guarded", () => {
  const internal = join(process.cwd(), "app/(experience)/(internal)/internal");
  const sales: Readonly<Record<string, string>> = {
    // The landing page decides for itself: sales home or the operations board.
    "page.tsx": "landing",
    "pricing/page.tsx": "sales:read",
    // Partner records: read with the sales workspace, changed with
    // contract:write; the loaders check the same again before any read.
    "partners/page.tsx": "sales:read",
    "partners/[id]/page.tsx": "sales:read",
    "partners/new/page.tsx": "contract:write",
    "partners/[id]/edit/page.tsx": "contract:write",
    "team/page.tsx": "staff:manage",
    "owner/page.tsx": "staff:manage",
    // Creating an organization is operations work, not only reading.
    "organizations/new/page.tsx": "operations:write",
  };
  function pages(directory: string): string[] {
    return readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return pages(path);
      return name === "page.tsx" ? [relative(internal, path)] : [];
    });
  }

  it.each(pages(internal))("%s refuses roles it does not serve", (page) => {
    const path = page.split("\\").join("/");
    const source = readFileSync(join(internal, page), "utf8");
    const expected = sales[path];
    if (expected === "landing") {
      expect(source).toContain('staffMayUse(session, "sales:read")');
      return;
    }
    // The MNDA workspace checks `mnda:send` and `signatory:manage` in its own
    // server module for every page and action under /internal/mndas.
    if (path.startsWith("mndas/")) return;
    // Contract and sales library pages load through the contracts loaders,
    // which check `contract:*`, `sales:read` or `collateral:manage` before
    // any read.
    if (path.startsWith("contracts/") || path.startsWith("sales-library/")) {
      expect(source).toContain("@/src/features/internal-ops/contracts/loaders");
      return;
    }
    // A new sales page is listed above with the permission it requires;
    // anything unlisted is an operations page.
    expect(source).toContain(
      `export default withStaffPermission("${expected ?? "operations:read"}", Page);`,
    );
    expect(source).not.toMatch(/export default async function/u);
  });
});
