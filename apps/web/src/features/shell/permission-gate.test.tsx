import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoutePermissionGate, SurfacePermissionGate } from "./permission-gate";

const getRouteRoles = vi.fn<(audience: string) => Promise<readonly string[]>>();

vi.mock("./route-session", () => ({
  getRouteRoles: (audience: string) => getRouteRoles(audience),
}));

describe("route permission gate", () => {
  it("renders customer content only for allowed commerce roles", () => {
    const { rerender } = render(
      <RoutePermissionGate audience="customer" roles={["billing"]}>
        <p>Account billing</p>
      </RoutePermissionGate>,
    );
    expect(screen.getByText("Account billing")).toBeInTheDocument();
    rerender(
      <RoutePermissionGate audience="internal" roles={["billing"]}>
        <p>Back office</p>
      </RoutePermissionGate>,
    );
    expect(screen.queryByText("Back office")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("not available");
  });
});

describe("surface permission gate", () => {
  it("resolves the roles on the server rather than from the client tree", async () => {
    getRouteRoles.mockResolvedValue(["owner"]);
    render(
      await SurfacePermissionGate({
        audience: "customer",
        requiredPermission: "quote:write",
        children: <p>Quote mutation</p>,
      }),
    );
    expect(getRouteRoles).toHaveBeenCalledWith("customer");
    expect(screen.getByText("Quote mutation")).toBeInTheDocument();
  });

  it("never renders the child of a denied surface", async () => {
    getRouteRoles.mockResolvedValue(["member"]);
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

  it("denies a surface when the session carries no roles", async () => {
    getRouteRoles.mockResolvedValue([]);
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
