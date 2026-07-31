import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { StateGallery } from "@/src/features/states/state-gallery";
import { ExperiencePage } from "@/src/features/surfaces/experience-page";

describe("experience accessibility", () => {
  it("has no axe violations in the customer dashboard", async () => {
    render(<ExperiencePage surface="dashboard" />);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });

  it("has no axe violations across designed application states", async () => {
    render(<StateGallery />);
    expect((await axe.run(document.body)).violations).toEqual([]);
  });
});
