import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoutePermissionGate } from "@/src/features/shell/permission-gate";

import {
  CommercialCollectionPage,
  CommercialErrorState,
  CommercialLoadingState,
} from "./collection-page";

describe("commercial collection states", () => {
  it("renders loading and retryable error guidance", () => {
    const { rerender } = render(<CommercialLoadingState />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading records");
    const retry = vi.fn();
    rerender(<CommercialErrorState retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
  });

  it("distinguishes empty collections from filtered no-match results", () => {
    const { rerender } = render(
      <CommercialCollectionPage kind="quotes" records={[]} searchParams={{}} />,
    );
    expect(screen.getByText("Nothing here yet")).toBeVisible();
    rerender(
      <CommercialCollectionPage
        kind="quotes"
        searchParams={{ q: "does-not-exist" }}
      />,
    );
    expect(screen.getByText("No records match these filters")).toBeVisible();
  });

  it("renders a permission state for a member attempting a mutation", () => {
    render(
      <RoutePermissionGate
        audience="customer"
        requiredPermission="quote:write"
        roles={["member"]}
      >
        <p>Quote mutation</p>
      </RoutePermissionGate>,
    );
    expect(screen.queryByText("Quote mutation")).not.toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("not available");
  });
});
