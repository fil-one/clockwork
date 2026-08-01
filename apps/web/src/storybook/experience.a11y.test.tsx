import { render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { StateGallery } from "@/src/features/states/state-gallery";
import { ExperiencePage } from "@/src/features/surfaces/experience-page";
import { DEMO_NOW, orders, timeline } from "@/src/features/shared/demo-data";

// The surface gate resolves roles on the server, so it cannot render here.
vi.mock("@/src/features/shell/permission-gate", () => ({
  SurfacePermissionGate: ({ children }: { children: ReactNode }) => children,
}));

describe("experience accessibility", () => {
  it("has no axe violations in the customer dashboard", async () => {
    render(
      <ExperiencePage
        surface="dashboard"
        records={orders}
        now={DEMO_NOW}
        timelineItems={timeline}
      />,
    );
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("has no axe violations across designed application states", async () => {
    render(<StateGallery />);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });
});
