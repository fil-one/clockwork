import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { permissionsForRoles, type Permission } from "@clockwork/contracts";

import { audienceCanAccess } from "./navigation";
import { RoutePermissionGate, SurfacePermissionGate } from "./permission-gate";

const getRoutePermissions =
  vi.fn<(audience: string) => Promise<readonly Permission[]>>();

vi.mock("./route-session", () => ({
  getRoutePermissions: (audience: string) => getRoutePermissions(audience),
}));

describe("route permission gate", () => {
  it("renders customer content only for allowed commerce roles", () => {
    const billing = permissionsForRoles(["billing"]);
    const { rerender } = render(
      <RoutePermissionGate audience="customer" permissions={billing}>
        <p>Account billing</p>
      </RoutePermissionGate>,
    );
    expect(screen.getByText("Account billing")).toBeInTheDocument();
    rerender(
      <RoutePermissionGate audience="internal" permissions={billing}>
        <p>Back office</p>
      </RoutePermissionGate>,
    );
    expect(screen.queryByText("Back office")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("not available");
  });
});

describe("portal audiences", () => {
  it.each([
    ["owner", "customer", "customer"],
    ["member", "customer", "customer"],
    ["partner_admin", "channel_partner", "partner"],
    ["partner_seller", "referral_partner", "partner"],
    ["revenue", "fil_one", "internal"],
    ["commerce_admin", "fil_one", "internal"],
  ] as const)("opens only one portal to %s on %s", (role, side, audience) => {
    const permissions = permissionsForRoles([role], { side });
    for (const candidate of ["customer", "partner", "internal"] as const)
      expect(audienceCanAccess(candidate, permissions)).toBe(
        candidate === audience,
      );
  });

  it("opens no portal to a session without permissions", () => {
    expect(audienceCanAccess("internal", [])).toBe(false);
    expect(audienceCanAccess("partner", [])).toBe(false);
  });
});

describe("surface permission gate", () => {
  it("resolves the permissions on the server rather than from the client tree", async () => {
    getRoutePermissions.mockResolvedValue(permissionsForRoles(["owner"]));
    render(
      await SurfacePermissionGate({
        audience: "customer",
        requiredPermission: "quote:write",
        children: <p>Quote mutation</p>,
      }),
    );
    expect(getRoutePermissions).toHaveBeenCalledWith("customer");
    expect(screen.getByText("Quote mutation")).toBeInTheDocument();
  });

  it("never renders the child of a denied surface", async () => {
    getRoutePermissions.mockResolvedValue(permissionsForRoles(["member"]));
    const Child = vi.fn(() => <p>Quote mutation</p>);
    render(
      await SurfacePermissionGate({
        audience: "customer",
        requiredPermission: "quote:write",
        children: <Child />,
      }),
    );
    expect(Child).not.toHaveBeenCalled();
    expect(screen.queryByText("Quote mutation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("not available");
  });

  it("denies a surface when the session carries no permissions", async () => {
    getRoutePermissions.mockResolvedValue([]);
    render(
      await SurfacePermissionGate({
        audience: "internal",
        requiredPermission: "billing:approve",
        children: <p>Collections queue</p>,
      }),
    );
    expect(screen.queryByText("Collections queue")).not.toBeInTheDocument();
  });
});
