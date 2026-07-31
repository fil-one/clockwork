import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RoutePermissionGate } from "./permission-gate";

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
